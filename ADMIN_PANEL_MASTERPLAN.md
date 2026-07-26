# ADMIN_PANEL_MASTERPLAN.md — New admin PWA: registry, projects, clients, licenses

## Background

This is a **new, separate application** — same stack as the existing client-facing PWA (Next.js,
same component/styling conventions, same Dexie-free-where-possible philosophy since this app
only ever talks to the registry project, no offline-first local mirror needed) — but its own
repo/deployment, own login model, own audience of exactly one person (you).

It exists to replace three things that are currently manual, per this project's own confirmed
code:
1. Hand-writing SQL to insert license rows (`LicenseService.cs`'s own comment: *"No in-app key
   generation; keys are inserted directly via SQL by the admin."*).
2. Manually creating each client's Supabase Auth user in Supabase Studio and hand-running SQL to
   stamp `user_metadata.license_key` onto it.
3. Manually running `MASTER_SQL.txt` against each new Supabase project you connect.

Depends on: `SHELL_MULTI_PROJECT_LICENSING_MASTERPLAN.md` Phase 2's registry contract (the exact
`licenses` table shape the shell/PWA will query) — read that before finalizing this track's own
schema in Phase 3, so all three tracks agree on one shape rather than three slightly different
ones.

**Where the powerful keys live, stated plainly once, referenced everywhere else in this file
rather than re-justified each time:** each connected Supabase project's service-role key is
stored in the registry, used *only* server-side by this admin app's own backend (Next.js API
routes / server actions — never sent to the browser, never bundled client-side). This is the one
place in the whole system a service-role key is allowed to exist, because this app is the one
thing only you ever access.

## House-style reminders

- Exactly one phase per session, `str_replace` the Phase pointer block before re-zipping.
- This is a from-scratch build — every phase involves real judgment calls. Flag ambiguity, don't
  silently resolve it.
- "Maximum user-friendly" is the standing design goal referenced in every phase below — prefer
  one clear action over a technically-more-flexible multi-step one, prefer sensible defaults over
  empty required fields, prefer inline validation/errors over silent failure.

---

## Phase 1 — Project scaffold + registry project provisioning

**Goal:** A running (even if mostly empty) Next.js app, and a real registry Supabase project to
point it at.

**In scope:** Scaffold the app from the same baseline dependencies/config as the existing
client-facing PWA (`package.json`, Tailwind config, base component library) — copy, don't
reinvent, so this app looks and feels consistent with the rest of the product. Stand up one real
Supabase project to serve as the registry (manual step, done once, by you — document the exact
steps taken so it's reproducible). Run the registry's own schema (Phase 3 finalizes the exact
shape, but this phase can create a minimal `projects` table stub so later phases have something
to build against). Set the app's own env vars to point at this real registry project's URL +
anon key (client-side safe, exact-match-only per the RLS policy this whole plan depends on).

**Out of scope:** Any actual admin functionality yet (auth, forms, etc. — later phases).

**Key files:** New repo root; `package.json`; `.env.local` (registry URL/anon key, never
committed).

**Verify:** App runs locally, loads a blank/placeholder page, and a manual REST call from the
browser console using the app's own anon key against the registry project succeeds for an
exact-match query and fails for an unfiltered listing query — confirms the RLS policy is actually
scoped correctly before any real data goes in it.

---

## Phase 2 — Admin auth

**Goal:** A login gate — email+password against the registry project's own Supabase Auth,
exactly one account (yours), created manually in Supabase Studio, no signup UI — same
no-self-signup pattern the shell's own business-owner login already uses, just for this app and
this project instead.

**In scope:** Login page (can closely mirror the existing client PWA's `app/login/page.js`
visually, wired to the registry project's Auth instead). Route guarding — every other page in
this app requires a valid session, redirect to login otherwise. Session persistence (localStorage
is fine here — this app has no offline-first Dexie layer to keep consistent with, unlike the
client PWA).

**Out of scope:** Any multi-admin-user support, roles/permissions — this is explicitly a
single-operator tool for now; note it as a candidate future phase if it's ever actually needed,
don't build it speculatively.

**Key files:** New `app/login/page.js`, new `lib/auth/session.js` (can be a much simpler version
of the client PWA's own file, since there's no mock-mode/offline concern here).

**Verify:** Logging in with the manually-created admin account succeeds; any other page redirects
to login when unauthenticated.

---

## Phase 3 — Finalize registry schema: `projects`, `licenses`, `audit_log`

**Goal:** The real, final table shapes this whole system depends on — cross-checked against
`SHELL_MULTI_PROJECT_LICENSING_MASTERPLAN.md` Phase 2's contract so nothing disagrees.

**In scope:** `projects` table — `id, label, supabase_url, supabase_anon_key,
supabase_service_role_key, created_at, notes` (a free-text field for "which of my 5 free
accounts is this, how full is it" — simple, no need to over-engineer capacity tracking yet).
`licenses` table — `license_key, company_name, contact_email, project_id (fk), is_active,
expires_at, max_devices, created_at` — the exact columns the shell/PWA registry lookup (Phase 2
of that track) reads must be a subset of this shape; confirm, don't assume. `audit_log` table —
`id, actor, action, target, details (jsonb), created_at` for Phase 11's use. Write the actual SQL
migration for all three.

**Out of scope:** Any UI yet — this phase is schema only.

**Key files:** New `supabase/migrations/000X_admin_schema.sql` (or wherever this repo's migration
convention lands — this is a from-scratch repo, so the executing session sets the convention,
document the choice).

**Verify:** Migration runs clean against the registry project from Phase 1. A manual insert/select
against each of the three tables succeeds via Supabase Studio, confirming the shapes are usable.

---

## Phase 4 — "Add project" flow

**Goal:** A form to connect a new Supabase project (one of your free-tier accounts) to the
registry, without touching Supabase Studio or the SQL editor directly.

**In scope:** Form: label, Supabase project URL, anon key, service-role key, free-text notes.
Server-side action inserts into `projects` (service-role key never touches the browser — the
form posts to a server action/API route, which is the only place that reads/writes it back to
the registry). **"Provision" button**, same action or a follow-up one: connects to the new
project's Postgres directly (Supabase gives every project a direct connection string, separate
from the REST/anon/service keys — found under Settings → Database) and runs `MASTER_SQL.txt`
against it server-side, so the tables that project needs (`mst_ledger`, `trn_voucher`,
`sync_queue`, `device_registrations`, etc.) get created without you hand-pasting SQL into
Supabase's own editor each time.

**Out of scope:** Automatic capacity monitoring/alerts (Phase 5 covers manual/basic visibility
only, not automation).

**Key files:** New `app/projects/new/page.js`, new server action/API route for the insert +
provisioning call.

**Verify:** Add a genuine test Supabase project through this flow; confirm the `projects` row
exists and (separately) confirm the target project's tables were actually created by the
provisioning step — check via Supabase Studio on that project, don't just trust the action
reported success.

---

## Phase 5 — Project list/dashboard

**Goal:** A single screen showing every connected project at a glance — the natural "where do I
have room for a new client" view.

**In scope:** List all `projects` rows: label, notes, a simple "how many licenses point here"
count (join against `licenses`), and a lightweight reachability check (one cheap REST call per
project, e.g. hitting its own `licenses` count via its own service-role key server-side, shown
as a simple up/down indicator — not a full health dashboard). Manual "mark as paused/full" toggle
so you can note a project as unavailable for new clients without deleting it.

**Out of scope:** Automated capacity alerts, real bandwidth/storage metrics pulled from Supabase's
own usage API — nice future addition, not required for "maximum user-friendly" at this stage; a
human-maintained notes field plus a manual pause toggle is enough for a handful of accounts.

**Key files:** New `app/projects/page.js`.

**Verify:** The dashboard correctly reflects Phase 4's test project, and the license-count join
correctly shows `0` before any client exists in it.

---

## Phase 6 — "Add client" flow (the core deliverable)

**Goal:** One form, one button: email, password (or auto-generate + show it once, matching how
password managers commonly present a "we generated this for you" flow), company name, license
rules (expiry date, max devices), and a target-project picker (default to whichever project Phase
5's dashboard suggests has room, but let the operator override).

**In scope:** On submit, a single server action performs, atomically (or with clear rollback/
retry messaging if partway through and something fails — don't leave a half-created client
silently dangling): (1) calls the target project's GoTrue Admin API
(`POST /auth/v1/admin/users`, authenticated with that project's service-role key, server-side
only) to create the login with `user_metadata: { license_key }` already attached in the same
call; (2) inserts the `licenses` row in the registry pointing at that project. Show the generated
license key and (if auto-generated) password clearly, with a one-click copy button — this is the
thing you'll be handing to the client next, so it needs to be effortless to grab correctly.

**Out of scope:** Bulk/CSV client import — a nice future addition once this core single-client
flow is proven out, not part of this phase's scope.

**Key files:** New `app/clients/new/page.js`, new server action calling both the target project's
Admin API and the registry insert.

**Verify:** Create a genuine test client through this flow; confirm (a) the Auth user exists in
the target project with correct metadata (check via that project's own Supabase Studio), (b) the
registry's `licenses` row exists and points at the right project, and (c) that test client's
credentials actually work end-to-end against a real shell/PWA activation.

---

## Phase 7 — Client list/management

**Goal:** Browse, search, and edit existing clients without ever touching Supabase Studio.

**In scope:** List all `licenses` rows across all projects (join for project label), search by
email/company name, filter by active/expired/near-device-limit. Inline edit for `expires_at` and
`max_devices` (simple registry row update — these two fields don't need to touch the target
project's Auth user at all, only the registry).

**Out of scope:** Editing the client's actual login email/password from here — that's a rarer,
riskier operation; Phase 8 handles the destructive end of the lifecycle, a "change this client's
email" edit case can be flagged as a future addition if it turns out to be needed often.

**Key files:** New `app/clients/page.js`.

**Verify:** Phase 6's test client shows up correctly; editing its expiry date persists and is
reflected back correctly on reload.

---

## Phase 8 — Revoke/suspend/delete client flow

**Goal:** A safe, clearly-labeled way to turn off or fully remove a client, given how destructive
"fully remove" actually is here (their login, their license, and optionally their data).

**In scope:** "Suspend" (soft) — flips `is_active` to false on the registry row only; the client's
login and data stay untouched, they just can't activate/sync anymore (shell/PWA's registry lookup
already fails cleanly on `is_active: false`, per the existing `LicenseService.cs` check pattern).
"Delete" (hard) — a separate, explicitly-confirmed action (type-the-company-name-to-confirm
pattern, given the stakes) that removes the Auth user (Admin API `DELETE`) and the registry row;
optionally offer (but don't require) a follow-up note reminding the operator that the client's
actual data tables in their target project are *not* automatically wiped by this action — that's
a deliberate choice, not an oversight, since accidentally deleting a client's live Tally data
history would be far worse than leaving inactive rows behind.

**Out of scope:** Automatic data-wipe-on-delete — explicitly not building this; flag it as a
manual follow-up step in the confirmation UI text instead.

**Key files:** `app/clients/page.js` (extend), new server action for suspend/delete.

**Verify:** Suspend a test client; confirm their next activation attempt fails cleanly with the
expected "inactive" message. Delete a (different) test client; confirm the Auth user and registry
row are both gone, and that a fresh attempt to activate that same license key now fails cleanly.

---

## Phase 9 — Device visibility per client

**Goal:** See, from this app, whether a client's shell/PWA devices are actually connected and
syncing — without opening that client's own target project's Supabase Studio.

**In scope:** On a client's detail view (extend Phase 7's list into a click-through detail page),
read that client's `device_registrations` rows directly from their target project (server-side,
using that project's stored anon or service-role key — anon is enough here since this is a
read-only display and RLS should already permit it the same way the client's own PWA reads it).
Show device name, last-seen, active/can_write flags — read-only, no editing from here (editing
`can_write`/`is_active` per-device is already the client-facing PWA's own job, per
`deviceManager.js`'s existing `updateDevice()` — don't duplicate that here).

**Out of scope:** Any write action on device rows from this app.

**Key files:** New `app/clients/[licenseKey]/page.js`.

**Verify:** A real activated test device (from the shell/PWA masterplan tracks, once those are
executed) shows up correctly here with an accurate last-seen timestamp.

---

## Phase 10 — License move/reassignment tool

**Goal:** A deliberate, clearly-warned way to move a client from one project to another — the
operation both other tracks' own Phase 8/7 (shell/PWA reassignment-detection phases) are built to
detect and react to.

**In scope:** On a client's detail page, a "Move to a different project" action — picker for the
new target project, a confirmation step that explicitly states (in plain language) that the
client's shell and any PWA devices will need to reactivate/resync once they next check in, and
that their historical data does not automatically follow. On confirm, update the registry's
`licenses.project_id` — that's the entire mechanical change; the shell/PWA side notice and react
to it on their own next check-in (those tracks' own phases), not this one.

**Out of scope:** Actually migrating the client's historical data between projects — a
significantly larger, separate piece of work if ever needed; explicitly not in scope here.

**Key files:** `app/clients/[licenseKey]/page.js` (extend).

**Verify:** Reassign a test client; confirm the registry row's `project_id` updates, and that
(if the shell/PWA tracks' reassignment-detection phases are done by this point) a real device
actually surfaces the "this license has moved" message on its next check-in.

---

## Phase 11 — Audit log

**Goal:** Every meaningful admin action (create/suspend/delete/reassign/edit) recorded somewhere
you can review later — accountability and a debugging aid for "wait, when did I change this."

**In scope:** Every server action from Phases 4–10 that mutates something also inserts one row
into `audit_log` (`actor` = your admin email, `action`, `target` = license key or project id,
`details` = whatever's useful as JSON). Simple reverse-chronological feed page.

**Out of scope:** Any alerting/notification system on top of the log — just the record and a
plain feed view for now.

**Key files:** New `app/activity/page.js`; small shared helper (e.g. `lib/audit.js`) called from
every mutating action built in earlier phases — retrofit those phases' actions to call it, don't
leave any of them silently unlogged.

**Verify:** Perform one of each action type (create client, suspend, delete, reassign, edit
expiry, add project) and confirm each produces exactly one clear, correctly-detailed audit row.

---

## Phase 12 — Polish + close-out

**Goal:** The "maximum user-friendly" pass — make sure every flow built above actually feels
effortless, plus final documentation and deployment notes.

**In scope:** Responsive/mobile check on every page (you may well use this from a phone away from
your desk) — this is a genuine functional requirement here, not cosmetic, given the stated goal.
Empty-state screens (no projects yet, no clients yet) with a clear first action rather than a
blank page. Error-message pass across every server action — confirm failures surface something
a non-technical moment-of-frustration reading would still understand, not a raw stack trace.
Write a short `README.md` covering: how to deploy this app, where its own env vars
(registry URL/anon key) come from, and a reminder that this app itself must never ship any
target-project service-role key to the browser — service-role keys only ever get *read* inside
server actions/API routes, never returned in a response body a client component could log or
inspect. Final full walkthrough of every phase's flow end-to-end.

**Out of scope:** Any new functionality — this phase is refinement and documentation only.

**Key files:** Every page built in Phases 1–11 (light touch-ups only); new `README.md`.

**Verify:** A full walkthrough — add a project, add a client, view their devices, edit their
expiry, suspend them, reassign them, delete a different test one, check the audit log reflects
all of it — completed entirely from a phone-sized viewport with no confusing dead ends.

---

## Phase pointer

**Next phase to execute: none — track complete.**
**Last completed phase: Phase 12 — Polish + close-out.**

- Phase 12 notes (see `docs/PHASE_12_SETUP.md` for the full write-up):
  - Added consistent "Back to dashboard" / "Back to projects" / "Back to
    clients" navigation to every top-level screen that was missing it
    (`app/(app)/projects/page.js`, `app/(app)/clients/page.js`,
    `app/(app)/activity/page.js`, `app/(app)/projects/new/page.js`,
    `app/(app)/clients/new/page.js`) — same inline ghost-Button-plus-
    ArrowLeft pattern the client detail page already established in
    Phase 9, not a new shared component.
  - Fixed a real dead-end/duplicate-submission risk on
    `app/(app)/projects/new/page.js`: a successful save used to leave the
    same form fully populated and resubmittable with only a static badge
    for feedback. It now swaps to a dedicated success view (mirroring
    `app/(app)/clients/new/page.js`'s own Phase 6 pattern) with "Add
    another project" / "Back to projects" actions, and the form itself is
    no longer on screen once saved.
  - Audited loading/empty/error states and error-message wording across
    every screen and server action against this phase's own "In scope"
    list — already at the bar this phase asks for as of Phase 11, no
    changes needed there.
  - New `README.md` at the repo root (setup, env vars, the service-role-
    key-never-to-the-browser rule stated once more plainly, deploy steps,
    project structure, a condensed verify walkthrough).
  - Not done as part of producing this phase: actually executing the full
    end-to-end walkthrough against a live registry project (this session
    has no real Supabase credentials to run it against) — see
    `docs/PHASE_12_SETUP.md` §4 and §5 for the checklist to run once
    `.env.local` is filled in for real.
  - Built: `lib/audit.js` — the "small shared helper... called from every
    mutating action" the masterplan's own Phase 11 spec asks for. Every
    mutating server action since Phase 4 was already inserting its own
    `audit_log` row inline (Phase 3's schema and Phase 4's own convention
    got there first); this phase routes all of them —
    `app/(app)/projects/new/actions.js` (create + provision),
    `app/(app)/projects/actions.js` (pause/unpause),
    `app/(app)/clients/new/actions.js` (create client),
    `app/(app)/clients/actions.js` (edit/suspend/reactivate/delete), and
    `app/(app)/clients/[licenseKey]/actions.js` (move) — through the one
    shared call site instead, so the shape and failure behavior can't
    drift between phases the way it already had.
  - Reconciled a real inconsistency, flagged back in Phase 5's own
    `actions.js` comment: Phase 4's two audit inserts hardcoded
    `actor: 'admin'`, while every phase from 5 onward logged the verified
    session's real email. Both of Phase 4's call sites now capture the
    verified user and log `user.email`, matching everywhere else — no
    hardcoded-string audit actor left anywhere in the app.
  - Built: `app/(app)/activity/page.js` + `app/(app)/activity/actions.js`
    — the reverse-chronological feed itself (`listAuditLogAction`, capped
    at the 500 most-recent rows — see `docs/PHASE_11_SETUP.md` §2 for why
    a cap, not real pagination, is enough for this tool). Search
    (actor/target text) and an action-type filter run client-side over
    the one loaded page, same reasoning Phase 7's own client list already
    used for its own search/filter. Each row's own `details` payload is
    collapsed by default and expands in place.
  - One judgment call worth flagging, full reasoning in
    `docs/PHASE_11_SETUP.md` §4: `logAuditEvent` deliberately never
    throws back into the action it's logging — none of the pre-existing
    call sites checked the insert's own `error` result either, so a
    failed audit write was already silently swallowed before this phase.
    What changed is that failure is now at least visible via
    `console.error` instead of a totally silent no-op. Flagged as a
    judgment call, not a masterplan requirement, in case a stricter
    "no action without a log" guarantee is ever wanted instead.
  - Small connectivity fix, same pattern as Phase 5's/Phase 6's: added an
    "Activity" link on the home screen (`app/(app)/page.js`) next to
    Projects/Clients/Add client.
  - Still owed by you: exercise one of each action type (add a project,
    provision it, pause/unpause it, add a client, edit their expiry,
    suspend/reactivate them, move them, delete a different test one) and
    confirm the Activity feed shows exactly one correctly-detailed row
    per action, with the real signed-in admin email as `actor` — see
    `docs/PHASE_11_SETUP.md` §5.

<!-- Superseded entry — kept for history, see the current pointer above. -->
**Previously — Last completed phase: Phase 10 — License move/reassignment tool.**
  - Built: a "Move to a different project" button and confirmation
    `BottomSheet` on `app/(app)/clients/[licenseKey]/page.js` (Phase 9's
    detail page, extended). Two new server actions in the same route's
    own `actions.js`: `listMoveTargetProjectOptionsAction` (every *other*
    connected project, no default selection — see
    `docs/PHASE_10_SETUP.md` §2 for why this differs from Phase 6's
    recommended-pick picker) and `moveClientAction` (the entire mechanical
    change per the masterplan's own wording: repoints
    `licenses.project_id`, writes one `audit_log` row, touches nothing
    else).
  - The confirmation dialog states plainly, every time, that the client's
    shell/PWA devices will need to reactivate/resync on their next
    check-in and that their historical data does not automatically
    follow — per the masterplan's own explicit requirement, not left
    implicit.
  - `moveClientAction` re-reads the license's current `project_id` itself
    before writing (doesn't trust a value handed up from a possibly-stale
    page) and rejects "moving" a client to the project they're already
    on.
  - After a successful move, the detail page reloads its own data —
    the device list you see afterward is read live from the *new* target
    project (typically empty until the client reactivates there), same
    read Phase 9 already built, just now pointed at wherever the registry
    currently says.
  - Verified: `npm run build` compiles clean with the extended
    `/clients/[licenseKey]` page; confirmed no service-role key (registry's
    or any target project's) appears in the client-side JS chunks.
  - Still owed by you: exercise a real move against a test client — see
    `docs/PHASE_10_SETUP.md` §4 for the exact steps, including confirming
    the `audit_log` row and (once the shell/PWA tracks' own
    reassignment-detection phases are done) that a real device actually
    surfaces the "this license has moved" message on its next check-in.
  - Built: `app/(app)/clients/[licenseKey]/page.js` — a click-through
    detail page reached from a new "Devices" button on each Phase 7 client
    row (`app/(app)/clients/page.js`, extended). Shows the client's own
    company name/expiry/license key at the top, then their
    `device_registrations` rows (device name, last-seen, active,
    can_write, a "Master" badge where `is_master` is set) read directly
    from their target project — entirely read-only, no per-device edit
    controls, per the masterplan's own out-of-scope note. New server
    action `getClientDetailAction` in the same route's own `actions.js`.
  - One judgment call worth flagging, full reasoning in
    `docs/PHASE_9_SETUP.md` §2: the masterplan's own "anon is enough"
    suggestion for this phase doesn't actually hold up against
    `device_registrations`'s own RLS policy, which scopes to an
    *authenticated* user matching their own `license_key` — this app has
    no such JWT for an arbitrary client being looked up by the operator,
    so an anon-key request would silently return zero devices for every
    client. Uses the target project's stored service-role key instead,
    same pattern Phase 7's own `fetchActiveDeviceCounts` already
    established for the near-device-limit column.
  - An unreachable target project (asleep, missing/misconfigured stored
    keys) doesn't blank the whole page — the client's registry-side info
    still loads, with an inline notice in place of the device list. Same
    "show what you know" spirit as Phase 5's own reachability badge.
  - Verified: `npm run build` compiles clean with the new
    `/clients/[licenseKey]` route; confirmed no service-role key (registry's
    or any target project's) appears in the client-side JS chunks.
  - Still owed by you: exercise this against a real activated shell/PWA
    device once the shell/PWA masterplan tracks have produced one — see
    `docs/PHASE_9_SETUP.md` §4 for the exact steps and what to
    independently cross-check in the target project's own Supabase Studio.
  - Built: `suspendClientAction` and `deleteClientAction` in
    `app/(app)/clients/actions.js`; extended `app/(app)/clients/page.js`
    with per-row Suspend/Reactivate buttons and a Delete action that opens
    a type-the-company-name-to-confirm `BottomSheet` dialog.
  - Suspend doubles as reactivate (one action, boolean argument) — the
    masterplan's own "soft"/reversible framing wouldn't hold with a
    one-way switch. Registry-only, per spec: never touches the client's
    Auth login on their target project.
  - Delete removes the target project's Auth user (GoTrue Admin API) and
    the registry row. Two judgment calls worth flagging (full reasoning
    in `docs/PHASE_8_SETUP.md` and the top comment in `actions.js`):
    1. **No Auth-user id is stored anywhere**, so the user is found by
       paging through `auth.admin.listUsers()` and matching
       `user_metadata.license_key` — capped at 20 pages of 1000, fine for
       this app's scale, flagged if that ever stops being true.
    2. **No rollback on the second half of delete** — if the Auth user is
       deleted but the registry row-delete then fails, there's no way to
       "undelete" the Auth side, so the error names exactly what's left
       to clean up by hand rather than silently losing track of it.
  - Confirmation is enforced server-side (`deleteClientAction` re-checks
    the typed company name itself), not just in the dialog.
  - Explicitly does NOT wipe the client's data tables on their target
    project — stated in the confirmation dialog every time, per the
    masterplan's own out-of-scope note.
  - Verified: `npm run build` compiles clean with the extended `/clients`
    page; confirmed no service-role key (registry's or any target
    project's) appears in the client-side JS chunks.
  - Still owed by you: exercise suspend/reactivate/delete against real
    test clients — see `docs/PHASE_8_SETUP.md` §5 for the exact steps and
    what to independently confirm in both Supabase Studios.
  - Built: `app/(app)/clients/new/page.js` — company name, login email,
    optional contact email, auto-generate-or-manual password, optional
    expiry, max devices, and a target-project picker defaulting to the
    non-paused project with the fewest licenses. Server actions in
    `app/(app)/clients/new/actions.js`: `listTargetProjectOptionsAction`
    (picker data + recommendation) and `createClientAction` (creates the
    Auth user on the target project via the Admin API with
    `user_metadata.license_key` attached at creation, then inserts the
    registry `licenses` row; rolls the Auth user back if the registry
    insert fails, per the masterplan's own no-silent-half-creation
    requirement). New `lib/licensing/keys.js` for license-key/password
    generation (server-only). New `components/ui/CopyField.jsx` — a
    reusable one-click-copy value display, built as its own primitive
    since Phase 7's client list will likely want the same pattern.
  - Three judgment calls made without an explicit spec to follow, each
    flagged in `docs/PHASE_6_SETUP.md` §2 and in the relevant file's own
    comments rather than silently decided: the license-key format itself
    (nowhere specified in this repo — see `lib/licensing/keys.js`), how
    "contact email" relates to the login email (Phase 3's schema has both,
    Phase 6's own field list names only one), and what "the project Phase
    5 suggests has room" concretely means (Phase 5's dashboard shows data,
    not a ranking — built one: non-paused, fewest licenses, no
    reachability re-check on this form for latency reasons).
  - Rollback note: the Auth-user-create step and the registry insert are
    two different databases, so this can't be one Postgres transaction —
    see `docs/PHASE_6_SETUP.md` §3 for the actual rollback behavior and
    its own failure-of-rollback message.
  - Small connectivity fix, same pattern as Phase 5's: added an "Add
    client" link on the home screen (`app/(app)/page.js`) next to Phase
    5's "Projects" link — `/clients/new` had no link pointing to it either.
  - Still owed by you: verify per `docs/PHASE_6_SETUP.md` §5, including
    confirming the Auth user's `user_metadata.license_key` in the target
    project's own Supabase Studio and exercising the rollback path at
    least once.

<!-- Superseded entry — kept for history, see the current pointer above. -->
**Previously — Last completed phase: Phase 5 — Project list/dashboard.**
  - Built: `app/(app)/projects/page.js` — every `projects` row, a
    "how many licenses point here" count joined from the registry's own
    `licenses`, a reachability badge, and a manual pause/full toggle.
    Server actions in `app/(app)/projects/actions.js`:
    `listProjectsWithStatusAction` (one round trip: projects + counts +
    reachability, never returns anon/service-role keys to the browser) and
    `toggleProjectPausedAction` (flips the new `is_paused` column, writes
    an audit entry).
  - Schema gap closed: `supabase/migrations/0003_project_status.sql` adds
    `projects.is_paused` — Phase 3's schema had nowhere for this phase's
    pause toggle to live. See that file's own comment for why it's a new
    migration rather than a retroactive edit to `0002`.
  - Ambiguity resolved, not guessed: "reachability" hits the *target*
    project's own local `licenses` table (provisioned by
    `target_project_schema.sql`), a different table from the registry's
    own `licenses` that the license-count column reads — confirmed the
    target schema actually has one before relying on it. See
    `docs/PHASE_5_SETUP.md` §2 for the full reasoning and why the two
    numbers can legitimately disagree.
  - Reachability checks run in parallel with a 5s per-project timeout, so
    one sleeping free-tier project can't stall the dashboard load; timeout
    counts as "down."
  - Small connectivity fix outside this phase's own listed files: added a
    "Projects" link on the Phase 2 home screen (`app/(app)/page.js`) —
    `/projects` (and Phase 4's `/projects/new`) had no link pointing to
    them from anywhere in the app before this. See `docs/PHASE_5_SETUP.md`
    §3.
  - Audit actor note: this phase's `toggleProjectPausedAction` logs the
    verified session's real email as `actor`, per Phase 11's own spec
    ("actor = your admin email"). Phase 4's inserts hardcoded `'admin'`
    instead — worth reconciling when Phase 11 retrofits logging across all
    prior phases' actions, flagged in `actions.js` rather than silently
    left to drift.
  - Still owed by you: run `0003_project_status.sql` against the registry
    project, then verify per `docs/PHASE_5_SETUP.md` §4 — including
    confirming the pause toggle persists across a reload and a second real
    test project shows up independently.
  - Built: `app/(app)/projects/new/page.js` (form: label, Supabase URL,
    anon key, service-role key, notes, plus a Postgres connection-string
    field — see below) with two submit paths, "Save project" and "Save &
    provision", matching the masterplan's "same action or a follow-up one"
    wording literally rather than picking one. Server actions in
    `app/(app)/projects/new/actions.js`: `createProjectAction` (registry
    insert via the new server-only service-role client) and
    `provisionProjectAction` (direct `pg` connection running
    `supabase/provisioning/target_project_schema.sql`, then queries
    `information_schema.tables` to report back what was actually created).
    Both write a best-effort `audit_log` entry (Phase 11 builds the UI;
    entries start accumulating now instead of only from whenever Phase 11
    lands).
  - Two things worth knowing for later phases:
    1. **Server actions now require bearer-token verification** —
       `lib/auth/server-session.js#requireAdminUser(accessToken)`. Phase
       2's session has no cookie, so nothing server-side previously
       checked a caller was actually logged in before a server action ran
       privileged code. Every server action from now on takes
       `accessToken` as its first argument and verifies it first. Keep
       this convention in Phase 6/8/10's own server actions.
    2. **Added a "Postgres connection string" form field** not listed in
       the masterplan's own Phase 4 form spec — that spec's form fields
       can't supply what its own provisioning requirement needs (a direct
       DB connection string is a distinct credential from the anon/
       service-role keys). Used once in-memory per provisioning call,
       never persisted, never sent back to the browser.
  - `supabase/provisioning/target_project_schema.sql` is a sanitized copy
    of `docs/reference/shell_MASTER_SQL.txt` (also copied into this repo
    now) — two personal/manual test artifacts stripped (a
    `TEST-LIC-0001-VALID` seed insert, and SECTION 13's manual
    `update auth.users` hardcoded to one personal email, made obsolete by
    this phase's own metadata-at-creation approach anyway). Actually run
    against a genuinely fresh local Postgres (with a stub `auth`
    schema/functions standing in for what real Supabase projects already
    have) — zero errors, all 50 expected tables created, `licenses` table
    provisions empty as intended.
  - Still owed by you: set `SUPABASE_REGISTRY_SERVICE_ROLE_KEY` in
    `.env.local`, then run the flow against a real (or disposable) target
    project — see `docs/PHASE_4_SETUP.md` for exact steps and what to
    independently confirm in that project's own Supabase Studio.
