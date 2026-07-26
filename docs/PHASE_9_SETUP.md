# Phase 9 setup — manual step + verify

Phase 9 adds a per-client detail page showing whether a client's shell/PWA
devices are actually connected and syncing — read-only, sourced directly
from that client's own target project.

## 1. No new env vars

Reuses each target project's own stored `supabase_service_role_key`
(already in the registry since Phase 4) — nothing new to add to
`.env.local`. See §2 below for why this phase uses the service-role key
rather than the anon key the masterplan's own wording suggested.

## 2. Judgment calls made this phase, worth knowing about

**"Anon is enough" didn't hold up once actually checked against the RLS
policy.** The masterplan's own Phase 9 text says anon-or-service-role is
fine here "since RLS should already permit it the same way the client's
own PWA reads it." That comparison doesn't actually hold: the client PWA
reads its own devices *as that authenticated client*, and
`device_registrations`'s own RLS policy
(`users_can_register_own_devices`, in
`supabase/provisioning/target_project_schema.sql`) is scoped `to
authenticated using (license_key = (auth.jwt()->'user_metadata'->>
'license_key'))`. This app has no JWT for the client whose devices the
*operator* is looking up — an anon-key request here is unauthenticated,
and RLS would silently return zero rows for every client, not the right
subset. Used the target project's stored service-role key instead, same
as Phase 7's own `fetchActiveDeviceCounts` already does for the
near-device-limit column — flagged here rather than silently building a
page that would always show "no devices."

**Reachability, not a hard failure.** If a target project can't be
reached (timeout, missing/misconfigured stored keys, a sleeping free-tier
project), `getClientDetailAction` still returns the client's registry-side
info (company name, expiry, etc.) with `devicesError` set, rather than
throwing and blanking the whole page. Same "show what you know" spirit as
Phase 5's own reachability badge — a client's basic details shouldn't
become unreachable just because their target project happens to be
asleep right now.

**License keys go straight into the URL, unencoded-looking but safe.**
`lib/licensing/keys.js`'s own format (`LIC-XXXX-XXXX-XXXX`, from a
32-symbol alphabet with no separators beyond hyphens) is already
URL-safe, so `/clients/[licenseKey]` uses the key directly as the dynamic
segment — `encodeURIComponent`/`decodeURIComponent` wrap it anyway on
both the linking and reading side, defensively, in case that format ever
changes to include a character that isn't.

**No edit controls on this page, including per-device ones.** Per the
masterplan's own explicit out-of-scope note, flipping a device's
`is_active`/`can_write` stays the client-facing PWA's own job
(`deviceManager.js`'s existing `updateDevice()`) — this page only ever
issues a `select` against `device_registrations`, never an `update`.

## 3. What I already verified locally

`npm run build` compiles clean with the new `/clients/[licenseKey]` route
and the extended `/clients` list (new "Devices" button per row).
Confirmed no service-role key — registry's or any target project's —
appears in the client-side JS chunks Next.js produces (same check as
every prior phase).

## 4. What to verify yourself, against a real activated device

The masterplan's own Phase 9 verify step:

1. `npm run dev`, sign in, go to **Clients**.
2. Pick a test client with at least one real activated device (from the
   shell/PWA masterplan tracks, once those are executed) and click
   **Devices**.
3. Confirm the detail page loads the client's own company name, expiry,
   and license key correctly at the top.
4. Confirm the device list shows that device's name, an accurate
   "Last seen" timestamp, and correct Active/Inactive and
   Can write/Read-only badges — cross-check the exact values against that
   project's own Supabase Studio (`device_registrations` table) rather
   than trusting the page blindly.
5. If that client has a device flagged `is_master`, confirm the "Master"
   badge shows on the right one.
6. Temporarily blank out that project's stored service-role key under
   **Projects** (or point it at a project that's asleep) and reload the
   detail page — confirm it still shows the client's own info with a
   clear inline notice instead of a blank page or a raw error.
7. Confirm there is no control anywhere on this page that edits a
   device's `is_active` or `can_write` flag — this page is read-only by
   design.
