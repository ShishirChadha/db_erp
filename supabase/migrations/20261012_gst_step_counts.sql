-- Step 5 shows invoice counts (ERP vs Zoho) beside the per-head totals.
begin;
CREATE OR REPLACE FUNCTION public.gst_period_steps(p_entity_key text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reg boolean;
  v_month date := date_trunc('month', p_from)::date;
  v_b int[] := array_fill(0, array[10]);
  v_w int[] := array_fill(0, array[10]);
  v_fp text[] := array_fill(''::text, array[10]);
  v_status text[] := array_fill('yellow'::text, array[10]);
  v_reason text[] := array_fill(null::text, array[10]);
  v_detail jsonb[] := array_fill('{}'::jsonb, array[10]);
  v_so jsonb;
  r record;
  -- step 1
  v_unin int; v_unin_tax numeric; v_unin_fp text; v_unpaid int;
  -- steps 4/5
  v_z record; v_z_found boolean := false;
  v_amt int := 0; v_head int := 0; v_ms int := 0;
  v_zc numeric := 0; v_zs numeric := 0; v_zi numeric := 0; v_zign numeric := 0; v_ecnt int := 0; v_zcnt int := 0;
  v_ec numeric := 0; v_es numeric := 0; v_ei numeric := 0;
  -- steps 6/7
  v_fp1 text; v_f1 record; v_f1_found boolean := false; v_f1_approved boolean; v_f1_match boolean;
  v_all15 boolean; v_sales_locked boolean;
  -- step 8
  v_b2 record; v_b2_found boolean := false; v_open8 int := 0; v_red8 int := 0;
  -- steps 9/10
  v_r3b jsonb; v_fp3 text; v_f3 record; v_f3_found boolean := false; v_f3_approved boolean; v_f3_match boolean;
  v_out_tx numeric := 0; v_out_tax numeric := 0; v_3b_tx numeric; v_3b_tax numeric; v_purch_locked boolean;
  v_titles text[] := array['Zoho register match','Sales complete','Invoice & customer checks','HSN & numbering','Zoho tax-head match','Review & approve GSTR-1','File GSTR-1 & lock sales','Purchases & ITC (GSTR-2B)','Review & approve GSTR-3B','File GSTR-3B'];
  v_signoff_steps int[] := array[2,3,4,8];
  n int;
begin
  select is_gst_registered into v_reg from business_profiles where key = p_entity_key;
  if not coalesce(v_reg, false) then return '[]'::jsonb; end if;

  -- Which exception codes belong to which step. zoho_register_* are deliberately
  -- absent: steps 4/5 are computed from the reconciliation lines directly so a
  -- head-only mismatch cannot turn step 4 red.
  for r in
    select m.step,
           count(*) filter (where e.severity = 'blocker') as bl,
           count(*) filter (where e.severity = 'warning') as wr,
           md5(coalesce(string_agg(
             e.check_code || '|' || coalesce(e.record_id::text, e.record_label, '') || '|' || coalesce(e.period_month::text, ''),
             ',' order by e.check_code, coalesce(e.record_id::text, e.record_label, ''), coalesce(e.period_month::text, ''))
             filter (where e.severity = 'warning'), '')) as fp
    from v_gst_exceptions e
    join (values
      ('voided_sale_with_live_invoice',2),
      ('zero_gst_on_gst_entity',3),('tax_computation_mismatch',3),('value_mismatch',3),('wrong_tax_type',3),
      ('missing_place_of_supply',3),('eway_bill_missing',3),('invalid_gstin_format',3),('gstin_state_mismatch',3),
      ('gstin_has_whitespace',3),('customer_missing_state',3),('b2b_missing_gstin',3),
      ('missing_hsn',4),('hsn_too_short',4),('hsn_not_numeric',4),('service_without_sac',4),
      ('invoice_line_hsn_unresolvable',4),('hsn_inconsistent_for_sku',4),('doc_series_gap',4),
      ('invoice_number_too_long',4),('invoice_number_bad_chars',4),('duplicate_invoice_number',4),
      ('line_gst_rate_mismatch',3),
      ('rcm_credit_unclaimed',8)
    ) as m(check_code, step) on m.check_code = e.check_code
    where e.entity_key = p_entity_key
      and (e.period_month is null or e.period_month between v_month and p_to)
    group by m.step
  loop
    v_b[r.step] := r.bl; v_w[r.step] := r.wr; v_fp[r.step] := r.fp;
  end loop;

  select coalesce(jsonb_object_agg(step::text, jsonb_build_object(
           'fingerprint', fingerprint, 'note', note, 'signed_at', signed_at, 'signed_by', signed_by)), '{}'::jsonb)
    into v_so
  from gst_step_signoffs where entity_key = p_entity_key and period_start = p_from;

  -- ---------- Step 1: sales complete ----------
  select count(*), coalesce(sum(coalesce(s.sale_gst, 0)), 0),
         md5(coalesce(string_agg(s.id::text, ',' order by s.id), ''))
    into v_unin, v_unin_tax, v_unin_fp
  from sales s
  where coalesce(s.is_deleted, false) = false and s.invoice_id is null
    and coalesce(s.sale_type, '') = 'GST'
    and (case when lower(trim(coalesce(s.payment_account, ''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
    and s.effective_sale_date between p_from and p_to;
  select count(*) into v_unpaid
  from sales s
  where coalesce(s.is_deleted, false) = false and coalesce(s.sale_type, '') = 'GST'
    and (case when lower(trim(coalesce(s.payment_account, ''))) in ('digitalbluez','techtenth','cash')
              then lower(trim(s.payment_account)) else 'digitalbluez' end) = p_entity_key
    and s.effective_sale_date between p_from and p_to
    and coalesce(s.payment_status, '') <> 'paid';
  v_fp[2] := v_unin_fp;
  v_detail[2] := jsonb_build_object('uninvoiced_count', v_unin, 'uninvoiced_tax', v_unin_tax, 'unpaid_count', v_unpaid);
  if v_b[2] > 0 then
    v_status[2] := 'red';
    v_reason[2] := v_b[2] || ' voided sale(s) still have a live invoice -- issue a credit note.';
  elsif v_unin > 0 and (v_so->'2'->>'fingerprint') is distinct from v_unin_fp then
    v_status[2] := 'yellow';
    v_reason[2] := v_unin || ' GST sale(s) have no Zoho invoice recorded yet. Record each invoice, or sign off with a reason (e.g. goods not yet delivered).';
  else
    v_status[2] := 'green';
  end if;

  -- ---------- Steps 2 and 3: exception-driven ----------
  foreach n in array array[3,4] loop
    if v_b[n] > 0 then
      v_status[n] := 'red'; v_reason[n] := v_b[n] || ' blocker(s) to fix before filing.';
    elsif v_w[n] > 0 and (v_so->(n::text)->>'fingerprint') is distinct from v_fp[n] then
      v_status[n] := 'yellow'; v_reason[n] := v_w[n] || ' warning(s) to review and sign off.';
    else
      v_status[n] := 'green';
    end if;
    v_detail[n] := jsonb_build_object('blockers', v_b[n], 'warnings', v_w[n]);
  end loop;

  -- ---------- Steps 4 and 5: Zoho register ----------
  select * into v_z from gst_recon_imports i
   where i.entity_key = p_entity_key and i.kind = 'zoho_invoices'
     and i.period_start <= p_from and i.period_end >= p_to
   order by i.created_at desc limit 1;
  v_z_found := found;

  select coalesce(sum(li.cgst_amount), 0), coalesce(sum(li.sgst_amount), 0), coalesce(sum(li.igst_amount), 0),
         count(distinct i.id)
    into v_ec, v_es, v_ei, v_ecnt
  from invoices i join invoice_items li on li.invoice_id = i.id
  where i.entity_key = p_entity_key and coalesce(i.is_deleted, false) = false
    and coalesce(i.invoice_type, 'sales') = 'sales' and i.invoice_date between p_from and p_to;

  if v_z_found then
    select
      count(*) filter (where l.resolution is null and (l.match_status = 'missing_in_erp' or
        (l.match_status = 'value_mismatch' and l.diff ?| array['taxable_value','doc_value','tax','doc_date','erp_voided']))),
      count(*) filter (where l.resolution is null and l.match_status = 'value_mismatch'
        and l.diff ?| array['tax_heads','place_of_supply']),
      count(*) filter (where l.resolution is null and l.match_status = 'missing_in_source'),
      coalesce(sum(l.cgst) filter (where l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')), 0),
      coalesce(sum(l.sgst) filter (where l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')), 0),
      coalesce(sum(l.igst) filter (where l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')), 0),
      coalesce(sum(coalesce(l.cgst,0) + coalesce(l.sgst,0) + coalesce(l.igst,0)) filter (where l.match_status = 'missing_in_erp' and l.resolution = 'ignored'), 0),
      count(*) filter (where l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored'))
    into v_amt, v_head, v_ms, v_zc, v_zs, v_zi, v_zign, v_zcnt
    from gst_recon_lines l where l.import_id = v_z.id;
  end if;

  v_detail[1] := jsonb_build_object('uploaded', v_z_found, 'import_id', case when v_z_found then v_z.id end,
    'rows', case when v_z_found then v_z.row_count end, 'matched', case when v_z_found then v_z.matched_count end,
    'amount_unresolved', v_amt, 'not_in_zoho_unresolved', v_ms);
  if not v_z_found then
    v_status[1] := 'yellow'; v_reason[1] := 'Upload the Zoho invoice register (Invoices report, CSV) covering this whole month.';
  elsif v_amt > 0 then
    v_status[1] := 'red'; v_reason[1] := v_amt || ' invoice(s) are missing from the ERP or disagree on value/date. Fix or resolve each.';
  elsif v_ms > 0 then
    v_status[1] := 'yellow'; v_reason[1] := v_ms || ' ERP invoice(s) are not in your Zoho register -- confirm they are real, or resolve.';
  else
    v_status[1] := 'green';
  end if;

  v_detail[5] := jsonb_build_object('head_unresolved', v_head, 'zoho_ignored_tax', v_zign, 'erp_invoice_count', v_ecnt, 'zoho_invoice_count', v_zcnt,
    'erp', jsonb_build_object('cgst', v_ec, 'sgst', v_es, 'igst', v_ei),
    'zoho', jsonb_build_object('cgst', v_zc, 'sgst', v_zs, 'igst', v_zi));
  if not v_z_found then
    v_status[5] := 'yellow'; v_reason[5] := 'Upload the Zoho register in step 1 first.';
  elsif v_z.matcher_version < 2 then
    v_status[5] := 'yellow'; v_reason[5] := 'This upload was matched before tax heads were compared. Press Re-check on the upload below to run the CGST/SGST/IGST comparison.';
  elsif v_head > 0 then
    v_status[5] := 'red'; v_reason[5] := v_head || ' invoice(s) have a different CGST/SGST/IGST split or place of supply in Zoho. Tax paid under the wrong head cannot be offset -- fix at source.';
  else
    v_status[5] := 'green';
  end if;

  -- ---------- Steps 6 and 7: GSTR-1 approval and filing ----------
  v_fp1 := gst_gstr1_fingerprint(p_entity_key, p_from, p_to);
  select * into v_f1 from gst_filings
   where entity_key = p_entity_key and return_type = 'gstr1' and period_start = p_from;
  v_f1_found := found;
  v_f1_approved := v_f1_found and v_f1.status in ('exported', 'filed');
  v_f1_match := v_f1_approved and (v_f1.snapshot_hash is null or v_f1.snapshot_hash = v_fp1);
  v_all15 := v_status[2] = 'green' and v_status[3] = 'green' and v_status[4] = 'green'
         and v_status[1] = 'green' and v_status[5] = 'green';
  v_fp[6] := v_fp1;
  v_detail[6] := jsonb_build_object('approved', v_f1_match, 'approved_at', case when v_f1_approved then v_f1.updated_at end,
    'stale', v_f1_approved and not v_f1_match);

  if v_f1_approved and not v_f1_match then
    if v_f1.status = 'filed' then
      v_status[6] := 'red'; v_reason[6] := 'Figures changed AFTER GSTR-1 was filed. An amendment (GSTR-1A / next-month amendment) is needed -- do not edit further without your CA.';
    else
      v_status[6] := 'yellow'; v_reason[6] := 'Data changed since you approved. Review and approve again.';
    end if;
  elsif v_f1_match then
    v_status[6] := 'green';
  elsif not v_all15 then
    v_status[6] := 'yellow'; v_reason[6] := 'Finish steps 1-5 first -- approval is only allowed when they are all green.';
  else
    v_status[6] := 'yellow'; v_reason[6] := 'Ready. Review the working papers and approve GSTR-1.';
  end if;

  select exists (select 1 from period_locks pl where pl.entity_key = p_entity_key and pl.module = 'sales'
                   and pl.locked_through_date >= p_to) into v_sales_locked;
  v_detail[7] := jsonb_build_object('arn', case when v_f1_found then v_f1.arn end,
    'filed_at', case when v_f1_found then v_f1.filed_at end, 'sales_locked', v_sales_locked);
  if v_f1_found and v_f1.status = 'filed' then
    if not v_f1_match then
      v_status[7] := 'red'; v_reason[7] := v_reason[6];
    elsif v_sales_locked then
      v_status[7] := 'green';
    else
      v_status[7] := 'yellow'; v_reason[7] := 'Filed. Now lock Sales through month-end so nothing can change underneath it.';
    end if;
  elsif v_f1_match then
    v_status[7] := 'yellow'; v_reason[7] := 'Approved. File it on the GST portal, then record the ARN here.';
  else
    v_status[7] := 'yellow'; v_reason[7] := 'Approve GSTR-1 first (step 6).';
  end if;

  -- ---------- Step 8: GSTR-2B / ITC ----------
  select * into v_b2 from gst_recon_imports i
   where i.entity_key = p_entity_key and i.kind = 'gstr2b'
     and i.period_start <= p_from and i.period_end >= p_to
   order by i.created_at desc limit 1;
  v_b2_found := found;
  if v_b2_found then
    select
      count(*) filter (where l.resolution is null),
      count(*) filter (where l.resolution is null and l.match_status = 'missing_in_source'
        and l.matched_type = 'purchase_order'
        and exists (select 1 from purchase_order_items poi where poi.po_id = l.matched_id and poi.itc_status = 'claimed'))
    into v_open8, v_red8
    from gst_recon_lines l where l.import_id = v_b2.id and l.match_status <> 'matched';
  end if;
  v_detail[8] := jsonb_build_object('uploaded', v_b2_found, 'import_id', case when v_b2_found then v_b2.id end,
    'open_lines', v_open8, 'claimed_not_in_2b', v_red8, 'warnings', v_w[8]);
  if not v_b2_found then
    v_status[8] := 'yellow'; v_reason[8] := 'Upload the GSTR-2B JSON for this month (portal: Returns > GSTR-2B > Download). ITC may be claimed only for invoices that appear in it.';
  elsif v_red8 > 0 then
    v_status[8] := 'red'; v_reason[8] := v_red8 || ' purchase(s) have ITC marked "claimed" but the supplier has not filed (not in GSTR-2B). Do not claim it, or chase the supplier (Rule 36(4) / 88D).';
  elsif v_open8 > 0 then
    v_status[8] := 'yellow'; v_reason[8] := v_open8 || ' GSTR-2B line(s) still need a decision (claim, ineligible, chase supplier).';
  elsif v_w[8] > 0 and (v_so->'8'->>'fingerprint') is distinct from v_fp[8] then
    v_status[8] := 'yellow'; v_reason[8] := v_w[8] || ' reverse-charge credit(s) not yet claimed -- review and sign off.';
  else
    v_status[8] := 'green';
  end if;

  -- ---------- Steps 9 and 10: GSTR-3B ----------
  v_r3b := gst_r3b_summary(p_entity_key, p_from, p_to);
  v_fp3 := md5(coalesce(v_r3b::text, ''));
  select * into v_f3 from gst_filings
   where entity_key = p_entity_key and return_type = 'gstr3b' and period_start = p_from;
  v_f3_found := found;
  v_f3_approved := v_f3_found and v_f3.status in ('exported', 'filed');
  v_f3_match := v_f3_approved and (v_f3.snapshot_hash is null or v_f3.snapshot_hash = v_fp3);

  select coalesce(sum(li.quantity * li.rate * (case when i.invoice_type = 'credit_note' then -1 else 1 end)), 0),
         coalesce(sum((coalesce(li.cgst_amount,0) + coalesce(li.sgst_amount,0) + coalesce(li.igst_amount,0))
                      * (case when i.invoice_type = 'credit_note' then -1 else 1 end)), 0)
    into v_out_tx, v_out_tax
  from invoices i join invoice_items li on li.invoice_id = i.id
  where i.entity_key = p_entity_key and coalesce(i.is_deleted, false) = false
    and coalesce(i.invoice_type, 'sales') in ('sales', 'credit_note') and i.invoice_date between p_from and p_to;
  v_3b_tx := coalesce((v_r3b->'table_3_1'->'a_outward_taxable'->>'taxable_value')::numeric, 0)
           + coalesce((v_r3b->'table_3_1'->'b_zero_rated'->>'taxable_value')::numeric, 0)
           + coalesce((v_r3b->'table_3_1'->'c_nil_exempt'->>'taxable_value')::numeric, 0)
           + coalesce((v_r3b->'table_3_1'->'e_non_gst_outward'->>'taxable_value')::numeric, 0);
  v_3b_tax := coalesce((v_r3b->'table_3_1'->'a_outward_taxable'->>'cgst')::numeric, 0)
            + coalesce((v_r3b->'table_3_1'->'a_outward_taxable'->>'sgst')::numeric, 0)
            + coalesce((v_r3b->'table_3_1'->'a_outward_taxable'->>'igst')::numeric, 0);
  v_fp[9] := v_fp3;
  v_detail[9] := jsonb_build_object('approved', v_f3_match, 'approved_at', case when v_f3_approved then v_f3.updated_at end,
    'gstr1_taxable', v_out_tx, 'gstr1_tax', v_out_tax, 'r3b_taxable', v_3b_tx, 'r3b_tax', v_3b_tax);

  if v_f1_found and v_f1.status = 'filed' and not v_f1_match then
    v_status[9] := 'red'; v_reason[9] := 'GSTR-1 data changed after it was filed, so 3B would not match what the portal holds. Resolve with your CA first.';
  elsif abs(v_3b_tx - v_out_tx) > 1 or abs(v_3b_tax - v_out_tax) > 1 then
    v_status[9] := 'red'; v_reason[9] := 'GSTR-3B Table 3.1 does not tie to GSTR-1: taxable ' || to_char(v_3b_tx, 'FM999999990.00') ||
      ' vs ' || to_char(v_out_tx, 'FM999999990.00') || ', tax ' || to_char(v_3b_tax, 'FM999999990.00') ||
      ' vs ' || to_char(v_out_tax, 'FM999999990.00') || '. The portal fills 3.1 from GSTR-1, so these must agree -- usually a line whose rate field disagrees with its tax.';
  elsif v_status[8] = 'red' then
    v_status[9] := 'red'; v_reason[9] := 'Fix step 8 (ITC claimed without GSTR-2B support) before approving 3B.';
  elsif v_f3_approved and not v_f3_match then
    if v_f3.status = 'filed' then
      v_status[9] := 'red'; v_reason[9] := 'Figures changed AFTER GSTR-3B was filed.';
    else
      v_status[9] := 'yellow'; v_reason[9] := 'Data changed since you approved. Review and approve again.';
    end if;
  elsif v_f3_match then
    v_status[9] := 'green';
  elsif not (v_f1_found and v_f1.status = 'filed') then
    v_status[9] := 'yellow'; v_reason[9] := 'File GSTR-1 first (step 7) -- the portal builds 3B liability from the filed GSTR-1.';
  elsif v_status[8] <> 'green' then
    v_status[9] := 'yellow'; v_reason[9] := 'Finish step 8 (GSTR-2B / ITC) first.';
  else
    v_status[9] := 'yellow'; v_reason[9] := 'Ready. Review Tables 3.1, 3.2, 4 and approve GSTR-3B.';
  end if;

  select exists (select 1 from period_locks pl where pl.entity_key = p_entity_key and pl.module = 'purchases'
                   and pl.locked_through_date >= p_to) into v_purch_locked;
  v_detail[10] := jsonb_build_object('arn', case when v_f3_found then v_f3.arn end,
    'filed_at', case when v_f3_found then v_f3.filed_at end, 'purchases_locked', v_purch_locked);
  if v_f3_found and v_f3.status = 'filed' then
    if not v_f3_match then
      v_status[10] := 'red'; v_reason[10] := v_reason[9];
    elsif v_purch_locked then
      v_status[10] := 'green';
    else
      v_status[10] := 'yellow'; v_reason[10] := 'Filed. Now lock Purchases through month-end.';
    end if;
  elsif v_f3_match then
    v_status[10] := 'yellow'; v_reason[10] := 'Approved. Pay the liability and file on the GST portal, then record the ARN here.';
  else
    v_status[10] := 'yellow'; v_reason[10] := 'Approve GSTR-3B first (step 9).';
  end if;

  return (
    select jsonb_agg(jsonb_build_object(
      'step', s,
      'group', case when s <= 7 then 'gstr1' else 'gstr3b' end,
      'title', v_titles[s],
      'status', v_status[s],
      'reason', v_reason[s],
      'blockers', v_b[s], 'warnings', v_w[s],
      'fingerprint', v_fp[s],
      'signoff_applicable', s = any(v_signoff_steps),
      'signed_off', (v_so->(s::text)->>'fingerprint') is not distinct from v_fp[s] and v_so ? (s::text),
      'signed_off_at', v_so->(s::text)->>'signed_at',
      'signed_off_note', v_so->(s::text)->>'note',
      'detail', v_detail[s]
    ) order by s)
    from generate_series(1, 10) s
  );
end;
$function$
;
commit;
