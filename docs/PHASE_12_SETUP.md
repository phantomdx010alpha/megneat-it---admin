# Phase 12 setup — polish + close-out

Phase 12 is refinement and documentation only, per the masterplan's own
"Out of scope: any new functionality" line — every item below is a
touch-up to something Phases 1–11 already built, not a new feature.

## 1. No new env vars, no new migration

Nothing about the schema, auth model, or deployment target changed this
phase.

## 2. What actually shipped this phase

- **Consistent "back" navigation on every top-level screen.** Working
  through the app from the dashboard, three screens
  (`app/(app)/projects/page.js`, `app/(app)/clients/page.js`,
  `app/(app)/activity/page.js`) had no way back to the dashboard other than
  the browser's own back button — every other screen in the app (the client
  detail page, since Phase 9) already had a `Back to clients`-style link at
  the top. All three now use that same pattern (a ghost `Button` with an
  `ArrowLeft` icon), and `app/(app)/projects/new/page.js` /
  `app/(app)/clients/new/page.js` gained one too. Nothing here is a new
  shared nav component — deliberately consistent with how every earlier
  phase implemented this same link inline rather than introducing a new
  abstraction this late in the build.
- **A real dead-end fixed on `app/(app)/projects/new/page.js`.** Before this
  phase, a successful "Save project" or "Save & provision" left the same
  form fully populated and still submittable — nothing prevented clicking
  Save again and creating a duplicate registry row with the same values,
  and the only feedback was a static "Done — add another, or navigate away"
  badge with no actual next-step buttons attached to it. This screen now
  follows the same success-view/form-view split
  `app/(app)/clients/new/page.js` already used since Phase 6: a successful
  save swaps to a dedicated confirmation card with "Add another project"
  (resets the form) and "Back to projects" buttons, and the form itself is
  no longer reachable (let alone resubmittable) until one of those is
  clicked.
- **Everything else audited, nothing else changed.** Loading states, empty
  states, and error messaging were checked page by page against this
  phase's own "In scope" list — every list/detail screen already routes
  through the shared `LoadingState` / `EmptyState` / `ErrorState`
  primitives (built in earlier phases), and every server action already
  throws operator-readable messages rather than raw Supabase/Postgres
  errors (see e.g. `app/(app)/clients/new/actions.js`'s own rollback
  messaging, or `lib/auth/server-session.js#requireAdminUser`'s "Session
  expired or invalid" wording). No raw stack trace reaches the browser
  anywhere in the current call graph. This phase didn't touch that code —
  it was already at the bar this phase's own spec asks for.

## 3. `README.md`

New, at the repo root. Covers local setup, the three registry env vars and
which one must never get a `NEXT_PUBLIC_` prefix, a deploy walkthrough, the
project structure, and a condensed version of this doc's own verify
checklist below — written so a future you (or anyone else who ends up
maintaining this) doesn't have to reconstruct any of it from the masterplan
or twelve separate phase docs.

## 4. A judgment call worth flagging

The masterplan's own Phase 12 line item mentions a "final full walkthrough
of every phase's flow end-to-end" as part of this phase's scope. That
walkthrough is written up as a checklist (in both this doc's own §5 below
and `README.md`) rather than actually executed against a live registry
project as part of producing this phase — doing so would require real
Supabase credentials and a disposable target project this session doesn't
have access to. Treat §5 as the script to run once real credentials are in
`.env.local`, not as a claim that it's already been run.

## 5. Verify

From a phone-sized viewport, with real registry credentials in
`.env.local`:

1. From the dashboard, reach every one of Projects / Clients / Add client /
   Activity, and confirm each one has a working way back to the dashboard.
2. Projects → Add project → Save project. Confirm the success view shows
   with "Add another project" / "Back to projects" buttons, and that the
   form itself is no longer on screen (so there's no way to accidentally
   resubmit the same values).
3. Add a project, add a client to it, view their devices, edit their
   expiry, suspend them, reassign them to a different project, delete a
   different test client, and confirm the Activity feed shows exactly one
   row per action — this is the same end-to-end flow Phase 11's own verify
   step already exercised; this phase's addition is confirming none of it
   hits a dead end or an unreadable error along the way.
