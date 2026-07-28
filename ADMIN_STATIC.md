# ADMIN_PANEL_DEVICE_DELETE_AND_PROJECT_EDIT_MASTERPLAN.md

## Background

Confirmed by reading the actual current code, not assumed:

- The client-detail page (`app/(app)/clients/[licenseKey]/page.js`, Phase 9 of the original
  `ADMIN_PANEL_MASTERPLAN.md`) shows each license's devices — but its own header comment states
  plainly: *"editing a device's `can_write`/`is_active` stays the client-facing PWA's own job...
  this admin panel never writes to `device_registrations` at all."* It's genuinely view-only today.
  There is no delete capability anywhere in this repo for a device.
- `app/(app)/projects/actions.js` has exactly three functions: `listProjectsWithStatusAction`,
  `toggleProjectPausedAction`, and `setProjectConnectionStringAction` (the one-time, never-saved
  provisioning credential). **There is no general "edit this project's own stored fields" action
  anywhere** — no way to fix a typo in a label, update a URL, or rotate an anon/service-role key
  after the project's already been added.
- The schema-broadcast tool (`app/(app)/schema-push/*`) already appends every successful push to
  `supabase/provisioning/target_project_schema.sql` in order (confirmed directly — Phase 4 of that
  track), so new projects already inherit every past push automatically, in the right order. What's
  missing is a dedicated place to *see* that history — pushes are logged via the existing
  `logAuditEvent()`/Activity feed, but the schema-push screen itself has no focused view of its own
  history.

This track builds all three: device deletion, full project editing, and a schema-push history view.

## House-style reminders

- Exactly one phase per session, `str_replace` the Phase pointer block before re-zipping.
- **Editing a live project's URL/anon key/service-role key is genuinely dangerous, not routine** —
  any client already active on that project has those exact values cached locally (shell's
  `magneat_config.json`, PWA's IndexedDB). Changing them here doesn't update any client — it just
  makes this admin panel's own record disagree with what every already-activated client is still
  using. Every phase touching project editing needs to treat this as a real hazard, not a plain
  form.
- Device deletion here is a pure Supabase-row delete (same mechanism the shell/PWA masterplans'
  own Phase 9/10 already cover from the device's own side) — this track doesn't need to coordinate
  with the shell or PWA to build it, but should be honest in its own UI copy about what deleting a
  device does and doesn't do (see Phase 2).

---

## Phase 1 — Device delete: backend action

**Goal:** A real, working way to permanently remove a device's row from `device_registrations` on
its target project.

**In scope:** New server action, e.g. `deleteDeviceAction(accessToken, { licenseKey, deviceId,
projectId })` in a new or extended actions file alongside the client-detail page. Look up the
project's stored URL + service-role key (same pattern `provisionProjectAction`/`updateClientAction`
already use elsewhere in this repo), build a service-role client for that specific project, and
delete the one row matching both `license_key` and `device_id` (never a bare `device_id` match
alone — a device_id could theoretically collide across different licenses in the same project,
however unlikely; scope the delete by both, matching the same discipline every RLS policy in this
system already uses). Log the action via `logAuditEvent()` (actor, `delete_device`, target =
`device_id` + company name, details = which project).

**Out of scope:** The UI button/confirmation (Phase 2). Any equivalent for a future
`shell_registrations` table (that table doesn't exist yet — this track only ever deletes rows from
`device_registrations`, the PWA-device table that already exists).

**Key files:** `app/(app)/clients/[licenseKey]/actions.js` (extended).

**Verify:** Hand-seed a test device row in a real (or test) target project; call the action; confirm
the row is actually gone (check directly in that project, not just trust the action's own success
return) and that a device belonging to a *different* license with the same `device_id` (if you
construct that test case) is untouched.

---

## Phase 2 — Device delete: UI, with honest copy about what it does and doesn't do

**Goal:** A delete action per device row on the client-detail page, with real confirmation friction
and copy that doesn't overpromise.

**In scope:** A delete button per device card, gated behind a confirmation step (name the specific
device — its own name/last-seen, not a bare "are you sure") matching this project's own established
bar for destructive actions (the client-delete flow is the right precedent, not a single click).
Copy should be honest about the consequence, per this masterplan's own Background note: something
like *"This removes the device's registration — if it's a PWA, that install will need to
reactivate; if it's a shell, nothing currently stops it from continuing to sync (shell-side
enforcement is separate, ongoing work)"* — don't imply a guarantee this repo alone can't back up.

**Out of scope:** Any change to how the shell/PWA themselves react to a deleted device (that's
each of those repo's own tracks' job, already covered by their own Phase 9/10 work where it exists).

**Key files:** `app/(app)/clients/[licenseKey]/page.js`.

**Verify:** Delete a real test device through the UI; confirm the row disappears from the page
after reload and is genuinely gone in Supabase, not just hidden client-side. Confirm cancelling the
confirmation step deletes nothing.

---

## Phase 3 — Project edit: backend action, with the danger made explicit in its own contract

**Goal:** A real `updateProjectAction()` that can change a project's label, URL, anon key,
service-role key, and notes — decided and documented as a genuinely hazardous action, not a plain
CRUD update.

**In scope:** New action in `app/(app)/projects/actions.js` accepting the project's `id` plus any
subset of `label`/`supabase_url`/`supabase_anon_key`/`supabase_service_role_key`/`notes` to change.
Before writing, check whether any `licenses` rows currently reference this project (a simple count
query) — this doesn't block the edit (there are legitimate reasons to fix a genuine typo even on
a project with active clients), but the count is returned to the caller so Phase 4's UI can warn
proportionally to the real stakes (editing an empty, unused project is low-risk; editing one with
12 active clients pointed at it is not). Log every field actually changed via `logAuditEvent()`
(old value → new value per field, not just "project edited" — this is exactly the kind of action
where the audit trail needs to be specific, given how much can silently break from an edit here).

**Out of scope:** Any attempt to push the new values out to already-activated clients — genuinely
impossible from this repo (clients aren't listening for this at all, by this whole system's own
design) and not this phase's job to solve.

**Key files:** `app/(app)/projects/actions.js`.

**Verify:** Update a test project's `notes` field alone — confirm only that field changes, nothing
else drifts. Update a test project's URL — confirm the active-client count is correctly returned
alongside the update result, using a project you've hand-linked at least one test license to.

---

## Phase 4 — Project edit: UI, with a warning proportional to real stakes

**Goal:** An actual edit screen, where the danger of changing a live project's connection details
is front and center, not buried.

**In scope:** New page, e.g. `app/(app)/projects/[id]/edit/page.js` — a form for all five editable
fields, pre-filled with current values. Before allowing a submit that changes `supabase_url`/
`supabase_anon_key`/`supabase_service_role_key` specifically (label/notes changes need no special
friction — genuinely low-risk), show Phase 3's own active-client count plainly: *"N active client(s)
are currently using this project's stored connection details — changing them here will NOT update
those clients, and may cause their next sync to fail."* Require an explicit confirmation step for
that specific case (matching this repo's own established destructive-action bar) — but do not
block a label/notes-only edit behind the same friction, since that's a real, common, low-stakes
edit this shouldn't discourage.

**Out of scope:** Any attempt to build a "push new credentials to affected clients" remediation
flow — flag it as a real gap in this phase's own UI copy (something like "if you must rotate these
values on a live project, affected clients will need to be manually re-activated") rather than
pretending a fix exists.

**Key files:** New `app/(app)/projects/[id]/edit/page.js`; `app/(app)/projects/page.js` (add the
edit entry point per project row).

**Verify:** Edit a test project's label/notes only — confirm no warning appears, edit proceeds
directly. Edit a test project's URL on one with a real linked test license — confirm the warning
shows the correct client count and blocks submission until confirmed.

---

## Phase 5 — Schema-push history view

**Goal:** A dedicated, focused view of every schema push ever run — order, what was submitted,
which projects succeeded/failed — right on the schema-push screen itself, not buried in the
general Activity feed.

**In scope:** Query the existing audit log for `action = 'schema_push'`-type entries (confirm the
exact action string `broadcastSchemaPushAction`'s existing `logAuditEvent()` call already uses —
re-read it directly rather than assuming) and render them, most-recent-first, on
`app/(app)/schema-push/page.js` — each entry showing when, a preview/expandable view of the SQL
submitted, and the per-project success/failure detail already captured in that log entry's own
`details` field.

**Out of scope:** Any new logging mechanism — this phase only surfaces what Phase 4 of the original
schema-broadcast track already records, per this masterplan's own Background confirmation.

**Key files:** `app/(app)/schema-push/page.js`, a new small query helper if one doesn't already
exist for reading filtered audit-log entries.

**Verify:** Run one real (or test) schema push; confirm it appears at the top of this new history
view with accurate detail, matching what's already independently visible in the general Activity
feed — same data, just a focused, purpose-built presentation of it.

---

## Phase 6 — Cross-check: does the general Activity feed need anything for these new actions?

**Goal:** Verification phase — confirm `delete_device` and the new project-edit actions both show
up correctly in the existing general Activity feed, not just their own dedicated views.

**In scope:** Re-check `app/(app)/activity/page.js`'s own rendering logic against the new action
types introduced in Phases 1-4 — confirm it doesn't assume a fixed, closed set of action strings
that would silently drop or mis-render an unfamiliar one. Fix only if a real gap is found.

**Out of scope:** Any new functionality beyond confirming/fixing this one thing.

**Key files:** `app/(app)/activity/page.js` (read-only unless a gap surfaces).

**Verify:** After Phases 1-4's real test actions, open the general Activity feed and confirm every
one of them (device delete, project edits) renders sensibly there too, not just in their own
dedicated views.

---

## Phase 7 — Full-repo consistency pass

**Goal:** Nothing from Phases 1-6 left half-wired.

**In scope:** Grep the repo for any other place that lists/reads project fields
(`supabase_url`/`supabase_anon_key`/etc.) and confirm none of them cache a stale copy that Phase
3's edit action would leave inconsistent (e.g. if `provisionProjectAction` or any other flow reads
project fields once and holds them in a way that wouldn't reflect a later edit — confirm this isn't
the case, or note it clearly if some caching is unavoidable). Confirm the client-detail page's own
device list correctly reflects a deletion without requiring a hard page refresh (or documents that
one is needed, if that's the simpler, acceptable choice).

**Out of scope:** Any new functionality — this is a consistency/regression check only.

**Key files:** Whole repo (read-only grep sweep), fixes only where a real gap is found.

**Verify:** A full walkthrough — delete a device, edit a project's notes, edit a project's URL
(with the warning), run a schema push — confirm all four show up correctly everywhere they should
(their own screen, the general Activity feed) with no stale/inconsistent state anywhere.

---

## Phase 8 — Close-out

**Goal:** Documentation and final build, same shape as every other track in this repo.

**In scope:** README update describing the two new capabilities (device delete, project edit) and
their real hazards (the project-edit warning in particular — worth stating plainly in the README
too, not just in the in-app copy, so a future reader skimming the docs understands the stakes
before ever opening the edit screen). This track's own pointer block, if this repo tracks phases
the same way the shell/PWA repos do. Final clean build.

**Out of scope:** Any new functionality.

**Key files:** `README.md`, this file's own Phase pointer block.

**Verify:** Clean build. A README read-through by someone unfamiliar with this session should be
enough on its own to understand both new features and their real risks.

---

## Phase pointer

**This track is complete. Phase 8 — Close-out — was the last phase.**
**Last completed phase: Phase 8 — Close-out.**

### Phase 8 notes, for whoever reads this next

- **README.md updated** with two new top-level sections, matching the
  existing "Pushing a schema change to every project at once" section's
  own style and level of detail:
  - **"Deleting a device"** — what it actually deletes (one
    `device_registrations` row, scoped by `license_key` + `device_id`
    together), and stated plainly, not glossed over: a PWA needs to
    reactivate, but an already-running shell is **not** stopped from
    continuing to sync by this alone — shell-side enforcement is flagged
    as separate, outstanding work, not implied as already covered.
  - **"Editing a project"** — label/notes as ordinary low-friction edits,
    versus URL/anon key/service-role key as a deliberately different,
    higher-friction action. States the real hazard in the README itself,
    not just the in-app copy, per this phase's own explicit instruction:
    already-active clients cache their own copy of these values locally
    and never re-fetch from this admin panel, so editing them here changes
    only this admin panel's own record, not what any live client is
    actually using — and that there is no "push new credentials" button
    anywhere in this repo to close that gap.
- **A small addition beyond this phase's own literally-named "two
  capabilities," flagged rather than silently included or silently
  dropped:** this masterplan's own Background section describes the track
  as building **three** things (device delete, project edit, and a
  schema-push history view), but this phase's own "In scope" text names
  only "the two new capabilities (device delete, project edit)" for the
  README update. Since the history view (Phase 5) is real, already-shipped
  functionality from this same track with its own genuine limitation worth
  knowing before relying on it (it shows outcome, not the submitted SQL or
  a failure's specific error text), a short paragraph was added to the
  existing "Pushing a schema change" section for it too — low-risk
  documentation, not new functionality, and cheap enough that leaving a
  real, already-built feature completely undocumented seemed like the
  bigger risk of the two options. Noted here explicitly in case that
  reasoning doesn't hold and it should be reverted.
- **`Project structure` and `Full walkthrough` sections both updated** to
  reflect the new edit route, the device-delete capability, and the
  schema-push history view — the walkthrough gained two new numbered
  steps (device delete with cancel-does-nothing check; project URL edit
  with the warning) plus a check that Activity renders both new action
  types with a proper label/icon (Phase 6), not the two originally in
  Phase 12's own list.
- **This file's own Phase pointer block** (immediately above) now marks
  the track complete rather than pointing at a next phase — no Phase 9
  exists in this masterplan.
- **Final clean build:** `npm install && npm run build` against dummy env
  values (compile/type-safety check only, standard for this session — no
  live Supabase available) completed with no errors or warnings across
  all 11 routes, including the three new/changed ones from this track
  (`/projects/[id]/edit`, `/clients/[licenseKey]` with its device-delete
  UI, `/schema-push` with its History section).
- **Verify still owed to a human, carried forward one last time:** every
  phase in this track (1 through 7) flagged the same real gap — no live
  Supabase credentials were available in any session that built this, so
  nothing here has been exercised against a real database. The
  `## Full walkthrough` section above (steps 4, 9, 10 specifically are new
  from this track) is written to be that check, ready for whoever next has
  live access to run it end-to-end.

---

### Phase 7 notes, for whoever reads this next

- **No code changes this phase** — a read-only sweep, per this phase's own
  scope ("fixes only where a real gap is found"; none was).
- **Grepped every read site of `supabase_url`/`supabase_anon_key`/
  `supabase_service_role_key`/`db_connection_string`** across `app/` and
  `lib/` (14 call sites across 7 files). Every one of them is a fresh
  `.from('projects').select(...)` (or `.select('...db_connection_string')`)
  inside a server action, run at call time — no module-level variable, no
  in-memory `Map`/cache, nothing holding a project row's connection fields
  across requests. The one cached client (`_adminClient` in
  `lib/supabase/admin.js`) is a connection to the **registry** project
  itself (this app's own database, credentials from env vars) — unrelated
  to *target* projects' own fields, which Phase 3's edit action touches;
  confirmed there's no overlap.
- **A real denormalized copy does exist, and is worth knowing about even
  though it needed no fix:** `licenses.target_supabase_url` /
  `licenses.target_supabase_anon_key` (0002_registry_schema.sql) are a
  flat-column copy of a license's own project's `supabase_url`/
  `supabase_anon_key` — kept there specifically so the shell's own
  registry contract (`docs/reference/shell_REGISTRY_CONTRACT.md`) can read
  them with a single-table query, no join. Confirmed this is **not**
  app-level caching this track needed to account for: a Postgres trigger
  already in that same migration
  (`trg_cascade_project_key_update`, `after update of supabase_url,
  supabase_anon_key on public.projects`) pushes any change straight to
  every `licenses` row pointing at that project, automatically, at the
  database level — independent of which client issued the `UPDATE`.
  `updateProjectAction`'s own `.update(updatePayload)` (Phase 3) is a real
  SQL `UPDATE`, so this trigger already fires correctly on it without that
  action needing to know the trigger exists. Traced through by hand:
  building a partial `updatePayload` from only the fields actually
  supplied (confirmed in `app/(app)/projects/actions.js`) means a
  notes-only edit's `UPDATE` never includes `supabase_url`/
  `supabase_anon_key` in its `SET` list, so the trigger correctly doesn't
  fire for that case either — no unnecessary writes.
  This doesn't contradict this track's own repeated "can't push to
  already-activated clients" warning: that trigger updates the
  **registry's own `licenses` row**, not a shell's local
  `magneat_config.json` or a PWA's IndexedDB — those are only read once,
  at activation time, and cache locally after that, exactly as this
  masterplan's own Background/Phase 3/Phase 4 text already says. The
  trigger keeps the registry internally consistent; it was never claimed
  to (and doesn't) reach already-activated clients.
- **`supabase_service_role_key` has no equivalent cascade** (by design —
  it's never given to the shell/PWA, so `licenses` has no column for it
  to go stale in). Confirmed no other table denormalizes it either.
- **Reachability status on the Projects dashboard** (`listProjectsWithStatusAction`,
  `app/(app)/projects/actions.js`) is computed live on every call, straight
  off the row just fetched in that same call — not stored, not cached — so
  a URL/key edit shows up correctly (reachable/unreachable) the very next
  time that list loads. No gap.
- **Device deletion — confirmed already correct, not a gap:** the
  client-detail page (`app/(app)/clients/[licenseKey]/page.js`) filters
  the deleted device straight out of its own local `detail.devices` React
  state on a successful `deleteDeviceAction` call (`setDetail((d) => ({
  ...d, devices: d.devices.filter(...) }))`) — no hard page reload needed,
  matching what Phase 2's own notes already claimed. The "Devices: N / max"
  count header reads off that same state, so it updates in lockstep, not
  as a second, separately-fetched number that could drift.
- **Also checked, not required by this phase's own two bullet points but
  in the spirit of "nothing left half-wired":** the Projects list page
  (`app/(app)/projects/page.js`) and the new edit page
  (`app/(app)/projects/[id]/edit/page.js`) don't share any client-side
  cache — the edit page's own "Back to projects" button does a real
  route navigation, and `/projects` re-runs `listProjectsWithStatusAction`
  fresh on its own mount every time, the same pattern every other list
  page in this app already relies on. The Clients list page's own
  per-license device count (`app/(app)/clients/page.js`) is likewise
  re-fetched fresh on that page's own mount, so a device deleted from the
  detail page shows correctly the next time the list page loads.
- **One pre-existing, out-of-scope observation, noted not fixed:** the
  `create_project` audit-log entry (`app/(app)/projects/new/actions.js`)
  permanently stores a snapshot of `supabase_url` *at creation time* in
  its own `details`. That's expected, ordinary audit-log behavior (a
  point-in-time record, same as every other audit entry), not a live
  reference anything in the app treats as current — flagged here only so
  a future reader doesn't mistake it for the same kind of staleness risk
  this phase was checking for.
- **Verify still owed to a human:** the masterplan's own Phase 7 Verify
  step — a full walkthrough (delete a device, edit a project's notes, edit
  a project's URL with the warning, run a schema push; confirm all four
  everywhere they should appear) — needs live Supabase and real test data,
  not available in this session. Everything above was confirmed by
  reading the actual code and the actual migration SQL, not by running it;
  that live walkthrough is still the next real check. Same
  outstanding-verify pattern as every phase in this track so far.

### Phase 6 notes, for whoever reads this next

- **Swept every `logAuditEvent()` call site in the repo** (not just this
  track's own two actions) to get the real, current list of action
  strings, rather than trusting this masterplan's own prior phases to
  have listed them completely:
  `create_project`, `provision_project`, `pause_project`, `unpause_project`,
  `edit_project`, `create_client`, `edit_client`, `suspend_client`,
  `reactivate_client`, `delete_client`, `move_client`, `delete_device`,
  `backfill_project_connection_string`, `schema_push_broadcast`.
- **`app/(app)/activity/page.js`'s own `ACTION_META` map was missing
  exactly the two new ones this track's Phases 1-4 introduced** —
  `delete_device` (Phase 1) and `edit_project` (Phase 3). Confirmed
  `DEFAULT_ACTION_META`'s own fallback already made this safe in the
  narrow sense this phase's Goal cares about most — no crash, no dropped
  row, every unfamiliar action string still renders — but the row showed
  up as the raw snake_case string next to a generic clock icon, unlike
  every other action type on this page. That's a real "does it render
  sensibly" gap per this phase's own Verify wording, so it's fixed here:
  `edit_project` gets the same icon/tone `edit_client` already uses
  (`PencilSimple`, `default` — the real stakes of a given edit live in
  that row's own `details.changes`, not in the action type's color);
  `delete_device` gets `danger` tone plus `DeviceMobile`, the same icon
  the client-detail page (`app/(app)/clients/[licenseKey]/page.js`)
  already uses for a device, reused here rather than inventing a second
  one for the same entity.
- **Two more gaps found during the same sweep, deliberately *not* fixed
  here:** `backfill_project_connection_string` and `schema_push_broadcast`
  are *also* missing from `ACTION_META` and *also* fall through to the
  generic fallback — but neither one was introduced by this track's own
  Phases 1-4 (both predate it, from the schema-broadcast track). This
  phase's own scope is explicit — "the new action types introduced in
  Phases 1-4," "no new functionality beyond confirming/fixing this one
  thing" — so both are flagged here, in this note, rather than folded in
  under this track's own phase count. Whoever eventually touches
  `ACTION_META` next (for that track, or a general cleanup) should treat
  this note as the pointer, not rediscover it from scratch.
- **`app/(app)/schema-push/page.js`'s own dedicated history view (Phase 5,
  same session prior)** already surfaces `schema_push_broadcast` entries
  with a purpose-built rendering, independent of `ACTION_META` — so that
  action type not having a friendly general-feed entry is a real but
  low-stakes gap (it has its own good view elsewhere), not a dead end for
  an operator trying to understand what happened.
- **Not done yet, deliberately:** no fix to the two pre-existing gaps
  above (out of scope, see above). No change to `deleteDeviceAction` or
  `updateProjectAction` themselves — this phase is read-only against
  those, confirmed no drift by rereading them (see the exact action
  strings above), not just trusting Phases 1 and 3's own notes.
- **Verify still owed to a human:** after real test runs of Phases 1-4's
  actions (device delete, project edits), opening the general Activity
  feed and confirming each renders with the new label/icon/tone added
  here — needs live Supabase and real test actions, not available in this
  session (`npm run build` passed cleanly against dummy env values as a
  compile/type-safety check only). Same outstanding-verify pattern as
  every phase in this track so far.

### Phase 5 notes, for whoever reads this next

- **`listSchemaPushHistoryAction(accessToken)`** added to
  `app/(app)/schema-push/actions.js` (extended, not a new file) — every
  `schema_push_broadcast` audit-log row, most-recent-first, capped at 100
  (same "single capped query, no pagination machinery" reasoning
  `listAuditLogAction` already established for the general Activity feed).
  The action string was re-read directly from that same file's own
  `logAuditEvent()` call rather than assumed — it's `schema_push_broadcast`,
  **not** `schema_push`, which is what this masterplan's own Phase 5 text
  above guessed.
- **A real gap surfaced while building this, not silently routed around:**
  this phase's own Goal text says each history entry should show "a
  preview/expandable view of the SQL submitted," on the assumption (per
  this masterplan's own Background note) that it's "already captured in
  that log entry's own `details` field." Re-reading `details` as actually
  written shows it holds `project_ids`, `succeeded_count`, `failed_count`,
  `folded_into_master`, and per-project `{ projectId, label, status }` —
  **no SQL text, and no per-project error text** (only `status`, not the
  `error` string that exists in-memory during the run itself). Since this
  phase's own "Out of scope" line rules out any new logging mechanism,
  neither gap was fixed here — the history view instead shows exactly
  what's on each row (when, actor, per-project success/failure, fold
  outcome) and says plainly, in its own UI copy, that the raw SQL and
  per-project error text aren't available from history, only during the
  run itself or by reading `target_project_schema.sql` directly for
  whatever ended up folded in. Fully documented in
  `app/(app)/schema-push/actions.js`'s own top comment for whoever
  eventually decides whether to add `sql` to that file's `logAuditEvent`
  call.
- **UI added to `app/(app)/schema-push/page.js`** (extended, same file as
  Phases 2-4): a new "History" `Card` below the existing SQL/projects
  form, loaded on mount alongside the existing project list (a separate
  `useEffect`/`useCallback`, so one failing to load never blocks the
  other) and reloaded again right after a run completes, so a
  just-finished push appears at the top without a manual refresh.
- **Per-row display:** succeeded/failed counts, a "Folded into master"
  badge when applicable, when + actor, and an expandable per-project list
  (same expand/collapse pattern `app/(app)/activity/page.js` already uses
  for its own `details` drill-down) showing each project's name and a
  success/failure icon — no error text, per the gap noted above.
- **Not done yet, deliberately:** no change to how `broadcastSchemaPushAction`
  logs (would be new logging, out of scope per this phase's own text). No
  pagination beyond the 100-row cap — same "revisit if this tool is ever
  run enough for that to be a real limit" stance the general Activity feed
  already takes.
- **Verify still owed to a human:** running a real (or test) schema push
  and confirming it appears at the top of this new history view with
  accurate detail matching the general Activity feed's own row for the
  same event — needs live Supabase, not available in this session
  (`npm run build` passed cleanly against dummy env values as a
  compile/type-safety check only, not a substitute for this). Same
  outstanding-verify pattern as every phase in this track so far.

### Phase 4 notes, for whoever reads this next

- **New page:** `app/(app)/projects/[id]/edit/page.js` — form for `label`/`notes`/
  `supabaseUrl`/`anonKey`/`serviceRoleKey`, pre-filled with current values (label/notes/URL) via
  a new `getProjectForEditAction` read helper (see next bullet). The two secret fields load
  blank on purpose — never echoed from the server, same discipline as everywhere else in this
  repo — and typing a value into either one is what "rotate this" means on this page.
- **`getProjectForEditAction` added to `actions.js`, flagged as a gap, not silently added:**
  neither Phase 3 nor Phase 4's own "Key files" list mentioned a single-project read action, but
  "pre-filled with current values" and showing the active-client count "before allowing a
  submit" both genuinely require one — `updateProjectAction` only ever returns that count
  *after* a write. Documented in that file's own top comment, same as every other
  flagged-not-guessed gap this track has hit so far.
- **Friction is proportional, exactly per the masterplan:** label/notes-only changes submit
  directly, no dialog. Changing the URL from its loaded value, or typing anything into either
  key field, opens a confirmation `BottomSheet` showing the loaded active-client count in the
  masterplan's own specified language, plus an explicit statement that this repo cannot push the
  new values to already-activated clients — stated as a real gap, not glossed over.
- **Entry point:** a small "Edit" button added per project row on `app/(app)/projects/page.js`,
  next to (not replacing) the existing pause/unpause toggle.
- **Not done yet, deliberately:** no "push new credentials to affected clients" flow — flagged
  explicitly in the confirmation dialog's own copy, per this phase's own out-of-scope note,
  rather than pretending a fix exists.
- **Verify still owed to a human:** editing a real test project's label/notes only and
  confirming no warning appears; editing a test project's URL on one with a real linked test
  license and confirming the warning shows the correct count and blocks submission until
  confirmed — both need live Supabase, not available in this session. Same outstanding-verify
  pattern as every phase in this track so far; carried forward again rather than dropped.

### Phase 3 notes, for whoever reads this next

- **`updateProjectAction(accessToken, { projectId, fields })`** added to
  `app/(app)/projects/actions.js` (extended, alongside `listProjectsWithStatusAction`/
  `toggleProjectPausedAction`/`setProjectConnectionStringAction`). `fields` accepts any subset
  of `label`/`notes`/`supabaseUrl`/`anonKey`/`serviceRoleKey` (camelCase, matching
  `createProjectAction`'s own existing convention in `projects/new/actions.js`) — an omitted key
  means "leave unchanged."
- **Only `notes` can be saved blank.** The other four fields throw if given an empty string —
  a project genuinely can't function without a label/URL/anon key/service-role key, so this
  isn't "any subset, including empty," it's "any subset of real values, plus optionally
  clearing notes."
- **Returns `activeClientCount`** (a fresh count of `licenses` rows pointing at this project)
  alongside the updated row on every call — never blocking the edit on it, per the masterplan's
  own instruction that fixing a genuine typo is legitimate even on a project with active
  clients. This is what Phase 4's UI will read to decide how hard to warn.
- **Audit log is per-field, old → new**, via `logAuditEvent()` under `action: 'edit_project'` —
  except `supabase_anon_key`/`supabase_service_role_key`, where only `{ changed: true }` is
  recorded, never the actual values. This isn't a new decision — it's the same
  never-log-secrets discipline `createProjectAction` and `setProjectConnectionStringAction`
  already established for this exact pair of fields, just applied here too.
- **No audit entry is written at all if nothing actually changed** (e.g. resubmitting identical
  values) — `changes` would be empty, and an empty-change "project edited" row would be noise,
  not signal.
- **Not done yet, deliberately:** no UI calls this yet (Phase 4's job). No attempt to push the
  new values to already-activated clients — genuinely impossible from this repo, per the
  masterplan's own explicit out-of-scope note for this phase.
- **Verify still owed to a human:** updating a real test project's `notes` alone and confirming
  nothing else drifts; updating a test project's URL and confirming the active-client count
  comes back correctly against a project with at least one hand-linked test license — both
  need live Supabase, not available in this session. Same outstanding-verify pattern as
  Phases 1 and 2 above; carry forward rather than silently drop.

### Phase 2 notes, for whoever reads this next

- **UI added to `app/(app)/clients/[licenseKey]/page.js`** (extended, same file as Phase 9/10):
  a small trash-icon `Button` in each device card's action column, calling
  `deleteDeviceAction` (Phase 1) via a type-to-confirm `BottomSheet` — same friction bar as
  the client-delete flow on `app/(app)/clients/page.js` (the masterplan's own named precedent),
  not a single click.
- **Confirmation identifies the specific device** by name (or raw `device_id` for the unnamed
  case — device names are nullable, device ids never are) plus its last-seen time, so two
  similar device rows can't be confused before deleting one. The required typed confirmation
  text is that same name-or-id.
- **Copy is deliberately non-overpromising**, per the masterplan's own Background note: states
  a PWA install will need to reactivate, but a shell already running is NOT stopped from
  continuing to sync by this action alone — shell-side enforcement is flagged as separate,
  ongoing work, not implied as already covered.
- **On success**, the deleted device is filtered out of local React state directly (no full
  page reload) — same pattern the clients-list page already uses after `deleteClientAction`.
- **Not done yet, deliberately:** no change to how the shell/PWA themselves react to a deleted
  device — explicitly out of scope per this masterplan's own Phase 2 text, that's each of those
  repos' own tracks' job.
- **Verify still owed to a human:** deleting a real test device through the UI end-to-end
  against live Supabase (row disappears after reload, confirmed gone in Supabase directly, and
  cancelling deletes nothing) — not done in this session, no live Supabase credentials
  available here. Carry this forward the same way Phase 1's own outstanding verify was noted.

### Phase 1 notes, for whoever reads this next

- **`deleteDeviceAction(accessToken, { licenseKey, deviceId, projectId })`** added to
  `app/(app)/clients/[licenseKey]/actions.js` (extended, not a new file — kept alongside
  `getClientDetailAction`/`moveClientAction` in the same file this page already imports from).
- Looks up the project's stored URL + service-role key via the license row's own
  `project_id` (same `admin.from('licenses')` → `admin.from('projects')` two-step every other
  action in this file already uses), builds a service-role client scoped to that one project,
  and deletes exactly one `device_registrations` row matched by **both** `license_key` AND
  `device_id` — never a bare `device_id` match alone, per this masterplan's own instruction.
- `projectId` is accepted per this masterplan's own documented signature, but is only ever used
  as a staleness check against the license row's own freshly-read `project_id` — the connection
  details actually queried always come from the server's own lookup, never trusted blindly from
  the caller. Same discipline `moveClientAction` (Phase 10) already applies to a caller-supplied
  `fromProjectId`.
- Logs via `logAuditEvent()`: `action: 'delete_device'`, target is the device name (or raw
  `device_id` if unnamed) plus company name + license key, details include `license_key`,
  `device_id`, `device_name`, `project_id`, `project_label`.
- **Not done yet, deliberately:** no UI button exists to call this yet (Phase 2's job). No
  `shell_registrations` equivalent — that table doesn't exist in this repo.
- **Verify still owed to a human:** hand-seeding a real test device row in an actual target
  project and confirming the delete + audit log against real Supabase, per this phase's own
  Verify step — not done in this session (no live Supabase credentials available here). Next
  session (Phase 2) should either fold that verification in alongside building the UI, or flag
  clearly if it's still outstanding when Phase 2 closes.
