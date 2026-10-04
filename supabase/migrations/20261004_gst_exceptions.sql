-- GST pre-flight validation.
--
-- Modelled on BUSY's "check possible errors before generating the return"
-- step rather than Zoho's "push and read the Failed Transactions tab": the
-- GST portal rejects a whole upload on schema violations, so the errors have
-- to be found before export, not after.
--
-- Derived live, never stored -- the same principle as /dashboard/pending-tasks.
-- A fixed record simply stops appearing; there is no status to get stale.

begin;

-- ---------------------------------------------------------------------------
-- GSTIN check digit (mod 36 over the first 14 characters).
-- Mirrors isValidGstinChecksum() in packages/shared/src/gstStateCodes.ts --
-- keep the two in step. Proves the number is well-formed, never that it is
-- registered or active; only the taxpayer lookup can speak to that.
-- ---------------------------------------------------------------------------
create or replace function public.gstin_is_valid(p_gstin text)
returns boolean
language plpgsql
immutable
as $function$
declare
  charset constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v text := upper(trim(coalesce(p_gstin, '')));
  total int := 0;
  cv int;
  product int;
  i int;
begin
  if length(v) <> 15 then return false; end if;
  if v !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z{1}[0-9A-Z]{1}$' then
    return false;
  end if;

  for i in 1..14 loop
    cv := position(substr(v, i, 1) in charset) - 1;
    if cv < 0 then return false; end if;
    product := cv * (case when i % 2 = 1 then 1 else 2 end);
    total := total + (product / 36) + (product % 36);
  end loop;

  return substr(v, 15, 1) = substr(charset, ((36 - (total % 36)) % 36) + 1, 1);
end;
$function$;

comment on function public.gstin_is_valid(text) is
  'True when the GSTIN is structurally well-formed and its mod-36 check digit matches. Mirrors isValidGstinChecksum() in @db/shared.';

-- ---------------------------------------------------------------------------
-- The invoice-number sequence actually in use, with its numeric suffix parsed
-- out once so the gap and format checks can share it.
-- ---------------------------------------------------------------------------
create or replace view public.v_gst_invoice_series as
select
  i.id,
  i.entity_key,
  i.invoice_number,
  i.invoice_date,
  date_trunc('month', i.invoice_date)::date as period_month,
  -- Everything after the last non-digit: 'DBI2026/27-00684' -> 684. Tolerates
  -- the malformed double-hyphen variant that exists in this data.
  nullif(regexp_replace(i.invoice_number, '^.*[^0-9]', ''), '')::bigint as seq
from invoices i
where coalesce(i.is_deleted, false) = false
  and coalesce(i.invoice_type, 'sales') = 'sales';

commit;
