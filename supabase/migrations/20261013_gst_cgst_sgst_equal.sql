-- The portal rejected the three B2B invoices (726, 736, 741) whose lines had CGST and SGST a paisa or two apart
-- (e.g. 4230.08 / 4230.07). On a line the two must be equal, so for intra-state lines whose stored CGST/SGST differ
-- only by rounding (total within 5 paise of 2 x rate-based half-tax) both are reported as that half-tax.
-- Sections, Table 12 and 3B all read this view, so they stay consistent with each other.
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
    COALESCE(NULLIF(TRIM(BOTH FROM COALESCE(pl.hsn_code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(psk.hsn_code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(psac.code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(li.hsn_code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(sk.hsn_code, ''::text)), ''::text), NULLIF(TRIM(BOTH FROM COALESCE(sac.code, ''::text)), ''::text),
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
        CASE
            WHEN pl.id IS NOT NULL THEN 0::numeric
            ELSE COALESCE(li.quantity, 1::numeric)
        END AS quantity,
    COALESCE(li.rate, 0::numeric) AS rate,
        CASE
            WHEN pl.id IS NOT NULL THEN COALESCE(pl.gst_rate, 0::numeric)
            ELSE COALESCE(li.gst_rate, 0::numeric)
        END AS rt,
    round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) AS txval,
    (CASE WHEN COALESCE(li.cgst_amount, 0::numeric) > 0::numeric AND (CASE WHEN COALESCE(li.cgst_amount, 0::numeric) > 0::numeric AND COALESCE(li.sgst_amount, 0::numeric) > 0::numeric AND li.cgst_amount <> li.sgst_amount AND abs(li.cgst_amount + li.sgst_amount - 2 * round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2)) <= 0.05 THEN round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2) ELSE COALESCE(li.sgst_amount, 0::numeric) END) > 0::numeric AND li.cgst_amount <> li.sgst_amount AND abs(li.cgst_amount + li.sgst_amount - 2 * round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2)) <= 0.05 THEN round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2) ELSE COALESCE(li.cgst_amount, 0::numeric) END) AS camt,
    (CASE WHEN COALESCE(li.cgst_amount, 0::numeric) > 0::numeric AND COALESCE(li.sgst_amount, 0::numeric) > 0::numeric AND li.cgst_amount <> li.sgst_amount AND abs(li.cgst_amount + li.sgst_amount - 2 * round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2)) <= 0.05 THEN round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2) ELSE COALESCE(li.sgst_amount, 0::numeric) END) AS samt,
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
    (CASE WHEN COALESCE(li.cgst_amount, 0::numeric) > 0::numeric AND (CASE WHEN COALESCE(li.cgst_amount, 0::numeric) > 0::numeric AND COALESCE(li.sgst_amount, 0::numeric) > 0::numeric AND li.cgst_amount <> li.sgst_amount AND abs(li.cgst_amount + li.sgst_amount - 2 * round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2)) <= 0.05 THEN round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2) ELSE COALESCE(li.sgst_amount, 0::numeric) END) > 0::numeric AND li.cgst_amount <> li.sgst_amount AND abs(li.cgst_amount + li.sgst_amount - 2 * round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2)) <= 0.05 THEN round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2) ELSE COALESCE(li.cgst_amount, 0::numeric) END) *
        CASE
            WHEN COALESCE(i.invoice_type, 'sales'::text) = 'credit_note'::text THEN '-1'::integer
            ELSE 1
        END::numeric AS camt_signed,
    (CASE WHEN COALESCE(li.cgst_amount, 0::numeric) > 0::numeric AND COALESCE(li.sgst_amount, 0::numeric) > 0::numeric AND li.cgst_amount <> li.sgst_amount AND abs(li.cgst_amount + li.sgst_amount - 2 * round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2)) <= 0.05 THEN round(round(COALESCE(li.quantity, 1::numeric) * COALESCE(li.rate, 0::numeric), 2) * COALESCE(li.gst_rate, 0::numeric) / 200, 2) ELSE COALESCE(li.sgst_amount, 0::numeric) END) *
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
