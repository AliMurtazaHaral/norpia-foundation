-- NORPIA — Week 4: chat query performance review.
-- Idempotent. Run in the Supabase SQL Editor AFTER 0004.
--
-- Query patterns in the app:
--   1. conversations of the signed-in user, newest activity first
--        select ... from conversations where user_id = auth.uid() order by updated_at desc
--   2. messages of one conversation, oldest first (chat transcript + context window)
--        select ... from messages where conversation_id = $1 order by created_at
-- Two composite indexes cover both. Nothing else is added on purpose: extra
-- indexes only slow down the insert-heavy message table.

create index if not exists idx_conversations_user_updated
  on public.conversations (user_id, updated_at desc);

create index if not exists idx_messages_conversation_created
  on public.messages (conversation_id, created_at);

-- Redundant: messages are never queried by user_id alone (RLS resolves ownership
-- through the parent conversation), so this index only cost write throughput.
drop index if exists public.idx_messages_user;

analyze public.conversations;
analyze public.messages;
