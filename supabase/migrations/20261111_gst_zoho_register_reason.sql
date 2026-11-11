-- Zoho register check: one row per month (was one per invoice), and a reason that says
-- which step lists the invoices (amount mismatches: step 1; tax-head/state only: step 5).
CREATE OR REPLACE FUNCTION public.gst_zoho_register_status(p_entity_key text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_import record;
  v_missing int;
  v_amount int;
  v_heads int;
  v_parts text[] := '{}';
begin
  select * into v_import
  from gst_recon_imports i
  where i.entity_key = p_entity_key and i.kind = 'zoho_invoices'
    and i.period_start <= p_from and i.period_end >= p_to
  order by i.created_at desc limit 1;

  if not found then
    return jsonb_build_object('uploaded', false, 'reconciled', false,
      'reason', 'No Zoho invoice register has been uploaded covering this period, so there is nothing to check the return against.');
  end if;

  -- A mismatch whose only differences are tax head / place of supply is listed in step 5
  -- (tax-head check), not step 1, so it is counted and named separately.
  select
    count(*) filter (where l.match_status = 'missing_in_erp' and l.resolution is null),
    count(*) filter (where l.match_status = 'value_mismatch' and l.resolution is null
      and not (coalesce(l.diff, '{}'::jsonb) <> '{}'::jsonb
        and not exists (select 1 from jsonb_object_keys(l.diff) k where k not in ('tax_heads', 'place_of_supply')))),
    count(*) filter (where l.match_status = 'value_mismatch' and l.resolution is null
      and coalesce(l.diff, '{}'::jsonb) <> '{}'::jsonb
      and not exists (select 1 from jsonb_object_keys(l.diff) k where k not in ('tax_heads', 'place_of_supply')))
  into v_missing, v_amount, v_heads
  from gst_recon_lines l where l.import_id = v_import.id;

  if v_missing > 0 then v_parts := v_parts || (v_missing || ' invoice(s) in Zoho are not recorded in the ERP (step 1)'); end if;
  if v_amount > 0 then v_parts := v_parts || (v_amount || ' invoice(s) differ in amount (step 1)'); end if;
  if v_heads > 0 then v_parts := v_parts || (v_heads || ' invoice(s) match in amount but differ in tax head (IGST vs CGST+SGST) or state -- listed in step 5, tax-head check'); end if;

  return jsonb_build_object(
    'uploaded', true, 'import_id', v_import.id, 'uploaded_at', v_import.created_at,
    'source_filename', v_import.source_filename, 'row_count', v_import.row_count,
    'matched_count', v_import.matched_count,
    'missing_in_erp_unresolved', v_missing,
    'value_mismatch_unresolved', v_amount + v_heads,
    'amount_mismatch_unresolved', v_amount,
    'tax_head_mismatch_unresolved', v_heads,
    'reconciled', v_missing + v_amount + v_heads = 0,
    'reason', case when v_missing + v_amount + v_heads = 0 then null
      else 'Zoho match: ' || array_to_string(v_parts, '; ') || '. Resolve them before filing.' end);
end;
$function$;

CREATE OR REPLACE VIEW public.v_gst_exceptions AS
WITH entities AS (
         SELECT business_profiles.key,
            business_profiles.state_code,
            business_profiles.is_gst_registered
           FROM business_profiles
        ), sale_entity AS (
         SELECT s.id,
            s.sale_date,
            s.sale_month,
            s.sale_year,
            s.invoice_number,
            s.customer_name,
            s.pmt,
            s.asset_number,
            s.sku,
            s.type,
            s.brand,
            s.asset_description,
            s.serial_number,
            s.sale_base_price,
            s.sale_gst,
            s.sale_total,
            s.sale_type,
            s.created_at,
            s.is_deleted,
            s.deleted_remarks,
            s.deleted_at,
            s.asset_ledger_id,
            s.customer_id,
            s.entered_by,
            s.finalized,
            s.finalized_by,
            s.finalized_at,
            s.invoice_id,
            s.bundled_accessories,
            s.accessory_id,
            s.accessory_quantity,
            s.payment_status,
            s.amount_paid,
            s.payment_account,
            s.sold_by,
            s.notes,
            s.repair_job_id,
            s.rental_agreement_id,
            s.rental_period_start,
            s.rental_period_end,
            s.original_sold_date,
            s.effective_sale_date,
            s.eway_bill_number,
            s.eway_bill_date,
                CASE
                    WHEN (lower(TRIM(BOTH FROM COALESCE(s.payment_account, ''::text))) = ANY (ARRAY['digitalbluez'::text, 'techtenth'::text, 'cash'::text])) THEN lower(TRIM(BOTH FROM s.payment_account))
                    ELSE 'digitalbluez'::text
                END AS entity_key
           FROM sales s
        ), series AS (
         SELECT v_gst_invoice_series.id,
            v_gst_invoice_series.entity_key,
            v_gst_invoice_series.invoice_number,
            v_gst_invoice_series.invoice_date,
            v_gst_invoice_series.cancelled,
            v_gst_invoice_series.period_month,
            v_gst_invoice_series.series_prefix,
            v_gst_invoice_series.series_key,
            v_gst_invoice_series.seq,
            v_gst_invoice_series.doc_type
           FROM v_gst_invoice_series
        ), series_gaps AS (
         SELECT g.entity_key,
            g.series_key,
            g.missing_seq,
            ( SELECT max(s2.period_month) AS max
                   FROM series s2
                  WHERE ((s2.entity_key = g.entity_key) AND (s2.series_key = g.series_key) AND (s2.seq < g.missing_seq))) AS period_month
           FROM ( SELECT s.entity_key,
                    s.series_key,
                    generate_series(min(s.seq), max(s.seq)) AS missing_seq
                   FROM series s
                  WHERE (s.seq IS NOT NULL)
                  GROUP BY s.entity_key, s.series_key) g
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM series s3
                  WHERE ((s3.entity_key = g.entity_key) AND (s3.series_key = g.series_key) AND (s3.seq = g.missing_seq)))))
        )
 SELECT e.key AS entity_key,
    g.period_month,
    'doc_series_gap'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'series'::text AS record_type,
    NULL::uuid AS record_id,
    (g.series_key || g.missing_seq) AS record_label,
    ((('Invoice number '::text || g.series_key) || g.missing_seq) || ' is missing from the series. Table 13 needs every number accounted for as either issued or cancelled -- this is either a cancelled invoice or one never recorded in the ERP.'::text) AS detail,
    g.series_key,
    g.missing_seq AS seq
   FROM (series_gaps g
     JOIN entities e ON ((e.key = g.entity_key)))
  WHERE (e.is_gst_registered AND (NOT (EXISTS ( SELECT 1
           FROM gst_void_invoice_numbers v
          WHERE ((v.entity_key = g.entity_key) AND (v.series_key = g.series_key) AND (v.seq = g.missing_seq))))))
UNION ALL
 SELECT i.entity_key,
    i.period_month,
    'invoice_number_too_long'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    (('Invoice number is '::text || length(i.invoice_number)) || ' characters. The GST portal rejects anything over 16.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (v_gst_invoice_series i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (NOT i.cancelled) AND (length(i.invoice_number) > 16))
UNION ALL
 SELECT i.entity_key,
    i.period_month,
    'invoice_number_bad_chars'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    'Invoice number contains characters the GST portal disallows. Only letters, digits, / and - are permitted.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (v_gst_invoice_series i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (NOT i.cancelled) AND (i.invoice_number ~ '[^A-Za-z0-9/-]'::text))
UNION ALL
 SELECT i.entity_key,
    i.period_month,
    'duplicate_invoice_number'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    'This invoice number appears more than once for this entity.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (v_gst_invoice_series i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (NOT i.cancelled) AND (EXISTS ( SELECT 1
           FROM v_gst_invoice_series d
          WHERE ((d.entity_key = i.entity_key) AND (d.invoice_number = i.invoice_number) AND (d.id <> i.id) AND (NOT d.cancelled)))))
UNION ALL
 SELECT s.entity_key,
    (date_trunc('month'::text, (s.effective_sale_date)::timestamp with time zone))::date AS period_month,
    'voided_sale_with_live_invoice'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'sale'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.customer_name, (s.id)::text) AS record_label,
    'Sale was voided but its invoice is still live, so the return reports a supply that was reversed. Needs a credit note.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (sale_entity s
     JOIN entities e ON ((e.key = s.entity_key)))
  WHERE (e.is_gst_registered AND (COALESCE(s.is_deleted, false) = true) AND (s.invoice_id IS NOT NULL))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'zero_gst_on_gst_entity'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    (('Taxable value of '::text || to_char(COALESCE(i.subtotal, (0)::numeric), 'FM999999990.00'::text)) || ' carries no GST on a GST-registered entity. Either exempt/nil-rated and needs to be reported as such, or output tax is missing.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text) AND (COALESCE(i.subtotal, (0)::numeric) > (0)::numeric) AND (COALESCE(i.total_gst, (0)::numeric) = (0)::numeric))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'tax_computation_mismatch'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    (((((('Tax of '::text || to_char(COALESCE(i.total_gst, (0)::numeric), 'FM999999990.00'::text)) || ' on '::text) || to_char(COALESCE(i.subtotal, (0)::numeric), 'FM999999990.00'::text)) || ' implies '::text) || to_char(round(((COALESCE(i.total_gst, (0)::numeric) / NULLIF(i.subtotal, (0)::numeric)) * (100)::numeric), 2), 'FM990.00'::text)) || '%, which is not a GST slab rate.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text) AND (COALESCE(i.subtotal, (0)::numeric) > (0)::numeric) AND (COALESCE(i.total_gst, (0)::numeric) > (0)::numeric) AND (round(((COALESCE(i.total_gst, (0)::numeric) / NULLIF(i.subtotal, (0)::numeric)) * (100)::numeric), 2) <> ALL (ARRAY[(0)::numeric, 0.25, 1.5, (3)::numeric, (5)::numeric, (12)::numeric, (18)::numeric, (28)::numeric, (40)::numeric])))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'value_mismatch'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    (('Grand total does not equal taxable value plus tax (off by '::text || to_char(abs((COALESCE(i.grand_total, (0)::numeric) - (COALESCE(i.subtotal, (0)::numeric) + COALESCE(i.total_gst, (0)::numeric)))), 'FM999999990.00'::text)) || ').'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text) AND (abs((COALESCE(i.grand_total, (0)::numeric) - (COALESCE(i.subtotal, (0)::numeric) + COALESCE(i.total_gst, (0)::numeric)))) > 0.05))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'wrong_tax_type'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    (((((('Place of supply '::text || COALESCE(i.place_of_supply, '(none)'::text)) || ' against entity state '::text) || COALESCE(e.state_code, '?'::text)) || ' but the line charges '::text) ||
        CASE
            WHEN (COALESCE(li.igst_amount, (0)::numeric) > (0)::numeric) THEN 'IGST'::text
            ELSE 'CGST+SGST'::text
        END) || '.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM ((invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
     JOIN invoice_items li ON ((li.invoice_id = i.id)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text) AND (i.place_of_supply IS NOT NULL) AND (((i.place_of_supply = e.state_code) AND (COALESCE(li.igst_amount, (0)::numeric) > (0)::numeric)) OR ((i.place_of_supply <> e.state_code) AND ((COALESCE(li.cgst_amount, (0)::numeric) > (0)::numeric) OR (COALESCE(li.sgst_amount, (0)::numeric) > (0)::numeric)))))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'missing_place_of_supply'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    'No place of supply recorded, so the CGST/SGST-versus-IGST split cannot be justified.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text) AND (NULLIF(TRIM(BOTH FROM COALESCE(i.place_of_supply, ''::text)), ''::text) IS NULL))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'eway_bill_missing'::text AS check_code,
    'warning'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    (('Invoice value is '::text || to_char(COALESCE(i.grand_total, (0)::numeric), 'FM999999990.00'::text)) || '. Movement of goods over 50,000 in Uttar Pradesh needs an e-way bill.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text) AND (COALESCE(i.grand_total, (0)::numeric) > (50000)::numeric) AND (NULLIF(TRIM(BOTH FROM COALESCE(i.eway_bill_number, ''::text)), ''::text) IS NULL))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'invalid_gstin_format'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    (('Customer GSTIN '::text || i.customer_gst) || ' fails the check-digit test, so the portal will reject this B2B row.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text) AND (NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) IS NOT NULL) AND (NOT gstin_is_valid(i.customer_gst)))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'gstin_state_mismatch'::text AS check_code,
    'warning'::text AS severity,
    'transactions'::text AS check_group,
    'customer'::text AS record_type,
    c.id AS record_id,
    c.customer_name AS record_label,
    (((('GSTIN starts with '::text || substr(TRIM(BOTH FROM c.gst_number), 1, 2)) || ' but the customer record says state '::text) || TRIM(BOTH FROM c.state_code)) || '. Place of supply resolves from the GSTIN first, so the state field is what is wrong.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM customers c
  WHERE ((COALESCE(c.is_deleted, false) = false) AND (NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM COALESCE(c.state_code, ''::text)), ''::text) IS NOT NULL) AND (substr(TRIM(BOTH FROM c.gst_number), 1, 2) <> TRIM(BOTH FROM c.state_code)))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'gstin_has_whitespace'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'customer'::text AS record_type,
    c.id AS record_id,
    c.customer_name AS record_label,
    'GSTIN is stored with leading or trailing whitespace. The portal requires exactly 15 characters with none.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM customers c
  WHERE ((COALESCE(c.is_deleted, false) = false) AND (NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NOT NULL) AND (c.gst_number <> TRIM(BOTH FROM c.gst_number)))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'customer_missing_state'::text AS check_code,
    'warning'::text AS severity,
    'transactions'::text AS check_group,
    'customer'::text AS record_type,
    c.id AS record_id,
    c.customer_name AS record_label,
    'No GSTIN and no state on file, so place of supply silently defaults to the seller''s own state. An out-of-state sale would be taxed as intra-state.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM customers c
  WHERE ((COALESCE(c.is_deleted, false) = false) AND (NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NULL) AND (NULLIF(TRIM(BOTH FROM COALESCE(c.state_code, ''::text)), ''::text) IS NULL) AND (EXISTS ( SELECT 1
           FROM sales sx
          WHERE ((sx.customer_id = c.id) AND (COALESCE(sx.is_deleted, false) = false)))))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'b2b_missing_gstin'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'customer'::text AS record_type,
    c.id AS record_id,
    c.customer_name AS record_label,
    'Marked as a registered business but has no GSTIN, so its supplies cannot be reported under B2B.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM customers c
  WHERE ((COALESCE(c.is_deleted, false) = false) AND (c.gst_treatment = ANY (ARRAY['registered_regular'::text, 'registered_composition'::text])) AND (NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NULL))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'missing_hsn'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, (s.id)::text) AS record_label,
    'No HSN code. Table 12 is mandatory and the portal now validates HSN against its own master, so this SKU cannot be reported.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sku_master s
  WHERE ((s.category <> 'SERVICE'::text) AND (NULLIF(TRIM(BOTH FROM COALESCE(s.hsn_code, ''::text)), ''::text) IS NULL) AND (EXISTS ( SELECT 1
           FROM invoice_items li
          WHERE (li.sku_id = s.id))))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'hsn_too_short'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, (s.id)::text) AS record_label,
    (('HSN '::text || s.hsn_code) || ' is shorter than the 4 digits required at this turnover.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sku_master s
  WHERE ((s.category <> 'SERVICE'::text) AND (NULLIF(TRIM(BOTH FROM COALESCE(s.hsn_code, ''::text)), ''::text) IS NOT NULL) AND (length(regexp_replace(s.hsn_code, '[^0-9]'::text, ''::text, 'g'::text)) < 4))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'hsn_not_numeric'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, (s.id)::text) AS record_label,
    (('HSN '::text || s.hsn_code) || ' contains non-numeric characters.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sku_master s
  WHERE ((NULLIF(TRIM(BOTH FROM COALESCE(s.hsn_code, ''::text)), ''::text) IS NOT NULL) AND (s.hsn_code ~ '[^0-9]'::text))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'service_without_sac'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, (s.id)::text) AS record_label,
    'Service SKU has no SAC code. A supply of service needs a SAC, not a goods HSN.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sku_master s
  WHERE ((s.category = 'SERVICE'::text) AND (s.sac_code_id IS NULL))
UNION ALL
 SELECT o.entity_key,
    o.period_month,
    'invoice_line_hsn_unresolvable'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'invoice'::text AS record_type,
    o.invoice_id AS record_id,
    ((o.invoice_number || ' — '::text) || "left"(o.description, 40)) AS record_label,
    (((('No HSN/SAC on the line, its SKU, or any linked SAC, so '::text || to_char(o.txval, 'FM999999990.00'::text)) || ' of taxable value is missing from Table 12 while still '::text) || 'reported in Tables 4/5/7.'::text) ||
        CASE
            WHEN (o.item_type = 'repair'::text) THEN ' Computer repair is normally SAC 998713 -- confirm with your CA before applying it.'::text
            WHEN (o.item_type = 'rental'::text) THEN ' Computer rental is SAC 997315.'::text
            ELSE ' Set an HSN on the SKU in SKU Master.'::text
        END) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM v_gst_outward_lines o
  WHERE (o.hsn_code IS NULL)
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'hsn_inconsistent_for_sku'::text AS check_code,
    'warning'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    li.sku_id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, (li.sku_id)::text) AS record_label,
    ('Invoiced under more than one HSN: '::text || string_agg(DISTINCT li.hsn_code, ', '::text)) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM (invoice_items li
     JOIN sku_master s ON ((s.id = li.sku_id)))
  WHERE ((li.sku_id IS NOT NULL) AND (NULLIF(TRIM(BOTH FROM COALESCE(li.hsn_code, ''::text)), ''::text) IS NOT NULL))
  GROUP BY li.sku_id, s.full_sku_code, s.sku_description
 HAVING (count(DISTINCT li.hsn_code) > 1)
UNION ALL
 SELECT COALESCE(e.entity_key, 'digitalbluez'::text) AS entity_key,
    (date_trunc('month'::text, (e.expense_date)::timestamp with time zone))::date AS period_month,
    'rcm_credit_unclaimed'::text AS check_code,
    'warning'::text AS severity,
    'transactions'::text AS check_group,
    'expense'::text AS record_type,
    e.id AS record_id,
    "left"(COALESCE(e.description, 'Expense'::text), 60) AS record_label,
    (('Reverse charge of '::text || to_char(COALESCE(e.gst_amount, (0)::numeric), 'FM999999990.00'::text)) || ' is recorded as owed but not claimed back. The liability lands in 3B 3.1(d) either way; the matching credit only reaches 4A once it is marked claimed.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM expenses e
  WHERE ((COALESCE(e.is_deleted, false) = false) AND (e.supply_type = ANY (ARRAY['rcm_domestic'::text, 'rcm_import_services'::text])) AND (COALESCE(e.gst_amount, (0)::numeric) > (0)::numeric) AND (COALESCE(e.itc_status, 'pending'::text) = 'pending'::text))
UNION ALL
 SELECT p.entity_key,
    p.period_month,
    'zoho_register_not_uploaded'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'series'::text AS record_type,
    NULL::uuid AS record_id,
    to_char((p.period_month)::timestamp with time zone, 'Mon YYYY'::text) AS record_label,
    (p.status ->> 'reason'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM ( SELECT a.entity_key,
            a.period_month,
            gst_zoho_register_status(a.entity_key, a.period_month, ((a.period_month + '1 mon -1 days'::interval))::date) AS status
           FROM ( SELECT i.entity_key,
                    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month
                   FROM (invoices i
                     JOIN business_profiles b ON ((b.key = i.entity_key)))
                  WHERE (b.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text])))
                UNION
                 SELECT se.entity_key,
                    (date_trunc('month'::text, (se.effective_sale_date)::timestamp with time zone))::date AS date_trunc
                   FROM (sale_entity se
                     JOIN business_profiles b2 ON ((b2.key = se.entity_key)))
                  WHERE (b2.is_gst_registered AND (COALESCE(se.is_deleted, false) = false) AND (COALESCE(se.sale_type, ''::text) = 'GST'::text))) a) p
  WHERE (((p.status ->> 'uploaded'::text))::boolean = false)
UNION ALL
 SELECT p.entity_key,
    p.period_month,
    'zoho_register_unreconciled'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'series'::text AS record_type,
    NULL::uuid AS record_id,
    to_char((p.period_month)::timestamp with time zone, 'Mon YYYY'::text) AS record_label,
    (p.status ->> 'reason'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM ( SELECT a.entity_key,
            a.period_month,
            gst_zoho_register_status(a.entity_key, a.period_month, ((a.period_month + '1 mon -1 days'::interval))::date) AS status
           FROM ( SELECT DISTINCT i.entity_key,
                    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month
                   FROM (invoices i
                     JOIN business_profiles b ON ((b.key = i.entity_key)))
                  WHERE (b.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text])))) a) p
  WHERE ((((p.status ->> 'uploaded'::text))::boolean = true) AND (((p.status ->> 'reconciled'::text))::boolean = false))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'line_gst_rate_mismatch'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    ((i.invoice_number || ' — '::text) || "left"(li.description, 40)) AS record_label,
    (((((((('Line carries tax of '::text || to_char(((COALESCE(li.cgst_amount, (0)::numeric) + COALESCE(li.sgst_amount, (0)::numeric)) + COALESCE(li.igst_amount, (0)::numeric)), 'FM999999990.00'::text)) || ' on '::text) || to_char((li.rate * li.quantity), 'FM999999990.00'::text)) || ' ('::text) || to_char(round(((((COALESCE(li.cgst_amount, (0)::numeric) + COALESCE(li.sgst_amount, (0)::numeric)) + COALESCE(li.igst_amount, (0)::numeric)) / (li.rate * li.quantity)) * (100)::numeric), 2), 'FM990.00'::text)) || '%) but its rate field says '::text) || COALESCE(li.gst_rate, (0)::numeric)) || '%. Returns group lines by that rate, so this tax would be filed under the wrong rate or as nil/exempt.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM ((invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
     JOIN invoice_items li ON ((li.invoice_id = i.id)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text])) AND ((li.rate * li.quantity) > (0)::numeric) AND (abs((((COALESCE(li.cgst_amount, (0)::numeric) + COALESCE(li.sgst_amount, (0)::numeric)) + COALESCE(li.igst_amount, (0)::numeric)) - (((li.rate * li.quantity) * COALESCE(li.gst_rate, (0)::numeric)) / (100)::numeric))) > 1.0))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'invoice_customer_gstin_stale'::text AS check_code,
        CASE
            WHEN (NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) IS NULL) THEN 'blocker'::text
            ELSE 'warning'::text
        END AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
        CASE
            WHEN (NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) IS NULL) THEN (('The invoice has no customer GSTIN, but the customer record now has '::text || c.gst_number) || ', so it would be filed as B2C instead of B2B. Use "Refresh from customer".'::text)
            ELSE (((('The invoice carries GSTIN '::text || i.customer_gst) || ' but the customer record now says '::text) || c.gst_number) || '. Check which is right, then refresh the invoice or correct the customer.'::text)
        END AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM ((invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
     JOIN customers c ON ((c.id = i.customer_id)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text) AND (NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NOT NULL) AND (upper(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text))) IS DISTINCT FROM upper(TRIM(BOTH FROM c.gst_number))) AND (NOT is_period_locked(i.entity_key, 'sales'::text, i.invoice_date)) AND (NOT (EXISTS ( SELECT 1
           FROM gst_filings f
          WHERE ((f.entity_key = i.entity_key) AND (f.return_type = 'gstr1'::text) AND (f.status = 'filed'::text) AND (f.period_start = (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date))))))
UNION ALL
 SELECT i.entity_key,
    (date_trunc('month'::text, (i.invoice_date)::timestamp with time zone))::date AS period_month,
    'invalid_gst_slab_rate'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    (((('A line carries a GST rate of '::text || (li.gst_rate)::text) || '% ('::text) || "left"(replace(COALESCE(li.description, ''::text), chr(10), ' '::text), 40)) || '). GSTR-1 only accepts the standard rates, so the portal would reject it. If the line is a free or token-priced add-on sold with another item, bundle it into that line; otherwise correct the line.'::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM ((invoices i
     JOIN entities e ON ((e.key = i.entity_key)))
     JOIN invoice_items li ON ((li.invoice_id = i.id)))
  WHERE (e.is_gst_registered AND (COALESCE(i.is_deleted, false) = false) AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text])) AND (li.bundled_into_item_id IS NULL) AND ((li.rate * li.quantity) > (0)::numeric) AND (COALESCE(li.gst_rate, (0)::numeric) <> ALL (ARRAY[(0)::numeric, 0.25, 1.5, (3)::numeric, (5)::numeric, (12)::numeric, (18)::numeric, (28)::numeric, (40)::numeric])));
