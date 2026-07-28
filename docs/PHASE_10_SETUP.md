# Phase 10 setup — manual step + verify

Phase 10 adds a deliberate, clearly-warned way to move a client from one
connected project to another, from the Phase 9 client detail page.

## 1. No new env vars

Reuses the registry's own service-role client (`lib/supabase/admin.js`) —
nothing new to add to `.env.local`.

## 2. Judgment calls made this phase, worth knowing about

**"Move" is registry-only, on purpose — and what that leaves dangling
until the client's next check-in.** Per the masterplan's own explicit
wording ("that's the entire mechanical change"), `moveClientAction` only
ever updates `licenses.project_id`. It does not create a new Auth login on
the destination project, does not delete the old one, and does not copy
any data table. Until the client's shell/PWA actually notices the
registry now points elsewhere (the shell/PWA masterplan's own
reassignment-detection phases) and reactivates there, their *old* Auth
login on the previous project still technically exists but is now
orphaned from the registry's point of view. That's the masterplan's own
intended shape for this phase, not an oversight — flagging it here so
it's not mistaken for one later.

**No project picked as "recommended" here, unlike Phase 6's create
flow.** `listMoveTargetProjectOptionsAction` returns every *other*
connected project (the client's current one is excluded — moving "to
itself" isn't a move), with the same `label · N clients` shape Phase 6's
own picker uses, but no default selection. Creating a new client benefits
from a sensible default; moving an *existing* one is rarer and more
consequential, so the operator picks the destination explicitly every
time rather than clicking through a pre-filled choice.

**The move is re-verified server-side, not trusted from the dialog.**
`moveClientAction` re-reads the license's current `project_id` itself
before writing anything (same "the server enforces it, not just the UI"
discipline as `deleteClientAction`'s own confirmation check) and rejects
a request to "move" a client to the project they're already on — a stale
detail page can't silently no-op or duplicate a move.

**The page reloads its own data after a successful move**, which means
the device list you see afterward is read live from the *new* target
project — normally empty until the client reactivates there. That's
expected: it's the same read Phase 9 already does, now just pointed
somewhere else, not a bug in this phase.

## 3. What I already verified locally

`npm run build` compiles clean with the extended
`/clients/[licenseKey]` page (new "Move to a different project" button
and confirmation dialog) and its two new server actions. Confirmed no
service-role key — registry's or any target project's — appears in the
client-side JS chunks Next.js produces (same check as every prior phase).

## 4. What to verify yourself, against a real test client

The masterplan's own Phase 10 verify step:

1. `npm run dev`, sign in, go to **Clients**, open a test client's
   **Devices** page.
2. Click **Move to a different project**. Confirm the picker lists every
   *other* connected project (not the one the client is already on), with
   no pre-selected value.
3. Confirm the dialog states plainly, before you can confirm, that the
   client's shell/PWA devices will need to reactivate/resync and that
   their historical data does not automatically follow.
4. Pick a destination and confirm the move. In the registry's own Table
   Editor, confirm that client's `licenses.project_id` now points at the
   new project, and that exactly one `audit_log` row was written
   (`action: 'move_client'`, with both the old and new project ids/labels
   in `details`).
5. Confirm the detail page reloads showing the new project's label, and
   that the device list now reflects the *new* project (typically empty,
   since the client hasn't reconnected there yet) rather than still
   showing the old project's devices.
6. If the shell/PWA masterplan tracks' own reassignment-detection phases
   are done by this point, confirm a real device actually surfaces the
   "this license has moved" message on its next check-in, and that
   reactivating there works the same way Phase 6's create flow creates a
   brand-new client's login.
