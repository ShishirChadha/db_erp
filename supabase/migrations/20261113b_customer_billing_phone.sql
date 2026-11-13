-- Billing address phone (Zoho parity with shipping_phone). Additive, nullable.
alter table customers add column if not exists billing_phone text;
