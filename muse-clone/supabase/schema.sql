-- Raven brain — Supabase schema (Phase 1: single-user, personal).
--
-- How to apply:
--   1. Create a project at https://supabase.com/dashboard
--   2. Open the SQL Editor, paste this whole file, and run it.
--
-- Notes:
--   * The server talks to Supabase with the SERVICE_ROLE key, which bypasses
--     Row Level Security entirely. RLS is still enabled on every table so that
--     if you later add user-facing access (e.g. Supabase Auth + anon key),
--     nothing is accidentally public — you'll add policies then.
--   * memories.embedding is vector(768) to match Gemini's text-embedding-004.
--   * The ivfflat index is a starting point for personal scale; if the memory
--     table grows past ~100k rows, consider HNSW instead.

create extension if not exists "vector";
create extension if not exists "pgcrypto";

-- Single-user for now (id = SINGLE_USER_ID env, default 'muse-clone-user').
-- Structured as a table so multi-user auth can slot in later: just add rows.
create table if not exists users (
  id text primary key,
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id),
  title text,
  composio_session_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text check (role in ('user', 'assistant')),
  content text,
  created_at timestamptz default now()
);

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id),
  content text,
  embedding vector(768),
  created_at timestamptz default now()
);

create index if not exists conversations_user_id_idx on conversations(user_id);
create index if not exists messages_conversation_id_created_at_idx
  on messages(conversation_id, created_at);
create index if not exists memories_embedding_idx
  on memories using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table users enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table memories enable row level security;
-- No policies: the server uses the service_role key (bypasses RLS).
-- Add policies when you introduce user-facing (anon/authenticated) access.

-- Cosine-similarity memory search for the server.
create or replace function match_memories(
  query_embedding vector(768),
  match_user_id text,
  match_count int
)
returns table (
  id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    memories.id,
    memories.content,
    1 - (memories.embedding <=> query_embedding) as similarity
  from memories
  where memories.user_id = match_user_id
  order by memories.embedding <=> query_embedding
  limit match_count;
$$;
