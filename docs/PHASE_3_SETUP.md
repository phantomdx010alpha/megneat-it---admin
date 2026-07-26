# Phase 3 setup — manual step + verify

Phase 3 finalizes the registry schema: full `projects` columns, plus new
`licenses` and `audit_log` tables. I ran this migration against a real
local Postgres (not just eyeballed the SQL) to check it applies cleanly on
top of Phase 1's schema and that the trickier parts — the RLS boundaries
and the sync triggers — actually behave as intended. Details below; you
still need to run it against your real registry project.

## 1. Run the migration

In your registry project's **SQL Editor**, paste in and run
`supabase/migrations/0002_registry_schema.sql`. It's additive on top of
0001 (uses `alter table ... add column if not exists`, `create table if
not exists`), so it's safe even with the test project row you may have
inserted during Phase 1's verify step.

## 2. What I already verified locally, so you don't have to guess

Using a throwaway local Postgres instance with `anon`/`authenticated`
roles standing in for Supabase's:

- **The migration runs clean** on top of 0001's schema — no errors.
- **`anon` can read `licenses`** via the exact query shape
  `docs/reference/shell_REGISTRY_CONTRACT.md` specifies (`select
  company_name,is_active,expires_at,target_supabase_url,target_supabase_anon_key`
  filtered by `license_key`) — confirmed this returns data.
- **`anon` gets zero rows from `projects`** — confirmed, including that
  `supabase_service_role_key` is never reachable by anon under any query.
- **`authenticated` (the one admin) has full access** to `projects` and
  `licenses`, and can insert into `audit_log`.
- **`audit_log` is genuinely immutable** — even the authenticated admin
  gets `permission denied` on `UPDATE`/`DELETE` against it; only
  `SELECT`/`INSERT` are permitted, by design.
- **The sync triggers work in both directions:**
  - Inserting/updating a license's `project_id` auto-populates
    `target_supabase_url`/`target_supabase_anon_key` from `projects` —
    confirmed by inserting a license and checking the columns came from
    the FK without being mentioned in the `INSERT`.
  - Rotating a project's `supabase_url`/`supabase_anon_key` cascades to
    every license pointing at it — confirmed by updating a project and
    re-selecting the license row.
  - Reassigning a license's `project_id` to a different project correctly
    updates its `target_supabase_url`/`target_supabase_anon_key` to match
    the new project — relevant now, and again for Phase 10.
- **FK protection works** — deleting a project still referenced by a
  license correctly fails with a foreign-key violation rather than
  silently orphaning the license.

## 3. What to verify yourself, against the real project

The masterplan's own Phase 3 verify step is a manual insert/select check in
Supabase Studio. Since the mechanics above are already confirmed against
real Postgres, this is mostly about confirming your actual registry
project's config (extensions, roles) matches what I assumed:

1. **Table Editor** → confirm `projects` now has the new columns
   (`supabase_url`, `supabase_anon_key`, `supabase_service_role_key`,
   `notes`), and that `licenses` and `audit_log` both exist.
2. Insert one project row with real-looking `supabase_url`/`supabase_anon_key`
   values, then insert one `licenses` row pointing at it via `project_id` —
   confirm `target_supabase_url`/`target_supabase_anon_key` auto-populate.
3. Try updating or deleting an `audit_log` row via the Table Editor (or a
   raw REST call with your anon/service key) — it should be refused unless
   you're using the `service_role` key directly (RLS doesn't apply to
   service_role, only anon/authenticated — that's expected and fine, since
   service_role is never used client-side).

## A cross-track design decision worth knowing about

`ADMIN_PANEL_MASTERPLAN.md`'s own Phase 3 spec describes `licenses` as
FK-only (`project_id` → `projects`, join-based). But
`docs/reference/shell_REGISTRY_CONTRACT.md` — the actual contract this
phase is supposed to cross-check against — has the shell reading flat
`target_supabase_url`/`target_supabase_anon_key` columns directly off
`licenses`, no join. Those two don't agree on their own.

Resolution used here: `project_id` stays the real source of truth (needed
for this app's own admin-side logic), and the two target columns are
denormalized copies kept in sync automatically via the triggers described
above — so the shell's existing query keeps working unmodified, and
nothing can silently drift out of sync. Full reasoning is in
`0002_registry_schema.sql`'s own comment block at the top.
