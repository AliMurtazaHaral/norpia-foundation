-- NORPIA — Month 2 / Week 2 (Prompt 2): automatic memory extraction.
-- Idempotent. Run in the Supabase SQL Editor AFTER 0007.
--
-- Two small additions only; no table is replaced and no policy is relaxed.
--   1. user_memories.confidence — how sure the extractor is about a candidate.
--   2. conversations.memory_extracted_through — bookmark so a conversation is
--      never re-analysed from the beginning (cost control + no duplicates).

alter table public.user_memories
  add column if not exists confidence numeric(3, 2) not null default 0.80
    check (confidence >= 0 and confidence <= 1);

alter table public.conversations
  add column if not exists memory_extracted_through timestamptz;

-- Retrieval favours strong, confident memories.
create index if not exists idx_user_memories_confidence
  on public.user_memories (user_id, is_active, confidence desc, importance desc);

-- Ownership, creation time and confidence bounds stay enforced by 0007's
-- trigger and RLS policies; nothing here widens access.
