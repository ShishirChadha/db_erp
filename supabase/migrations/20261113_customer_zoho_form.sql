-- Zoho-style customer form: separate billing/shipping addresses, primary
-- contact name parts, work phone, PAN, contact persons, communication
-- channels and internal remarks.
--
-- Purely additive and nullable (or defaulted) -- the storefront signup and the
-- lead->customer conversion also insert customers, so required-ness is
-- enforced in the ERP form, not the table.
--
-- The existing address_line1/2, city, state, state_code, pincode and the
-- composed flat `address` stay as the BILLING address, so GST/place-of-supply
-- logic and every current reader keep working unchanged. customer_name stays
-- the Display Name and phone stays the Mobile (customers_active_phone_unique).
--
-- sales_documents (quotations + proformas) gets its own shipping_address
-- snapshot, mirroring invoices.shipping_address.

begin;

alter table customers
  add column if not exists salutation text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists company_name text,
  add column if not exists work_phone text,
  add column if not exists pan text,
  add column if not exists remarks text,
  add column if not exists billing_attention text,
  add column if not exists shipping_attention text,
  add column if not exists shipping_address_line1 text,
  add column if not exists shipping_address_line2 text,
  add column if not exists shipping_city text,
  add column if not exists shipping_state text,
  add column if not exists shipping_pincode text,
  add column if not exists shipping_phone text,
  add column if not exists shipping_address text,
  add column if not exists contact_persons jsonb not null default '[]'::jsonb,
  add column if not exists communication_channels text[] not null default '{email}';

comment on column customers.shipping_address is
  'Composed flat shipping address (from shipping_* parts), snapshotted onto invoices/sales_documents.shipping_address at document creation. Null = ship to billing address.';
comment on column customers.contact_persons is
  'Additional contact persons: [{salutation, first_name, last_name, email, work_phone, mobile}]. contact_person (text) mirrors the first one''s name for legacy readers.';

alter table sales_documents
  add column if not exists shipping_address text;

commit;
