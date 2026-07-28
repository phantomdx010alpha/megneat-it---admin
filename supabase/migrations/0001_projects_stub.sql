-- 0001_projects_stub.sql
--
-- Phase 1 stub: just enough of a `projects` table for later phases to build
-- against and to prove RLS is scoped correctly before any real data goes in.
-- Phase 3 finalizes the real, final shape (and adds `licenses` +
-- `audit_log`) — this migration will very likely be superseded/altered
-- there. Do not treat these columns as final.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;
-- No `for select` policy at all here: default-deny. Direct
-- `GET /rest/v1/projects` (filtered or not) is refused for anon/authenticated
-- — see the note below on why this app can't reuse the shell's simpler
-- "trust the query filter" pattern.

-- Exact-match lookups are exposed only through this narrow RPC, never
-- through a direct table grant. `security definer` runs as the function's
-- owner (bypassing RLS internally) but the function itself only ever
-- returns the one row matching the id argument — there is no way to call
-- it and get back an unfiltered list.
create or replace function public.get_project_by_id(p_id uuid)
returns table (id uuid, label text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, label, created_at
  from public.projects
  where id = p_id
$$;

revoke all on function public.get_project_by_id(uuid) from public;
grant execute on function public.get_project_by_id(uuid) to anon, authenticated;

-- ── Note on this being stricter than the shell/PWA registry's own RLS ──────
-- docs/reference/shell_REGISTRY_CONTRACT.md (from the sibling
-- SHELL_MULTI_PROJECT_LICENSING_MASTERPLAN.md track) documents the shell's
-- own `licenses` anon-read policy as `using (true)`, explicitly relying on
-- PostgREST's `?license_key=eq.<key>` filter to narrow results rather than
-- the RLS policy itself — that file says outright "the policy itself does
-- not narrow — do not rely on it to." That's an acceptable risk there
-- because the exposed columns are low-stakes (company name, active flag).
--
-- This admin registry cannot reuse that pattern: from Phase 3 onward,
-- `projects` also carries each connected Supabase project's
-- `supabase_service_role_key` — a master key to that entire project. A
-- `using (true)` policy would let literally anyone with the (client-side,
-- public) anon key list every stored service-role key with a single
-- unfiltered REST call. Hence the default-deny-plus-RPC design above,
-- which is what Phase 1's own verify step ("succeeds for exact-match,
-- fails for unfiltered listing") is actually checking for — the shell's
-- pattern would fail that same test if pointed at this table. Flagging
-- this now since it's directly relevant to Phase 3's schema/RLS work too.
