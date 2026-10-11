-- Bundled add-ons. A free or token-priced item sold in one bundle with another item is one supply and is
-- filed under the principal item's HSN and rate, with no quantity of its own. invoice_items.bundled_into_item_id
-- marks such a line; v_gst_outward_lines then reports the principal's HSN/rate and quantity 0 for it (taxable
-- value and tax are unchanged, so section totals do not move). Also adds the invalid_gst_slab_rate check:
-- a non-slab line rate (e.g. 17.65 from rounding a Rs 1 price) would be rejected by the GST portal.
alter table public.invoice_items
  add column if not exists bundled_into_item_id uuid references public.invoice_items(id) on delete set null;
alter table public.invoice_items drop constraint if exists invoice_items_bundle_not_self;
alter table public.invoice_items add constraint invoice_items_bundle_not_self check (bundled_into_item_id is null or bundled_into_item_id <> id);
create index if not exists invoice_items_bundled_into_idx on public.invoice_items (bundled_into_item_id) where bundled_into_item_id is not null;

create or replace view public.v_gst_outward_lines as
WITH ent AS (
         SELECT business_profiles.key,
            business_profiles.state_code,
            business_profiles.gstin,
            business_profiles.is_gst_registered
           FROM business_profiles
        )
 SELECT i.entity_key,
    e.state_code AS entity_state_code,
    i.invoice_date,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    i.id AS invoice_id,
    i.invoice_number,
    i.source,
    COALESCE(i.grand_total, 0::numeric) AS invoice_value,
    i.customer_id,
    COALESCE(i.customer_name, 'Unknown'::text) AS customer_name,
    NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) AS customer_gstin,
    c.gst_treatment,
    COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(i.place_of_supply, ''::text)), ''::text), substr(NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text), 1, 2), e.state_code) AS pos,
    li.id AS line_id,
    li.item_type,
    li.description,
    COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(pl.hsn_code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(psk.hsn_code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(psac.code, ''::text)), ''::text),
    NULLIF(TRIM(BOTH FROM COALESCE(li.hsn_code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(sk.hsn_code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(sac.code, ''::text)), ''::text),
        CASE li.item_type
            WHEN 'repair'::text THEN ( SELECT sac_codes.code
               FROM sac_codes
              WHERE sac_codes.code = '998713'::text AND sac_codes.is_active
             LIMIT 1)
            WHEN 'rental'::text THEN ( SELECT sac_codes.code
               FROM sac_codes
              WHERE sac_codes.code = '997315'::text AND sac_codes.is_active
             LIMIT 1)
            ELSE NULL::text
        END) AS hsn_code,
    NULLIF(TRIM(BOTH FROM COALESCE(li.hsn_code, ''::text)), ''::text) IS NULL AND NULLIF(TRIM(BOTH FROM COALESCE(sk.hsn_code, ''::text)), ''::text) IS NOT NULL AS hsn_from_sku_fallback,
    li.item_type = ANY (ARRAY['repair'::text, 'rental'::text]) AS is_service,
    CASE WHEN pl.id IS NOT NULL THEN 0::numeric ELSE COALESCE(li.quantity, 1::numeric) END AS quantity,
    COALESCE(li.rate, 0::numeric) AS rate,
    CASE WHEN pl.id IS NOT NULL THEN COALESCE(pl.gst_rate, 0::numeric) ELSE COALESCE(li.gst_rate, 0::numeric) END AS rt,
    round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) AS txval,
    COALESCE(li.cgst_amount, 0::numeric) AS camt,
    COALESCE(li.sgst_amount, 0::numeric) AS samt,
    COALESCE(li.igst_amount, 0::numeric) AS iamt,
    0::numeric AS csamt,
    NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) IS NOT NULL AS is_b2b,
    COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(i.place_of_supply, ''::text)), ''::text), substr(NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text), 1, 2), e.state_code) = e.state_code AS is_intra_state,
        CASE
            WHEN NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) IS NOT NULL THEN 'b2b'::text
            WHEN COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(i.place_of_supply, ''::text)), ''::text), e.state_code) <> e.state_code AND COALESCE(i.grand_total, 0::numeric) >
            CASE
                WHEN i.invoice_date >= '2024-08-01'::date THEN 100000
                ELSE 250000
            END::numeric THEN 'b2cl'::text
            ELSE 'b2cs'::text
        END AS gstr1_section,
        CASE
            WHEN COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(i.place_of_supply, ''::text)), ''::text), substr(NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text), 1, 2), e.state_code) = e.state_code THEN 'INTRA'::text
            ELSE 'INTER'::text
        END AS sply_ty,
    COALESCE(i.invoice_type, 'sales'::text) AS doc_type,
        CASE
            WHEN COALESCE(i.invoice_type, 'sales'::text) = 'credit_note'::text THEN '-1'::integer
            ELSE 1
        END AS sign,
    round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) *
        CASE
            WHEN COALESCE(i.invoice_type, 'sales'::text) = 'credit_note'::text THEN '-1'::integer
            ELSE 1
        END::numeric AS txval_signed,
    COALESCE(li.cgst_amount, 0::numeric) *
        CASE
            WHEN COALESCE(i.invoice_type, 'sales'::text) = 'credit_note'::text THEN '-1'::integer
            ELSE 1
        END::numeric AS camt_signed,
    COALESCE(li.sgst_amount, 0::numeric) *
        CASE
            WHEN COALESCE(i.invoice_type, 'sales'::text) = 'credit_note'::text THEN '-1'::integer
            ELSE 1
        END::numeric AS samt_signed,
    COALESCE(li.igst_amount, 0::numeric) *
        CASE
            WHEN COALESCE(i.invoice_type, 'sales'::text) = 'credit_note'::text THEN '-1'::integer
            ELSE 1
        END::numeric AS iamt_signed
   FROM invoices i
     JOIN ent e ON e.key = i.entity_key
     JOIN invoice_items li ON li.invoice_id = i.id
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN sku_master sk ON sk.id = COALESCE(li.sku_id, li.accessory_id)
     LEFT JOIN sac_codes sac ON sac.id = sk.sac_code_id
     LEFT JOIN invoice_items pl ON pl.id = li.bundled_into_item_id
     LEFT JOIN sku_master psk ON psk.id = COALESCE(pl.sku_id, pl.accessory_id)
     LEFT JOIN sac_codes psac ON psac.id = psk.sac_code_id
  WHERE COALESCE(i.is_deleted, false) = false AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text])) AND e.is_gst_registered;

create or replace view public.v_gst_exceptions as
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
                    WHEN lower(TRIM(BOTH FROM COALESCE(s.payment_account, ''::text))) = ANY (ARRAY['digitalbluez'::text, 'techtenth'::text, 'cash'::text]) THEN lower(TRIM(BOTH FROM s.payment_account))
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
                  WHERE s2.entity_key = g.entity_key AND s2.series_key = g.series_key AND s2.seq < g.missing_seq) AS period_month
           FROM ( SELECT s.entity_key,
                    s.series_key,
                    generate_series(min(s.seq), max(s.seq)) AS missing_seq
                   FROM series s
                  WHERE s.seq IS NOT NULL
                  GROUP BY s.entity_key, s.series_key) g
          WHERE NOT (EXISTS ( SELECT 1
                   FROM series s3
                  WHERE s3.entity_key = g.entity_key AND s3.series_key = g.series_key AND s3.seq = g.missing_seq))
        )
 SELECT e.key AS entity_key,
    g.period_month,
    'doc_series_gap'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'series'::text AS record_type,
    NULL::uuid AS record_id,
    g.series_key || g.missing_seq AS record_label,
    (('Invoice number '::text || g.series_key) || g.missing_seq) || ' is missing from the series. Table 13 needs every number accounted for as either issued or cancelled -- this is either a cancelled invoice or one never recorded in the ERP.'::text AS detail,
    g.series_key,
    g.missing_seq AS seq
   FROM series_gaps g
     JOIN entities e ON e.key = g.entity_key
  WHERE e.is_gst_registered AND NOT (EXISTS ( SELECT 1
           FROM gst_void_invoice_numbers v
          WHERE v.entity_key = g.entity_key AND v.series_key = g.series_key AND v.seq = g.missing_seq))
UNION ALL
 SELECT i.entity_key,
    i.period_month,
    'invoice_number_too_long'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    ('Invoice number is '::text || length(i.invoice_number)) || ' characters. The GST portal rejects anything over 16.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM v_gst_invoice_series i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND NOT i.cancelled AND length(i.invoice_number) > 16
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
   FROM v_gst_invoice_series i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND NOT i.cancelled AND i.invoice_number ~ '[^A-Za-z0-9/-]'::text
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
   FROM v_gst_invoice_series i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND NOT i.cancelled AND (EXISTS ( SELECT 1
           FROM v_gst_invoice_series d
          WHERE d.entity_key = i.entity_key AND d.invoice_number = i.invoice_number AND d.id <> i.id AND NOT d.cancelled))
UNION ALL
 SELECT s.entity_key,
    date_trunc('month'::text, s.effective_sale_date::timestamp with time zone)::date AS period_month,
    'voided_sale_with_live_invoice'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'sale'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.customer_name, s.id::text) AS record_label,
    'Sale was voided but its invoice is still live, so the return reports a supply that was reversed. Needs a credit note.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sale_entity s
     JOIN entities e ON e.key = s.entity_key
  WHERE e.is_gst_registered AND COALESCE(s.is_deleted, false) = true AND s.invoice_id IS NOT NULL
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'zero_gst_on_gst_entity'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    ('Taxable value of '::text || to_char(COALESCE(i.subtotal, 0::numeric), 'FM999999990.00'::text)) || ' carries no GST on a GST-registered entity. Either exempt/nil-rated and needs to be reported as such, or output tax is missing.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text AND COALESCE(i.subtotal, 0::numeric) > 0::numeric AND COALESCE(i.total_gst, 0::numeric) = 0::numeric
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'tax_computation_mismatch'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    ((((('Tax of '::text || to_char(COALESCE(i.total_gst, 0::numeric), 'FM999999990.00'::text)) || ' on '::text) || to_char(COALESCE(i.subtotal, 0::numeric), 'FM999999990.00'::text)) || ' implies '::text) || to_char(round(COALESCE(i.total_gst, 0::numeric) / NULLIF(i.subtotal, 0::numeric) * 100::numeric, 2), 'FM990.00'::text)) || '%, which is not a GST slab rate.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text AND COALESCE(i.subtotal, 0::numeric) > 0::numeric AND COALESCE(i.total_gst, 0::numeric) > 0::numeric AND (round(COALESCE(i.total_gst, 0::numeric) / NULLIF(i.subtotal, 0::numeric) * 100::numeric, 2) <> ALL (ARRAY[0::numeric, 0.25, 1.5, 3::numeric, 5::numeric, 12::numeric, 18::numeric, 28::numeric, 40::numeric]))
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'value_mismatch'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    ('Grand total does not equal taxable value plus tax (off by '::text || to_char(abs(COALESCE(i.grand_total, 0::numeric) - (COALESCE(i.subtotal, 0::numeric) + COALESCE(i.total_gst, 0::numeric))), 'FM999999990.00'::text)) || ').'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text AND abs(COALESCE(i.grand_total, 0::numeric) - (COALESCE(i.subtotal, 0::numeric) + COALESCE(i.total_gst, 0::numeric))) > 0.05
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'wrong_tax_type'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    ((((('Place of supply '::text || COALESCE(i.place_of_supply, '(none)'::text)) || ' against entity state '::text) || COALESCE(e.state_code, '?'::text)) || ' but the line charges '::text) ||
        CASE
            WHEN COALESCE(li.igst_amount, 0::numeric) > 0::numeric THEN 'IGST'::text
            ELSE 'CGST+SGST'::text
        END) || '.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
     JOIN invoice_items li ON li.invoice_id = i.id
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text AND i.place_of_supply IS NOT NULL AND (i.place_of_supply = e.state_code AND COALESCE(li.igst_amount, 0::numeric) > 0::numeric OR i.place_of_supply <> e.state_code AND (COALESCE(li.cgst_amount, 0::numeric) > 0::numeric OR COALESCE(li.sgst_amount, 0::numeric) > 0::numeric))
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'missing_place_of_supply'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    'No place of supply recorded, so the CGST/SGST-versus-IGST split cannot be justified.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text AND NULLIF(TRIM(BOTH FROM COALESCE(i.place_of_supply, ''::text)), ''::text) IS NULL
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'eway_bill_missing'::text AS check_code,
    'warning'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    ('Invoice value is '::text || to_char(COALESCE(i.grand_total, 0::numeric), 'FM999999990.00'::text)) || '. Movement of goods over 50,000 in Uttar Pradesh needs an e-way bill.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text AND COALESCE(i.grand_total, 0::numeric) > 50000::numeric AND NULLIF(TRIM(BOTH FROM COALESCE(i.eway_bill_number, ''::text)), ''::text) IS NULL
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'invalid_gstin_format'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    ('Customer GSTIN '::text || i.customer_gst) || ' fails the check-digit test, so the portal will reject this B2B row.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text AND NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) IS NOT NULL AND NOT gstin_is_valid(i.customer_gst)
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'gstin_state_mismatch'::text AS check_code,
    'warning'::text AS severity,
    'transactions'::text AS check_group,
    'customer'::text AS record_type,
    c.id AS record_id,
    c.customer_name AS record_label,
    ((('GSTIN starts with '::text || substr(TRIM(BOTH FROM c.gst_number), 1, 2)) || ' but the customer record says state '::text) || TRIM(BOTH FROM c.state_code)) || '. Place of supply resolves from the GSTIN first, so the state field is what is wrong.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM customers c
  WHERE COALESCE(c.is_deleted, false) = false AND NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NOT NULL AND NULLIF(TRIM(BOTH FROM COALESCE(c.state_code, ''::text)), ''::text) IS NOT NULL AND substr(TRIM(BOTH FROM c.gst_number), 1, 2) <> TRIM(BOTH FROM c.state_code)
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
  WHERE COALESCE(c.is_deleted, false) = false AND NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NOT NULL AND c.gst_number <> TRIM(BOTH FROM c.gst_number)
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
  WHERE COALESCE(c.is_deleted, false) = false AND NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NULL AND NULLIF(TRIM(BOTH FROM COALESCE(c.state_code, ''::text)), ''::text) IS NULL AND (EXISTS ( SELECT 1
           FROM sales sx
          WHERE sx.customer_id = c.id AND COALESCE(sx.is_deleted, false) = false))
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
  WHERE COALESCE(c.is_deleted, false) = false AND (c.gst_treatment = ANY (ARRAY['registered_regular'::text, 'registered_composition'::text])) AND NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NULL
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'missing_hsn'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, s.id::text) AS record_label,
    'No HSN code. Table 12 is mandatory and the portal now validates HSN against its own master, so this SKU cannot be reported.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sku_master s
  WHERE s.category <> 'SERVICE'::text AND NULLIF(TRIM(BOTH FROM COALESCE(s.hsn_code, ''::text)), ''::text) IS NULL AND (EXISTS ( SELECT 1
           FROM invoice_items li
          WHERE li.sku_id = s.id))
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'hsn_too_short'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, s.id::text) AS record_label,
    ('HSN '::text || s.hsn_code) || ' is shorter than the 4 digits required at this turnover.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sku_master s
  WHERE s.category <> 'SERVICE'::text AND NULLIF(TRIM(BOTH FROM COALESCE(s.hsn_code, ''::text)), ''::text) IS NOT NULL AND length(regexp_replace(s.hsn_code, '[^0-9]'::text, ''::text, 'g'::text)) < 4
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'hsn_not_numeric'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, s.id::text) AS record_label,
    ('HSN '::text || s.hsn_code) || ' contains non-numeric characters.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sku_master s
  WHERE NULLIF(TRIM(BOTH FROM COALESCE(s.hsn_code, ''::text)), ''::text) IS NOT NULL AND s.hsn_code ~ '[^0-9]'::text
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'service_without_sac'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    s.id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, s.id::text) AS record_label,
    'Service SKU has no SAC code. A supply of service needs a SAC, not a goods HSN.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM sku_master s
  WHERE s.category = 'SERVICE'::text AND s.sac_code_id IS NULL
UNION ALL
 SELECT o.entity_key,
    o.period_month,
    'invoice_line_hsn_unresolvable'::text AS check_code,
    'blocker'::text AS severity,
    'hsn_summary'::text AS check_group,
    'invoice'::text AS record_type,
    o.invoice_id AS record_id,
    (o.invoice_number || ' — '::text) || "left"(o.description, 40) AS record_label,
    ((('No HSN/SAC on the line, its SKU, or any linked SAC, so '::text || to_char(o.txval, 'FM999999990.00'::text)) || ' of taxable value is missing from Table 12 while still '::text) || 'reported in Tables 4/5/7.'::text) ||
        CASE
            WHEN o.item_type = 'repair'::text THEN ' Computer repair is normally SAC 998713 -- confirm with your CA before applying it.'::text
            WHEN o.item_type = 'rental'::text THEN ' Computer rental is SAC 997315.'::text
            ELSE ' Set an HSN on the SKU in SKU Master.'::text
        END AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM v_gst_outward_lines o
  WHERE o.hsn_code IS NULL
UNION ALL
 SELECT 'digitalbluez'::text AS entity_key,
    NULL::date AS period_month,
    'hsn_inconsistent_for_sku'::text AS check_code,
    'warning'::text AS severity,
    'hsn_summary'::text AS check_group,
    'sku'::text AS record_type,
    li.sku_id AS record_id,
    COALESCE(s.full_sku_code, s.sku_description, li.sku_id::text) AS record_label,
    'Invoiced under more than one HSN: '::text || string_agg(DISTINCT li.hsn_code, ', '::text) AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoice_items li
     JOIN sku_master s ON s.id = li.sku_id
  WHERE li.sku_id IS NOT NULL AND NULLIF(TRIM(BOTH FROM COALESCE(li.hsn_code, ''::text)), ''::text) IS NOT NULL
  GROUP BY li.sku_id, s.full_sku_code, s.sku_description
 HAVING count(DISTINCT li.hsn_code) > 1
UNION ALL
 SELECT COALESCE(e.entity_key, 'digitalbluez'::text) AS entity_key,
    date_trunc('month'::text, e.expense_date::timestamp with time zone)::date AS period_month,
    'rcm_credit_unclaimed'::text AS check_code,
    'warning'::text AS severity,
    'transactions'::text AS check_group,
    'expense'::text AS record_type,
    e.id AS record_id,
    "left"(COALESCE(e.description, 'Expense'::text), 60) AS record_label,
    ('Reverse charge of '::text || to_char(COALESCE(e.gst_amount, 0::numeric), 'FM999999990.00'::text)) || ' is recorded as owed but not claimed back. The liability lands in 3B 3.1(d) either way; the matching credit only reaches 4A once it is marked claimed.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM expenses e
  WHERE COALESCE(e.is_deleted, false) = false AND (e.supply_type = ANY (ARRAY['rcm_domestic'::text, 'rcm_import_services'::text])) AND COALESCE(e.gst_amount, 0::numeric) > 0::numeric AND COALESCE(e.itc_status, 'pending'::text) = 'pending'::text
UNION ALL
 SELECT p.entity_key,
    p.period_month,
    'zoho_register_not_uploaded'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'series'::text AS record_type,
    NULL::uuid AS record_id,
    to_char(p.period_month::timestamp with time zone, 'Mon YYYY'::text) AS record_label,
    p.status ->> 'reason'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM ( SELECT a.entity_key,
            a.period_month,
            gst_zoho_register_status(a.entity_key, a.period_month, (a.period_month + '1 mon -1 days'::interval)::date) AS status
           FROM ( SELECT i.entity_key,
                    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month
                   FROM invoices i
                     JOIN business_profiles b ON b.key = i.entity_key
                  WHERE b.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text]))
                UNION
                 SELECT se.entity_key,
                    date_trunc('month'::text, se.effective_sale_date::timestamp with time zone)::date AS date_trunc
                   FROM sale_entity se
                     JOIN business_profiles b2 ON b2.key = se.entity_key
                  WHERE b2.is_gst_registered AND COALESCE(se.is_deleted, false) = false AND COALESCE(se.sale_type, ''::text) = 'GST'::text) a) p
  WHERE ((p.status ->> 'uploaded'::text)::boolean) = false
UNION ALL
 SELECT p.entity_key,
    p.period_month,
    'zoho_register_unreconciled'::text AS check_code,
    'blocker'::text AS severity,
    'document_summary'::text AS check_group,
    'series'::text AS record_type,
    NULL::uuid AS record_id,
    to_char(p.period_month::timestamp with time zone, 'Mon YYYY'::text) AS record_label,
    p.status ->> 'reason'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM ( SELECT a.entity_key,
            a.period_month,
            gst_zoho_register_status(a.entity_key, a.period_month, (a.period_month + '1 mon -1 days'::interval)::date) AS status
           FROM ( SELECT i.entity_key,
                    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month
                   FROM invoices i
                     JOIN business_profiles b ON b.key = i.entity_key
                  WHERE b.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text]))) a) p
  WHERE ((p.status ->> 'uploaded'::text)::boolean) = true AND ((p.status ->> 'reconciled'::text)::boolean) = false
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'line_gst_rate_mismatch'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    (i.invoice_number || ' — '::text) || "left"(li.description, 40) AS record_label,
    ((((((('Line carries tax of '::text || to_char(COALESCE(li.cgst_amount, 0::numeric) + COALESCE(li.sgst_amount, 0::numeric) + COALESCE(li.igst_amount, 0::numeric), 'FM999999990.00'::text)) || ' on '::text) || to_char(li.rate * li.quantity, 'FM999999990.00'::text)) || ' ('::text) || to_char(round((COALESCE(li.cgst_amount, 0::numeric) + COALESCE(li.sgst_amount, 0::numeric) + COALESCE(li.igst_amount, 0::numeric)) / (li.rate * li.quantity) * 100::numeric, 2), 'FM990.00'::text)) || '%) but its rate field says '::text) || COALESCE(li.gst_rate, 0::numeric)) || '%. Returns group lines by that rate, so this tax would be filed under the wrong rate or as nil/exempt.'::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
     JOIN invoice_items li ON li.invoice_id = i.id
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text])) AND (li.rate * li.quantity) > 0::numeric AND abs(COALESCE(li.cgst_amount, 0::numeric) + COALESCE(li.sgst_amount, 0::numeric) + COALESCE(li.igst_amount, 0::numeric) - li.rate * li.quantity * COALESCE(li.gst_rate, 0::numeric) / 100::numeric) > 1.0
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'invoice_customer_gstin_stale'::text AS check_code,
        CASE
            WHEN NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) IS NULL THEN 'blocker'::text
            ELSE 'warning'::text
        END AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
        CASE
            WHEN NULLIF(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text)), ''::text) IS NULL THEN ('The invoice has no customer GSTIN, but the customer record now has '::text || c.gst_number) || ', so it would be filed as B2C instead of B2B. Use "Refresh from customer".'::text
            ELSE ((('The invoice carries GSTIN '::text || i.customer_gst) || ' but the customer record now says '::text) || c.gst_number) || '. Check which is right, then refresh the invoice or correct the customer.'::text
        END AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
     JOIN customers c ON c.id = i.customer_id
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false AND COALESCE(i.invoice_type, 'sales'::text) = 'sales'::text AND NULLIF(TRIM(BOTH FROM COALESCE(c.gst_number, ''::text)), ''::text) IS NOT NULL AND upper(TRIM(BOTH FROM COALESCE(i.customer_gst, ''::text))) IS DISTINCT FROM upper(TRIM(BOTH FROM c.gst_number)) AND NOT is_period_locked(i.entity_key, 'sales'::text, i.invoice_date) AND NOT (EXISTS ( SELECT 1
           FROM gst_filings f
          WHERE f.entity_key = i.entity_key AND f.return_type = 'gstr1'::text AND f.status = 'filed'::text AND f.period_start = date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date))
UNION ALL
 SELECT i.entity_key,
    date_trunc('month'::text, i.invoice_date::timestamp with time zone)::date AS period_month,
    'invalid_gst_slab_rate'::text AS check_code,
    'blocker'::text AS severity,
    'transactions'::text AS check_group,
    'invoice'::text AS record_type,
    i.id AS record_id,
    i.invoice_number AS record_label,
    ('A line carries a GST rate of ' || li.gst_rate::text || '% (' || left(replace(COALESCE(li.description, ''), chr(10), ' '), 40) || '). GSTR-1 only accepts the standard rates, so the portal would reject it. If the line is a free or token-priced add-on sold with another item, bundle it into that line; otherwise correct the line.')::text AS detail,
    NULL::text AS series_key,
    NULL::bigint AS seq
   FROM invoices i
     JOIN entities e ON e.key = i.entity_key
     JOIN invoice_items li ON li.invoice_id = i.id
  WHERE e.is_gst_registered AND COALESCE(i.is_deleted, false) = false
    AND (COALESCE(i.invoice_type, 'sales'::text) = ANY (ARRAY['sales'::text, 'credit_note'::text]))
    AND li.bundled_into_item_id IS NULL
    AND (li.rate * li.quantity) > 0::numeric
    AND COALESCE(li.gst_rate, 0::numeric) <> ALL (ARRAY[0, 0.25, 1.5, 3, 5, 12, 18, 28, 40]::numeric[])
;

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
  v_ecc int := 0; v_ecs int := 0; v_eci int := 0; v_zcc int := 0; v_zcs int := 0; v_zci int := 0;
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
      ('line_gst_rate_mismatch',3),('invoice_customer_gstin_stale',3),('invalid_gst_slab_rate',3),
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

  select count(*) filter (where t.c > 0), count(*) filter (where t.s > 0), count(*) filter (where t.g > 0)
    into v_ecc, v_ecs, v_eci
  from (
    select i.id, coalesce(sum(li.cgst_amount), 0) c, coalesce(sum(li.sgst_amount), 0) s, coalesce(sum(li.igst_amount), 0) g
    from invoices i join invoice_items li on li.invoice_id = i.id
    where i.entity_key = p_entity_key and coalesce(i.is_deleted, false) = false
      and coalesce(i.invoice_type, 'sales') = 'sales' and i.invoice_date between p_from and p_to
    group by i.id
  ) t;

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
      count(*) filter (where l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')),
      count(*) filter (where coalesce(l.cgst, 0) > 0 and l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')),
      count(*) filter (where coalesce(l.sgst, 0) > 0 and l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored')),
      count(*) filter (where coalesce(l.igst, 0) > 0 and l.match_status <> 'missing_in_source' and not (l.match_status = 'missing_in_erp' and l.resolution = 'ignored'))
    into v_amt, v_head, v_ms, v_zc, v_zs, v_zi, v_zign, v_zcnt, v_zcc, v_zcs, v_zci
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

  v_detail[5] := jsonb_build_object('head_unresolved', v_head, 'zoho_ignored_tax', v_zign, 'erp_head_counts', jsonb_build_object('cgst', v_ecc, 'sgst', v_ecs, 'igst', v_eci), 'zoho_head_counts', jsonb_build_object('cgst', v_zcc, 'sgst', v_zcs, 'igst', v_zci), 'erp_invoice_count', v_ecnt, 'zoho_invoice_count', v_zcnt,
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
$function$;
