


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."asset_status_enum" AS ENUM (
    'reserved',
    'received',
    'in_stock',
    'sold',
    'faulty',
    'returned'
);


ALTER TYPE "public"."asset_status_enum" OWNER TO "postgres";


CREATE TYPE "public"."movement_type_enum" AS ENUM (
    'receipt',
    'sale',
    'adjustment',
    'damage',
    'return'
);


ALTER TYPE "public"."movement_type_enum" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_warranty_expiry"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.warranty_start_date IS NOT NULL AND NEW.warranty_duration_months IS NOT NULL THEN
    NEW.warranty_expiry_date := (NEW.warranty_start_date + (NEW.warranty_duration_months || ' months')::interval)::date;
  ELSE
    NEW.warranty_expiry_date := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."compute_warranty_expiry"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  next_num INT;
  current_year TEXT;
BEGIN
  IF prefix = 'TTAS' THEN
    current_year := TO_CHAR(NOW(), 'YY');
    SELECT COALESCE(MAX(CAST(SUBSTRING(asset_number FROM '-(\d+)$') AS INT)), 0) + 1 INTO next_num
    FROM assets
    WHERE asset_number LIKE 'TTAS' || current_year || '-%';
    RETURN 'TTAS' || current_year || '-' || next_num;
  ELSE
    SELECT COALESCE(MAX(CAST(SUBSTRING(asset_number FROM '[0-9]+$') AS INT)), 0) + 1 INTO next_num
    FROM assets
    WHERE asset_number LIKE prefix || '%';
    RETURN prefix || next_num;
  END IF;
END;
$_$;


ALTER FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_po_number"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  current_year INT := EXTRACT(YEAR FROM CURRENT_DATE);
  next_num INT;
BEGIN
  INSERT INTO po_counter (year, last_number) VALUES (current_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_number = po_counter.last_number + 1
  RETURNING last_number INTO next_num;
  RETURN 'PO-' || current_year || '-' || LPAD(next_num::TEXT, 3, '0');
END;
$$;


ALTER FUNCTION "public"."generate_po_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_repair_job_number"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  cur_year text := to_char(current_date, 'YY');
  next_num integer;
begin
  insert into public.repair_job_counter (year, last_number)
  values (cur_year, 1)
  on conflict (year) do update set last_number = repair_job_counter.last_number + 1
  returning last_number into next_num;

  return 'RPR-' || cur_year || '-' || lpad(next_num::text, 3, '0');
end;
$$;


ALTER FUNCTION "public"."generate_repair_job_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_vendor_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.vendor_code := 'VEND-' || LPAD(nextval('vendor_code_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."generate_vendor_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  new_number INTEGER;
BEGIN
  INSERT INTO invoice_sequences (prefix, financial_year, last_number)
  VALUES (p_prefix, p_financial_year, 1)
  ON CONFLICT (prefix, financial_year)
  DO UPDATE SET last_number = invoice_sequences.last_number + 1
  RETURNING last_number INTO new_number;

  RETURN p_prefix || '/' || p_financial_year || '/' || LPAD(new_number::TEXT, 4, '0');
END;
$$;


ALTER FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner' and is_active = true
  );
$$;


ALTER FUNCTION "public"."is_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_document_number"("p_entity_key" "text", "p_doc_type" "text", "p_financial_year" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_prefix text;
  v_format text;
  v_next integer;
  v_fy_display text;
  v_result text;
BEGIN
  IF p_doc_type = 'quotation' THEN
    SELECT quotation_prefix, invoice_number_format INTO v_prefix, v_format FROM business_profiles WHERE key = p_entity_key;
  ELSIF p_doc_type = 'proforma' THEN
    SELECT proforma_prefix, invoice_number_format INTO v_prefix, v_format FROM business_profiles WHERE key = p_entity_key;
  ELSE
    SELECT invoice_prefix, invoice_number_format INTO v_prefix, v_format FROM business_profiles WHERE key = p_entity_key;
  END IF;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'No invoice_prefix configured for entity %', p_entity_key;
  END IF;

  INSERT INTO invoice_sequences (entity_key, doc_type, financial_year, last_number, prefix)
  VALUES (p_entity_key, p_doc_type, p_financial_year, 1, NULL)
  ON CONFLICT (entity_key, doc_type, financial_year)
  DO UPDATE SET last_number = invoice_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  v_fy_display := replace(p_financial_year, '-', '/');

  v_result := replace(v_format, '{prefix}', v_prefix);
  v_result := replace(v_result, '{fy}', v_fy_display);
  v_result := replace(v_result, '{seq:5}', lpad(v_next::text, 5, '0'));

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."next_document_number"("p_entity_key" "text", "p_doc_type" "text", "p_financial_year" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) RETURNS "text"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  cur_full TEXT := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  cur_suffix TEXT := RIGHT(cur_full, 2);               -- default two-digit year
  custom_suffix TEXT;
  next_num INT;
  assets TEXT[] := '{}';
  asset_num TEXT;
  i INT;
BEGIN
  -- Fetch the custom year suffix (if any) for this prefix and current year
  SELECT year_suffix INTO custom_suffix FROM asset_counters
  WHERE prefix = p_prefix AND year = cur_full;

  -- If no custom suffix, fall back to the current year's two-digit suffix
  IF custom_suffix IS NULL THEN
    custom_suffix := cur_suffix;
  END IF;

  -- Reserve the next sequence numbers
  INSERT INTO asset_counters (prefix, year, last_number)
  VALUES (p_prefix, cur_full, qty)
  ON CONFLICT (prefix, year) DO UPDATE SET last_number = asset_counters.last_number + qty
  RETURNING last_number - qty + 1 INTO next_num;

  -- Generate asset numbers: always use prefix + suffix + '-' + sequence
  FOR i IN 0..qty-1 LOOP
    asset_num := p_prefix || custom_suffix || '-' || (next_num + i);
    assets := array_append(assets, asset_num);
  END LOOP;

  RETURN assets;
END;
$$;


ALTER FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_sku_stock_from_movement"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_after integer;
BEGIN
  UPDATE sku_master
  SET quantity_in_stock = GREATEST(0, quantity_in_stock + NEW.quantity_change)
  WHERE id = NEW.sku_id
  RETURNING quantity_in_stock INTO v_after;

  IF v_after IS NULL THEN
    RAISE EXCEPTION 'sync_sku_stock_from_movement: sku_master row % not found', NEW.sku_id;
  END IF;

  NEW.quantity_after := v_after;
  NEW.quantity_before := v_after - NEW.quantity_change;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_sku_stock_from_movement"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_migration_tracking" (
    "old_purchase_id" "uuid" NOT NULL,
    "new_po_id" "uuid",
    "migrated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."_migration_tracking" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "status" "text" DEFAULT 'pending'::"text",
    "due_date" timestamp with time zone,
    "reminder_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_reminder_sent" timestamp with time zone,
    CONSTRAINT "activities_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'done'::"text"])))
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_cost_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "reason" "text",
    "added_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."asset_cost_adjustments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_counters" (
    "prefix" "text" NOT NULL,
    "year" "text" NOT NULL,
    "last_number" integer DEFAULT 0,
    "year_suffix" "text"
);


ALTER TABLE "public"."asset_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_ledger" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "po_id" "uuid",
    "po_item_id" "uuid",
    "sku_id" "uuid" NOT NULL,
    "asset_number" "text",
    "serial_number" "text",
    "status" "text" DEFAULT 'reserved'::"text",
    "reserved_at" timestamp with time zone DEFAULT "now"(),
    "received_at" timestamp with time zone,
    "sold_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "source" "text" DEFAULT 'purchase_order'::"text" NOT NULL,
    "legacy_purchase_id" "uuid",
    "vendor_id" "uuid",
    "purchased_by_type" "text",
    "cost_price" numeric,
    "gst_percentage" numeric,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_remarks" "text",
    "qc_grade" "text",
    "qc_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "qc_notes" "text",
    "qc_by" "uuid",
    "qc_at" timestamp with time zone,
    "warranty_type" "text",
    "warranty_start_date" "date",
    "warranty_duration_months" integer,
    "warranty_expiry_date" "date",
    "entered_by" "uuid",
    "owner_reviewed_at" timestamp with time zone,
    "legacy_asset_number" "text",
    CONSTRAINT "asset_ledger_qc_grade_check" CHECK (("qc_grade" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text", 'D'::"text", 'Scrap'::"text"]))),
    CONSTRAINT "asset_ledger_qc_status_check" CHECK (("qc_status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'passed'::"text", 'failed'::"text"]))),
    CONSTRAINT "asset_ledger_source_check" CHECK (("source" = ANY (ARRAY['purchase_order'::"text", 'legacy_purchase'::"text", 'employee_intake'::"text"]))),
    CONSTRAINT "asset_ledger_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'reserved'::"text", 'received'::"text", 'in_stock'::"text", 'sold'::"text", 'faulty'::"text", 'returned'::"text", 'qc_pending'::"text", 'qc_passed'::"text", 'ready_for_sale'::"text", 'rma_sent'::"text", 'rma_returned'::"text", 'scrapped'::"text", 'pending_sale'::"text", 'pending_replacement'::"text"]))),
    CONSTRAINT "asset_ledger_warranty_type_check" CHECK (("warranty_type" = ANY (ARRAY['none'::"text", 'vendor'::"text", 'in_house'::"text"])))
);


ALTER TABLE "public"."asset_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_qc_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "check_item" "text" NOT NULL,
    "result" "text" NOT NULL,
    "notes" "text",
    "checked_by" "uuid",
    "checked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "asset_qc_checks_result_check" CHECK (("result" = ANY (ARRAY['pass'::"text", 'fail'::"text", 'na'::"text"])))
);


ALTER TABLE "public"."asset_qc_checks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_rma_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "direction" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "vendor_id" "uuid",
    "status" "text" DEFAULT 'initiated'::"text" NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closed_at" timestamp with time zone,
    "notes" "text",
    "created_by" "uuid",
    CONSTRAINT "asset_rma_events_direction_check" CHECK (("direction" = ANY (ARRAY['to_vendor'::"text", 'from_customer'::"text"]))),
    CONSTRAINT "asset_rma_events_status_check" CHECK (("status" = ANY (ARRAY['initiated'::"text", 'shipped'::"text", 'vendor_accepted'::"text", 'vendor_rejected'::"text", 'replacement_received'::"text", 'refund_received'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."asset_rma_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "legal_name" "text" NOT NULL,
    "address" "text",
    "state" "text",
    "state_code" "text",
    "gstin" "text",
    "is_gst_registered" boolean DEFAULT false NOT NULL,
    "logo_url" "text",
    "signature_url" "text",
    "stamp_url" "text",
    "bank_details" "jsonb",
    "contact" "jsonb",
    "invoice_prefix" "text",
    "invoice_number_format" "text",
    "default_terms" "text",
    "default_notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "quotation_prefix" "text" DEFAULT 'QUO'::"text",
    "proforma_prefix" "text" DEFAULT 'PI'::"text",
    CONSTRAINT "business_profiles_key_check" CHECK (("key" = ANY (ARRAY['digitalbluez'::"text", 'techtenth'::"text", 'cash'::"text"])))
);


ALTER TABLE "public"."business_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."custom_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_name" "text" NOT NULL,
    "type" "text",
    "has_gst" boolean DEFAULT false,
    "gst_number" "text",
    "address" "text",
    "phone" "text",
    "email" "text",
    "source" "text",
    "google_review" boolean DEFAULT false,
    "social_following" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    "deleted_remarks" "text",
    "deleted_at" timestamp with time zone,
    "state" "text",
    "state_code" "text",
    CONSTRAINT "customers_social_following_check" CHECK (("social_following" = ANY (ARRAY['FB'::"text", 'Insta'::"text", 'Both'::"text", 'None'::"text"]))),
    CONSTRAINT "customers_type_check" CHECK (("type" = ANY (ARRAY['Business'::"text", 'Individual'::"text"])))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_sends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_type" "text" NOT NULL,
    "document_id" "uuid" NOT NULL,
    "channel" "text" DEFAULT 'email'::"text" NOT NULL,
    "sent_to" "text" NOT NULL,
    "status" "text" NOT NULL,
    "provider_message_id" "text",
    "error_message" "text",
    "sent_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_sends_channel_check" CHECK (("channel" = ANY (ARRAY['email'::"text", 'whatsapp'::"text"]))),
    CONSTRAINT "document_sends_document_type_check" CHECK (("document_type" = ANY (ARRAY['invoice'::"text", 'sales_document'::"text"]))),
    CONSTRAINT "document_sends_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."document_sends" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expense_date" "date" NOT NULL,
    "description" "text",
    "type" "text",
    "from_location" "text",
    "to_location" "text",
    "amount" numeric(10,2),
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    "deleted_remarks" "text",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "expenses_type_check" CHECK (("type" = ANY (ARRAY['Food'::"text", 'Transport'::"text", 'Stationary'::"text", 'Water'::"text", 'Birthday'::"text"])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "item_type" "text" NOT NULL,
    "asset_id" "uuid",
    "accessory_id" "uuid",
    "description" "text" NOT NULL,
    "hsn_code" "text",
    "quantity" numeric(10,2) DEFAULT 1 NOT NULL,
    "rate" numeric(10,2) NOT NULL,
    "gst_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "gst_type" "text",
    "cgst_amount" numeric(10,2) DEFAULT 0,
    "sgst_amount" numeric(10,2) DEFAULT 0,
    "igst_amount" numeric(10,2) DEFAULT 0,
    "amount" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sku_id" "uuid",
    "asset_number" "text",
    "po_item_id" "uuid",
    "cost_of_goods" numeric(12,2),
    "ledger_asset_id" "uuid",
    CONSTRAINT "invoice_items_gst_type_check" CHECK (("gst_type" = ANY (ARRAY['IGST'::"text", 'CGST_SGST'::"text"]))),
    CONSTRAINT "invoice_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['asset'::"text", 'accessory'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_sequences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prefix" "text",
    "financial_year" "text" NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL,
    "entity_key" "text",
    "doc_type" "text"
);


ALTER TABLE "public"."invoice_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_number" "text" NOT NULL,
    "invoice_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "place_of_supply" "text",
    "customer_id" "uuid",
    "customer_name" "text",
    "customer_gst" "text",
    "customer_address" "text",
    "customer_phone" "text",
    "customer_email" "text",
    "shipping_address" "text",
    "subject" "text",
    "notes" "text",
    "bank_details" "text",
    "terms_conditions" "text",
    "subtotal" numeric(10,2) DEFAULT 0,
    "total_gst" numeric(10,2) DEFAULT 0,
    "grand_total" numeric(10,2) DEFAULT 0,
    "status" "text" DEFAULT 'draft'::"text",
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    "deleted_remarks" "text",
    "deleted_at" timestamp with time zone,
    "po_id" "uuid",
    "invoice_type" "text" DEFAULT 'sales'::"text",
    "attachment_urls" "jsonb",
    "payment_status" "text" DEFAULT 'pending'::"text",
    "total_amount" numeric(14,2),
    "gst_total" numeric(14,2),
    "entity_key" "text",
    CONSTRAINT "invoices_invoice_type_check" CHECK (("invoice_type" = ANY (ARRAY['sales'::"text", 'purchase'::"text", 'credit_note'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."po_counter" (
    "year" integer NOT NULL,
    "last_number" integer DEFAULT 0
);


ALTER TABLE "public"."po_counter" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'employee'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "allowed_pages" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "profiles_allowed_pages_check" CHECK (("allowed_pages" <@ ARRAY['new_entry'::"text", 'accessories'::"text", 'repair_jobs'::"text", 'sku_master'::"text", 'live_stock'::"text", 'invoices'::"text", 'customers'::"text", 'activities'::"text"])),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'employee'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_id" "uuid",
    "asset_number" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_type" "text" NOT NULL,
    "file_size_kb" integer,
    "storage_provider" "text" DEFAULT 'supabase'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "asset_ledger_id" "uuid",
    CONSTRAINT "purchase_files_file_type_check" CHECK (("file_type" = ANY (ARRAY['invoice'::"text", 'eway_bill'::"text", 'receipt'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."purchase_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_order_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "po_id" "uuid" NOT NULL,
    "line_item_number" integer NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "base_sku_code" "text",
    "variant_number" integer,
    "quantity" integer NOT NULL,
    "base_price" numeric(12,2) NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "gst_percentage" numeric(5,2) DEFAULT 18,
    "gst_amount" numeric(12,2),
    "line_total" numeric(12,2),
    "asset_prefix" "text",
    "asset_numbers_reserved" "text"[],
    "serial_numbers" "text"[],
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "purchase_order_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."purchase_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_orders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "po_number" "text" NOT NULL,
    "po_date" "date" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "vendor_name" "text",
    "po_status" "text" DEFAULT 'draft'::"text",
    "purchase_type" "text" DEFAULT 'GST'::"text",
    "purchased_by_type" "text" DEFAULT 'Digitalbluez'::"text",
    "purchased_by_other" "text",
    "po_reference" "text",
    "expected_delivery_date" "date",
    "delivery_location" "text",
    "total_amount" numeric(14,2),
    "gst_total" numeric(14,2),
    "grand_total" numeric(14,2),
    "expense_amount" numeric(12,2),
    "expense_description" "text",
    "terms_and_conditions" "text",
    "remarks" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "purchase_orders_po_status_check" CHECK (("po_status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'partially_received'::"text", 'received'::"text", 'invoiced'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "purchase_orders_purchase_type_check" CHECK (("purchase_type" = ANY (ARRAY['GST'::"text", 'Cash'::"text"]))),
    CONSTRAINT "purchase_orders_purchased_by_type_check" CHECK (("purchased_by_type" = ANY (ARRAY['Digitalbluez'::"text", 'Techtenth'::"text", 'Cash'::"text", 'Other'::"text"])))
);


ALTER TABLE "public"."purchase_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "purchase_date" "date" NOT NULL,
    "purchase_month" character varying(20),
    "purchase_year" integer,
    "vendor_name" "text",
    "asset_number" "text",
    "sku" "text",
    "type" "text",
    "brand" "text",
    "asset_description" "text",
    "serial_number" "text",
    "base_price" numeric(10,2),
    "gst" numeric(10,2),
    "total_price" numeric(10,2),
    "stock_status" "text",
    "purchased_by" "text",
    "purchase_type" "text",
    "selling_price" numeric(10,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category" "text",
    "ram" "text",
    "ram_custom" "text",
    "ssd" "text",
    "ssd_custom" "text",
    "hdd" "text",
    "hdd_custom" "text",
    "cpu" "text",
    "cpu_custom" "text",
    "generation" "text",
    "accessory_type" "text",
    "accessory_type_custom" "text",
    "remarks" "text",
    "is_deleted" boolean DEFAULT false,
    "deleted_remarks" "text",
    "deleted_at" timestamp with time zone,
    "entry_date" "date" DEFAULT CURRENT_DATE,
    "charger" boolean DEFAULT false,
    "expense" boolean DEFAULT false,
    "expense_amount" numeric(10,2),
    "expense_description" "text",
    "status_purchase" "text" DEFAULT 'QC Pending'::"text",
    "status_other" "text",
    "purchased_by_type" "text" DEFAULT 'Digitalbluez'::"text",
    "purchased_by_other" "text",
    "model" "text",
    "purchased_invoice_number" "text",
    "eway_bill_no" "text",
    "vendor_id" "uuid",
    "screen_size" "text",
    "monitor_size" "text",
    "has_keyboard" boolean DEFAULT false,
    "has_mouse" boolean DEFAULT false,
    "public_photo_url" "text",
    "make_year" integer,
    "vendor_invoice_total" numeric(10,2),
    "status" "text" DEFAULT 'draft'::"text",
    "submitted_at" timestamp with time zone,
    "brand_other" "text",
    "gst_amount" numeric(10,2),
    "sku_variant_id" "uuid",
    CONSTRAINT "purchases_category_check" CHECK (("category" = ANY (ARRAY['New'::"text", 'Preowned'::"text"]))),
    CONSTRAINT "purchases_purchase_type_check" CHECK (("purchase_type" = ANY (ARRAY['Cash'::"text", 'GST'::"text"])))
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reorder_rules" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "reorder_quantity" integer NOT NULL,
    "reorder_at_quantity" integer NOT NULL,
    "is_active" boolean DEFAULT true,
    "auto_generate_po" boolean DEFAULT false,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reorder_rules_reorder_quantity_check" CHECK (("reorder_quantity" > 0))
);


ALTER TABLE "public"."reorder_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."repair_job_counter" (
    "year" "text" NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."repair_job_counter" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."repair_job_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "repair_job_id" "uuid" NOT NULL,
    "accessory_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "accessory_movement_id" "uuid"
);


ALTER TABLE "public"."repair_job_parts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."repair_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_number" "text",
    "customer_id" "uuid" NOT NULL,
    "is_own_stock" boolean DEFAULT false NOT NULL,
    "asset_id" "uuid",
    "customer_device_description" "text",
    "customer_device_serial" "text",
    "job_type" "text" NOT NULL,
    "replacement_asset_id" "uuid",
    "problem_description" "text",
    "solution_description" "text",
    "status" "text" DEFAULT 'intake'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "amount_charged" numeric,
    "amount_paid" numeric,
    "entered_by" "uuid",
    "finalized_by" "uuid",
    "finalized_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_account" "text",
    "job_date" "date",
    CONSTRAINT "repair_jobs_job_type_check" CHECK (("job_type" = ANY (ARRAY['repair'::"text", 'replacement'::"text"]))),
    CONSTRAINT "repair_jobs_payment_account_check" CHECK (("payment_account" = ANY (ARRAY['Digitalbluez'::"text", 'Techtenth'::"text", 'Cash'::"text"]))),
    CONSTRAINT "repair_jobs_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'partial'::"text", 'paid'::"text"]))),
    CONSTRAINT "repair_jobs_status_check" CHECK (("status" = ANY (ARRAY['intake'::"text", 'in_progress'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."repair_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_date" "date" NOT NULL,
    "sale_month" character varying(20),
    "sale_year" integer,
    "invoice_number" "text",
    "customer_name" "text",
    "pmt" "text",
    "asset_number" "text",
    "sku" "text",
    "type" "text",
    "brand" "text",
    "asset_description" "text",
    "serial_number" "text",
    "sale_base_price" numeric(10,2),
    "sale_gst" numeric(10,2),
    "sale_total" numeric(10,2),
    "sale_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    "deleted_remarks" "text",
    "deleted_at" timestamp with time zone,
    "asset_ledger_id" "uuid",
    "customer_id" "uuid",
    "entered_by" "uuid",
    "finalized" boolean DEFAULT false NOT NULL,
    "finalized_by" "uuid",
    "finalized_at" timestamp with time zone,
    "invoice_id" "uuid",
    "bundled_accessories" "jsonb",
    "accessory_id" "uuid",
    "accessory_quantity" integer,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "amount_paid" numeric DEFAULT 0 NOT NULL,
    "payment_account" "text",
    "sold_by" "text",
    CONSTRAINT "sales_payment_account_check" CHECK (("payment_account" = ANY (ARRAY['Digitalbluez'::"text", 'Techtenth'::"text", 'Cash'::"text"]))),
    CONSTRAINT "sales_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'partial'::"text", 'paid'::"text"]))),
    CONSTRAINT "sales_sale_type_check" CHECK (("sale_type" = ANY (ARRAY['Cash'::"text", 'GST'::"text"])))
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_document_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sales_document_id" "uuid" NOT NULL,
    "item_type" "text" NOT NULL,
    "sku_id" "uuid",
    "accessory_id" "uuid",
    "description" "text" NOT NULL,
    "hsn_code" "text",
    "quantity" numeric DEFAULT 1 NOT NULL,
    "rate" numeric NOT NULL,
    "gst_rate" numeric DEFAULT 0 NOT NULL,
    "gst_type" "text",
    "cgst_amount" numeric DEFAULT 0,
    "sgst_amount" numeric DEFAULT 0,
    "igst_amount" numeric DEFAULT 0,
    "amount" numeric NOT NULL,
    "converted" boolean DEFAULT false NOT NULL,
    "sale_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_document_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['sku'::"text", 'accessory'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."sales_document_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_type" "text" NOT NULL,
    "document_number" "text" NOT NULL,
    "document_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date",
    "entity_key" "text" NOT NULL,
    "customer_id" "uuid",
    "customer_name" "text",
    "customer_gst" "text",
    "customer_address" "text",
    "customer_phone" "text",
    "customer_email" "text",
    "place_of_supply" "text",
    "subtotal" numeric DEFAULT 0 NOT NULL,
    "total_gst" numeric DEFAULT 0 NOT NULL,
    "grand_total" numeric DEFAULT 0 NOT NULL,
    "notes" "text",
    "terms_conditions" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_documents_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['quotation'::"text", 'proforma'::"text"]))),
    CONSTRAINT "sales_documents_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'accepted'::"text", 'rejected'::"text", 'expired'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."sales_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sku_category_templates" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "category" character varying(50) NOT NULL,
    "display_name" character varying(100),
    "field_schema" "jsonb",
    "sku_code_prefix" character varying(10),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "sku_code_format" "text"
);


ALTER TABLE "public"."sku_category_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sku_master" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "base_sku_code" "text" NOT NULL,
    "variant_number" integer DEFAULT 1 NOT NULL,
    "full_sku_code" "text" NOT NULL,
    "category" "text" NOT NULL,
    "item_type" "text" NOT NULL,
    "brand" "text",
    "model_name" "text",
    "specifications" "jsonb" DEFAULT '{}'::"jsonb",
    "sku_description" "text",
    "base_cost" numeric(12,2),
    "selling_price_default" numeric(12,2),
    "quantity_in_stock" integer DEFAULT 0,
    "reorder_level" integer DEFAULT 5,
    "status" "text" DEFAULT 'active'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_by" "uuid",
    "hsn_code" "text",
    CONSTRAINT "sku_master_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'discontinued'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."sku_master" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "movement_type" "public"."movement_type_enum" NOT NULL,
    "quantity_change" integer NOT NULL,
    "quantity_before" integer NOT NULL,
    "quantity_after" integer NOT NULL,
    "po_id" "uuid",
    "po_item_id" "uuid",
    "invoice_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vendor_code_seq"
    START WITH 63
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendor_code_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_name" "text" NOT NULL,
    "spoc_name" "text",
    "owner_name" "text",
    "phone" "text",
    "address" "text",
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "has_gst" boolean DEFAULT false,
    "gst_number" "text",
    "gst_company_name" "text",
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "pincode" "text",
    "remarks" "text",
    "is_deleted" boolean DEFAULT false,
    "deleted_remarks" "text",
    "deleted_at" timestamp with time zone,
    "vendor_code" character varying(20)
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


ALTER TABLE ONLY "public"."_migration_tracking"
    ADD CONSTRAINT "_migration_tracking_pkey" PRIMARY KEY ("old_purchase_id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_cost_adjustments"
    ADD CONSTRAINT "asset_cost_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_counters"
    ADD CONSTRAINT "asset_counters_pkey" PRIMARY KEY ("prefix", "year");



ALTER TABLE ONLY "public"."asset_qc_checks"
    ADD CONSTRAINT "asset_qc_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_rma_events"
    ADD CONSTRAINT "asset_rma_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."business_profiles"
    ADD CONSTRAINT "business_profiles_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."business_profiles"
    ADD CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_options"
    ADD CONSTRAINT "custom_options_category_value_key" UNIQUE ("category", "value");



ALTER TABLE ONLY "public"."custom_options"
    ADD CONSTRAINT "custom_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_sends"
    ADD CONSTRAINT "document_sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_entity_doc_fy_unique" UNIQUE ("entity_key", "doc_type", "financial_year");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_prefix_financial_year_key" UNIQUE ("prefix", "financial_year");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."po_counter"
    ADD CONSTRAINT "po_counter_pkey" PRIMARY KEY ("year");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_files"
    ADD CONSTRAINT "purchase_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "purchase_order_asset_mapping_asset_number_key" UNIQUE ("asset_number");



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "purchase_order_asset_mapping_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_po_number_key" UNIQUE ("po_number");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_asset_number_key" UNIQUE ("asset_number");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reorder_rules"
    ADD CONSTRAINT "reorder_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reorder_rules"
    ADD CONSTRAINT "reorder_rules_sku_id_vendor_id_key" UNIQUE ("sku_id", "vendor_id");



ALTER TABLE ONLY "public"."repair_job_counter"
    ADD CONSTRAINT "repair_job_counter_pkey" PRIMARY KEY ("year");



ALTER TABLE ONLY "public"."repair_job_parts"
    ADD CONSTRAINT "repair_job_parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."repair_jobs"
    ADD CONSTRAINT "repair_jobs_job_number_key" UNIQUE ("job_number");



ALTER TABLE ONLY "public"."repair_jobs"
    ADD CONSTRAINT "repair_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_document_items"
    ADD CONSTRAINT "sales_document_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_documents"
    ADD CONSTRAINT "sales_documents_document_number_key" UNIQUE ("document_number");



ALTER TABLE ONLY "public"."sales_documents"
    ADD CONSTRAINT "sales_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_category_templates"
    ADD CONSTRAINT "sku_category_templates_category_key" UNIQUE ("category");



ALTER TABLE ONLY "public"."sku_category_templates"
    ADD CONSTRAINT "sku_category_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_full_sku_code_key" UNIQUE ("full_sku_code");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_vendor_code_key" UNIQUE ("vendor_code");



CREATE INDEX "asset_cost_adjustments_asset_id_idx" ON "public"."asset_cost_adjustments" USING "btree" ("asset_id");



CREATE INDEX "idx_activities_due_date" ON "public"."activities" USING "btree" ("due_date");



CREATE INDEX "idx_activities_reminder_at" ON "public"."activities" USING "btree" ("reminder_at");



CREATE INDEX "idx_activities_user_id" ON "public"."activities" USING "btree" ("user_id");



CREATE INDEX "idx_asset_qc_checks_asset" ON "public"."asset_qc_checks" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_rma_events_asset" ON "public"."asset_rma_events" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_rma_events_status" ON "public"."asset_rma_events" USING "btree" ("status");



CREATE INDEX "idx_asset_sku" ON "public"."asset_ledger" USING "btree" ("sku_id");



CREATE INDEX "idx_asset_status" ON "public"."asset_ledger" USING "btree" ("status");



CREATE INDEX "idx_po_date" ON "public"."purchase_orders" USING "btree" ("po_date");



CREATE INDEX "idx_po_status" ON "public"."purchase_orders" USING "btree" ("po_status");



CREATE INDEX "idx_po_vendor" ON "public"."purchase_orders" USING "btree" ("vendor_id");



CREATE INDEX "idx_poi_po" ON "public"."purchase_order_items" USING "btree" ("po_id");



CREATE INDEX "idx_poi_sku" ON "public"."purchase_order_items" USING "btree" ("sku_id");



CREATE INDEX "idx_purchases_sku_variant_id" ON "public"."purchases" USING "btree" ("sku_variant_id");



CREATE INDEX "idx_reorder_sku" ON "public"."reorder_rules" USING "btree" ("sku_id");



CREATE INDEX "idx_reorder_vendor" ON "public"."reorder_rules" USING "btree" ("vendor_id");



CREATE INDEX "idx_sku_base_code" ON "public"."sku_master" USING "btree" ("base_sku_code");



CREATE INDEX "idx_sku_category" ON "public"."sku_master" USING "btree" ("category");



CREATE INDEX "idx_sku_full_code" ON "public"."sku_master" USING "btree" ("full_sku_code");



CREATE INDEX "idx_sku_quantity" ON "public"."sku_master" USING "btree" ("quantity_in_stock");



CREATE INDEX "idx_stock_invoice" ON "public"."stock_movements" USING "btree" ("invoice_id");



CREATE INDEX "idx_stock_po" ON "public"."stock_movements" USING "btree" ("po_id");



CREATE INDEX "idx_stock_sku" ON "public"."stock_movements" USING "btree" ("sku_id");



CREATE OR REPLACE TRIGGER "trg_compute_warranty_expiry" BEFORE INSERT OR UPDATE OF "warranty_start_date", "warranty_duration_months" ON "public"."asset_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."compute_warranty_expiry"();



CREATE OR REPLACE TRIGGER "trg_sync_sku_stock" BEFORE INSERT ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."sync_sku_stock_from_movement"();



CREATE OR REPLACE TRIGGER "vendors_vendor_code" BEFORE INSERT ON "public"."vendors" FOR EACH ROW WHEN (("new"."vendor_code" IS NULL)) EXECUTE FUNCTION "public"."generate_vendor_code"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_cost_adjustments"
    ADD CONSTRAINT "asset_cost_adjustments_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_cost_adjustments"
    ADD CONSTRAINT "asset_cost_adjustments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_ledger"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "asset_ledger_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "asset_ledger_legacy_purchase_id_fkey" FOREIGN KEY ("legacy_purchase_id") REFERENCES "public"."purchases"("id");



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "asset_ledger_qc_by_fkey" FOREIGN KEY ("qc_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "asset_ledger_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."asset_qc_checks"
    ADD CONSTRAINT "asset_qc_checks_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_ledger"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_qc_checks"
    ADD CONSTRAINT "asset_qc_checks_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_rma_events"
    ADD CONSTRAINT "asset_rma_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."asset_rma_events"
    ADD CONSTRAINT "asset_rma_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."asset_rma_events"
    ADD CONSTRAINT "asset_rma_events_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."document_sends"
    ADD CONSTRAINT "document_sends_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."purchases"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_ledger_asset_id_fkey" FOREIGN KEY ("ledger_asset_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_entity_key_fkey" FOREIGN KEY ("entity_key") REFERENCES "public"."business_profiles"("key");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_entity_key_fkey" FOREIGN KEY ("entity_key") REFERENCES "public"."business_profiles"("key");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_files"
    ADD CONSTRAINT "purchase_files_asset_ledger_id_fkey" FOREIGN KEY ("asset_ledger_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."purchase_files"
    ADD CONSTRAINT "purchase_files_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "purchase_order_asset_mapping_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id");



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "purchase_order_asset_mapping_po_item_id_fkey" FOREIGN KEY ("po_item_id") REFERENCES "public"."purchase_order_items"("id");



ALTER TABLE ONLY "public"."asset_ledger"
    ADD CONSTRAINT "purchase_order_asset_mapping_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_order_items"
    ADD CONSTRAINT "purchase_order_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."purchase_orders"
    ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."reorder_rules"
    ADD CONSTRAINT "reorder_rules_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reorder_rules"
    ADD CONSTRAINT "reorder_rules_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."repair_job_parts"
    ADD CONSTRAINT "repair_job_parts_repair_job_id_fkey" FOREIGN KEY ("repair_job_id") REFERENCES "public"."repair_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repair_jobs"
    ADD CONSTRAINT "repair_jobs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."repair_jobs"
    ADD CONSTRAINT "repair_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."repair_jobs"
    ADD CONSTRAINT "repair_jobs_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."repair_jobs"
    ADD CONSTRAINT "repair_jobs_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."repair_jobs"
    ADD CONSTRAINT "repair_jobs_replacement_asset_id_fkey" FOREIGN KEY ("replacement_asset_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_asset_ledger_id_fkey" FOREIGN KEY ("asset_ledger_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."sales_document_items"
    ADD CONSTRAINT "sales_document_items_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."sales_document_items"
    ADD CONSTRAINT "sales_document_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id");



ALTER TABLE ONLY "public"."sales_document_items"
    ADD CONSTRAINT "sales_document_items_sales_document_id_fkey" FOREIGN KEY ("sales_document_id") REFERENCES "public"."sales_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_document_items"
    ADD CONSTRAINT "sales_document_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."sales_documents"
    ADD CONSTRAINT "sales_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sales_documents"
    ADD CONSTRAINT "sales_documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."sales_documents"
    ADD CONSTRAINT "sales_documents_entity_key_fkey" FOREIGN KEY ("entity_key") REFERENCES "public"."business_profiles"("key");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



CREATE POLICY "Admin full access" ON "public"."customers" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."expenses" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."purchase_files" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."purchases" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."sales" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow full access to auth users" ON "public"."asset_cost_adjustments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."asset_ledger" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."asset_qc_checks" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."asset_rma_events" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."purchase_order_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."purchase_orders" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Enable all for authenticated users" ON "public"."invoice_items" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Enable all for authenticated users" ON "public"."invoice_sequences" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Enable all for authenticated users" ON "public"."invoices" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can delete own activities" ON "public"."activities" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert SKUs" ON "public"."sku_master" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Users can insert own activities" ON "public"."activities" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update SKUs" ON "public"."sku_master" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Users can update own activities" ON "public"."activities" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view SKUs" ON "public"."sku_master" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can view own activities" ON "public"."activities" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."_migration_tracking" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_cost_adjustments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_qc_checks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_rma_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_options" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_options_select_authenticated" ON "public"."custom_options" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "custom_options_write_owner" ON "public"."custom_options" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_sends" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."po_counter" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."purchase_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reorder_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repair_job_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "repair_job_parts_authenticated" ON "public"."repair_job_parts" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."repair_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "repair_jobs_authenticated" ON "public"."repair_jobs" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_document_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_category_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendors_owner_only" ON "public"."vendors" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."compute_warranty_expiry"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_warranty_expiry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_warranty_expiry"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_repair_job_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_repair_job_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_repair_job_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."next_document_number"("p_entity_key" "text", "p_doc_type" "text", "p_financial_year" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."next_document_number"("p_entity_key" "text", "p_doc_type" "text", "p_financial_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_document_number"("p_entity_key" "text", "p_doc_type" "text", "p_financial_year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "service_role";


















GRANT ALL ON TABLE "public"."_migration_tracking" TO "anon";
GRANT ALL ON TABLE "public"."_migration_tracking" TO "authenticated";
GRANT ALL ON TABLE "public"."_migration_tracking" TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."asset_cost_adjustments" TO "anon";
GRANT ALL ON TABLE "public"."asset_cost_adjustments" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_cost_adjustments" TO "service_role";



GRANT ALL ON TABLE "public"."asset_counters" TO "anon";
GRANT ALL ON TABLE "public"."asset_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_counters" TO "service_role";



GRANT ALL ON TABLE "public"."asset_ledger" TO "anon";
GRANT ALL ON TABLE "public"."asset_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."asset_qc_checks" TO "anon";
GRANT ALL ON TABLE "public"."asset_qc_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_qc_checks" TO "service_role";



GRANT ALL ON TABLE "public"."asset_rma_events" TO "anon";
GRANT ALL ON TABLE "public"."asset_rma_events" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_rma_events" TO "service_role";



GRANT ALL ON TABLE "public"."business_profiles" TO "anon";
GRANT ALL ON TABLE "public"."business_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."business_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."custom_options" TO "anon";
GRANT ALL ON TABLE "public"."custom_options" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_options" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."document_sends" TO "anon";
GRANT ALL ON TABLE "public"."document_sends" TO "authenticated";
GRANT ALL ON TABLE "public"."document_sends" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_sequences" TO "anon";
GRANT ALL ON TABLE "public"."invoice_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."po_counter" TO "anon";
GRANT ALL ON TABLE "public"."po_counter" TO "authenticated";
GRANT ALL ON TABLE "public"."po_counter" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_files" TO "anon";
GRANT ALL ON TABLE "public"."purchase_files" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_files" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_items" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_orders" TO "anon";
GRANT ALL ON TABLE "public"."purchase_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_orders" TO "service_role";



GRANT ALL ON TABLE "public"."purchases" TO "anon";
GRANT ALL ON TABLE "public"."purchases" TO "authenticated";
GRANT ALL ON TABLE "public"."purchases" TO "service_role";



GRANT ALL ON TABLE "public"."reorder_rules" TO "anon";
GRANT ALL ON TABLE "public"."reorder_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."reorder_rules" TO "service_role";



GRANT ALL ON TABLE "public"."repair_job_counter" TO "anon";
GRANT ALL ON TABLE "public"."repair_job_counter" TO "authenticated";
GRANT ALL ON TABLE "public"."repair_job_counter" TO "service_role";



GRANT ALL ON TABLE "public"."repair_job_parts" TO "anon";
GRANT ALL ON TABLE "public"."repair_job_parts" TO "authenticated";
GRANT ALL ON TABLE "public"."repair_job_parts" TO "service_role";



GRANT ALL ON TABLE "public"."repair_jobs" TO "anon";
GRANT ALL ON TABLE "public"."repair_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."repair_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON TABLE "public"."sales_document_items" TO "anon";
GRANT ALL ON TABLE "public"."sales_document_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_document_items" TO "service_role";



GRANT ALL ON TABLE "public"."sales_documents" TO "anon";
GRANT ALL ON TABLE "public"."sales_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_documents" TO "service_role";



GRANT ALL ON TABLE "public"."sku_category_templates" TO "anon";
GRANT ALL ON TABLE "public"."sku_category_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_category_templates" TO "service_role";



GRANT ALL ON TABLE "public"."sku_master" TO "anon";
GRANT ALL ON TABLE "public"."sku_master" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_master" TO "service_role";



GRANT ALL ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_code_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_code_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_code_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































