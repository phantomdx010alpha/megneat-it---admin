# Magneatit Admin

A single-operator admin PWA for the Magneatit product line: connect Supabase
projects, provision their schema, onboard clients (login + license) without
touching Supabase Studio, manage the client lifecycle (suspend/delete/move),
and review a full audit trail of every action taken here.

See `ADMIN_PANEL_MASTERPLAN.md` for the full phase-by-phase build history and
design rationale, and `docs/PHASE_N_SETUP.md` for the manual steps and
verification notes specific to each phase.

## What this app is (and isn't)

This is **not** the client-facing shell/PWA product. It's a separate,
internal tool with an audience of exactly one person — you, the operator.
It has no offline-first data layer, no multi-user support, and no roles or
permissions; a valid login is the only access control there is.

## Stack

- Next.js 15 (App Router), React 19
- Supabase (Auth + Postgres) for the app's own **registry** project
- Tailwind CSS, a small shared neumorphic component library under
  `components/ui/`
- `pg` for direct Postgres connections when provisioning a *target* project's
  schema (a separate credential from that project's anon/service-role keys —
  see `docs/PHASE_4_SETUP.md`)

## Local setup

```bash
npm install
cp .env.local.example .env.local
# fill in the three values below, then:
npm run dev
```

### Environment variables

All three come from the **registry** Supabase project — the one project
this admin app itself talks to (see `docs/PHASE_1_SETUP.md` for how that
project was created). They are unrelated to the target projects you connect
*through* this app once it's running.

| Variable | Where it's used | Safe to expose to the browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Registry project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Registry project anon key | Yes — the registry's RLS policies are exact-match-only, so this key alone can't list or scan rows |
| `SUPABASE_REGISTRY_SERVICE_ROLE_KEY` | Registry writes from server actions only | **No — never add a `NEXT_PUBLIC_` prefix to this one** |

`.env.local` is gitignored. Nothing above is committed anywhere.

## The one rule this whole app is built around

**A target project's own service-role key — the powerful, all-access
credential you paste in on the "Add project" screen for each Supabase
project you connect — only ever gets *read* inside server actions and API
routes.** It is stored in the registry (write access to that table is itself
only possible server-side), used server-side to provision schema and manage
client Auth users, and is never returned in a response body, logged to the
browser console, or rendered into any client component. If you're ever
extending this app, treat any code path that could put a service-role key
in something the browser receives as a bug, full stop — not a style
preference.

The registry project's *own* service-role key
(`SUPABASE_REGISTRY_SERVICE_ROLE_KEY`) gets the identical treatment: server
actions only, never a `NEXT_PUBLIC_*` var.

## Pushing a schema change to every project at once

Adding a table/column/policy to one project at creation time is what
"Provision" on the Add Project screen already does. That has no answer for
"I need this change on the 4-5 projects I already have" — for that, use
**Schema Push** (`/schema-push`), not manual SQL in each project's own
Supabase Studio.

**Use this tool for any schema change that touches more than one existing
project, full stop — this is not a one-off built for a single feature, it's
the standing way this app makes schema changes from now on.**

How it works, in order:

1. Paste the SQL once, pick which currently-active (non-paused) projects it
   should run against — default is all of them — and confirm (a genuine
   type-`CONFIRM` gate, same friction level as deleting a client, because
   this runs real, irreversible DDL directly against live databases).
2. It runs **sequentially**, one project at a time, and reports a clear
   success/failure for each individual project — one project failing never
   stops the others from getting the change, and nothing here retries a
   failure automatically; fix it (the SQL, or that project's stored
   connection string) and re-run.
3. **Only if every selected project came back a success** — zero
   failures — the same SQL is folded automatically into
   `supabase/provisioning/target_project_schema.sql`, so every **future**
   project gets it too without a second manual step. Any failure at all
   skips the fold until a clean re-run happens, so the master file never
   drifts ahead of what's actually live everywhere.
4. Write idempotent SQL (`create table if not exists`, wrap
   `create policy` in `drop policy if exists` where this repo's own
   conventions already do that) — the tool does a light heuristic warning
   for the most common miss, but it's not a linter and won't rewrite your
   SQL for you.

**Every past push is visible on the same screen, in a dedicated History
section** — most-recent-first, with each entry's per-project
success/failure breakdown expandable in place, so you don't have to go dig
through the general Activity feed to answer "did that already run, and did
it work everywhere?" One honest limit: history shows the *outcome*, not the
SQL that was actually submitted or a failed project's specific error text —
neither is captured in the underlying log entry today, only during the run
itself (the results card right above, in the same session) or by reading
`supabase/provisioning/target_project_schema.sql` directly for whatever
ended up folded in.

**One thing that only matters once, not per-run:** every project needs a
stored Postgres connection string (`projects.db_connection_string`) before
it can be a Schema Push target. A project added through "Add project" from
now on captures this automatically. The 4-5 projects that already existed
before this tool did **not** have this column, so they each needed a
one-time backfill through a prompt on the Projects screen — if that's ever
skipped for a project, Schema Push reports it as an ordinary per-project
failure ("no stored connection string"), not a silent skip.

**The tradeoff this depends on, said plainly:** reaching 5+ projects
on-demand, in one action, without re-pasting a connection string every
single time, means the registry now stores each target project's own
database password (or full connection string) at rest, in
`projects.db_connection_string` — a new class of stored secret this app
didn't hold before. It's stored in plaintext, deliberately, for the same
reason `projects.supabase_service_role_key` already is (see
`supabase/migrations/0004_project_connection_strings.sql` for the full
reasoning): the real security boundary here is `requireAdminUser()` on
every server action, not encryption-at-rest on a single-operator registry,
and this table already held an equally powerful plaintext secret next to
it before this column existed. Revisit this if this registry ever grows
past a single trusted operator.

## Deleting a device

Where: client detail page (`/clients/[licenseKey]`) → the trash icon on a
device card → type-to-confirm (same friction bar as deleting a client).

**What this actually does:** a real, permanent delete of exactly one row in
`device_registrations` on that device's target project — matched by both
`license_key` and `device_id` together, never `device_id` alone, so a
`device_id` collision across two different licenses on the same project
can't delete the wrong row.

**What it doesn't do, said plainly so it isn't assumed:** this admin panel
has never talked to devices directly, and deleting a registration here
doesn't change that.

- A **PWA** whose registration was just deleted will need to reactivate the
  next time it checks in — expected, not a bug, given this repo's own
  offline-first design.
- A **shell** that's already running is genuinely **not** stopped from
  continuing to sync just because its own registration row is gone —
  shell-side enforcement of a deleted registration is separate, ongoing
  work outside this repo, not something this delete button reaches.

Use this to clean up a device that's genuinely gone or compromised, not as
a way to force an active device offline right now — on its own, it doesn't
do that yet.

## Editing a project

Where: Projects → the **Edit** button on a project row →
`/projects/[id]/edit`.

Label and notes are ordinary, low-friction edits: change them, save, done —
no dialog, no warning. **The other three fields — URL, anon key,
service-role key — are treated as a genuinely different, riskier kind of
action, not a plain form:** changing any of them shows exactly how many
active licenses (clients) currently point at this project and requires an
explicit confirmation step before the save goes through.

**Read this before rotating a live project's URL or keys here:** every
client already active on that project — every shell, every PWA install —
has its own local copy of these exact values, captured once at activation
time (a shell's `magneat_config.json`, a PWA's IndexedDB) and never
re-fetched from this admin panel again after that. Editing a project's
stored values here changes only **this admin panel's own record** of what
those values should be — it does not reach out and update a single
already-active client. In practice, rotating a live project's URL or key
without a plan for every client already pointed at it means those clients'
next sync attempt fails. **There is no "push new credentials to every
active client" button anywhere in this repo.** If a live project's
connection details genuinely need to rotate, plan for manually
reactivating every affected client — this screen will tell you how many
that is, but it won't do the reactivation for you.

None of the above applies to a label/notes-only edit, which is exactly why
this repo doesn't put that case behind the same friction.



This is a standard Next.js app — deploy it anywhere that runs Next.js
(Vercel is the path of least resistance, given the rest of this product
line's own hosting choices, but nothing here is Vercel-specific).

1. Push the repo to your Git provider of choice.
2. Import it into your hosting platform.
3. Set the three environment variables above in that platform's own env var
   settings — **not** in a committed file.
4. Deploy. `npm run build` / `npm run start` is the standard Next.js
   production flow if you're running this somewhere other than a platform
   that handles that for you.
5. Log in with the one admin account you created manually in the registry
   project's Supabase Studio (`docs/PHASE_2_SETUP.md`) — there is no sign-up
   flow, by design.

Because this app has exactly one operator and no offline/local-first layer
to keep in sync, there's no special migration or cache-invalidation dance on
deploy — a plain redeploy picks up the latest code against the same
registry project.

## Project structure

```
app/
  login/              Sign-in (single admin account, no sign-up)
  (app)/              Everything behind the auth guard in layout.js
    page.js            Dashboard — entry points to every screen below
    projects/          Connected Supabase projects: list, add, provision,
                        edit (label/notes low-friction; URL/keys gated
                        behind an active-client-count warning)
    clients/           Clients across all projects: list, add, detail
                        (view + delete devices), suspend/delete/move
    schema-push/       Broadcast a SQL change to every active project at
                        once, and fold it into future provisioning
    activity/          Reverse-chronological audit log feed
components/ui/        Shared neumorphic primitives (Button, Card, Select,
                       BottomSheet, etc.) — token-driven, see styles/tokens.css
lib/
  auth/                Browser session (session.js) + server-side bearer
                       token verification (server-session.js)
  supabase/            Registry client (browser-safe) and admin client
                       (server-only, service-role)
  licensing/           License key generation
  audit.js             Shared audit-log insert helper, called from every
                       mutating server action
supabase/
  migrations/          Registry project's own schema (projects, licenses,
                       audit_log)
  provisioning/        Schema applied to each *target* project when you hit
                       "Provision" on the Add Project screen
docs/                  One PHASE_N_SETUP.md per build phase — manual steps
                       and verification notes specific to that phase
```

## Full walkthrough (matches Phase 12's own verify step, extended since)

A quick end-to-end sanity check after any deploy or major change, all doable
from a phone-sized viewport:

1. **Add a project** — Projects → Add project → save & provision. Confirm
   the new project shows up in the list with a "Reachable" badge.
2. **Add a client** — Dashboard → Add client (or Clients → Add client) →
   pick the project you just added → create. Copy the generated credentials
   somewhere safe — they're shown once.
3. **View their devices** — Clients → click into that client → confirm the
   device panel loads (empty is expected until a real device activates).
4. **Delete a test device** — hand-seed (or wait for) a real device row on
   that client, then delete it from the device card → type-to-confirm →
   confirm the row disappears from the page without a reload, and is
   genuinely gone in Supabase, not just hidden client-side. Confirm
   cancelling the confirmation step deletes nothing.
5. **Edit their expiry** — Clients → edit the row inline → Save → reload the
   page → confirm it persisted.
6. **Suspend them** — Clients → Suspend → confirm the badge flips to
   "Suspended".
7. **Reassign them** — client detail page → Move to a different project →
   confirm the registry row updates.
8. **Delete a different test client** — Clients → Delete → type the company
   name to confirm → confirm both the Auth user and the registry row are
   gone.
9. **Edit a project's notes only** — Projects → Edit → change Notes → Save →
   confirm it saves directly, with no warning dialog.
10. **Edit a project's URL** — on a project with at least one real linked
    test license, Projects → Edit → change the Supabase URL → confirm the
    warning shows the correct active-client count and blocks the save until
    confirmed.
11. **Check the audit log** — Activity → confirm every action above
    produced exactly one row, with your admin email as the actor, a legible
    action/target/details, and (for the device delete and project edits
    specifically) a proper label and icon, not a raw action-string
    fallback.
12. **Broadcast a harmless schema change** — Schema Push → paste a throwaway
    `create table if not exists` statement → select all projects → confirm →
    confirm every project reports success, then check
    `supabase/provisioning/target_project_schema.sql` for the appended
    statement, and confirm the run also appears at the top of that same
    screen's own History section.

If every step above works without a dead end, an unclear error, or a screen
you can't get back from on a phone, this app is doing its job.
