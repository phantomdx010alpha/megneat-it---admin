-- ============================================================
-- M@GNEAT IT -- TARGET PROJECT Supabase Setup (Fresh Project)
-- Run this ONCE, per target (client-data) project, via the admin panel's
-- "Provision" button on the Add Project screen -- or manually, once, in
-- that project's own SQL Editor (role: postgres), if provisioning that way.
--
-- THIS IS NOT THE REGISTRY PROJECT'S SCHEMA. The registry (the small,
-- separate project the admin panel itself talks to, holding the
-- license-key -> target-project lookup) has its own, already-finalized
-- schema -- see the admin panel repo's supabase/migrations/. Nothing in
-- this file should ever be run against the registry project, and nothing
-- in the registry's schema belongs in this file.
--
-- MERGE HISTORY (2026-07-24): this file consolidates everything actually
-- run against a real project's SQL editor across this project's history --
-- the original "fresh project" baseline, five follow-up migrations
-- (core_voucher_type, voucher_queue RLS hardening x2, voucher_date_resync_
-- requests, app_annotations) -- reconciled into one script, MINUS the old
-- single-shared-project `licenses` table and manual Auth-metadata SQL step
-- (both superseded by the registry + admin panel, see the notes left in
-- their place below), and MINUS a couple of pure dev-cycle artifacts that
-- were never meant to be part of a fresh install (a "drop every table"
-- reset script, and a one-off diagnostic SELECT) -- neither is schema, so
-- neither belongs here; ask if you want either explained separately.
--
-- FIXED, NOT JUST FLAGGED (as of this revision): device_registrations' own
-- RLS now has a real `devices_insert_enforce_max` policy (SECTION 2 below) --
-- prior history only ever referenced this policy in comments
-- (SHELL_BUGFIX_MASTERPLAN.md Phase 5) without it actually existing anywhere
-- in the SQL history reconciled into this file. It reads the limit from the
-- same JWT user_metadata license_key already comes from, since a target
-- project no longer has its own `licenses.max_devices` column to check
-- against (that lives in the registry now). THIS HAS A REQUIRED COMPANION
-- APPLICATION-CODE CHANGE -- see SECTION 2's own policy comment for exactly
-- what the admin panel must additionally do (stamp/refresh
-- user_metadata.max_devices) for this enforcement to actually reflect a
-- client's real, current limit rather than silently blocking everyone at 0.
-- ============================================================


-- ============================================================
-- SECTION 1: LICENSES -- REMOVED (multi-project licensing track)
-- ============================================================
--
-- A target project no longer keeps its own local `licenses` table. License
-- validity now lives ONLY in the separate, small REGISTRY project (see
-- REGISTRY_CONTRACT.md and ADMIN_PANEL_MASTERPLAN.md's own `licenses` table,
-- supabase/migrations/0002_registry_schema.sql in the admin panel repo) --
-- which additionally tracks which target project (this one, or one of the
-- others) each license is assigned to. The shell's LicenseService.cs queries
-- the registry directly at activation time, not this project.
--
-- Do NOT recreate a `licenses` table here -- there is deliberately only one
-- source of truth for license validity/expiry/device limits now, and it is
-- not this project.


-- ============================================================
-- SECTION 2: DEVICE REGISTRATIONS
-- ============================================================

create table if not exists device_registrations (
  id            uuid        primary key default gen_random_uuid(),
  license_key   text        not null,
  device_id     text        not null,
  device_name   text,
  registered_at timestamptz default now(),
  last_seen_at  timestamptz,
  is_active     boolean     default true,
  is_master     boolean     not null default false,
  can_write     boolean     not null default false,
  unique(device_id)
);

alter table device_registrations enable row level security;

-- SPLIT INTO PER-COMMAND POLICIES (was a single "for all" policy) so the
-- max_devices check below can apply to INSERT only, without touching
-- select/update/delete. This is the fix for the gap flagged earlier: prior
-- history referenced a `devices_insert_enforce_max` policy (comments in
-- SHELL_BUGFIX_MASTERPLAN.md Phase 5) that was never actually written --
-- it exists for real now, below.

create policy "devices_select_own_license" on device_registrations
  for select to authenticated
  using (license_key = (auth.jwt()->'user_metadata'->>'license_key'));

create policy "devices_update_own_license" on device_registrations
  for update to authenticated
  using (license_key = (auth.jwt()->'user_metadata'->>'license_key'))
  with check (license_key = (auth.jwt()->'user_metadata'->>'license_key'));

create policy "devices_delete_own_license" on device_registrations
  for delete to authenticated
  using (license_key = (auth.jwt()->'user_metadata'->>'license_key'));

-- INSERT -- license_key match (same as before) PLUS the actual max_devices
-- enforcement. Reads the limit from the same JWT user_metadata license_key
-- already comes from (NOT from a local `licenses` table -- that table no
-- longer exists in a target project, see SECTION 1's note above), so this
-- requires the admin panel to also stamp `max_devices` into the Auth
-- user's user_metadata -- see the REQUIRED COMPANION CHANGE note below.
--
-- Fails CLOSED if max_devices is missing/blank/non-numeric in the JWT:
-- `nullif(..., '')::integer` -> null -> `coalesce(..., 0)` -> 0 -> the
-- count(*) < 0 comparison is never true -> INSERT rejected. An absent
-- limit is treated as "zero allowed," never as "unlimited."
--
-- REQUIRED COMPANION CHANGE (application code, not SQL -- not applied
-- here): the admin panel's "Add client" server action (Phase 6) must set
-- user_metadata.max_devices alongside user_metadata.license_key in the
-- same createUser Admin API call. And whenever a client's max_devices is
-- edited later (Phase 7's inline edit), that edit currently only updates
-- the registry's own `licenses.max_devices` column -- it must ALSO call
-- the target project's Admin API updateUserById to refresh this same
-- user_metadata field, or an edited limit will silently keep enforcing
-- the old number here. Flagging this explicitly so it isn't missed --
-- this SQL alone cannot keep the two in sync.
create policy "devices_insert_enforce_max" on device_registrations
  for insert to authenticated
  with check (
    license_key = (auth.jwt()->'user_metadata'->>'license_key')
    and (
      select count(*) from device_registrations dr
      where dr.license_key = device_registrations.license_key
        and dr.is_active    = true
    ) < coalesce(nullif((auth.jwt()->'user_metadata'->>'max_devices'), '')::integer, 0)
  );


-- ============================================================
-- SECTION 3: SYNC QUEUE (multi-device postbox)
-- ============================================================

create table if not exists sync_queue (
  id           uuid        primary key default gen_random_uuid(),
  license_key  text        not null,
  device_id    text,                    -- target device (required in multi-device mode)
  table_name   text        not null,
  chunk_index  integer     not null,
  total_chunks integer     not null,
  payload      jsonb       not null,
  pushed_at    timestamptz default now(),
  acked_by     text[]      default '{}',
  required_acks text[]     not null default '{}'
);

alter table sync_queue enable row level security;

create policy "authenticated_full_access" on sync_queue
  for all to authenticated using (true) with check (true);

-- Index for fast per-device polling
create index if not exists idx_sync_queue_device
  on sync_queue(device_id, license_key);

-- Auto-delete trigger: when all required devices have acked, delete the row
create or replace function delete_fully_acked_chunk()
returns trigger language plpgsql as $$
begin
  if new.required_acks <@ new.acked_by then
    delete from sync_queue where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ack_cleanup on sync_queue;
create trigger trg_ack_cleanup
  after update of acked_by on sync_queue
  for each row execute function delete_fully_acked_chunk();


-- ============================================================
-- SECTION 4: INITIAL SYNC REQUESTS
-- ============================================================

create table if not exists initial_sync_requests (
  id           uuid        primary key default gen_random_uuid(),
  license_key  text        not null,
  device_id    text        not null,
  from_date    date,                    -- financial year start (e.g. 2024-04-01)
  to_date      date,                    -- financial year end or today
  requested_at timestamptz default now(),
  status       text        default 'pending',  -- pending | in_progress | completed | failed
  started_at   timestamptz,
  completed_at timestamptz
);

alter table initial_sync_requests enable row level security;

create policy "authenticated_full_access" on initial_sync_requests
  for all to authenticated using (true) with check (true);

create index if not exists idx_initial_sync_requests_status
  on initial_sync_requests(license_key, status);

-- Hard guarantee against duplicate in-flight requests for the same device.
-- The PWA already checks for an existing pending/processing row before
-- inserting (lib/data/sync.js requestInitialSync), but that check has a
-- small race window — two near-simultaneous calls could both pass it before
-- either insert lands. This index is the actual guarantee: a second insert
-- while one is still pending/processing fails with 23505 (unique_violation),
-- which the PWA catches and treats as "already in flight, nothing to do."
-- Without this, duplicate rows would each independently trigger the shell to
-- run a full Tally pull + full postbox push for the same device — wasteful
-- and pointless since the first one already covers it.
create unique index if not exists one_pending_initial_sync_per_device
  on initial_sync_requests (license_key, device_id)
  where status in ('pending', 'processing');


-- ============================================================
-- SECTION 5: DELTA SYNC REQUESTS
-- ============================================================

create table if not exists delta_sync_requests (
  id            uuid        primary key default gen_random_uuid(),
  license_key   text        not null,
  device_id     text        not null,
  last_sync_at  timestamptz not null,   -- device's last known sync timestamp
  lookback_days integer     default 4,  -- shell calculates: from = last_sync_at - lookback_days
  requested_at  timestamptz default now(),
  status        text        default 'pending'  -- pending | processing | completed | failed
);

alter table delta_sync_requests enable row level security;

create policy "device_can_manage_own_delta_requests"
  on delta_sync_requests for all to authenticated
  using (license_key = (auth.jwt()->'user_metadata'->>'license_key'))
  with check (license_key = (auth.jwt()->'user_metadata'->>'license_key'));

create index if not exists idx_delta_sync_requests_status
  on delta_sync_requests(license_key, status);

-- Same hard guarantee as initial_sync_requests above — prevents duplicate
-- in-flight delta requests for the same device. More relevant here since
-- delta can be triggered from three independent places on the PWA side
-- (auto-interval timer, window 'online' event, manual button) that could
-- plausibly fire close together.
create unique index if not exists one_pending_delta_sync_per_device
  on delta_sync_requests (license_key, device_id)
  where status in ('pending', 'processing');


-- ============================================================
-- SECTION 6: DEVICE SYNC STATE
-- ============================================================

create table if not exists device_sync_state (
  device_id    text not null,
  table_name   text not null,
  last_pulled_at timestamptz,
  row_count    bigint,
  primary key (device_id, table_name)
);

alter table device_sync_state enable row level security;

create policy "authenticated_full_access" on device_sync_state
  for all to authenticated using (true) with check (true);


-- ============================================================
-- SECTION 7: SYNC COMMANDS (for future remote sync from PWA)
-- ============================================================

create table if not exists sync_commands (
  id                  uuid        primary key default gen_random_uuid(),
  license_key         text        not null,
  issued_by_device_id text        not null,
  command             text        not null,
  lookback_days       integer     not null,
  status              text        default 'pending',
  issued_at           timestamptz default now(),
  picked_up_at        timestamptz,
  completed_at        timestamptz,
  error_message       text
);

alter table sync_commands enable row level security;

create policy "authenticated_full_access" on sync_commands
  for all to authenticated using (true) with check (true);


-- ============================================================
-- SECTION 8: TALLY MASTER TABLES
-- ============================================================

create table if not exists mst_group (
    guid text primary key,
    name text,
    parent text,
    is_revenue integer,
    is_deemed_positive integer,
    affects_gross_profit integer,
    sort_position integer
);
alter table mst_group enable row level security;
create policy "authenticated_full_access" on mst_group
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_currency (
    guid text primary key,
    name text,
    formal_name text
);
alter table mst_currency enable row level security;
create policy "authenticated_full_access" on mst_currency
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_voucher_type (
    guid text primary key,
    name text,
    parent text,
    numbering_method text,
    is_optional integer,
    is_active integer,
    use_zero_entries integer,
    common_narration integer,
    effect_stock integer,
    core_voucher_type text,
    as_mfg_jrnl integer,
    alias text,
    use_for_jobwork integer,
    is_for_jobwork_in integer,
    print_after_save integer,
    use_for_pos_invoice integer,
    vch_print_bank_name text,
    vch_print_title text,
    tax_unit_name text,
    vch_print_jurisdiction text,
    multi_narration integer,
    is_default_allocation_enabled integer,
    default_voucher_category text,
    can_delete integer
);
alter table mst_voucher_type enable row level security;
create policy "authenticated_full_access" on mst_voucher_type
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_cost_category (
    guid text primary key,
    name text,
    allocate_revenue integer,
    allocate_non_revenue integer,
    alias text
);
alter table mst_cost_category enable row level security;
create policy "authenticated_full_access" on mst_cost_category
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_cost_centre (
    guid text primary key,
    name text,
    parent text,
    category text,
    email text,
    show_opening_bal integer,
    alias text
);
alter table mst_cost_centre enable row level security;
create policy "authenticated_full_access" on mst_cost_centre
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_unit (
    guid text primary key,
    name text,
    formal_name text,
    is_simple_unit integer,
    base_unit text,
    additional_units text,
    conversion numeric,
    decimal_places integer
);
alter table mst_unit enable row level security;
create policy "authenticated_full_access" on mst_unit
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_group (
    guid text primary key,
    name text,
    parent text,
    is_addable integer,
    alias text,
    gst_applicability text,
    base_unit text
);
alter table mst_stock_group enable row level security;
create policy "authenticated_full_access" on mst_stock_group
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_category (
    guid text primary key,
    name text,
    parent text,
    alias text
);
alter table mst_stock_category enable row level security;
create policy "authenticated_full_access" on mst_stock_category
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_godown (
    guid text primary key,
    name text,
    alias text
);
alter table mst_godown enable row level security;
create policy "authenticated_full_access" on mst_godown
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_gst_registration (
    guid text primary key,
    gstin text,
    state_name text,
    registration_type text,
    applicable_from text,
    prior_state_name text,
    eway_applicable_type text,
    gst_username text,
    is_other_territory integer,
    is_eway_bill_applicable integer,
    alias text,
    esign_method text,
    is_eway_bill_applicable_for_intra integer
);
alter table mst_gst_registration enable row level security;
create policy "authenticated_full_access" on mst_gst_registration
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_company (
    guid text primary key,
    name text,
    comp_num text,
    starting_from text,
    end_date text,
    is_group_company integer
);
alter table mst_company enable row level security;
create policy "authenticated_full_access" on mst_company
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_employee (
    guid text primary key,
    name text,
    parent text,
    category text,
    email text,
    show_opening_bal integer
);
alter table mst_employee enable row level security;
create policy "authenticated_full_access" on mst_employee
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_employee_group (
    guid text primary key,
    name text,
    parent text,
    category text,
    email text,
    show_opening_bal integer
);
alter table mst_employee_group enable row level security;
create policy "authenticated_full_access" on mst_employee_group
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ============================================================
-- SECTION 9: MST_LEDGER + SUB-TABLES
-- ============================================================

create table if not exists mst_ledger (
    guid text primary key,
    name text,
    parent text,
    alias text,
    opening_balance numeric,
    currency text,
    tax_type text,
    gst_type text,
    pan_number text,
    email text,
    website text,
    bank_name text,
    account_number text,
    credit_limit text,
    is_bill_wise integer,
    email_cc text,
    ifsc_code text,
    swift_code text,
    bank_bsr_code text,
    branch_name text,
    rate_of_tax numeric,
    gst_type_of_supply text,
    phone_number text,
    mobile_no text,
    updated_at text,
    is_cost_centres_on integer,
    is_interest_on integer,
    is_credit_check integer,
    appropriate_for text
);
alter table mst_ledger enable row level security;
create policy "authenticated_full_access" on mst_ledger
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_mailing_details (
    id bigserial primary key,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    mailing_name text,
    applicable_from text,
    country text,
    state text,
    pin_code text,
    address_lines text
);
alter table mst_ledger_mailing_details enable row level security;
create policy "authenticated_full_access" on mst_ledger_mailing_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_addresses (
    id bigserial primary key,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    address_name text,
    country text,
    state text,
    pin_code text,
    contact_person text,
    mobile_no text,
    phone_number text,
    fax_number text,
    email text,
    pan_number text,
    vat_number text,
    cst_number text,
    gstin text,
    gst_dealer_type text,
    is_other_territory integer,
    address_lines text,
    excise_nature_of_purchase text,
    excise_registration_no text,
    excise_import_registration_no text,
    import_export_code text
);
alter table mst_ledger_addresses enable row level security;
create policy "authenticated_full_access" on mst_ledger_addresses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_payment_details (
    id bigserial primary key,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    bank_name text,
    city text,
    transaction_type text,
    in_favour text,
    transaction_name text,
    bank_account_no text,
    bank_branch text,
    ifsc text,
    set_as_default integer,
    cheque_cross_comment text
);
alter table mst_ledger_payment_details enable row level security;
create policy "authenticated_full_access" on mst_ledger_payment_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_gst_reg_details (
    id bigserial primary key,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    applicable_from text,
    registration_type text,
    state text,
    place_of_supply text,
    is_other_territory integer,
    gstin text,
    consider_purchase_for_export integer,
    is_transporter integer,
    transporter_id text,
    is_common_party integer
);
alter table mst_ledger_gst_reg_details enable row level security;
create policy "authenticated_full_access" on mst_ledger_gst_reg_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_gst_details (
    id bigserial primary key,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    applicable_from text,
    calculation_type text,
    nature_of_transaction text,
    taxability text,
    source_of_gst_details text,
    is_non_gst_goods integer,
    is_reverse_charge integer,
    is_ineligible_itc integer,
    calculate_slab_on_mrp integer,
    include_exp_for_slab_calc integer
);
alter table mst_ledger_gst_details enable row level security;
create policy "authenticated_full_access" on mst_ledger_gst_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_hsn_details (
    id bigserial primary key,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    applicable_from text,
    hsn_code text,
    hsn_description text,
    hsn_classification text,
    source text
);
alter table mst_ledger_hsn_details enable row level security;
create policy "authenticated_full_access" on mst_ledger_hsn_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_contact_details (
    id bigserial primary key,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    country_iso text,
    name text,
    phone_number text,
    is_default_whatsapp boolean
);
alter table mst_ledger_contact_details enable row level security;
create policy "authenticated_full_access" on mst_ledger_contact_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_gst_statewise_details (
    id bigserial primary key,
    gst_detail_id bigint references mst_ledger_gst_details(id) on delete cascade,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    state_name text,
    duty_head text,
    valuation_type text,
    gst_rate numeric
);
alter table mst_ledger_gst_statewise_details enable row level security;
create policy "authenticated_full_access" on mst_ledger_gst_statewise_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_ledger_address_excise_jurisdictions (
    id bigserial primary key,
    address_id bigint references mst_ledger_addresses(id) on delete cascade,
    ledger_guid text references mst_ledger(guid) on delete cascade,
    applicable_from text,
    range text,
    division text,
    commissionerate text
);
alter table mst_ledger_address_excise_jurisdictions enable row level security;
create policy "authenticated_full_access" on mst_ledger_address_excise_jurisdictions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ============================================================
-- SECTION 10: MST_STOCK_ITEM + SUB-TABLES
-- ============================================================

create table if not exists mst_stock_item (
    guid text primary key,
    name text,
    stock_group text,
    stock_category text,
    base_unit text,
    additional_units text,
    opening_qty numeric,
    opening_rate numeric,
    opening_value numeric,
    gst_applicable text,
    hsn_code text,
    gst_type_of_supply text,
    tcs_applicable text,
    description text,
    costing_method text,
    valuation_method text,
    use_expiry_dates integer,
    track_mfg_date integer,
    alias text,
    narration text,
    is_cost_tracking integer,
    is_cost_centres_on integer,
    maintain_in_branches integer,
    inclusive_of_tax integer,
    denominator numeric,
    conversion numeric,
    rate_of_duty text
);
alter table mst_stock_item enable row level security;
create policy "authenticated_full_access" on mst_stock_item
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_item_hsn_details (
    id bigserial primary key,
    stock_item_guid text references mst_stock_item(guid) on delete cascade,
    applicable_from text,
    hsn_code text,
    hsn_description text,
    hsn_classification text,
    source text
);
alter table mst_stock_item_hsn_details enable row level security;
create policy "authenticated_full_access" on mst_stock_item_hsn_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_item_gst_details (
    id bigserial primary key,
    stock_item_guid text references mst_stock_item(guid) on delete cascade,
    applicable_from text,
    calculation_type text,
    nature_of_transaction text,
    taxability text,
    source_of_gst_details text,
    is_non_gst_goods integer,
    is_reverse_charge integer,
    is_ineligible_itc integer,
    calculate_slab_on_mrp integer,
    include_exp_for_slab_calc integer
);
alter table mst_stock_item_gst_details enable row level security;
create policy "authenticated_full_access" on mst_stock_item_gst_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_item_gst_statewise_details (
    id bigserial primary key,
    gst_detail_id bigint references mst_stock_item_gst_details(id) on delete cascade,
    stock_item_guid text references mst_stock_item(guid) on delete cascade,
    state_name text,
    duty_head text,
    valuation_type text,
    gst_rate numeric
);
alter table mst_stock_item_gst_statewise_details enable row level security;
create policy "authenticated_full_access" on mst_stock_item_gst_statewise_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_item_opening_batches (
    id bigserial primary key,
    stock_item_guid text references mst_stock_item(guid) on delete cascade,
    batch_name text,
    godown_name text,
    quantity numeric,
    rate numeric,
    value numeric,
    manufactured_on text
);
alter table mst_stock_item_opening_batches enable row level security;
create policy "authenticated_full_access" on mst_stock_item_opening_batches
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_item_components (
    id bigserial primary key,
    stock_item_guid text references mst_stock_item(guid) on delete cascade,
    component_name text,
    base_qty numeric
);
alter table mst_stock_item_components enable row level security;
create policy "authenticated_full_access" on mst_stock_item_components
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_item_component_items (
    id bigserial primary key,
    component_id bigint references mst_stock_item_components(id) on delete cascade,
    stock_item_guid text references mst_stock_item(guid) on delete cascade,
    nature_of_component text,
    item_name text,
    default_godown text,
    actual_qty numeric
);
alter table mst_stock_item_component_items enable row level security;
create policy "authenticated_full_access" on mst_stock_item_component_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_group_gst_details (
    id bigserial primary key,
    stock_group_guid text references mst_stock_group(guid) on delete cascade,
    applicable_from text,
    calculation_type text,
    nature_of_transaction text,
    taxability text,
    source_of_gst_details text,
    is_non_gst_goods integer,
    is_reverse_charge integer,
    is_ineligible_itc integer,
    calculate_slab_on_mrp integer,
    include_exp_for_slab_calc integer
);
alter table mst_stock_group_gst_details enable row level security;
create policy "authenticated_full_access" on mst_stock_group_gst_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_stock_group_gst_statewise_details (
    id bigserial primary key,
    gst_detail_id bigint references mst_stock_group_gst_details(id) on delete cascade,
    stock_group_guid text references mst_stock_group(guid) on delete cascade,
    state_name text,
    duty_head text,
    valuation_type text,
    gst_rate numeric
);
alter table mst_stock_group_gst_statewise_details enable row level security;
create policy "authenticated_full_access" on mst_stock_group_gst_statewise_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ============================================================
-- SECTION 11: VOUCHER TYPE SUB-TABLES + GST REGISTRATION
-- ============================================================

create table if not exists mst_voucher_type_classes (
    id bigserial primary key,
    voucher_type_guid text references mst_voucher_type(guid) on delete cascade,
    class_name text
);
alter table mst_voucher_type_classes enable row level security;
create policy "authenticated_full_access" on mst_voucher_type_classes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists mst_gst_registration_details (
    id bigserial primary key,
    gst_reg_guid text references mst_gst_registration(guid) on delete cascade,
    applicable_from text,
    registration_type text,
    state text,
    place_of_supply text,
    is_other_territory integer,
    is_state_cess_on integer
);
alter table mst_gst_registration_details enable row level security;
create policy "authenticated_full_access" on mst_gst_registration_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ============================================================
-- SECTION 12: TRN_VOUCHER + SUB-TABLES
-- ============================================================

create table if not exists trn_voucher (
    guid text primary key,
    date text,
    effective_date text,
    voucher_type text,
    voucher_number text,
    reference text,
    reference_date text,
    narration text,
    is_invoice integer,
    is_optional integer,
    place_of_supply text,
    party_gstin text,
    irn text,
    irn_ack_no text,
    irn_ack_date text,
    company text,
    master_id integer,
    alter_id integer,
    altered_on text,
    party_name text,
    party_mailing_name text,
    state text,
    country text,
    pin_code text,
    gst_registration text,
    registration_type text,
    voucher_number_series text,
    order_reference text,
    consignee_name text,
    consignee_mailing_name text,
    consignee_state text,
    consignee_country text,
    consignee_gstin text,
    price_level text,
    dispatch_from_name text,
    dispatch_from_state text,
    dispatch_from_pin text,
    dispatch_doc_no text,
    carrier_name text,
    bill_of_landing_no text,
    bill_of_landing_date text,
    shipping_bill_no text,
    shipping_bill_date text,
    port_code text,
    destination_country text,
    cost_centre_name text,
    dispatched_through text,
    destination text,
    core_voucher_type text
);
alter table trn_voucher enable row level security;
create policy "authenticated_full_access" on trn_voucher
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists trn_ledger_entries (
    id bigserial primary key,
    voucher_guid text references trn_voucher(guid) on delete cascade,
    ledger_name text,
    amount numeric,
    is_deemed_positive integer,
    is_party_ledger integer,
    ledger_type text,
    ad_alloc_type text,
    swift_code text
);
alter table trn_ledger_entries enable row level security;
create policy "authenticated_full_access" on trn_ledger_entries
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists trn_bill_allocations (
    id bigserial primary key,
    voucher_guid text references trn_voucher(guid) on delete cascade,
    ledger_name text,
    bill_name text,
    bill_type text,
    amount numeric
);
alter table trn_bill_allocations enable row level security;
create policy "authenticated_full_access" on trn_bill_allocations
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists trn_inventory_entries (
    id bigserial primary key,
    voucher_guid text references trn_voucher(guid) on delete cascade,
    stock_item_name text,
    actual_qty numeric,
    billed_qty numeric,
    rate numeric,
    amount numeric,
    is_deemed_positive integer,
    discount numeric,
    bom_name text,
    is_scrap integer,
    user_descriptions text
);
alter table trn_inventory_entries enable row level security;
create policy "authenticated_full_access" on trn_inventory_entries
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists trn_batch_allocations (
    id bigserial primary key,
    voucher_guid text references trn_voucher(guid) on delete cascade,
    stock_item_name text,
    godown_name text,
    batch_name text,
    actual_qty numeric,
    billed_qty numeric,
    amount numeric,
    manufactured_on text,
    tracking_no text
);
alter table trn_batch_allocations enable row level security;
create policy "authenticated_full_access" on trn_batch_allocations
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists trn_inventory_ledgers (
    id bigserial primary key,
    voucher_guid text references trn_voucher(guid) on delete cascade,
    stock_item_name text,
    ledger_name text,
    amount numeric,
    is_deemed_positive integer
);
alter table trn_inventory_ledgers enable row level security;
create policy "authenticated_full_access" on trn_inventory_ledgers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists trn_inventory_entry_gst_rate_details (
    id bigserial primary key,
    voucher_guid text references trn_voucher(guid) on delete cascade,
    stock_item_name text,
    duty_head text,
    valuation_type text,
    gst_rate numeric,
    rate_per_unit numeric
);
alter table trn_inventory_entry_gst_rate_details enable row level security;
create policy "authenticated_full_access" on trn_inventory_entry_gst_rate_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create table if not exists trn_ledger_entry_gst_rate_details (
    id bigserial primary key,
    voucher_guid text references trn_voucher(guid) on delete cascade,
    ledger_name text,
    duty_head text,
    valuation_type text,
    gst_rate numeric,
    rate_per_unit numeric
);
alter table trn_ledger_entry_gst_rate_details enable row level security;
create policy "authenticated_full_access" on trn_ledger_entry_gst_rate_details
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ============================================================
-- SECTION 13: AUTH USER SETUP -- REMOVED (multi-project licensing track)
-- ============================================================
--
-- This used to be a manual step: create the Auth user in Supabase Studio,
-- then hand-run an `update auth.users set raw_user_meta_data = ...` query
-- (with a real client's email hardcoded into this very file, which is its
-- own separate problem) to stamp license_key onto it.
--
-- The admin panel's "Add client" flow (ADMIN_PANEL_MASTERPLAN.md Phase 6)
-- now does this in one atomic step -- creating the Auth user in whichever
-- target project you pick, WITH user_metadata.license_key already attached
-- -- via that project's own service-role key, called server-side from the
-- admin panel, never by hand in this SQL editor. Do not manually create
-- client logins in a target project going forward -- use the admin panel.

-- ============================================================
-- SECTION 14: VOUCHER QUEUE (PWA -> shell write bridge)
-- PWA inserts pending rows here to create/alter Sales, Purchase,
-- Receipt, Payment, or Journal vouchers. The shell polls this table
-- (same polling pattern as SECTION 7's sync_commands) and writes
-- the result back once Tally has processed it.
-- ============================================================

create table if not exists voucher_queue (
  id                  uuid        primary key default gen_random_uuid(),
  license_key         text        not null,
  device_id           text        not null,
  client_request_id   text        not null,
  voucher_kind        text        not null,   -- 'Sales' | 'Purchase' | 'Receipt' | 'Payment' | 'Journal'
  operation           text        not null,   -- 'Create' | 'Alter'
  payload             jsonb       not null,
  target_voucher_guid text,                   -- required when operation = 'Alter'
  status              text        default 'pending',  -- 'pending' | 'processing' | 'posted' | 'failed' | 'conflict'
  result              jsonb,
  created_at          timestamptz default now(),
  processed_at        timestamptz,
  unique(client_request_id)
);

alter table voucher_queue enable row level security;

-- SUPERSEDED — SHELL_BUGFIX_MASTERPLAN.md PHASE 5 (2026-07-20). Kept here, struck
-- through rather than deleted, per this project's own "preserve historical reasoning,
-- don't silently delete" convention (see supabase_migrations/0006_*.sql's own header
-- for the full decision log):
--   -- Matches SECTION 7 (sync_commands) / SECTION 3 (sync_queue)'s existing house style —
--   -- broad "authenticated_full_access" rather than a license_key/can_write-scoped policy.
--   -- Tighter, company- and permission-scoped RLS is a documented future hardening step
--   -- (see VOUCHER_PWA_BRIDGE_MASTERPLAN.md, Phase 46), not silently skipped here — flagging
--   -- this explicitly rather than deviating from the existing convention without note.
--   -- create policy "authenticated_full_access" on voucher_queue
--   --   for all to authenticated using (true) with check (true);
-- That documented future hardening step is what Phase 5 now closes out — the policy
-- below replaces the struck-through one above; do not run both (0006_*.sql itself
-- issues the corresponding `drop policy if exists "authenticated_full_access"`).

-- License-key-scoped SELECT — reuses the same auth.jwt() pattern already established by
-- SECTION 2 (device_registrations) and SECTION 5 (delta_sync_requests) above, rather than
-- inventing a new one.
create policy "voucher_queue_select_own_license" on voucher_queue
  for select to authenticated
  using (license_key = (auth.jwt()->'user_metadata'->>'license_key'));

-- License-key- AND can_write-scoped INSERT — the extra can_write subquery (beyond the
-- SECTION 2/5 precedent) pushes Bug B's fix (Phase 3's PollAndClaimVoucherQueueAsync
-- can_write check) down to the database for the insert path, using the same
-- "subquery inside WITH CHECK" shape 0003_max_devices_rls.sql already established for
-- device_registrations' own max-devices enforcement.
create policy "voucher_queue_insert_own_license_write_device" on voucher_queue
  for insert to authenticated
  with check (
    license_key = (auth.jwt()->'user_metadata'->>'license_key')
    and exists (
      select 1 from device_registrations dr
      where dr.license_key = voucher_queue.license_key
        and dr.device_id   = voucher_queue.device_id
        and dr.is_active    = true
        and dr.can_write    = true
    )
  );

-- License-key-scoped UPDATE (SHELL_BUGFIX_MASTERPLAN.md follow-up -- run
-- separately from the select/insert pair above, folded in here now). Lets a
-- device on the same license update the status/result columns it should be
-- able to touch as part of the request lifecycle it participates in; the
-- shell itself never needs this policy (service role bypasses RLS
-- entirely), same reasoning already given for the select/insert pair above.
create policy "voucher_queue_update_own_license"
  on voucher_queue
  for update
  to authenticated
  using (license_key = (auth.jwt()->'user_metadata'->>'license_key'))
  with check (license_key = (auth.jwt()->'user_metadata'->>'license_key'));

-- No DELETE policy for `authenticated` — deliberate (denied by RLS default), since
-- only the service-role shell ever updates/deletes voucher_queue rows in this codebase's
-- documented design. See supabase_migrations/0006_*.sql's own header for the full
-- reasoning, the "who this affects" analysis (service role bypasses RLS entirely — this
-- change affects only the PWA's own anon/authenticated access, not the shell), and the
-- hand-traced verification scenarios.

-- Index for fast per-status, per-license polling (same purpose as SECTION 3's
-- idx_sync_queue_device index).
create index if not exists idx_voucher_queue_status
  on voucher_queue(status, license_key);


-- ============================================================
-- SECTION 15: VOUCHER QUEUE — claimed_at (HANDOFF_PWA_BRIDGE_SHELL_SIDE_FINAL.md
-- Phase 3, timeout-based requeue)
--
-- FLAGGED SCHEMA ADDITION — not part of SECTION 14 as originally confirmed. SECTION 14 has
-- no timestamp recording when a row entered 'processing', and Phase 3's own explicit
-- instruction ("a row stuck in processing... implement a timeout-based requeue... don't
-- leave this undefined") cannot be correctly implemented without one — created_at is set
-- once by the PWA at insert time and does not move when the shell later claims the row, so
-- it cannot tell "stuck in processing for 10 minutes" apart from "sat pending for a day
-- before being claimed, then processing for 30 seconds." This column, plus the trigger
-- below, closes that gap.
--
-- This must be run against the real Supabase project before Phase 3's timeout-requeue sweep
-- (Services/AutoSyncService.cs, RequeueStaleProcessingVoucherQueueRowsAsync) will do anything
-- — until then, that method logs a clear warning each poll tick and returns without acting,
-- rather than failing loudly or (worse) silently blocking Phase 1/2's own claim/dispatch flow
-- on the same tick. Confirm this has actually been run — don't assume it from this file
-- existing in the repo — same discipline SECTION 14 itself was introduced with.
--
-- TRIGGER, NOT APPLICATION CODE, SETS claimed_at: deliberately chosen over having the shell's
-- own claim PATCH (status='pending' -> 'processing') include claimed_at=now() in its request
-- body. Setting it in the PATCH body would mean that PATCH starts failing outright (PostgREST
-- rejects an unrecognized column) on any shell that hasn't had this section run yet — silently
-- breaking Phase 1/2's already-working claim step for a Phase 3 feature that hasn't been
-- provisioned. A BEFORE UPDATE trigger instead means the claim PATCH's request body never
-- needs to change at all: unmodified, it works identically whether or not this section has
-- been run (claimed_at just never gets set until it has). This project already uses this same
-- trigger pattern for sync_queue's own ack-cleanup (see SECTION 3 above), so this isn't a new
-- convention.
-- ============================================================

alter table voucher_queue add column if not exists claimed_at timestamptz;

create or replace function voucher_queue_set_claimed_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'processing' and (old.status is distinct from 'processing') then
    new.claimed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_voucher_queue_claimed_at on voucher_queue;
create trigger trg_voucher_queue_claimed_at
  before update on voucher_queue
  for each row
  execute function voucher_queue_set_claimed_at();


-- ============================================================
-- SECTION 16: VOUCHER DATE RESYNC REQUESTS (SHELL_DATE_RESYNC_RACE_FIX_MASTERPLAN.md
-- Phase 3 — date-scoped resync feature)
--
-- "Give me the authoritative set of vouchers for exactly this one date," independent of
-- delta_sync_requests (SECTION 5), which is anchored to "since last_sync_at minus a lookback
-- window" and may not cover an old voucher's own date at all. Shape mirrors delta_sync_requests
-- exactly, per this phase's own instruction, with last_sync_at/lookback_days swapped for the
-- single target_date input this feature actually needs. See
-- supabase_migrations/0007_voucher_date_resync_requests.sql for the full reasoning.
-- ============================================================

create table if not exists voucher_date_resync_requests (
  id           uuid        primary key default gen_random_uuid(),
  license_key  text        not null,
  device_id    text        not null,
  target_date  date        not null,   -- the single calendar date to resync
  requested_at timestamptz default now(),
  status       text        default 'pending'  -- pending | processing | completed | failed
);

alter table voucher_date_resync_requests enable row level security;

create policy "device_can_manage_own_voucher_date_resync_requests"
  on voucher_date_resync_requests for all to authenticated
  using (license_key = (auth.jwt()->'user_metadata'->>'license_key'))
  with check (license_key = (auth.jwt()->'user_metadata'->>'license_key'));

create index if not exists idx_voucher_date_resync_requests_status
  on voucher_date_resync_requests(license_key, status);

-- Same duplicate-in-flight-request guarantee as SECTION 4/5, scoped one level narrower
-- (license_key, device_id, target_date) since a device can legitimately have independent
-- in-flight resync requests open for two different historical dates at once — see the
-- migration file's own comment for the full reasoning.
create unique index if not exists one_pending_voucher_date_resync_per_device_date
  on voucher_date_resync_requests (license_key, device_id, target_date)
  where status in ('pending', 'processing');


-- ============================================================
-- SECTION 17: APP ANNOTATIONS (flags/notes/review-queue -- not mirrored
-- from Tally, written directly by the PWA -- see lib/localDb/annotations.js)
-- ============================================================

-- Table
-- ----------------------------------------------------------------------------
--
-- Deviation from MASTERPLAN.md Section 12 — documented, not silent:
-- Section 12's column list does not include license_key. Every other
-- Supabase table in this project (device_registrations, sync_queue,
-- delta_sync_requests, initial_sync_requests — see docs/SUPABASE_MIGRATIONS.md)
-- is isolated per license via `license_key = (auth.jwt()->'user_metadata'
-- ->>'license_key')`, because one Supabase project can host more than one
-- customer's license (Section 4: "one license key = one company", not "one
-- Supabase project = one company"). Without a license_key column here,
-- annotations would leak across companies sharing a project. Added it as the
-- same isolation key every other table already uses. MASTERPLAN.md Section 12
-- should be updated to list this column explicitly the next time that file
-- is in a phase's scope.
create table if not exists app_annotations (
  id            uuid        primary key default gen_random_uuid(),
  license_key   text        not null,

  entity_type   text        not null check (entity_type in ('voucher', 'ledger', 'stock_item')),
  entity_id     text        not null, -- Tally guid of the voucher/ledger/stock item

  kind          text        not null check (kind in ('flag', 'note')),
  title         text        not null,
  body          text,

  status        text        not null default 'open' check (status in ('open', 'resolved')),
  visibility    text        not null default 'shared' check (visibility in ('shared', 'private')),

  -- Never trust a client-submitted created_by — RLS's WITH CHECK below
  -- additionally enforces created_by = auth.uid() on every INSERT, but the
  -- column default means a well-behaved client doesn't even need to send it.
  created_by    uuid        not null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  resolved_at   timestamptz,
  resolved_by   uuid,

  -- Soft delete only. There is deliberately no DELETE RLS policy below, so
  -- `authenticated` cannot hard-delete a row at all — the app must UPDATE
  -- deleted_at instead. See "No DELETE policy" note further down.
  deleted_at    timestamptz
);

comment on table app_annotations is
  'App-native flags/notes/review-queue entries. Not mirrored from Tally. '
  'Written directly by the PWA and cached in Dexie app_annotations for offline reading.';

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

-- Per MASTERPLAN.md Section 12: "Index on (entity_type, entity_id) for fast
-- lookups" — the annotation panel slotted into voucher/ledger detail pages
-- (Phase 35) looks up by exactly this pair.
create index if not exists idx_app_annotations_entity
  on app_annotations (entity_type, entity_id);

-- Review Queue (app/(app)/review-queue/page.js, Phase 35) lists all open
-- annotations for the current license — same "license_key + status" shape
-- docs/SUPABASE_MIGRATIONS.md's own sync_queue/initial_sync_requests indexes
-- already use for their own per-license polling queries.
create index if not exists idx_app_annotations_license_status
  on app_annotations (license_key, status);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
-- The first table in this project to need one — every prior table either has
-- no updated_at column, or (sync_queue/initial_sync_requests/delta_sync_requests)
-- is short-lived enough that it doesn't matter. Annotations are long-lived
-- records a user edits/resolves over time, so updated_at needs to be
-- trustworthy without every call site remembering to set it by hand.
create or replace function set_app_annotations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_annotations_updated_at on app_annotations;
create trigger trg_app_annotations_updated_at
  before update on app_annotations
  for each row
  execute function set_app_annotations_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
-- Same JWT-claim pattern every other table in this project uses (see
-- docs/SUPABASE_MIGRATIONS.md) — license_key isolation is the base
-- requirement, layered with the visibility ('shared'|'private') rule from
-- MASTERPLAN.md Section 12 on top.
alter table app_annotations enable row level security;

-- SELECT: same license, not soft-deleted, and either shared (any teammate on
-- the license can see it) or private-and-mine (only the author can see it).
create policy "Users can view annotations for their license"
on app_annotations for select
to authenticated
using (
  license_key = (auth.jwt() -> 'user_metadata' ->> 'license_key')
  and deleted_at is null
  and (visibility = 'shared' or created_by = auth.uid())
);

-- INSERT: must be tagged with the caller's own license and the caller's own
-- uid — this is the "created_by defaults server-side to auth.uid(); RLS
-- enforces with check (created_by = auth.uid())" rule from MASTERPLAN.md
-- Section 10 in enforced form, not just as a column default a client could
-- try to override.
create policy "Users can create annotations for their license"
on app_annotations for insert
to authenticated
with check (
  license_key = (auth.jwt() -> 'user_metadata' ->> 'license_key')
  and created_by = auth.uid()
);

-- UPDATE: covers both "edit my own note" and "resolve a shared flag a
-- teammate raised" (Review Queue, Phase 35, is a team-wide worklist, not a
-- per-user one) — same visibility rule as SELECT decides what's editable.
-- WITH CHECK re-confirms license_key on the resulting row so an update can't
-- move an annotation to a different license.
create policy "Users can update annotations they can see"
on app_annotations for update
to authenticated
using (
  license_key = (auth.jwt() -> 'user_metadata' ->> 'license_key')
  and deleted_at is null
  and (visibility = 'shared' or created_by = auth.uid())
)
with check (
  license_key = (auth.jwt() -> 'user_metadata' ->> 'license_key')
);

-- No DELETE policy, deliberately. RLS defaults to deny for any command with
-- no matching policy, so `authenticated` has no way to hard-delete a row at
-- all. Soft delete (UPDATE ... set deleted_at = now()) goes through the
-- UPDATE policy above instead. lib/localDb/annotations.js (Phase 35) must
-- never attempt a real .delete() call against this table.

-- ----------------------------------------------------------------------------
-- Verify (run manually after applying this file)
-- ----------------------------------------------------------------------------
-- select tablename, policyname, cmd
-- from pg_policies
-- where tablename = 'app_annotations'
-- order by policyname;
--
-- Expected: 3 policies (select, insert, update) — no delete policy.
--
-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'app_annotations'
-- order by ordinal_position;


-- ============================================================
-- DONE. All tables, RLS policies, indexes, and triggers created.
-- ============================================================