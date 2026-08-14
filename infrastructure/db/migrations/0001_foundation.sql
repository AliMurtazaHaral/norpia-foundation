-- NORPIA — Week 2 database foundation.
-- Schema scaffolding only. Domain tables (users, organizations, workspaces,
-- conversations, messages, ai_sessions, documents, permissions, settings)
-- are introduced in Week 3+ as additive migrations in this folder.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Logical separation so later entities land in the right place.
CREATE SCHEMA IF NOT EXISTS identity;   -- users, organizations, permissions
CREATE SCHEMA IF NOT EXISTS workspace;  -- workspaces, settings, documents
CREATE SCHEMA IF NOT EXISTS ai;         -- conversations, messages, ai_sessions

-- Migration ledger: every future migration inserts its own version row.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schema_migrations (version)
VALUES ('0001_foundation')
ON CONFLICT (version) DO NOTHING;

-- Shared trigger used by every future table with an updated_at column.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
