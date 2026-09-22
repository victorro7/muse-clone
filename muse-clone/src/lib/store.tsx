import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
};

type ChatContextValue = {
  conversations: Conversation[];
  getConversation: (id: string) => Conversation | undefined;
  createConversation: () => string;
  deleteConversation: (id: string) => void;
  sendMessage: (conversationId: string, text: string) => void;
  isTyping: (conversationId: string) => boolean;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// The brain's base URL. When EXPO_PUBLIC_API_URL is set (hosted server),
// the app talks to it; otherwise it falls back to the Expo dev server origin.
const HOSTED_API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

// The dev server origin Expo Go is connected to, e.g. "192.168.1.5:8081" or a tunnel URL.
function apiUrl(path: string): string {
  if (HOSTED_API_URL) return `${HOSTED_API_URL}${path}`;
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) throw new Error('no-host');
  const base = hostUri.startsWith('http') ? hostUri : `http://${hostUri}`;
  return `${base}${path}`;
}

// Fallback brain when the server isn't reachable or keys aren't configured.
const FALLBACK_REPLIES = [
  (t: string) => `Interesting — "${t.slice(0, 60)}${t.length > 60 ? '…' : ''}". Here's my honest take: it's worth digging into, and I'd start with the simplest version first.`,
  (t: string) => `Good question. If I had to give a straight answer about "${t.slice(0, 48)}${t.length > 48 ? '…' : ''}": it depends on what you're optimizing for — speed or quality.`,
  () => `Noted. In this demo build my brain is a canned-response engine — wire up your own API in src/lib/store.tsx and I'll get a whole lot smarter.`,
  (t: string) => `Say more about "${t.slice(0, 48)}${t.length > 48 ? '…' : ''}" — the details change the answer a lot.`,
];

function fallbackReply(text: string, turnCount: number): string {
  const t = text.trim();
  if (t.endsWith('?')) return FALLBACK_REPLIES[1](t);
  return FALLBACK_REPLIES[turnCount % FALLBACK_REPLIES.length](t);
}

function seed(): Conversation[] {
  const now = Date.now();
  return [
    {
      id: 'seed-1',
      title: 'Weekend plans',
      createdAt: now - 1000 * 60 * 60 * 5,
      messages: [
        { id: uid(), role: 'user', text: 'Any ideas for Saturday night?', createdAt: now - 1000 * 60 * 60 * 5 },
        { id: uid(), role: 'assistant', text: "Hey, I'm Raven — your demo assistant. Ask me anything and I'll riff on it.", createdAt: now - 1000 * 60 * 60 * 5 + 2000 },
      ],
    },
    {
      id: 'seed-2',
      title: 'Dinner spots nearby',
      createdAt: now - 1000 * 60 * 60 * 26,
      messages: [
        { id: uid(), role: 'user', text: 'Where should I eat tonight?', createdAt: now - 1000 * 60 * 60 * 26 },
        { id: uid(), role: 'assistant', text: "Light bites if you're drinking after — heavy food before a night out is a trap.", createdAt: now - 1000 * 60 * 60 * 26 + 2000 },
      ],
    },
  ];
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>(seed);
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const turnCount = useRef(0);
  // Maps the app's local conversation ids to the server's conversation ids
  // (uuids). The server creates its own row on first contact and returns the
  // id; we keep using it so history and the Composio session persist.
  const serverIds = useRef<Record<string, string>>({});

  const getConversation = useCallback(
    (id: string) => conversations.find((c) => c.id === id),
    [conversations],
  );

  const createConversation = useCallback(() => {
    const id = uid();
    const convo: Conversation = { id, title: 'New chat', createdAt: Date.now(), messages: [] };
    setConversations((prev) => [convo, ...prev]);
    return id;
  }, []);

  const deleteConversation = useCallback((id: string) => {
    delete serverIds.current[id];
    setConversations((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const appendMessage = useCallback((conversationId: string, message: Message) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== conversationId) return c;
        const title =
          c.messages.length === 0 && message.role === 'user'
            ? message.text.slice(0, 42)
            : c.title;
        return { ...c, title, messages: [...c.messages, message] };
      }),
    );
  }, []);

  const askBrain = useCallback(async (
    conversationId: string,
    history: Message[],
  ): Promise<{ reply: string; serverId?: string }> => {
    const res = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: serverIds.current[conversationId] ?? conversationId,
        messages: history.map((m) => ({ role: m.role, text: m.text })),
      }),
    });
    const data = await res.json();
    if (res.ok && typeof data.reply === 'string') {
      return {
        reply: data.reply,
        serverId: typeof data.conversationId === 'string' ? data.conversationId : undefined,
      };
    }
    if (data?.error === 'missing_keys') {
      return {
        reply: HOSTED_API_URL
          ? 'My brain isn\'t wired up yet — set COMPOSIO_API_KEY and GEMINI_API_KEY on the server (see server/.env.example), then ask me again.'
          : 'My brain isn\'t wired up yet — add COMPOSIO_API_KEY and GEMINI_API_KEY to the app .env file and restart the dev server, then ask me again.',
      };
    }
    throw new Error(typeof data?.hint === 'string' ? data.hint : 'request failed');
  }, []);

  const sendMessage = useCallback(
    (conversationId: string, rawText: string) => {
      const text = rawText.trim();
      if (!text) return;
      const userMsg: Message = { id: uid(), role: 'user', text, createdAt: Date.now() };
      appendMessage(conversationId, userMsg);
      setTyping((prev) => ({ ...prev, [conversationId]: true }));

      const convo = conversations.find((c) => c.id === conversationId);
      const history = [...(convo?.messages ?? []), userMsg];

      askBrain(conversationId, history)
        .then(({ reply, serverId }) => {
          if (serverId) serverIds.current[conversationId] = serverId;
          appendMessage(conversationId, { id: uid(), role: 'assistant', text: reply, createdAt: Date.now() });
        })
        .catch(() => {
          // Server unreachable — fall back to the demo brain so the app still responds.
          const reply = fallbackReply(text, turnCount.current);
          turnCount.current += 1;
          appendMessage(conversationId, { id: uid(), role: 'assistant', text: reply, createdAt: Date.now() });
        })
        .finally(() => {
          setTyping((prev) => ({ ...prev, [conversationId]: false }));
        });
    },
    [conversations, appendMessage, askBrain],
  );

  const isTyping = useCallback((conversationId: string) => !!typing[conversationId], [typing]);

  const value = useMemo(
    () => ({ conversations, getConversation, createConversation, deleteConversation, sendMessage, isTyping }),
    [conversations, getConversation, createConversation, deleteConversation, sendMessage, isTyping],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}
