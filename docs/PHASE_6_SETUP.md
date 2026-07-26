# Phase 6 setup — manual step + verify

Phase 6 adds the core deliverable: one form that creates a client's login
on a target project and registers their license in the registry, in one
submit.

## 1. No new env vars

This phase reuses `SUPABASE_REGISTRY_SERVICE_ROLE_KEY` (Phase 4) and each
target project's own stored `supabase_service_role_key` (Phase 4's "Add
project" flow) — nothing new to add to `.env.local`.

## 2. Three judgment calls made this phase, worth knowing about

**License key format isn't specified anywhere in this repo.** The
masterplan, `LicenseService.cs`'s own comment, and
`shell_REGISTRY_CONTRACT.md` all describe *that* keys get inserted, never
a format — the only concrete example anywhere is the stripped test seed
`TEST-LIC-0001-VALID`. Chose `LIC-XXXX-XXXX-XXXX` from a 32-symbol
alphabet with visually-ambiguous characters removed (no `0`/`O`, `1`/`I`/`L`),
since this is a string non-technical clients may need to read aloud or
retype. See the top comment in `lib/licensing/keys.js` for the reasoning
and entropy numbers. This is a reversible choice — nothing downstream
parses the key's internal structure, so it can change later without a
migration.

**"Contact email" vs. "login email."** Phase 3's schema has a
`licenses.contact_email` column separate from the Auth login email, but
Phase 6's own form-field list only says "email" once. Built one required
"Login email" field and one optional "Contact email" field that defaults
to the login email when left blank — covers the common case (they're the
same person) with zero extra typing, while still letting the two differ
when that's genuinely useful (e.g. a shared login, a different billing
contact).

**"Default to whichever project Phase 5's dashboard suggests has room."**
Phase 5's dashboard doesn't actually rank or flag a "suggested" project —
it just shows license counts and a paused toggle for a human to read.
Interpreted "suggests" as: among non-paused projects, whichever has the
fewest licenses currently pointing at it. Deliberately does **not**
re-run Phase 5's reachability check here — a network probe against every
project on every page load would slow down the one flow the masterplan
calls out as needing to be "maximum user-friendly," for a signal that's a
weak proxy for "has room" anyway. A paused project can still be picked
manually (the picker shows its paused state and license count; nothing
blocks selecting it) — the masterplan's own "let the operator override"
line already anticipates this.

## 3. Rollback behavior, and why it can't be a single transaction

Creating a client touches two separate databases — the target project's
own Auth (`auth.admin.createUser`) and the registry's `licenses` table —
reached over two different connections, so there's no single Postgres
transaction that can cover both. If the registry insert fails *after* the
target project's Auth user was already created, `createClientAction`
makes a best-effort call to delete that just-created Auth user before
throwing, so a failed submit doesn't leave an orphaned login with no
matching license. If that rollback delete itself also fails, the error
message says so explicitly — naming the email and the target project —
so you know exactly what to go clean up by hand in that project's own
Supabase Studio, rather than silently losing track of a half-created
client. The license-key generation step (before either side is touched)
retries on an actual key collision, so a failure there never creates
anything to roll back in the first place.

## 4. What I already verified locally

`npm run build` compiles clean with the new `/clients/new` route, and I
confirmed neither the registry's nor any target project's service-role
key appears in the client-side JS chunks Next.js produces.

## 5. What to verify yourself, against a real project

The masterplan's own Phase 6 verify step:

1. `npm run dev`, sign in, go to **Add client** from the home screen (or
   `/clients/new` directly).
2. Fill in company name, a real (or disposable) email, leave the password
   on auto-generate, and confirm the target-project picker pre-selects a
   real connected project.
3. Submit. Confirm the result screen shows a license key, the login
   email, and a generated password, each with a working copy button.
4. In the **target** project's own Supabase Studio (Authentication →
   Users): confirm the Auth user exists with `user_metadata.license_key`
   matching what was shown.
5. In the **registry** project's own Table Editor: confirm the `licenses`
   row exists, `project_id` points at the right project, and
   `target_supabase_url`/`target_supabase_anon_key` got filled in by
   0002's trigger.
6. Confirm the license count on that project's card in `/projects` (Phase
   5) went up by one.
7. If you have the shell/PWA masterplan tracks far enough along: activate
   a real device with the generated key + password end-to-end, confirming
   the credentials actually work, not just that the rows exist.
8. To see the rollback path: temporarily break the registry insert (e.g.
   rename `licenses.project_id` in Table Editor, submit, then rename it
   back) and confirm the Auth user created moments earlier is gone from
   the target project afterward, not left dangling.
