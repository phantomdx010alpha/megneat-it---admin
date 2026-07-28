-- 0003_project_status.sql
--
-- Phase 5 gap, flagged not guessed: the masterplan's own Phase 5 spec calls
-- for a "manual 'mark as paused/full' toggle" on the projects dashboard,
-- but Phase 3's finalized `projects` schema (0002_registry_schema.sql) has
-- no column to hold that state — `id, label, notes, supabase_url,
-- supabase_anon_key, supabase_service_role_key, created_at` has nowhere to
-- persist "paused". Adding the one column Phase 5 actually needs, in its
-- own migration rather than reopening 0002, since 0002 is Phase 3's closed
-- record of what that phase actually shipped.

alter table public.projects
  add column if not exists is_paused boolean not null default false;

-- No RLS change needed: the existing Phase 3 policy
-- ("authenticated_full_access_projects", for all, using(true)) already
-- covers reading and writing this new column for the one admin session.
-- Still anon-inaccessible, same as every other `projects` column.
