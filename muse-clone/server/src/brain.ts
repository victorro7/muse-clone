// The agent loop, ported from the local dev route (src/app/api/chat+api.ts)
// with Supabase persistence + vector memory layered on top.
//
// When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent, persistence and
// memory are skipped entirely and this behaves exactly like the dev route:
// memoryless, with Composio sessions held in a process-local map.

import { Composio } from '@composio/core';
import OpenAI from 'openai';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type Config, hasPersistence } from './config';

export type ChatMessage = { role: 'user' | 'assistant'; text: string };

export type ChatResult = {
  status: 200 | 400 | 500;
  body: { reply?: string; conversationId?: string; error?: string; hint?: string };
};

type ComposioSession = Awaited<ReturnType<InstanceType<typeof Composio>['sessions']['use']>>;
type MemoryHit = { id: string; content: string; similarity: number };

const MAX_TOOL_ROUNDS = 8;
const HISTORY_LIMIT = 40;
const MEMORY_TOP_K = 5;
const MEMORY_SIMILARITY_THRESHOLD = 0.85;
const EMBEDDING_MODEL = 'text-embedding-004'; // Gemini embedding model (768 dims)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INSTRUCTIONS = `You are Raven, a personal AI companion living in a mobile chat app.
You can take real actions in the user's connected apps using your tools (email, calendar, and more).
Keep replies short, casual, and chatty — this is a phone chat, not an essay.
Only call tools when the user actually asks you to do something or the request clearly needs live data.
If a tool call fails because an account isn't connected, say so plainly and say which app to connect in the Composio dashboard.`;

// Process-local Composio sessions — only used when Supabase is absent.
const memorylessSessions = new Map<string, string>();

function makeLLM(config: Config): OpenAI {
  return new OpenAI({
    apiKey: config.llmKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  });
}

function makeSupabase(config: Config): SupabaseClient | null {
  if (!hasPersistence(config)) return null;
  return createClient(config.supabaseUrl!, config.supabaseServiceKey!);
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function parseJsonStringArray(text: string): string[] {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // fall through
  }
  return [];
}

async function embed(openai: OpenAI, text: string): Promise<number[]> {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  const vec = res.data[0]?.embedding;
  if (!vec) throw new Error('empty embedding response');
  return vec;
}

async function recallMemories(
  supabase: SupabaseClient,
  userId: string,
  queryEmbedding: number[],
  topK: number,
): Promise<MemoryHit[]> {
  const { data, error } = await supabase.rpc('match_memories', {
    query_embedding: queryEmbedding,
    match_user_id: userId,
    match_count: topK,
  });
  if (error) throw error;
  return (data ?? []) as MemoryHit[];
}

type ConversationRow = { id: string; composio_session_id: string | null; title: string | null };

async function getOrCreateConversation(
  supabase: SupabaseClient,
  userId: string,
  clientConversationId: string | undefined,
  firstUserText: string,
): Promise<ConversationRow> {
  if (clientConversationId && UUID_RE.test(clientConversationId)) {
    const { data } = await supabase
      .from('conversations')
      .select('id, composio_session_id, title')
      .eq('id', clientConversationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return data as ConversationRow;
  }
  const title = (firstUserText || 'New chat').slice(0, 60);
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title })
    .select('id, composio_session_id, title')
    .single();
  if (error) throw error;
  return data as ConversationRow;
}

async function loadHistory(supabase: SupabaseClient, conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return (data ?? []).map((m) => ({
    role: m.role as 'user' | 'assistant',
    text: m.content as string,
  }));
}

/**
 * Merge DB history with the messages the app sent. The app sends its full
 * local history each turn, so anything already persisted is filtered out —
 * except the final incoming message, which is always the new user message
 * and must never be dropped (even if identical to an older one).
 */
function mergeHistory(
  dbHistory: ChatMessage[],
  incoming: ChatMessage[],
): { history: ChatMessage[]; fresh: ChatMessage[] } {
  const key = (m: ChatMessage) => `${m.role}\n${m.text}`;
  const seen = new Set(dbHistory.map(key));
  const last = incoming[incoming.length - 1];
  const fresh = incoming.slice(0, -1).filter((m) => !seen.has(key(m)));
  if (last) fresh.push(last);
  return { history: [...dbHistory, ...fresh], fresh };
}

async function getSession(
  composio: Composio,
  supabase: SupabaseClient | null,
  conversation: ConversationRow | null,
  conversationKey: string,
  userId: string,
  toolkits: string[],
): Promise<ComposioSession> {
  if (supabase && conversation) {
    if (conversation.composio_session_id) {
      try {
        return await composio.sessions.use(conversation.composio_session_id);
      } catch {
        // Session expired or invalid — recreate below.
      }
    }
    const session = await composio.sessions.create(
      userId,
      toolkits.length > 0 ? { toolkits } : {},
    );
    await supabase
      .from('conversations')
      .update({ composio_session_id: session.sessionId, updated_at: new Date().toISOString() })
      .eq('id', conversation.id);
    return session;
  }
  // Memoryless fallback (no Supabase): process-local session map.
  const existing = memorylessSessions.get(conversationKey);
  if (existing) {
    try {
      return await composio.sessions.use(existing);
    } catch {
      memorylessSessions.delete(conversationKey);
    }
  }
  const session = await composio.sessions.create(
    userId,
    toolkits.length > 0 ? { toolkits } : {},
  );
  memorylessSessions.set(conversationKey, session.sessionId);
  return session;
}

async function runAgent(
  openai: OpenAI,
  model: string,
  session: ComposioSession,
  systemPrompt: string,
  history: ChatMessage[],
): Promise<string> {
  // The default OpenAI provider already converts session tools to the
  // Chat Completions function-tool format, with the Composio slug as the
  // function name — so session.execute() can run them directly.
  const tools = (await session.tools()) as OpenAI.Chat.Completions.ChatCompletionTool[];

  const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(
      (m): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
        role: m.role,
        content: m.text,
      }),
    ),
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      tools: tools.length > 0 ? tools : undefined,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) throw new Error('Empty model response');
    chatMessages.push(choice);

    const toolCalls = choice.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return choice.content?.trim() || "(I didn't get a text answer back.)";
    }

    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      let toolContent: string;
      try {
        const args = safeJsonParse(call.function.arguments);
        const result = await session.execute(call.function.name, args);
        toolContent = result.error
          ? `Tool error: ${result.error}`
          : JSON.stringify(result.data).slice(0, 12000);
      } catch (err) {
        toolContent = `Tool error: ${err instanceof Error ? err.message : 'execution failed'}`;
      }
      chatMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: toolContent,
      });
    }
  }

  return '(I did a bunch of tool calls but ran out of steps — ask me to summarize.)';
}

/**
 * Fire-and-forget: extract durable facts about the user from the recent
 * conversation and store them as vector memories. Skips facts that are
 * already remembered (cosine similarity >= threshold).
 */
async function extractMemories(
  supabase: SupabaseClient,
  openai: OpenAI,
  model: string,
  userId: string,
  history: ChatMessage[],
  reply: string,
): Promise<void> {
  const convoText = [...history.slice(-12), { role: 'assistant' as const, text: reply }]
    .map((m) => `${m.role === 'user' ? 'Victor' : 'Raven'}: ${m.text}`)
    .join('\n');

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You extract durable facts about the user from a conversation. ' +
          'Return ONLY a JSON array of strings, e.g. ["Victor lives in Cambridge, MA", "Victor prefers light food before drinking"]. ' +
          'Each string is one durable fact, preference, or stable piece of personal context about the USER (not the assistant). ' +
          'Only include things likely to still be true in 6 months. If nothing durable was said, return [].',
      },
      { role: 'user', content: convoText },
    ],
  });

  const facts = parseJsonStringArray(completion.choices[0]?.message?.content ?? '');
  for (const fact of facts.slice(0, 10)) {
    if (fact.length < 8) continue;
    const vec = await embed(openai, fact);
    const existing = await recallMemories(supabase, userId, vec, 1);
    if (existing[0] && existing[0].similarity >= MEMORY_SIMILARITY_THRESHOLD) continue;
    const { error } = await supabase
      .from('memories')
      .insert({ user_id: userId, content: fact, embedding: vec });
    if (error) throw error;
  }
}

export async function handleChat(
  body: { conversationId?: string; messages?: ChatMessage[] },
  config: Config,
): Promise<ChatResult> {
  const { conversationId, messages } = body;
  if (!conversationId || !Array.isArray(messages) || messages.length === 0) {
    return { status: 400, body: { error: 'conversationId and messages are required' } };
  }
  if (!config.composioKey || !config.llmKey) {
    return {
      status: 400,
      body: {
        error: 'missing_keys',
        hint: 'Set COMPOSIO_API_KEY and GEMINI_API_KEY (or OPENAI_API_KEY) on the server, then restart it.',
      },
    };
  }

  const openai = makeLLM(config);
  const supabase = makeSupabase(config);
  const userId = config.singleUserId;

  try {
    let conversation: ConversationRow | null = null;
    let dbConversationId = conversationId;
    let dbHistory: ChatMessage[] = [];

    if (supabase) {
      await supabase.from('users').upsert({ id: userId }, { onConflict: 'id' });
      const firstUserText = messages.find((m) => m.role === 'user')?.text ?? '';
      conversation = await getOrCreateConversation(supabase, userId, conversationId, firstUserText);
      dbConversationId = conversation.id;
      dbHistory = await loadHistory(supabase, conversation.id);
    }

    const { history, fresh } = mergeHistory(dbHistory, messages);

    // Memory recall: embed the latest user message, pull the most similar
    // remembered facts, and add them to the system prompt.
    let systemPrompt = INSTRUCTIONS;
    if (supabase) {
      try {
        const latestUser = [...history].reverse().find((m) => m.role === 'user');
        if (latestUser) {
          const queryVec = await embed(openai, latestUser.text);
          const hits = await recallMemories(supabase, userId, queryVec, MEMORY_TOP_K);
          if (hits.length > 0) {
            systemPrompt +=
              '\n\nThings you remember about Victor:\n' +
              hits.map((h) => `- ${h.content}`).join('\n') +
              '\nUse these naturally when relevant. Never mention that you "recalled a memory".';
          }
        }
      } catch (err) {
        console.error('[brain] memory recall failed:', err instanceof Error ? err.message : err);
      }
    }

    // Persist the new messages before running the agent so nothing is lost
    // if the agent run fails halfway.
    if (supabase && fresh.length > 0) {
      const { error } = await supabase.from('messages').insert(
        fresh.map((m) => ({ conversation_id: dbConversationId, role: m.role, content: m.text })),
      );
      if (error) throw error;
      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', dbConversationId);
    }

    const composio = new Composio({ apiKey: config.composioKey });
    const session = await getSession(
      composio,
      supabase,
      conversation,
      conversationId,
      userId,
      config.toolkits,
    );
    const reply = await runAgent(openai, config.model, session, systemPrompt, history);

    if (supabase) {
      const { error } = await supabase
        .from('messages')
        .insert({ conversation_id: dbConversationId, role: 'assistant', content: reply });
      if (error) throw error;
      // Don't block the response on memory extraction.
      void extractMemories(supabase, openai, config.model, userId, history, reply).catch((err) =>
        console.error('[brain] memory extraction failed:', err instanceof Error ? err.message : err),
      );
    }

    return { status: 200, body: { reply, conversationId: dbConversationId } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[brain] agent run failed:', message);
    return { status: 500, body: { error: 'agent_failed', hint: message } };
  }
}
