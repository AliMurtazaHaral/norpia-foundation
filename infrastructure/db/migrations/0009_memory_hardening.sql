-- NORPIA — Month 2 / Week 2 (Prompt 3): memory audit hardening.
-- Idempotent. Run in the Supabase SQL Editor AFTER 0008.
--
-- Two corrections found during the Week 2 audit. No policy is relaxed, no
-- column is dropped, no data is rewritten.
--
--   1. `last_used_at` bookkeeping used to bump `updated_at`, which made every
--      retrieved memory look freshly edited and permanently inflated its
--      recency score. Usage bookkeeping must not count as an edit.
--   2. A partial index so the retrieval query (active memories of one user,
--      strongest first) never scans deactivated rows.

create or replace function public.set_user_memory_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Ownership and creation time stay immutable, always.
  new.user_id    := old.user_id;
  new.created_at := old.created_at;

  -- Pure usage bookkeeping (only last_used_at changed) is not an edit:
  -- keep updated_at so recency ranking still reflects real changes.
  if new.last_used_at is distinct from old.last_used_at
     and new.content    is not distinct from old.content
     and new.category   is not distinct from old.category
     and new.importance is not distinct from old.importance
     and new.confidence is not distinct from old.confidence
     and new.is_active  is not distinct from old.is_active
     and new.metadata   is not distinct from old.metadata
  then
    new.updated_at := old.updated_at;
    return new;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Retrieval path only ever reads active rows.
create index if not exists idx_user_memories_active_only
  on public.user_memories (user_id, importance desc, confidence desc, updated_at desc)
  where is_active;
