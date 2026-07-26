-- 0002_registry_schema.sql
--
-- Phase 3: finalize the registry schema — projects, licenses, audit_log.
-- Builds on 0001_projects_stub.sql rather than replacing it (that stub's
-- table/RPC may already have a test row in it from the Phase 1 verify
-- step).
--
-- ── A note on a real conflict this migration resolves ──────────────────────
-- ADMIN_PANEL_MASTERPLAN.md's own Phase 3 spec lists `licenses` as having a
-- `project_id` FK to `projects` (join-based lookup). But
-- docs/reference/shell_REGISTRY_CONTRACT.md — the sibling shell track's
-- actual registry contract, which this phase is supposed to cross-check
-- against — has the shell reading flat columns directly off `licenses`:
--
--   GET /rest/v1/licenses?license_key=eq.<key>
--       &select=company_name,is_active,expires_at,
--               target_supabase_url,target_supabase_anon_key&limit=1
--
-- That's a single-table flat select, not a join, so a bare `project_id` FK
-- alone would break the shell's existing query. This migration keeps
-- `project_id` as the actual source of truth (needed for Phase 4/6/10's own
-- admin-side joins and reassignment logic) and adds `target_supabase_url` /
-- `target_supabase_anon_key` as denormalized columns kept in sync via
-- triggers below — so the shell's contract query works unmodified, and nothing
-- can drift out of sync with `projects` without either side's code having to
-- remember to update it. Flagging this resolution explicitly since it's a
-- cross-track decision, not something either masterplan stated outright.
--
-- Exposing another project's anon key here is not a new secret being
-- leaked — Supabase anon keys are designed to be client-safe/public,
-- protected by that project's own RLS, which is exactly the reasoning
-- shell_REGISTRY_CONTRACT.md itself gives for its `using (true)` policy.

-- ── projects: finalize the real column set ─────────────────────────────────
alter table public.projects
  add column if not exists supabase_url text,
  add column if not exists supabase_anon_key text,
  add column if not exists supabase_service_role_key text,
  add column if not exists notes text;

-- Phase 1's RLS was a stopgap to prove RLS worked before Phase 2's real
-- admin auth existed (default-deny + a narrow anon RPC). Now that Phase 2
-- gives us a real authenticated admin session, that stopgap is no longer
-- the right shape: `projects` holds service-role keys, so anon should have
-- *zero* access (not even the narrow RPC), and the authenticated admin
-- should have full access (single-operator tool — no roles to gate by,
-- per Phase 2's own "out of scope").
drop function if exists public.get_project_by_id(uuid);

create policy "authenticated_full_access_projects"
  on public.projects
  for all
  to authenticated
  using (true)
  with check (true);
-- No policy at all for anon — default-deny stays in effect, and now
-- covers the whole row including the new sensitive columns.

-- ── licenses ─────────────────────────────────────────────────────────────
create table if not exists public.licenses (
  license_key text primary key,
  company_name text not null,
  contact_email text,
  project_id uuid not null references public.projects(id) on delete restrict,
  is_active boolean not null default true,
  expires_at timestamptz,
  max_devices integer not null default 5,
  created_at timestamptz not null default now(),
  -- Denormalized from `projects`, kept in sync by trigger — see the
  -- conflict note above. Never written directly by admin-app code; always
  -- derived from project_id.
  target_supabase_url text,
  target_supabase_anon_key text
);

alter table public.licenses enable row level security;

-- Mirrors shell_REGISTRY_CONTRACT.md's own accepted-risk shape exactly:
-- the shell has no Supabase Auth session at all (only the anon API key),
-- so this table needs a real anon read policy, not an authenticated-only
-- one. As that contract itself notes, `using (true)` means the policy
-- doesn't narrow — an unfiltered listing is technically still possible for
-- anon, same caveat that contract already accepts for low-stakes columns.
-- Not solved here since changing the shell's query contract is out of
-- scope for this masterplan.
create policy "anon_can_read_licenses"
  on public.licenses
  for select
  to anon
  using (true);

create policy "authenticated_full_access_licenses"
  on public.licenses
  for all
  to authenticated
  using (true)
  with check (true);

-- Keep target_supabase_url/target_supabase_anon_key in sync with whatever
-- `project_id` currently points at, on every insert/update of project_id.
create or replace function public.sync_license_target_keys()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.supabase_url, p.supabase_anon_key
    into new.target_supabase_url, new.target_supabase_anon_key
    from public.projects p
    where p.id = new.project_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_license_target_keys on public.licenses;
create trigger trg_sync_license_target_keys
  before insert or update of project_id on public.licenses
  for each row
  execute function public.sync_license_target_keys();

-- Cascade the other direction too: if a project's own URL/anon key ever
-- changes (key rotation, etc.), push that out to every license currently
-- pointing at it, so target_supabase_url/target_supabase_anon_key never
-- go stale without either side's code having to remember to do it.
create or replace function public.cascade_project_key_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.licenses
    set target_supabase_url = new.supabase_url,
        target_supabase_anon_key = new.supabase_anon_key
    where project_id = new.id;
  return new;
end;
$$;

drop trigger if exists trg_cascade_project_key_update on public.projects;
create trigger trg_cascade_project_key_update
  after update of supabase_url, supabase_anon_key on public.projects
  for each row
  execute function public.cascade_project_key_update();

-- ── audit_log ────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

-- Append-only by design: authenticated (the one admin) can read and write
-- new entries, but there is deliberately no update/delete policy at all —
-- not even for the admin — so history can't be quietly edited after the
-- fact via the REST API. This is what Phase 11 (audit log) depends on
-- actually being trustworthy.
create policy "authenticated_can_read_audit_log"
  on public.audit_log
  for select
  to authenticated
  using (true);

create policy "authenticated_can_insert_audit_log"
  on public.audit_log
  for insert
  to authenticated
  with check (true);
-- No anon access at all — this is a purely internal admin trail.
