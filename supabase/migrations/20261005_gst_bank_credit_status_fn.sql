-- Part 1 of the 2026-10-05 correction: create gst_bank_credit_status()
-- BEFORE v_gst_exceptions is rewritten to call it (apply order matters --
-- see 20261004_gst_exceptions_view.sql and 20261005_gst_drop_exclusion_columns.sql).
begin;

-- ---------------------------------------------------------------------------
-- 2. gst_bank_credit_status() -- parallel in shape to gst_zoho_register_status(),
--    but reads the EXISTING Bank Reconciliation module's own tables instead of
--    a GST-specific upload. "Uploaded" here means a bank_statements row for
--    the entity's account(s) covers the whole requested period, same
--    full-period-coverage logic as the Zoho check (a partial upload must not
--    silently pass). "Unexplained" is any credit transaction whose recon_status
--    is still 'open' or 'split' -- 'matched'/'explained'/'ignored'/'transfer'
--    are already resolved or deliberately dismissed by the owner and are not
--    this check's concern.
-- ---------------------------------------------------------------------------
create or replace function public.gst_bank_credit_status(
  p_entity_key text, p_from date, p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_covered boolean;
  v_unexplained_count int;
  v_unexplained_total numeric;
begin
  -- Covered if EVERY one of the entity's active bank accounts has a statement
  -- spanning the period -- an account with no statement at all is exactly as
  -- uncovered as one with a partial one.
  select not exists (
    select 1 from bank_accounts ba
    where ba.entity_key = p_entity_key and ba.is_active
      and not exists (
        select 1 from bank_statements bs
        where bs.bank_account_id = ba.id
          and bs.period_start <= p_from and bs.period_end >= p_to
      )
  )
  -- An entity with no bank account at all has nothing to cover -- don't
  -- manufacture a false "not uploaded" for it.
  and exists (select 1 from bank_accounts ba2 where ba2.entity_key = p_entity_key and ba2.is_active)
  into v_covered;

  if not v_covered then
    return jsonb_build_object(
      'uploaded', false,
      'unexplained_count', 0,
      'unexplained_total', 0,
      'reason', 'No bank statement covering this whole period has been uploaded for this entity''s account(s) in Bank Reconciliation.'
    );
  end if;

  select count(*), coalesce(sum(bt.credit), 0)
    into v_unexplained_count, v_unexplained_total
  from bank_transactions bt
    join bank_accounts ba on ba.id = bt.bank_account_id
  where ba.entity_key = p_entity_key
    and bt.txn_date between p_from and p_to
    and coalesce(bt.credit, 0) > 0
    and bt.recon_status in ('open', 'split');

  return jsonb_build_object(
    'uploaded', true,
    'unexplained_count', coalesce(v_unexplained_count, 0),
    'unexplained_total', coalesce(v_unexplained_total, 0),
    'reason', case when coalesce(v_unexplained_count, 0) = 0 then null else
      v_unexplained_count || ' bank credit(s) totalling ' ||
      to_char(v_unexplained_total, 'FM999999990.00') ||
      ' have no (or only partial) matching entry in Bank Reconciliation.' end
  );
end;
$function$;

comment on function public.gst_bank_credit_status(text, date, date) is
  'Whether the period''s bank statement(s) have been uploaded (via the existing Bank Reconciliation module) and how many credit transactions are still open/split -- the safety net for revenue with no ERP sale AND no Zoho invoice. Warning-level: does not gate can_generate.';

commit;
