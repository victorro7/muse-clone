// Environment parsing for the hosted brain. Everything is optional except
// COMPOSIO_API_KEY + an LLM key; Supabase vars are optional and persistence
// is skipped entirely when they are absent.

export type Config = {
  supabaseUrl: string | undefined;
  supabaseServiceKey: string | undefined;
  composioKey: string | undefined;
  llmKey: string | undefined;
  baseURL: string | undefined;
  model: string;
  toolkits: string[];
  singleUserId: string;
  port: number;
};

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const geminiKey = env.GEMINI_API_KEY || undefined;
  const openaiKey = env.OPENAI_API_KEY || undefined;
  const llmKey = geminiKey || openaiKey;

  return {
    supabaseUrl: env.SUPABASE_URL || undefined,
    supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    composioKey: env.COMPOSIO_API_KEY || undefined,
    llmKey,
    baseURL:
      env.LLM_BASE_URL ||
      (geminiKey ? 'https://generativelanguage.googleapis.com/v1beta/openai/' : undefined),
    model: env.LLM_MODEL || (geminiKey ? 'gemini-2.5-flash' : 'gpt-4o-mini'),
    toolkits: csv(env.COMPOSIO_TOOLKITS),
    singleUserId: env.SINGLE_USER_ID || 'muse-clone-user',
    port: Number(env.PORT) || 3001,
  };
}

/** LLM + Composio are configured — the brain can think and act. */
export function hasBrain(config: Config): boolean {
  return Boolean(config.composioKey && config.llmKey);
}

/** Supabase is configured — persistence and vector memory are available. */
export function hasPersistence(config: Config): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}
