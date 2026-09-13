-- NORPIA — Month 2 / Week 2: long-term memory foundation.
-- Idempotent. Run in the Supabase SQL Editor AFTER 0006.
--
-- Scope: durable, USER-scoped facts that stay useful across conversations.
-- This is deliberately different from `conversation_summaries`, which describe
-- ONE conversation. Nothing here is automatically extracted yet (next prompt);
-- this migration only establishes the store, its isolation and its indexes.

create table if not exists public.user_memories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  content         text not null check (length(btrim(content)) between 1 and 2000),
  -- Free text + check constraint instead of an enum: new categories can be
  -- added with a one-line constraint change, without an enum migration dance.
  category        text not null default 'other'
                    check (category in (
                      'preference',
                      'personal',
                      'professional',
                      'goal',
                      'project',
                      'fact',
                      'instruction',
                      'business',
                      'other'
                    )),
  -- 1 = nice to know, 5 = always relevant.
  importance      integer not null default 3 check (importance between 1 and 5),
  -- Where this memory came from ('user' | 'assistant' | 'system' | 'import').
  source          text not null default 'user',
  -- Optional provenance: the conversation the memory was learned in.
  source_conversation_id uuid references public.conversations(id) on delete set null,
  -- Soft delete / review workflow: deactivated memories never reach the model.
  is_active       boolean not null default true,
  metadata        jsonb not null default '{}'::jsonb,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Retrieval path: active memories of one user, strongest first.
create index if not exists idx_user_memories_active
  on public.user_memories (user_id, is_active, importance desc, updated_at desc);

create index if not exists idx_user_memories_category
  on public.user_memories (user_id, category);

grant select, insert, update, delete on public.user_memories to authenticated;
grant all on public.user_memories to service_role;

alter table public.user_memories enable row level security;

-- User isolation: every policy is anchored on auth.uid(). A memory id belonging
-- to another user is simply invisible, so ids cannot be used to probe data.
drop policy if exists "Users can read own memories" on public.user_memories;
create policy "Users can read own memories"
  on public.user_memories for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create own memories" on public.user_memories;
create policy "Users can create own memories"
  on public.user_memories for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      source_conversation_id is null
      or exists (
        select 1 from public.conversations c
        where c.id = source_conversation_id and c.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Users can update own memories" on public.user_memories;
create policy "Users can update own memories"
  on public.user_memories for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own memories" on public.user_memories;
create policy "Users can delete own memories"
  on public.user_memories for delete to authenticated
  using (auth.uid() = user_id);

-- Ownership and creation time are immutable; keep updated_at fresh.
create or replace function public.set_user_memory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.user_id    := old.user_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists trg_user_memories_updated_at on public.user_memories;
create trigger trg_user_memories_updated_at
  before update on public.user_memories
  for each row execute function public.set_user_memory_updated_at();
