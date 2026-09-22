// Hosted brain for the Raven mobile app.
// The phone app POSTs to /api/chat; this runs the LLM + Composio tool loop
// with Supabase persistence and vector memory.

import 'dotenv/config';
import express from 'express';
import { loadConfig, hasBrain, hasPersistence } from './config';
import { handleChat } from './brain';

const config = loadConfig();
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    brain: hasBrain(config),
    persistence: hasPersistence(config),
    model: config.model,
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const result = await handleChat(req.body ?? {}, config);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[server] unexpected error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'agent_failed', hint: 'Unexpected server error' });
  }
});

app.listen(config.port, () => {
  console.log(
    `[server] listening on :${config.port} ` +
      `(brain=${hasBrain(config) ? 'on' : 'missing keys'}, ` +
      `persistence=${hasPersistence(config) ? 'on' : 'off'})`,
  );
});
