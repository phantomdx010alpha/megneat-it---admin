# REGISTRY_CONTRACT.md — the registry project's `licenses` lookup table, as the shell consumes it

Produced by Phase 2 of `SHELL_MULTI_PROJECT_LICENSING_MASTERPLAN.md`. This is a spec, not code —
no files under `TallyConnector/` were touched in this phase. Any other track (PWA masterplan,
admin-panel masterplan) building against the registry should point at this file rather than each
maintaining its own copy of the contract.

## 1. What currently exists, read from the shipped migrations (not assumed)

As of this writing, ALL of the following tables live in one project — the same project Phase 1
renamed the client's hardcoded pointer for (`RegistryProject`, née `SupabaseSharedProject`):

| Table | Migration | Purpose |
|---|---|---|
| `licenses` | `0002_licenses.sql` | license_key -> company_name, is_active, max_devices, expires_at |
| `device_registrations` | `0001_postbox_foundation.sql` | per-device rows, scoped by `license_key` |
| `device_sync_state` | `0001_postbox_foundation.sql` | per-device sync cursors |
| `sync_queue` | `0001_postbox_foundation.sql` | postbox push queue |
| `initial_sync_requests` | `0001_postbox_foundation.sql` | full-resync requests |
| `sync_commands` | `0004_phase1_device_mgmt_sync_commands.sql` | admin -> device commands |
| `voucher_date_resync_requests` | `0007_voucher_date_resync_requests.sql` | targeted resync requests |

Under the new architecture, only `licenses` (in a slimmed-down form, see §2) belongs in the
**registry**. Every other table above is client data and belongs in a **target** project instead
— that's the whole point of splitting them apart. This phase does not move any of these tables;
it only specifies what the registry's own `licenses` table needs to look like once the split
happens (a later phase's job — see §5's open question for why even that isn't fully settled yet).

## 2. Registry `licenses` table shape (target shape, not yet applied)

Extends the existing `0002_licenses.sql` shape with two new columns:

| Column | Type | Notes |
|---|---|---|
| `license_key` | `text primary key` | unchanged |
| `company_name` | `text` | unchanged |
| `is_active` | `boolean default true` | unchanged — **see §5, this may not be able to stay the single source of truth** |
| `max_devices` | `integer default 5` | unchanged — **see §5, same caveat** |
| `created_at` | `timestamptz default now()` | unchanged |
| `expires_at` | `timestamptz` | unchanged |
| `target_supabase_url` | `text` | **new** — the resolved target project's URL |
| `target_supabase_anon_key` | `text` | **new** — the resolved target project's anon key |

This is a spec for a future `ALTER TABLE licenses ADD COLUMN ...` migration, not a migration file
itself — writing that migration is in scope for whichever phase actually executes it (Phase 3
consumes the contract; the admin-panel masterplan likely owns writing the migration, since it
also owns creating target projects and assigning them to licenses — confirm ownership before
Phase 3 assumes either way).

## 3. Exact query the shell issues

Matches the shape `LicenseService.cs`'s `BuildClient()`/`ValidateAndActivateAsync()` already use
today (confirmed by reading the shipped code, not assumed), extended with the two new columns:

```
GET /rest/v1/licenses?license_key=eq.<url-encoded-key>&select=company_name,is_active,expires_at,target_supabase_url,target_supabase_anon_key&limit=1
```

Headers: `apikey: <registry anon key>`, `Authorization: Bearer <registry anon key>` (unchanged —
same pattern `BuildClient()` already uses; no user auth token needed for this lookup).

Today's actual live query also selects `license_key` itself (`select=license_key,company_name,...`)
— harmless to keep or drop since it's the filter key already known to the caller. Not a
meaningful part of the contract either way.

Response shape (PostgREST array, 0 or 1 rows):
```json
[
  {
    "company_name": "Acme Corp",
    "is_active": true,
    "expires_at": null,
    "target_supabase_url": "https://<target-project-ref>.supabase.co",
    "target_supabase_anon_key": "eyJ..."
  }
]
```
Empty array (`[]`) means "license key not found" — same as today's behavior.

## 4. Required RLS policy — and a gap found in the existing migration

`0002_licenses.sql`'s current RLS comment says the table relies on **no anon policy at all**,
trusting that only the shell's hardcoded key (which — per Phase 1's Background — actually decoded
to a service-role key) would ever read it, and that a service-role key "bypasses RLS entirely...
no policy needed." That was true only because the key in use was a service-role key. Now that
Phase 1 has renamed the client-facing constant toward a real anon key (currently a placeholder —
no live value yet), that assumption breaks: an anon key against the *current* migration would be
blocked by RLS entirely (zero policies = zero anon access), so every license lookup would return
empty and look identical to "license key not found."

**This means the existing migration needs a new anon-scoped `select` policy before any real anon
key can work at all** — not just the two new columns from §2. Spec for that policy (same
reasoning `RegistryProject.cs`'s own doc comment already states):

```sql
create policy "anon can read own license row"
on licenses for select to anon
using (true);  -- PostgREST's own ?license_key=eq.<key> filter narrows to one row;
                -- the policy itself does not narrow — do not rely on it to.
```

This is a **required companion to §2's column addition**, not optional — flagging it clearly since
it wasn't explicitly called out in Phase 2's own masterplan text, but the query in §3 cannot work
without it given what's actually shipped today. Writing this into an actual migration file is
still out of this phase's scope (documentation only), same as §2.

## 5. Open question — explicitly unresolved, needs cross-check before Phase 3

The masterplan's own Phase 2 text says: *"confirm with the admin-panel masterplan which project
actually owns 'is this license active' as the single source of truth ... don't let both the
registry and a target project each think they own activation state."* That masterplan was not
provided to this session, so this question is **not actually resolved** — flagging it rather than
guessing:

- **`is_active` / `expires_at`**: if these stay registry-only (as in §2's table), then a target
  project's own RLS can't independently gate access by them (a target project has no way to see
  the registry's row without another cross-project call, which defeats the point of resolving
  once at activation). That likely means "activation-time gate only" — the shell checks
  `is_active`/`expires_at` once at `ValidateAndActivateAsync()` time and re-checks on Phase 8's
  reassignment-detection cadence, but a target project's own RLS cannot enforce it live. Confirm
  this is acceptable before Phase 3 codes against it.
- **`max_devices`**: this is the sharper version of the same problem. `0003_max_devices_rls.sql`
  enforces the device cap with a same-database SQL subquery joining `device_registrations`
  (target-project data) against `licenses.max_devices` (registry data) — that only works today
  because both tables are in the same project. Once they're split, that specific RLS policy
  **cannot be ported as-is** to the target project, since Postgres RLS can't subquery across
  projects. Either `max_devices` needs to be duplicated onto the target project (denormalized,
  admin-panel-maintained, another source-of-truth question), or enforcement moves out of DB-level
  RLS into application logic (the shell or an edge function checking a resolved count). This is a
  real design decision, not a documentation nit — flagging it for the admin-panel masterplan
  and/or a dedicated later phase rather than deciding it here.

**Recommendation, not a decision:** treat the registry as authoritative for
`is_active`/`expires_at`/`max_devices` at *activation and periodic re-check* time only (Phase 8's
job), and treat per-request enforcement inside a target project as the target project's own
problem to solve with data it denormalizes at license-assignment time — but this needs sign-off
from whoever owns the admin-panel masterplan before Phase 3 builds against it, since Phase 3
persists whatever this phase's contract says into `AppConfig` and Phase 8 re-checks against it.

## 6. Phase 3 should NOT yet assume

- That §2's columns exist on any real table (no live registry project exists — see the main
  masterplan's Background/House-style notes, unchanged since Phase 1).
- That §4's policy has been applied anywhere.
- That §5's open question has been answered — Phase 3's persistence logic (into `AppConfig`)
  should be written so that a future change to where `is_active`/`max_devices` truth lives doesn't
  require re-touching `LicenseService.cs`'s query shape, if that's easy to arrange; flag if it
  isn't.
