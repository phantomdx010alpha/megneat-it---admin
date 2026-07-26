# Phase 8 setup — manual step + verify

Phase 8 adds the destructive end of the client lifecycle: suspend (soft,
reversible) and delete (hard, permanent), both from the Clients list built
in Phase 7.

## 1. No new env vars

Reuses `SUPABASE_REGISTRY_SERVICE_ROLE_KEY` (Phase 4) and each target
project's own stored `supabase_service_role_key` — nothing new to add to
`.env.local`.

## 2. Judgment calls made this phase, worth knowing about

**Suspend doubles as Reactivate.** The masterplan describes suspend as
"soft" and only mentions turning `is_active` to `false`. Building a
one-way switch would contradict "soft" and leave no way back short of
Supabase Studio — exactly what this whole app exists to avoid. One action
(`suspendClientAction`), one boolean argument, used for both directions;
the Clients list button reads "Suspend" or "Reactivate" depending on
current state.

**Finding the Auth user to delete required a lookup Phase 6 never set
up.** `deleteClientAction` needs the target project's Auth user id to
call the GoTrue Admin API's delete endpoint, but nothing in the registry
stores that id, and the registry doesn't store the login email either
(see Phase 7's own search-field note — that gap compounds here). Rather
than retrofitting Phase 6's schema or behavior this phase, `deleteClientAction`
looks the user up by `user_metadata.license_key` — the one thing
guaranteed to be on their Auth record, stamped on at creation time. The
GoTrue Admin API has no metadata filter, so this pages through
`auth.admin.listUsers()` (1000/page, capped at 20 pages) looking for a
match. Fine for a single-operator tool's target projects; flagged in
`actions.js`'s own top comment in case any target project's user count
ever grows enough for that cap to matter.

**Delete confirmation is enforced server-side, not just in the dialog.**
The BottomSheet requires typing the exact company name before its own
Delete button even enables, but `deleteClientAction` re-checks that same
match itself before touching anything — a destructive action's real gate
belongs on the server that can enforce it, not the UI that happens to
render it. A hand-crafted call to the server action with the wrong
confirmation text is rejected the same as a UI bypass would be.

**Delete order: Auth user first, registry row second — and why there's
no rollback on the second half.** Unlike Phase 6's create flow (which can
roll back a just-created Auth user if the registry insert then fails),
there's no way to "undelete" an Auth user if the registry delete that
follows it then fails. If that happens, the thrown error names exactly
what's left — the registry row for that license key — so it's a
one-line manual cleanup in the registry's own Table Editor, not a
silently orphaned client. If the Auth delete itself fails first, nothing
else is touched at all — safe to just retry.

**No Auth user found ≠ error.** If `deleteClientAction` can't find a
matching Auth user (already removed by hand, or the login was somehow
never created), it doesn't block the delete — it proceeds straight to
removing the registry row, since the practical goal ("this client can no
longer log in or activate") is already true in that case.

## 3. What this deliberately does not do

Per the masterplan's own explicit scoping: delete does **not** touch the
client's actual data tables (`mst_ledger`, `trn_voucher`,
`device_registrations`, etc.) on their target project. The confirmation
dialog says so every time, in plain language, so this isn't a surprise
discovered later. Wiping a client's live data history is a separate,
manual, per-project decision — not something this button should ever do
automatically.

## 4. What I already verified locally

`npm run build` compiles clean with the extended `/clients` page (suspend
button, delete dialog). Confirmed (same check as every prior phase) that
neither the registry's nor any target project's service-role key appears
in the client-side JS chunks Next.js produces.

## 5. What to verify yourself, against real test clients

The masterplan's own Phase 8 verify step:

1. `npm run dev`, sign in, go to **Clients**.
2. Pick a test client and click **Suspend**. Confirm the card immediately
   shows a "Suspended" badge, and that (if you can test against a real
   shell/PWA activation) that client's next activation attempt now fails
   cleanly with an inactive/suspended message rather than succeeding or
   erroring oddly.
3. Click **Reactivate** on that same client and confirm the badge clears
   and activation would succeed again.
4. In the registry's own Table Editor, confirm each suspend/reactivate
   produced exactly one `audit_log` row (`action: 'suspend_client'` /
   `'reactivate_client'`).
5. Pick a **different** test client (one you're fine permanently
   deleting) and click **Delete**. Confirm the dialog's Delete button
   stays disabled until you type the exact company name, and that it
   explicitly states the client's data tables won't be touched.
6. Confirm the deletion. In the **target** project's own Supabase Studio
   (Authentication → Users): confirm that client's Auth user is gone. In
   the **registry** project's own Table Editor: confirm the `licenses`
   row is gone, and that exactly one `audit_log` row was written
   (`action: 'delete_client'`).
7. Confirm a fresh attempt to activate that same (now-deleted) license
   key fails cleanly, rather than partially succeeding.
8. Confirm that client's actual data tables (if any existed) are still
   present and untouched in the target project — this is the explicit
   "not automatically wiped" behavior, not a bug.
