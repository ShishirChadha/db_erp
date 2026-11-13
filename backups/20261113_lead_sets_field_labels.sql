-- Lead Sets: optional per-Set column labels, so an admin can create an empty
-- Set (name it, optionally relabel Phone/Email/Address/Identifier for what
-- this particular list actually needs -- e.g. "Flat No." for a society list --
-- or just use the defaults), assign it to a staff member, and let them add
-- and work their own leads into it from scratch, without a CSV round-trip.
--
-- Nullable/backward-compatible: every existing Set has field_labels = null,
-- which resolves to the same default labels (Phone/Email/Address/Identifier)
-- it's always shown today -- see resolveFieldLabels() in apps/erp/lib/leads.ts.

begin;

alter table public.lead_sets
  add column if not exists field_labels jsonb;

commit;
