-- Phase 3: purchase-side tax capture, so GSTR-3B Table 4 and GSTR-2B
-- reconciliation become possible at all.
--
-- The ERP's value here is NOT computing ITC -- 3B Table 4 auto-populates from
-- GSTR-2B. It is reconciling our purchase register against 2B, to catch credit
-- we are owed but not getting, and credit claimed that 2B does not support
-- (which triggers a Rule 88D / DRC-01C intimation).
--
-- Idempotent throughout.

begin;

-- ---------------------------------------------------------------------------
-- 1. vendors.state_code -- customers already has one; vendors did not, so an
--    inward supply's intra/inter split had nothing to compare against.
-- ---------------------------------------------------------------------------
alter table vendors add column if not exists state_code text;

comment on column vendors.state_code is
  'Two-digit GST state code. Backfilled from the GSTIN prefix where present; the GSTIN is authoritative over the free-text state name.';

update vendors
set state_code = substr(trim(gst_number), 1, 2)
where state_code is null
  and nullif(trim(coalesce(gst_number, '')), '') is not null
  and trim(gst_number) ~ '^[0-9]{2}';

-- ---------------------------------------------------------------------------
-- 2. The vendor's own invoice. Its DATE -- not po_date -- is the ITC period and
--    the GSTR-2B match key, so these cannot be derived from what we already
--    hold.
-- ---------------------------------------------------------------------------
alter table purchase_orders add column if not exists vendor_invoice_number text;
alter table purchase_orders add column if not exists vendor_invoice_date date;
alter table purchase_orders add column if not exists place_of_supply text;

comment on column purchase_orders.vendor_invoice_date is
  'The date on the vendor''s own tax invoice. This, not po_date, determines the ITC period and is part of the GSTR-2B match key (vendor GSTIN + invoice number + date).';
comment on column purchase_orders.place_of_supply is
  'Two-digit state code of the place of supply for this inward supply. For goods with movement that is where they were delivered, i.e. normally the buying entity''s own state.';

-- ---------------------------------------------------------------------------
-- 3. Per-line tax heads on the inward side, mirroring invoice_items.
-- ---------------------------------------------------------------------------
alter table purchase_order_items add column if not exists cgst_amount numeric(12,2);
alter table purchase_order_items add column if not exists sgst_amount numeric(12,2);
alter table purchase_order_items add column if not exists igst_amount numeric(12,2);

-- BUSY's ITC model, which is better than Zoho's: separate "credit exists on
-- this bill" from "credit claimed, in which return period". Without that split,
-- a late claim, a reversal and a reclaim are all unrepresentable.
alter table purchase_order_items add column if not exists itc_status text;
alter table purchase_order_items add column if not exists itc_claimed_period date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'poi_itc_status_check') then
    alter table purchase_order_items add constraint poi_itc_status_check
      check (itc_status is null or itc_status in ('pending','claimed','ineligible','reversed'));
  end if;
end $$;

comment on column purchase_order_items.itc_status is
  'Input tax credit lifecycle for this line: pending (available, not yet claimed), claimed, ineligible (blocked by law or forgone), reversed. GSTR-3B Table 4 is computed from this, not from raw purchase rows.';
comment on column purchase_order_items.itc_claimed_period is
  'First day of the return period in which this line''s ITC was claimed. Lets a claim land in a later period than the invoice date, which is normal and otherwise unrepresentable.';

-- Backfill the split from the tax already stored, using the vendor's state
-- against the buying entity's. Intra-state halves into CGST+SGST; inter-state
-- is IGST. Same rule as calculateGST(), kept as one definition conceptually
-- even though this is the SQL side.
with ctx as (
  select
    poi.id as item_id,
    coalesce(poi.gst_amount, 0) as tax,
    v.state_code as vendor_state,
    bp.state_code as entity_state
  from purchase_order_items poi
    join purchase_orders po on po.id = poi.po_id
    left join vendors v on v.id = po.vendor_id
    left join business_profiles bp
      on bp.key = case
           when lower(trim(coalesce(po.purchased_by_type, ''))) in ('digitalbluez','techtenth','cash')
             then lower(trim(po.purchased_by_type)) else 'digitalbluez' end
)
update purchase_order_items poi
set cgst_amount = case when c.vendor_state is not null and c.vendor_state = c.entity_state then round(c.tax / 2, 2) else 0 end,
    sgst_amount = case when c.vendor_state is not null and c.vendor_state = c.entity_state then round(c.tax / 2, 2) else 0 end,
    -- An unknown vendor state is treated as inter-state rather than guessed as
    -- local: over-stating IGST is visible in a 2B mismatch, whereas a wrong
    -- CGST+SGST split quietly looks plausible.
    igst_amount = case when c.vendor_state is not null and c.vendor_state = c.entity_state then 0 else c.tax end
from ctx c
where c.item_id = poi.id
  and poi.cgst_amount is null and poi.sgst_amount is null and poi.igst_amount is null;

-- Everything already purchased is credit that either was taken or never will
-- be; marking it 'pending' would misrepresent it as an outstanding claim.
update purchase_order_items
set itc_status = 'claimed'
where itc_status is null and coalesce(gst_amount, 0) > 0;

update purchase_order_items
set itc_status = 'ineligible'
where itc_status is null and coalesce(gst_amount, 0) = 0;

-- ---------------------------------------------------------------------------
-- 4. entity_key on purchase invoices, which were created without one.
-- ---------------------------------------------------------------------------
update invoices i
set entity_key = case
      when lower(trim(coalesce(po.purchased_by_type, ''))) in ('digitalbluez','techtenth','cash')
        then lower(trim(po.purchased_by_type)) else 'digitalbluez' end
from purchase_orders po
where po.id = i.po_id
  and coalesce(i.invoice_type, 'sales') = 'purchase'
  and i.entity_key is null;

-- ---------------------------------------------------------------------------
-- 5. GST on expenses. This is where the reverse-charge exposure lives: a
--    foreign advertising invoice (Google/Meta/AWS) is an IMPORT OF SERVICE and
--    attracts RCM under s.9(3) -- a liability in 3B 3.1(d) with the credit in
--    4A -- and nothing in the ERP could record it before this.
--
--    Note s.9(4) (unregistered domestic purchases) does NOT apply to computers:
--    it needs both a notified class of person and notified goods, and computers
--    are on neither list. So this is deliberately about s.9(3) only.
-- ---------------------------------------------------------------------------
alter table expenses add column if not exists gst_percentage numeric(5,2);
alter table expenses add column if not exists gst_amount numeric(12,2);
alter table expenses add column if not exists supply_type text;
alter table expenses add column if not exists itc_status text;
alter table expenses add column if not exists itc_claimed_period date;
alter table expenses add column if not exists vendor_gstin text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_supply_type_check') then
    alter table expenses add constraint expenses_supply_type_check
      check (supply_type is null or supply_type in ('none','forward','rcm_domestic','rcm_import_services'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_itc_status_check') then
    alter table expenses add constraint expenses_itc_status_check
      check (itc_status is null or itc_status in ('pending','claimed','ineligible','reversed'));
  end if;
end $$;

comment on column expenses.supply_type is
  'How GST arises on this expense. forward = the vendor charged it. rcm_domestic = s.9(3) reverse charge we owe (GTA freight, legal services, security, commercial rent from an unregistered landlord). rcm_import_services = imported service, typically foreign advertising or cloud, which we self-assess and may then claim. none = outside GST.';

commit;
