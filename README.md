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

## Deploying

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
    projects/          Connected Supabase projects: list, add, provision
    clients/           Clients across all projects: list, add, detail,
                        suspend/delete/move
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

## Full walkthrough (matches Phase 12's own verify step)

A quick end-to-end sanity check after any deploy or major change, all doable
from a phone-sized viewport:

1. **Add a project** — Projects → Add project → save & provision. Confirm
   the new project shows up in the list with a "Reachable" badge.
2. **Add a client** — Dashboard → Add client (or Clients → Add client) →
   pick the project you just added → create. Copy the generated credentials
   somewhere safe — they're shown once.
3. **View their devices** — Clients → click into that client → confirm the
   device panel loads (empty is expected until a real device activates).
4. **Edit their expiry** — Clients → edit the row inline → Save → reload the
   page → confirm it persisted.
5. **Suspend them** — Clients → Suspend → confirm the badge flips to
   "Suspended".
6. **Reassign them** — client detail page → Move to a different project →
   confirm the registry row updates.
7. **Delete a different test client** — Clients → Delete → type the company
   name to confirm → confirm both the Auth user and the registry row are
   gone.
8. **Check the audit log** — Activity → confirm every action above produced
   exactly one row, with your admin email as the actor and a legible
   action/target/details.
9. **Broadcast a harmless schema change** — Schema Push → paste a throwaway
   `create table if not exists` statement → select all projects → confirm →
   confirm every project reports success, then check
   `supabase/provisioning/target_project_schema.sql` for the appended
   statement.

If every step above works without a dead end, an unclear error, or a screen
you can't get back from on a phone, this app is doing its job.
