-- NORPIA — Week 4: JARVIS chat foundation (conversations + messages).
-- Idempotent. Run in the Supabase SQL Editor AFTER 0003.

-- =====================================================================
-- 1. Enum for message roles (extensible: add values with ALTER TYPE)
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'message_role') then
    create type public.message_role as enum ('user', 'assistant', 'system');
  end if;
end
$$;

-- =====================================================================
-- 2. conversations
-- =====================================================================
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New conversation',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_conversations_user_updated
  on public.conversations (user_id, updated_at desc);

grant select, insert, update, delete on public.conversations to authenticated;
grant all on public.conversations to service_role;

alter table public.conversations enable row level security;

drop policy if exists "Users can read own conversations" on public.conversations;
create policy "Users can read own conversations"
  on public.conversations for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create own conversations" on public.conversations;
create policy "Users can create own conversations"
  on public.conversations for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own conversations" on public.conversations;
create policy "Users can update own conversations"
  on public.conversations for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete own conversations" on public.conversations;
create policy "Users can delete own conversations"
  on public.conversations for delete to authenticated
  using (auth.uid() = user_id);

-- =====================================================================
-- 3. messages
-- =====================================================================
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             public.message_role not null,
  content          text not null,
  -- future-proofing: token usage, model name, tool calls, citations…
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_messages_conversation_created
  on public.messages (conversation_id, created_at);
create index if not exists idx_messages_user on public.messages (user_id);

grant select, insert, delete on public.messages to authenticated;
grant all on public.messages to service_role;

alter table public.messages enable row level security;

-- Ownership is verified through the parent conversation, never the client.
drop policy if exists "Users can read own messages" on public.messages;
create policy "Users can read own messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can create messages in own conversations" on public.messages;
create policy "Users can create messages in own conversations"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete own messages" on public.messages;
create policy "Users can delete own messages"
  on public.messages for delete to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

-- Messages are an append-only log: no update grant, no update policy.

-- =====================================================================
-- 4. Keep conversations.updated_at fresh
-- =====================================================================
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_messages_touch_conversation on public.messages;
create trigger trg_messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

create or replace function public.set_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id;   -- ownership is immutable
  return new;
end;
$$;

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_conversation_updated_at();
