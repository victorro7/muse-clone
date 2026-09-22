# Raven brain — hosted server

Standalone Node service (Express + tsx) that runs the LLM + Composio tool
loop with Supabase persistence and vector memory. The phone app talks to
this instead of the Expo dev server's `/api/chat` route.

The local dev route (`src/app/api/chat+api.ts`) is untouched and keeps
working for laptop-only development.

## Run locally

```sh
cd server
cp .env.example .env   # fill in keys (no Supabase vars = memoryless mode)
npm install --legacy-peer-deps
npx tsx src/index.ts
# health check:
curl localhost:3001/healthz
```

With `EXPO_PUBLIC_API_URL=http://<your-mac-ip>:3001` in the app's `.env`,
the phone app will use this server. (Use your Mac's LAN IP, not
`localhost` — the phone can't reach your Mac's localhost.)

## Deploy to Render (free tier)

1. Push this repo to GitHub (private repo is fine).
2. Go to https://dashboard.render.com → **New +** → **Web Service** →
   **Build and deploy from a Git repository**, select the repo.
3. Settings:
   - **Root Directory:** `server`
   - **Build Command:** `npm install --legacy-peer-deps`
   - **Start Command:** `npx tsx src/index.ts`
   - Instance type: Free
4. Under **Environment**, add:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (from Supabase →
     Project Settings → API; run `supabase/schema.sql` in the SQL editor
     first)
   - `COMPOSIO_API_KEY`
   - `GEMINI_API_KEY` (free tier, from https://aistudio.google.com/apikey)
   - `SINGLE_USER_ID` (optional, default `muse-clone-user`)
   - `COMPOSIO_TOOLKITS` (optional csv, e.g. `gmail,googlecalendar`)
   - `LLM_MODEL` (optional; default `gemini-2.5-flash` with a Gemini key)
5. Deploy. Render gives you a URL like
   `https://muse-clone-server.onrender.com`.
6. In the app's `.env`, set
   `EXPO_PUBLIC_API_URL=https://muse-clone-server.onrender.com`,
   restart the dev server (public env vars are inlined at bundle time),
   and reload the app.

Note: Render's free tier sleeps after ~15 minutes idle, so the first
message after a while can take ~30s while it wakes. A paid instance
(~a few $/mo) stays warm.

## How it works

- `src/index.ts` — Express app: `POST /api/chat`, `GET /healthz`.
- `src/brain.ts` — the agent loop (ported from the dev route):
  per-conversation Composio sessions, max 8 tool rounds.
- `src/config.ts` — env parsing.
- With Supabase configured: upserts the single user, get-or-creates a
  conversation row (reusing the stored `composio_session_id` across turns),
  loads the last 40 messages, recalls the top-5 similar memories
  (pgvector cosine search over `text-embedding-004` embeddings) into the
  system prompt, persists new messages, and fire-and-forget extracts
  durable facts into the `memories` table (skipping near-duplicates at
  ≥0.85 similarity).
- Without Supabase vars: behaves exactly like the dev route — memoryless,
  sessions in a process-local map.
