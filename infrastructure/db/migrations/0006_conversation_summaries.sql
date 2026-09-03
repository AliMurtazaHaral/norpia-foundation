-- NORPIA — Month 2 / Week 1: conversation-level summaries.
-- Idempotent. Run in the Supabase SQL Editor AFTER 0005.
--
-- Scope: ONE rolling summary per conversation, covering the OLDER part of that
-- conversation only. This is NOT a permanent user-memory store (Month 2 Week 2)
-- — nothing here is shared across conversations.

create table if not exists public.conversation_summaries (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null unique
                          references public.conversations(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  summary               text not null,
  -- Everything created at or before this instant is represented by `summary`.
  covered_through       timestamptz not null,
  covered_message_count integer not null default 0,
  -- Bumped on every regeneration; lets us trace which summary shaped a reply.
  version               integer not null default 1,
  model                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_conversation_summaries_user
  on public.conversation_summaries (user_id);

grant select, insert, update, delete on public.conversation_summaries to authenticated;
grant all on public.conversation_summaries to service_role;

alter table public.conversation_summaries enable row level security;

-- Ownership is verified through the parent conversation AND the user_id column,
-- so User A can never read or write User B's summary.
drop policy if exists "Users can read own conversation summaries" on public.conversation_summaries;
create policy "Users can read own conversation summaries"
  on public.conversation_summaries for select to authenticated
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_summaries.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can create own conversation summaries" on public.conversation_summaries;
create policy "Users can create own conversation summaries"
  on public.conversation_summaries for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own conversation summaries" on public.conversation_summaries;
create policy "Users can update own conversation summaries"
  on public.conversation_summaries for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own conversation summaries" on public.conversation_summaries;
create policy "Users can delete own conversation summaries"
  on public.conversation_summaries for delete to authenticated
  using (auth.uid() = user_id);

-- Ownership and conversation link are immutable; keep updated_at fresh.
create or replace function public.set_conversation_summary_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id;
  new.conversation_id := old.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_conversation_summaries_updated_at on public.conversation_summaries;
create trigger trg_conversation_summaries_updated_at
  before update on public.conversation_summaries
  for each row execute function public.set_conversation_summary_updated_at();
