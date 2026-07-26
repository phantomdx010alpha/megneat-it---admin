# Phase 11 setup — manual step + verify

Phase 11 adds a plain, reverse-chronological feed of every admin action —
the accountability/"wait, when did I change this" record the masterplan's
own Phase 11 spec asks for.

## 1. No new env vars, no new migration

`audit_log` already existed as of `0002_registry_schema.sql` (Phase 3) —
append-only by RLS design (no update/delete policy at all, not even for
the admin). Nothing about the table shape changed this phase.

## 2. What actually shipped this phase

The masterplan's own Phase 3 and Phase 4 spec already anticipated most of
this — every mutating server action from Phase 4 onward was already
inserting its own `audit_log` row inline, not waiting for Phase 11 to
exist first. What this phase actually adds, per its own "In scope" text:

- **`lib/audit.js`** — the "small shared helper... called from every
  mutating action" the masterplan asks for. Every inline
  `admin.from('audit_log').insert(...)` call across
  `app/(app)/projects/new/actions.js`, `app/(app)/projects/actions.js`,
  `app/(app)/clients/new/actions.js`, `app/(app)/clients/actions.js`, and
  `app/(app)/clients/[licenseKey]/actions.js` now goes through
  `logAuditEvent(...)` instead — one call site for the insert itself,
  so its shape and failure behavior can't drift between phases the way it
  already had (see the reconciliation below).
- **`app/(app)/activity/page.js`** + **`app/(app)/activity/actions.js`** —
  the reverse-chronological feed page itself. Search (actor/target text)
  and an action-type filter, both client-side over one capped load (most
  recent 500 rows — see actions.js's own note on why a cap, not real
  pagination, is enough for this tool). Each row's own `details` payload
  is collapsed by default and expands in place.
- A new **Activity** entry point on the home screen, alongside
  Projects/Clients/Add client — same "every phase's own primary screen
  needs an entry point from here" convention Phase 5 established.

## 3. A real inconsistency this phase resolves

Phase 4's own two audit inserts (`createProjectAction`,
`provisionProjectAction`) hardcoded `actor: 'admin'`. Phase 5 onward
switched to the verified session's real email
(`user.email ?? 'admin'`) — Phase 5's own `actions.js` comment at the time
already flagged this as worth reconciling "when Phase 11 retrofits every
mutating action's logging, rather than silently diverging without a
note." That reconciliation happens here: both of Phase 4's call sites now
capture the verified `user` from `requireAdminUser(accessToken)` and pass
`user.email` through, same as every later phase's call site already did.
There is no longer a hardcoded-string audit actor left anywhere in the
app.

## 4. Failure behavior: best-effort, and why that's unchanged

None of the pre-existing call sites checked the insert's own `error`
result before this phase — a failed audit write was already silently
swallowed. `lib/audit.js` preserves that same "never block the mutating
action over a logging failure" behavior deliberately (see the file's own
top comment for the full reasoning), but now at least surfaces the
failure via `console.error` rather than a totally silent no-op. This is a
judgment call, not a masterplan requirement — flagging it in case a
stricter "no action without a log" guarantee is ever wanted instead, which
would be a real (if straightforward) behavior change, not just a retrofit.

## 5. Verify

Perform one of each action type — add a project, provision it, pause and
unpause it, add a client, edit their expiry, suspend them, reactivate
them, move them to a different project, delete a (different) test one —
and confirm the Activity feed shows exactly one row per action, each with
the real signed-in admin email as `actor`, a human-readable action label,
the right target, and a "Show details" payload matching what the
underlying action actually did.
