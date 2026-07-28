# Phase 7 setup — manual step + verify

Phase 7 adds the client list/management screen: browse, search, filter,
and inline-edit every client without ever opening Supabase Studio.

## 1. No new env vars

Reuses `SUPABASE_REGISTRY_SERVICE_ROLE_KEY` (Phase 4) and each target
project's own stored `supabase_service_role_key` — nothing new to add to
`.env.local`.

## 2. Judgment calls made this phase, worth knowing about

**"Search by email" searches `contact_email`, not the login email.** The
registry's own `licenses` row has no login-email column at all — that
credential lives only in each target project's own Auth
(`user_metadata`), and reaching into every target project just to make a
search box work would be slow and out of proportion to what this screen
needs. Phase 6 already defaults `contact_email` to the login email
whenever the operator leaves it blank, which covers the common case. In
the rarer case the two were deliberately set to different values, this
search will not find a client by their login email — see the top comment
in `app/(app)/clients/actions.js` for the full reasoning.

**"Near-device-limit" required a new read this phase hadn't done
before.** `max_devices` lives in the registry, but how many devices a
client currently has *registered* lives in each target project's own
`device_registrations` table — a table Phase 9 (device visibility) was
always going to be the first to read, but the masterplan's own Phase 7
spec explicitly asks for this filter here too, ahead of that. Added a
lightweight, read-only, count-only query (one per distinct target
project, not one per license — same "group first, query once" pattern as
Phase 5's own reachability check), using each project's stored
service-role key server-side. "Near" itself isn't defined anywhere in
either masterplan; chose active-device-count >= max_devices - 1 (at the
limit or one seat away) as the threshold that would actually be useful to
notice ahead of a rejected registration. Reversible — nothing downstream
depends on the exact number.

**Unreachable target projects show devices as "unknown," not "0."** If a
target project times out or its stored keys are missing/bad, that
project's clients get `deviceCount: null` and are excluded from the
near-device-limit filter (rather than looking like a false "no devices
registered, plenty of room" positive). The Devices badge on each client
card reads "unknown / N" in that case instead of a misleading number.

**A "Suspended" badge shows up on this list even though Phase 8 (the
suspend/delete flow) hasn't been built yet.** `licenses.is_active`
already exists as a column from Phase 3's schema — this phase only reads
and displays it, it doesn't add any way to flip it. No functionality was
pulled forward from Phase 8, just a read of a column that was already
there.

## 3. What I already verified locally

`npm run build` compiles clean with the new `/clients` route. Confirmed
(same check as Phase 6) that neither the registry's nor any target
project's service-role key appears in the client-side JS chunks Next.js
produces — only the client-safe `NEXT_PUBLIC_SUPABASE_ANON_KEY` shows up
there, as expected.

## 4. What to verify yourself, against real data

The masterplan's own Phase 7 verify step, plus the filter/search paths:

1. `npm run dev`, sign in, go to **Clients** from the home screen (or
   `/clients` directly).
2. Confirm Phase 6's test client (or any existing client) shows up, with
   the correct company name, contact email, and project label.
3. Search by a substring of that client's company name, then by a
   substring of their contact email — confirm the list narrows to just
   that client in both cases, and clears back to the full list when the
   search box is emptied.
4. Try each filter option (Active / Expired / Near device limit) against
   your real data and confirm the results match what you'd expect from
   each client's own `expires_at` / `is_active` / device count.
5. Click **Edit** on a client, change the expiry date, and change max
   devices, then **Save**. Confirm the card immediately reflects the new
   values, and reload the page to confirm the change actually persisted
   in the registry (not just local state).
6. In the registry project's own Table Editor: confirm the edited
   `licenses` row's `expires_at`/`max_devices` match what you set, and
   that exactly one new `audit_log` row was written for the edit
   (`action: 'edit_client'`).
7. Confirm the edit did **not** touch that client's Auth user on their
   target project — their login email/password should be unchanged in
   that project's own Supabase Studio.
8. If you have a target project with real `device_registrations` rows:
   confirm the Devices count shown on that client's card matches the
   actual count of `is_active = true` rows for their `license_key` in
   that project's own Table Editor.
