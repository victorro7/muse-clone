import { Composio } from '@composio/core';
import OpenAI from 'openai';

type ChatMessage = { role: 'user' | 'assistant'; text: string };

// One Composio session per conversation, reused across turns.
const sessionIds = new Map<string, string>();
const USER_ID = 'muse-clone-user';
const MAX_TOOL_ROUNDS = 8;

const INSTRUCTIONS = `You are Raven, a personal AI companion living in a mobile chat app.
You can take real actions in the user's connected apps using your tools (email, calendar, and more).
Keep replies short, casual, and chatty — this is a phone chat, not an essay.
Only call tools when the user actually asks you to do something or the request clearly needs live data.
If a tool call fails because an account isn't connected, say so plainly and say which app to connect in the Composio dashboard.`;

function getConfig() {
  const composioKey = process.env.COMPOSIO_API_KEY;
  // LLM provider: Gemini free tier (default) or OpenAI. Gemini's endpoint is
  // OpenAI-compatible, so the same chat-completions client works for both.
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const llmKey = geminiKey || openaiKey;
  if (!composioKey || !llmKey) return null;
  const toolkits = (process.env.COMPOSIO_TOOLKITS ?? '')
    .split(',')
    .map((t: string) => t.trim().toLowerCase())
    .filter(Boolean);
  return {
    composioKey,
    llmKey,
    toolkits,
    baseURL:
      process.env.LLM_BASE_URL ||
      (geminiKey ? 'https://generativelanguage.googleapis.com/v1beta/openai/' : undefined),
    model: process.env.LLM_MODEL || (geminiKey ? 'gemini-2.5-flash' : 'gpt-4o-mini'),
  };
}

async function getSession(composio: Composio, conversationId: string, toolkits: string[]) {
  const existing = sessionIds.get(conversationId);
  if (existing) {
    try {
      return await composio.sessions.use(existing);
    } catch {
      sessionIds.delete(conversationId);
    }
  }
  const session = await composio.sessions.create(
    USER_ID,
    toolkits.length > 0 ? { toolkits } : {},
  );
  sessionIds.set(conversationId, session.sessionId);
  return session;
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

export async function POST(request: Request): Promise<Response> {
  let body: { conversationId?: string; messages?: ChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { conversationId, messages } = body;
  if (!conversationId || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'conversationId and messages are required' }, { status: 400 });
  }

  const config = getConfig();
  if (!config) {
    return Response.json(
      { error: 'missing_keys', hint: 'Set COMPOSIO_API_KEY and GEMINI_API_KEY (or OPENAI_API_KEY) in .env, then restart the dev server.' },
      { status: 400 },
    );
  }

  try {
    const composio = new Composio({ apiKey: config.composioKey });
    const session = await getSession(composio, conversationId, config.toolkits);
    // The default OpenAI provider already converts session tools to the
    // Chat Completions function-tool format, with the Composio slug as the
    // function name — so session.execute() can run them directly.
    const tools = await session.tools();

    const openai = new OpenAI({
      apiKey: config.llmKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: INSTRUCTIONS },
      ...messages.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
        role: m.role,
        content: m.text,
      })),
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await openai.chat.completions.create({
        model: config.model,
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
      });

      const choice = completion.choices[0]?.message;
      if (!choice) {
        return Response.json({ error: 'agent_failed', hint: 'Empty model response' }, { status: 500 });
      }
      chatMessages.push(choice);

      const toolCalls = choice.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return Response.json({ reply: choice.content?.trim() || "(I didn't get a text answer back.)" });
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

    return Response.json({ reply: '(I did a bunch of tool calls but ran out of steps — ask me to summarize.)' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/chat] agent run failed:', message);
    return Response.json({ error: 'agent_failed', hint: message }, { status: 500 });
  }
}
