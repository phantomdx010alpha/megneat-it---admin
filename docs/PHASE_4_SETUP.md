# Phase 4 setup — manual step + verify

Phase 4 adds the "add project" flow: a form that inserts into the
registry's `projects` table and (optionally, same submit) provisions a
target project's schema via a direct Postgres connection.

## 1. New env var — get it before testing

Add to `.env.local`:

```
SUPABASE_REGISTRY_SERVICE_ROLE_KEY=your-registry-project-service-role-key
```

From your **registry** project's Settings → API → `service_role` key
(the same registry project from Phase 1, not a target project). Server-only
— no `NEXT_PUBLIC_` prefix, never sent to the browser.

## 2. Two architecture decisions made this phase, worth knowing about

**Server actions now need to verify who's calling them.** Phase 2's login
session lives only in browser localStorage — there's no cookie, so a
server action (a real server endpoint, callable directly regardless of
which page rendered its trigger button) had no way to check "is an admin
actually logged in" before this phase. Rather than retrofit the whole app
onto cookie-based sessions, every server action from now on takes the
current `access_token` (already available client-side via
`getSession()`) as its first argument and verifies it server-side via
`lib/auth/server-session.js#requireAdminUser()` before doing anything
privileged. Keep this convention for every server action in later phases.

**A form-field gap between the masterplan's spec and its own requirement.**
Phase 4's "in scope" text lists the form fields as label/URL/anon
key/service-role key/notes, but then says provisioning needs "the new
project's Postgres directly (Supabase gives every project a direct
connection string, separate from the REST/anon/service keys)". That
connection string is a real, separate credential (includes the DB
password) — none of the listed fields capture it, and it can't be derived
from the others. Added a "Postgres connection string" field to close this
gap; see the top comment in `app/(app)/projects/new/actions.js` for the
full reasoning. It's used once, in-memory, for the provisioning call only
— never persisted to `projects` (Phase 3's schema correctly has no column
for it) and never sent back to the browser.

## 3. What I already verified locally

Same rigor as Phase 3 — actually ran things against real Postgres, not
just wrote SQL and hoped:

- **`supabase/provisioning/target_project_schema.sql`** (the sanitized copy
  of the shell's `MASTER_SQL.txt` that this phase's provisioning step runs)
  applies with **zero errors** against a genuinely fresh database, stood up
  locally with a stub `auth` schema/functions to mirror what every real
  Supabase project already has built in.
- It creates all **50 expected tables** (`licenses`, `device_registrations`,
  `mst_*`, `trn_*`, `sync_queue`, etc.) and nothing extra.
- **Two things were deliberately stripped** from the source file before
  using it here — both are leftover personal/manual test artifacts, not
  appropriate to silently run against a real client's project:
  1. The `TEST-LIC-0001-VALID` seed insert into `licenses` — confirmed the
     table now provisions with **zero rows**, ready for Phase 6 to insert
     the real license.
  2. SECTION 13's manual `update auth.users ... where email =
     'phantomdx9@gmail.com'` — hardcoded to one personal test email, and
     made obsolete by Phase 6 attaching `user_metadata.license_key` at
     Auth-user creation time instead of via a follow-up manual update.
- The app itself (`npm run build`) still compiles clean with the new
  `/projects/new` route, and I confirmed the service-role key and the `pg`
  connection logic don't leak into any client-side JS chunk.

## 4. What to verify yourself, against a real project

The masterplan's own Phase 4 verify step: add a genuine test project
through the flow, then confirm independently.

1. Run `npm install && npm run dev`, sign in, go to `/projects/new`.
2. Fill in a real (or disposable/free-tier) target Supabase project's URL,
   anon key, service-role key, and its Postgres connection string
   (Settings → Database → Connection string — URI format).
3. Click **Save & provision**.
4. Confirm in your **registry** project's Table Editor that the `projects`
   row exists with the right values (service-role key included).
5. Confirm in the **target** project's own Supabase Studio — Table
   Editor or SQL Editor — that the tables actually exist there too. Don't
   just trust the "tables created" list the UI shows you; that list is a
   genuine post-provision query result, but the masterplan's own verify
   step is explicit that you should double-check independently, and it's
   right to.
6. Try clicking **Save project** alone (no provisioning) on a second test
   entry, to confirm that path works standalone too.
