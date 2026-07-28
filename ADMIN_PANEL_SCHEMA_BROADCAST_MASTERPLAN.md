# ADMIN_PANEL_SCHEMA_BROADCAST_MASTERPLAN.md — Push a schema change to every project, once, forever

## Background

Right now, per this admin panel's own `Provision` button (`app/(app)/projects/new/actions.js`),
schema only ever gets applied to **one** project at a time, at creation, via a Postgres connection
string that's explicitly "used once, in memory, never saved" (confirmed in that page's own UI
copy). That's fine for a brand-new project. It has no answer at all for "I need to add one table
to the 4-5 projects I already have" — today that would mean manually running SQL by hand in each
one's own SQL Editor, exactly the kind of manual, error-prone, easy-to-forget-one process this
whole admin panel exists to get away from.

This track builds a **general, reusable tool**: paste SQL once, run it against every currently
active project in one action, and have that same SQL automatically fold into
`supabase/provisioning/target_project_schema.sql` so every **future** project gets it too, without
a second manual step. This isn't being built one-off for the push-notifications feature — the
push-notifications `push_subscriptions` table (Phase 5 below) is simply the **first real thing**
run through it, proving it end-to-end. Any future schema change — for this feature or any other —
should go through this same tool from now on.

**A real decision this track has to make explicitly, not silently assume:** running arbitrary DDL
against a live Postgres database needs a direct connection, the same way single-project
provisioning already does — PostgREST (what the anon/service-role keys talk to) cannot run
`CREATE TABLE`. Single-project provisioning gets away with asking for the connection string once,
in the moment, and forgetting it immediately after. A tool that needs to reach **5+ projects in
one action**, on demand, whenever a new schema change comes up, cannot practically ask the
operator to re-paste 5 separate connection strings every single time — that defeats the entire
point. So this track has to store enough per-project connection information (in practice: a
database password, or a full connection string) in the registry's own `projects` table to make
that possible. **This is a real, new class of stored secret, not currently in the design** — flag
it plainly, don't bury it: adding this makes the registry hold slightly more sensitive material
than it did before per project, in exchange for genuinely one-click future schema pushes. This
track's Phase 1 is exactly this decision, made and documented, not skipped past.

## House-style reminders

- Exactly one phase per session, `str_replace` the Phase pointer block before re-zipping.
- This tool runs real, irreversible DDL against every live client database at once — every phase
  involving an actual run against real projects needs the same confirmation-friction discipline
  already established elsewhere in this admin panel (client delete's type-to-confirm pattern is
  the right bar to match, not a bare button).
- The registry project itself must never be a target this tool can accidentally run against — it's
  a fundamentally different database (no `mst_ledger`/`push_subscriptions`/etc.), and this tool
  should only ever loop over rows in the registry's own `projects` table, never touch the registry
  database's own schema.

---

## Phase 1 — Decide and implement: store what's needed to reach every project without re-asking

**Goal:** `projects` gets whatever new column(s) are needed (a stored database password, or a full
stored connection string) so future phases can connect to any active project on demand, without
the operator re-entering credentials each time.

**In scope:** Add a new column to `projects` (e.g. `db_connection_string`, encrypted at rest if
Supabase/Postgres column-level encryption is practical to set up here — document whether it was
used or not, don't silently skip it without saying so) via a new migration file, following this
repo's own existing migration-numbering convention. Update the "Add project" flow
(`app/(app)/projects/new/actions.js`) to optionally capture and store this alongside the existing
fields, rather than only accepting it transiently for one-time provisioning as today. For
**already-existing** projects (the 4-5 already added before this track existed), this phase also
needs a one-time "add your connection string now" prompt/form on the existing project-edit screen,
since they were created before this column existed and won't have it populated otherwise.

**Out of scope:** Actually building the broadcast tool itself (Phase 2) — this phase only makes
the data available for it to use.

**Key files:** New `supabase/migrations/000X_project_connection_strings.sql`,
`app/(app)/projects/new/actions.js`, `app/(app)/projects/page.js` (or wherever project editing
lives) for the backfill prompt on existing rows.

**Verify:** Confirm a newly-added project can have its connection string stored at creation, and
that each of the existing 4-5 projects has had its own string backfilled in through the new
prompt — this phase isn't done until every currently-active project actually has one stored, not
just until the column exists.

---

## Phase 2 — The broadcast UI: paste SQL, pick projects, confirm

**Goal:** A dedicated screen where an operator pastes SQL and, after a clear confirmation step,
runs it against every selected active project.

**In scope:** New page, e.g. `app/(app)/schema-push/page.js` — a large text area for the SQL,
a list of every non-paused project (from `projects.is_paused`) with checkboxes (default: all
checked), and a confirmation step before anything runs — given the stakes, match the client-delete
flow's own friction level (an explicit "type the word CONFIRM" or equivalent, not a single click)
rather than the lighter touch single-project provisioning currently uses.

**Out of scope:** Actually connecting to and running anything yet (Phase 3).

**Key files:** New `app/(app)/schema-push/page.js`.

**Verify:** The form renders, lists real active projects correctly excluding paused ones, and the
confirmation step genuinely blocks submission until satisfied.

---

## Phase 3 — Run it: one connection per project, sequential, full per-project result reporting

**Goal:** The pasted SQL actually runs against every selected project, one at a time, with a clear
success/failure result for each individual project — never a single pass/fail for the whole batch.

**In scope:** Server action reusing the same `pg` `Client` pattern `provisionProjectAction` already
established, looped over every selected project using Phase 1's stored connection strings — run
**sequentially, not in parallel** (free-tier Postgres connection limits are real and shared
resources; a burst of 5 simultaneous DDL connections risks hitting them, sequential is safer and
the time cost is trivial for how rarely this runs). For each project: attempt the run, catch and
record the specific error if it fails, and **continue to the next project regardless** — one
project failing must never stop the others from getting the update. Return a clear per-project
list: which succeeded, which failed and why.

**Out of scope:** Automatically retrying a failed project — surface the failure clearly and let
the operator decide (fix the SQL, fix that project's connection string, retry manually), don't
build automatic retry logic for what should be a rare, deliberate action.

**Key files:** New `app/(app)/schema-push/actions.js`.

**Verify:** Run a harmless, genuinely idempotent test statement (e.g. a `create table if not
exists` for a throwaway test table) against all active projects; confirm every one reports success
individually. Then deliberately break one project's stored connection string and re-run; confirm
that project reports a clear failure while every other project still succeeds.

---

## Phase 4 — Fold successful pushes into the master provisioning script

**Goal:** SQL that's been successfully broadcast also gets appended to
`supabase/provisioning/target_project_schema.sql`, so every **future** project gets it automatically.

**In scope:** After Phase 3's run completes (this track's own call on whether "all succeeded" or
"at least one succeeded" is the bar — document whichever is chosen and why; leaning toward
requiring **all selected, non-failed projects to have succeeded** before touching the master file,
since appending schema that isn't actually live everywhere yet risks new projects silently
diverging from old ones), append the submitted SQL to the end of
`target_project_schema.sql` with a clear comment marking when it was added and via this tool,
matching the file's own existing comment style. Because this file is meant to be re-run on a
brand-new, empty database, remind the operator (via UI copy, not just a hope) that submitted SQL
should use idempotent guards (`create table if not exists`, `create policy` wrapped in a
`drop policy if exists` where this file's existing conventions already do that) — this phase can
do a light heuristic check (e.g. warn if the pasted SQL contains a bare `create table` without
`if not exists`) without trying to be a full SQL linter.

**Out of scope:** Automatically rewriting non-idempotent SQL submitted by the operator into an
idempotent form — warn, don't silently rewrite someone's exact SQL.

**Key files:** `app/(app)/schema-push/actions.js`, `supabase/provisioning/target_project_schema.sql`.

**Verify:** Run Phase 3's test statement through the full flow; confirm it's both live on every
active project *and* appended correctly to the master file. Provision a brand-new throwaway test
project afterward and confirm the appended statement runs cleanly as part of that fresh
provisioning, proving the loop is genuinely closed for future projects too.

---

## Phase 5 — First real use: ship the `push_subscriptions` table

**Goal:** Prove this whole tool end-to-end by using it for the actual thing that motivated
building it — the table `SHELL_PUSH_NOTIFICATIONS_MASTERPLAN.md` and
`PWA_PUSH_NOTIFICATIONS_MASTERPLAN.md` both depend on.

**In scope:** Write the real SQL for `push_subscriptions` — columns for `license_key`, `device_id`,
`endpoint`, `p256dh` (public key), `auth` (auth secret), `created_at`; RLS enabled, policies
mirroring `device_registrations`' own split-by-command pattern exactly (`select`/`update`/`delete`
scoped to `license_key = auth.jwt()->'user_metadata'->>'license_key'`, `insert` similarly scoped —
no `max_devices`-style limit needed here, since a subscription is naturally one-per-device already
via `device_id` as part of a unique constraint, not a separately-enforced count). Run it through
Phases 2-4's tool against every currently-active project. Confirm the two dependent tracks (shell,
PWA) can now actually build against a real table instead of a documented-but-not-yet-real contract.

**Out of scope:** Anything about how push notifications actually get sent or received — purely the
schema, delivered via this new tool.

**Key files:** None new — this phase is a *use* of Phases 2-4's tool, not new code.

**Verify:** Confirm `push_subscriptions` exists, correctly structured with working RLS, on every
currently-active project — check directly in at least one project's own Supabase Studio, don't
just trust the tool's own success report blindly for the first real run.

---

## Phase 6 — Close-out

**Goal:** Full documentation of this new capability so it's obviously the right tool for the next
schema change, not something a future session has to rediscover.

**In scope:** README update explaining this tool exists and should be used for any future schema
change touching more than one project — including the one-time backfill step new projects skip
(since they'll have their connection string captured at creation, per Phase 1) versus what already
-existing projects needed. Final review of Phase 1's stored-connection-string decision — confirm
the tradeoff is clearly written down somewhere obvious, not just in this masterplan file. This
track's own pointer block updated to "Track complete," `PHASE_STATUS.md`-equivalent update if this
repo tracks its phases the same way the other two repos do.

**Out of scope:** Any new functionality.

**Key files:** `README.md`, this file's own Phase pointer block.

**Verify:** A fresh read-through of the README section by someone who wasn't in this conversation
should be enough, on its own, to understand why this tool exists and how to use it for the next
unrelated schema change six months from now.

---

## Phase pointer

**Track complete.** All 6 phases done: connection strings stored (Phase 1),
the broadcast UI built (Phase 2), the real broadcast run (Phase 3), folding
into the master provisioning file (Phase 4), the real `push_subscriptions`
table shipped and confirmed live across every active project (Phase 5,
confirmed run and Supabase Studio verification done by the operator), and
this close-out (Phase 6).

Phase 6 notes, for whoever reads this months from now wondering why this
tool exists:

- **README.md** gained a new "Pushing a schema change to every project at
  once" section — what the tool is, the paste/select/confirm/run/fold
  sequence, the idempotent-SQL expectation, the one-time backfill distinction
  (new projects capture a connection string automatically at creation;
  the 4-5 pre-existing ones each needed a one-time manual backfill through
  the Projects screen), and the stored-connection-string tradeoff restated
  in plain language with a pointer to the migration file that first made
  the call. The project-structure tree and the "Full walkthrough" checklist
  both gained a line for `schema-push/`.
- **Phase 1's stored-connection-string decision, final review:** the
  tradeoff was already written down in full inside
  `supabase/migrations/0004_project_connection_strings.sql` (not skipped
  past there), but that's a file only someone reading migrations would
  ever open. Per this phase's own instruction to confirm it's written down
  "somewhere obvious, not just in this masterplan file," it's now also in
  README.md itself — the first place anyone new to this repo actually
  looks — restating the same reasoning (this table already held an equally
  powerful plaintext secret before this column existed; the real boundary
  is `requireAdminUser()`, not encryption-at-rest, for a single-operator
  registry) with a pointer back to the migration for the full version.
  Nothing about the underlying decision changed on this review — it's
  reaffirmed, with the caveat (also restated) that it should be revisited
  if this registry ever grows past one trusted operator.
- **PHASE_STATUS.md-equivalent:** this repo does not keep a separate
  `PHASE_STATUS.md` file the way the shell/PWA repos might — it tracks
  phase status the same way this file already has, all along: a live,
  editable "Phase pointer" block at the bottom of each track's own
  masterplan, kept current by whichever session works that track (see
  `ADMIN_PANEL_MASTERPLAN.md`'s own build-history log for the main track's
  version of the same convention). This block, now reading "Track
  complete," **is** this repo's PHASE_STATUS.md-equivalent for this track
  — there's no separate file to also update.
- **No new functionality was added in this phase**, per its own explicit
  "Out of scope" — everything above is documentation only.
- **For the next unrelated schema change, six months from now:** open
  `/schema-push`, paste the SQL, select the affected projects, confirm.
  That's the entire playbook this track exists to establish — see
  README.md's own new section for the rest of the detail.
