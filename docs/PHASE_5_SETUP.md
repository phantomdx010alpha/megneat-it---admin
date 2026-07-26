# Phase 5 setup — manual step + verify

Phase 5 adds the projects dashboard: one screen listing every connected
project, how many licenses point at it, a reachability indicator, and a
manual paused/full toggle.

## 1. Run the new migration

`supabase/migrations/0003_project_status.sql` adds one column,
`projects.is_paused`, that Phase 3's schema never defined (see the top
comment in that file — the masterplan's own Phase 5 spec calls for a pause
toggle, but nothing in Phase 3 gave it anywhere to live). Run it against
your registry project the same way you ran `0001`/`0002` — SQL Editor,
paste, run. No env var changes needed; this phase reuses
`SUPABASE_REGISTRY_SERVICE_ROLE_KEY` from Phase 4.

## 2. Two things worth knowing about this phase's design

**"Reachability" checks the target project's own `licenses` table, not the
registry's.** The masterplan's phrasing — "hitting its own `licenses`
count via its own service-role key" — reads as ambiguous out of context,
since both the registry and every target project have a table named
`licenses`. Confirmed against `supabase/provisioning/target_project_schema.sql`
that every provisioned target project really does get its own local
`licenses` table (SECTION 1), separate from the registry's. That's the one
this phase's reachability probe hits — a project being "up" means "this
project's Postgres/PostgREST answered," independent of the registry's own
"how many licenses point here" count, which is a different number sourced
from the registry's own `licenses` table. The two can legitimately
disagree (a freshly-provisioned, reachable project with zero licenses
pointing at it yet is normal, not a bug).

**Reachability checks run with a 5-second timeout per project, in
parallel.** A free-tier Supabase project that's gone to sleep can take a
while to wake on first request; without a timeout, one sleeping project
would stall the whole dashboard load. A timeout is treated as "down" —
correct for "can a client actually use this project right now," even
though a slow-but-eventually-reachable project is a slightly different
condition than a genuinely broken one. Not distinguished further, per the
masterplan's own "not a full health dashboard" scope note.

## 3. A small connectivity fix, outside this phase's listed files

`app/(app)/page.js` (the Phase 2 home screen) had no link to `/projects`
anywhere in the app before this phase — Phase 4 added `/projects/new` with
the same gap. Added one "Projects" button on the home screen pointing at
the new dashboard, since a page nothing links to isn't actually usable.
Did not add a link to `/projects/new` from the dashboard's own header
beyond the "Add project" button already built into this phase's page —
that's in scope here, unlike the home-screen fix, which technically
belongs to Phase 4's leftover gap.

## 4. What to verify yourself

The masterplan's own Phase 5 verify step: confirm the dashboard reflects
Phase 4's test project, and that the license-count join shows 0 before any
client exists.

1. Run the migration above if you haven't.
2. `npm run dev`, sign in, click **Projects** from the home screen (or go
   directly to `/projects`).
3. Confirm your Phase 4 test project appears with **0 licenses** (no
   client's been added yet — that's Phase 6) and a reachability badge.
   - If it shows **Unreachable** and you're confident the project and its
     stored service-role key are both fine, check that project hasn't
     been paused/deleted on Supabase's own side, and that the key stored
     in the registry hasn't been rotated since Phase 4.
4. Click **Pause / full** on that project; confirm the "Paused" badge
   appears immediately and persists across a page reload (confirms the
   write actually landed in `projects.is_paused`, not just local state).
   Click **Unpause** to reverse it.
5. Add a second real test project through `/projects/new` (from Phase 4)
   and confirm it shows up here too, independently reachable/counted from
   the first.
