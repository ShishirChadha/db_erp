


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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



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


CREATE OR REPLACE FUNCTION "public"."create_assets_on_receive"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  item RECORD;
  asset_prefix TEXT;
  i INT;
  new_asset_number TEXT;
  serial_array TEXT[];
  serial_item TEXT;
BEGIN
  IF NEW.status = 'received' AND OLD.status != 'received' THEN
    CASE NEW.purchased_by_type
      WHEN 'Digitalbluez' THEN asset_prefix := 'DBAS';
      WHEN 'Techtenth' THEN asset_prefix := 'TTAS';
      WHEN 'Cash' THEN asset_prefix := 'CSAS';
      WHEN 'Other' THEN
        asset_prefix := UPPER(LEFT(NEW.purchased_by_other, 4));
        IF asset_prefix IS NULL OR asset_prefix = '' THEN asset_prefix := 'OTHR'; END IF;
      ELSE asset_prefix := 'DBAS';
    END CASE;

    FOR item IN
      SELECT li.id, li.sku_variant_id, li.quantity, li.unit_cost, li.serial_numbers
      FROM purchase_line_items li
      WHERE li.po_id = NEW.id
    LOOP
      serial_array := string_to_array(replace(item.serial_numbers, '\n', ','), ',');
      FOR i IN 1..item.quantity LOOP
        new_asset_number := generate_asset_number_with_prefix(asset_prefix);
        serial_item := NULL;
        IF i <= array_length(serial_array, 1) THEN
          serial_item := trim(serial_array[i]);
        END IF;
        INSERT INTO assets (
          asset_number,
          serial_number,
          purchase_line_item_id,
          sku_variant_id,
          cost_price,
          status,
          qc_status
        ) VALUES (
          new_asset_number,
          serial_item,
          item.id,
          item.sku_variant_id,
          item.unit_cost,
          'in_stock',
          'pending_qc'
        );
      END LOOP;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_assets_on_receive"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrement_inventory_on_asset_sold"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.status = 'sold' AND OLD.status != 'sold' THEN
    UPDATE sku_inventory
    SET current_stock = current_stock - 1,
        last_updated = NOW()
    WHERE sku_variant_id = NEW.sku_variant_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."decrement_inventory_on_asset_sold"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_inventory_on_asset_creation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO sku_inventory (sku_variant_id, current_stock, avg_cost_price)
  VALUES (NEW.sku_variant_id, 1, NEW.cost_price)
  ON CONFLICT (sku_variant_id) DO UPDATE
  SET current_stock = sku_inventory.current_stock + 1,
      avg_cost_price = (sku_inventory.avg_cost_price * (sku_inventory.current_stock) + NEW.cost_price) / (sku_inventory.current_stock + 1),
      last_updated = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_inventory_on_asset_creation"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_migration_tracking" (
    "old_purchase_id" "uuid" NOT NULL,
    "new_po_id" "uuid",
    "migrated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."_migration_tracking" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accessories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "accessory_name" "text" NOT NULL,
    "category" "text",
    "brand" "text",
    "model_number" "text",
    "compatible_models" "text",
    "quantity" integer DEFAULT 0,
    "unit_cost" numeric(10,2),
    "selling_price" numeric(10,2),
    "supplier" "text",
    "purchase_date" "date",
    "remarks" "text",
    "is_deleted" boolean DEFAULT false,
    "deleted_remarks" "text",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."accessories" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."asset_counters" (
    "prefix" "text" NOT NULL,
    "year" "text" NOT NULL,
    "last_number" integer DEFAULT 0,
    "year_suffix" "text"
);


ALTER TABLE "public"."asset_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_number" "text" NOT NULL,
    "serial_number" "text",
    "purchase_line_item_id" "uuid" NOT NULL,
    "sku_variant_id" "uuid" NOT NULL,
    "cost_price" numeric(12,2) NOT NULL,
    "selling_price" numeric(12,2),
    "status" "text" DEFAULT 'in_stock'::"text",
    "qc_status" "text" DEFAULT 'pending_qc'::"text",
    "warehouse_location" "text",
    "assigned_to" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "po_id" "uuid",
    CONSTRAINT "assets_qc_status_check" CHECK (("qc_status" = ANY (ARRAY['pending_qc'::"text", 'ready_for_sale'::"text", 'faulty'::"text", 'other'::"text"]))),
    CONSTRAINT "assets_status_check" CHECK (("status" = ANY (ARRAY['in_stock'::"text", 'sold'::"text", 'damaged'::"text"])))
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
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
    CONSTRAINT "customers_social_following_check" CHECK (("social_following" = ANY (ARRAY['FB'::"text", 'Insta'::"text", 'Both'::"text", 'None'::"text"]))),
    CONSTRAINT "customers_type_check" CHECK (("type" = ANY (ARRAY['Business'::"text", 'Individual'::"text"])))
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


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
    CONSTRAINT "invoice_items_gst_type_check" CHECK (("gst_type" = ANY (ARRAY['IGST'::"text", 'CGST_SGST'::"text"]))),
    CONSTRAINT "invoice_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['asset'::"text", 'accessory'::"text", 'custom'::"text"])))
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_sequences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prefix" "text" NOT NULL,
    "financial_year" "text" NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL
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
    CONSTRAINT "invoices_invoice_type_check" CHECK (("invoice_type" = ANY (ARRAY['sales'::"text", 'purchase'::"text", 'credit_note'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."models" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."po_counter" (
    "year" integer NOT NULL,
    "last_number" integer DEFAULT 0
);


ALTER TABLE "public"."po_counter" OWNER TO "postgres";


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
    CONSTRAINT "purchase_files_file_type_check" CHECK (("file_type" = ANY (ARRAY['invoice'::"text", 'eway_bill'::"text", 'receipt'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."purchase_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "po_id" "uuid" NOT NULL,
    "sku_variant_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "unit_cost" numeric(12,2) NOT NULL,
    "discount_percent" numeric(5,2) DEFAULT 0,
    "line_total" numeric(12,2) GENERATED ALWAYS AS (((("quantity")::numeric * "unit_cost") * ((1)::numeric - ("discount_percent" / (100)::numeric)))) STORED,
    "serial_numbers" "text",
    "asset_description" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "purchase_line_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."purchase_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_order_asset_mapping" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "po_id" "uuid" NOT NULL,
    "po_item_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "asset_number" "text" NOT NULL,
    "serial_number" "text",
    "status" "text" DEFAULT 'reserved'::"text",
    "reserved_at" timestamp with time zone DEFAULT "now"(),
    "received_at" timestamp with time zone,
    "sold_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "purchase_order_asset_mapping_status_check" CHECK (("status" = ANY (ARRAY['reserved'::"text", 'received'::"text", 'in_stock'::"text", 'sold'::"text", 'faulty'::"text", 'returned'::"text"])))
);


ALTER TABLE "public"."purchase_order_asset_mapping" OWNER TO "postgres";


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
    "model_id" "uuid",
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


CREATE TABLE IF NOT EXISTS "public"."sale_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "item_type" "text" NOT NULL,
    "asset_id" "uuid",
    "accessory_id" "uuid",
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit_price" numeric(10,2) NOT NULL,
    "gst" numeric(10,2),
    "total_price" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sale_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['asset'::"text", 'accessory'::"text"])))
);


ALTER TABLE "public"."sale_items" OWNER TO "postgres";


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
    CONSTRAINT "sales_sale_type_check" CHECK (("sale_type" = ANY (ARRAY['Cash'::"text", 'GST'::"text"])))
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sku_base" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sku_base" "text" NOT NULL,
    "product_name" "text" NOT NULL,
    "brand" "text",
    "category" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sku_base" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."sku_inventory" (
    "sku_variant_id" "uuid" NOT NULL,
    "current_stock" integer DEFAULT 0,
    "reorder_level" integer DEFAULT 0,
    "avg_cost_price" numeric(12,2),
    "last_updated" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sku_inventory" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."sku_variants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sku_base_id" "uuid" NOT NULL,
    "variant_code" "text" NOT NULL,
    "variant_name" "text",
    "cpu" "text",
    "ram_gb" integer,
    "ssd_gb" integer,
    "screen_size" numeric(5,2),
    "charger" boolean DEFAULT true,
    "has_keyboard" boolean DEFAULT false,
    "has_mouse" boolean DEFAULT false,
    "make_year" integer,
    "generation" "text",
    "unit_cost" numeric(10,2),
    "selling_price" numeric(10,2),
    "current_stock" integer DEFAULT 0,
    "reorder_level" integer DEFAULT 0,
    "warranty_months" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "specs" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."sku_variants" OWNER TO "postgres";


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


CREATE OR REPLACE VIEW "public"."v_inventory_status" AS
 SELECT "sb"."sku_base",
    "sv"."variant_code",
    "sv"."variant_name",
    "si"."current_stock",
    "si"."reorder_level",
        CASE
            WHEN ("si"."current_stock" <= "si"."reorder_level") THEN 'Low Stock'::"text"
            ELSE 'OK'::"text"
        END AS "alert",
    "si"."avg_cost_price"
   FROM (("public"."sku_inventory" "si"
     JOIN "public"."sku_variants" "sv" ON (("si"."sku_variant_id" = "sv"."id")))
     JOIN "public"."sku_base" "sb" ON (("sv"."sku_base_id" = "sb"."id")));


ALTER VIEW "public"."v_inventory_status" OWNER TO "postgres";


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



ALTER TABLE ONLY "public"."accessories"
    ADD CONSTRAINT "accessories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_counters"
    ADD CONSTRAINT "asset_counters_pkey" PRIMARY KEY ("prefix", "year");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_asset_number_key" UNIQUE ("asset_number");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_serial_number_key" UNIQUE ("serial_number");



ALTER TABLE ONLY "public"."custom_options"
    ADD CONSTRAINT "custom_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_prefix_financial_year_key" UNIQUE ("prefix", "financial_year");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_unique" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."models"
    ADD CONSTRAINT "models_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."models"
    ADD CONSTRAINT "models_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."po_counter"
    ADD CONSTRAINT "po_counter_pkey" PRIMARY KEY ("year");



ALTER TABLE ONLY "public"."purchase_files"
    ADD CONSTRAINT "purchase_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_line_items"
    ADD CONSTRAINT "purchase_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_order_asset_mapping"
    ADD CONSTRAINT "purchase_order_asset_mapping_asset_number_key" UNIQUE ("asset_number");



ALTER TABLE ONLY "public"."purchase_order_asset_mapping"
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



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_base"
    ADD CONSTRAINT "sku_base_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_base"
    ADD CONSTRAINT "sku_base_sku_base_key" UNIQUE ("sku_base");



ALTER TABLE ONLY "public"."sku_category_templates"
    ADD CONSTRAINT "sku_category_templates_category_key" UNIQUE ("category");



ALTER TABLE ONLY "public"."sku_category_templates"
    ADD CONSTRAINT "sku_category_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_inventory"
    ADD CONSTRAINT "sku_inventory_pkey" PRIMARY KEY ("sku_variant_id");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_full_sku_code_key" UNIQUE ("full_sku_code");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_variants"
    ADD CONSTRAINT "sku_variants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_variants"
    ADD CONSTRAINT "sku_variants_sku_base_id_variant_code_key" UNIQUE ("sku_base_id", "variant_code");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_vendor_code_key" UNIQUE ("vendor_code");



CREATE INDEX "idx_accessories_category" ON "public"."accessories" USING "btree" ("category");



CREATE INDEX "idx_accessories_name" ON "public"."accessories" USING "btree" ("accessory_name");



CREATE INDEX "idx_activities_due_date" ON "public"."activities" USING "btree" ("due_date");



CREATE INDEX "idx_activities_reminder_at" ON "public"."activities" USING "btree" ("reminder_at");



CREATE INDEX "idx_activities_user_id" ON "public"."activities" USING "btree" ("user_id");



CREATE INDEX "idx_asset_asset_number" ON "public"."assets" USING "btree" ("asset_number");



CREATE INDEX "idx_asset_serial" ON "public"."assets" USING "btree" ("serial_number");



CREATE INDEX "idx_asset_sku" ON "public"."purchase_order_asset_mapping" USING "btree" ("sku_id");



CREATE INDEX "idx_asset_sku_status" ON "public"."assets" USING "btree" ("sku_variant_id", "status");



CREATE INDEX "idx_asset_status" ON "public"."purchase_order_asset_mapping" USING "btree" ("status");



CREATE INDEX "idx_inventory_sku" ON "public"."sku_inventory" USING "btree" ("sku_variant_id");



CREATE INDEX "idx_lineitem_po" ON "public"."purchase_line_items" USING "btree" ("po_id");



CREATE INDEX "idx_lineitem_sku_variant" ON "public"."purchase_line_items" USING "btree" ("sku_variant_id");



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



CREATE INDEX "idx_sku_variant_base" ON "public"."sku_variants" USING "btree" ("sku_base_id");



CREATE INDEX "idx_stock_invoice" ON "public"."stock_movements" USING "btree" ("invoice_id");



CREATE INDEX "idx_stock_po" ON "public"."stock_movements" USING "btree" ("po_id");



CREATE INDEX "idx_stock_sku" ON "public"."stock_movements" USING "btree" ("sku_id");



CREATE OR REPLACE TRIGGER "decrement_inventory_on_asset_sold" AFTER UPDATE OF "status" ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."decrement_inventory_on_asset_sold"();



CREATE OR REPLACE TRIGGER "trg_sync_sku_stock" BEFORE INSERT ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."sync_sku_stock_from_movement"();



CREATE OR REPLACE TRIGGER "update_inventory_on_asset_creation" AFTER INSERT ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."update_inventory_on_asset_creation"();



CREATE OR REPLACE TRIGGER "vendors_vendor_code" BEFORE INSERT ON "public"."vendors" FOR EACH ROW WHEN (("new"."vendor_code" IS NULL)) EXECUTE FUNCTION "public"."generate_vendor_code"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_purchase_line_item_id_fkey" FOREIGN KEY ("purchase_line_item_id") REFERENCES "public"."purchase_line_items"("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_sku_variant_id_fkey" FOREIGN KEY ("sku_variant_id") REFERENCES "public"."sku_variants"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "public"."accessories"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."purchases"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."purchase_files"
    ADD CONSTRAINT "purchase_files_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_line_items"
    ADD CONSTRAINT "purchase_line_items_sku_variant_id_fkey" FOREIGN KEY ("sku_variant_id") REFERENCES "public"."sku_variants"("id");



ALTER TABLE ONLY "public"."purchase_order_asset_mapping"
    ADD CONSTRAINT "purchase_order_asset_mapping_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id");



ALTER TABLE ONLY "public"."purchase_order_asset_mapping"
    ADD CONSTRAINT "purchase_order_asset_mapping_po_item_id_fkey" FOREIGN KEY ("po_item_id") REFERENCES "public"."purchase_order_items"("id");



ALTER TABLE ONLY "public"."purchase_order_asset_mapping"
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
    ADD CONSTRAINT "purchases_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_sku_variant_id_fkey" FOREIGN KEY ("sku_variant_id") REFERENCES "public"."sku_variants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."reorder_rules"
    ADD CONSTRAINT "reorder_rules_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reorder_rules"
    ADD CONSTRAINT "reorder_rules_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "public"."accessories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."purchases"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_asset_number_fkey" FOREIGN KEY ("asset_number") REFERENCES "public"."purchases"("asset_number");



ALTER TABLE ONLY "public"."sku_inventory"
    ADD CONSTRAINT "sku_inventory_sku_variant_id_fkey" FOREIGN KEY ("sku_variant_id") REFERENCES "public"."sku_variants"("id");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sku_variants"
    ADD CONSTRAINT "sku_variants_sku_base_id_fkey" FOREIGN KEY ("sku_base_id") REFERENCES "public"."sku_base"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



CREATE POLICY "Admin full access" ON "public"."custom_options" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."customers" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."expenses" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."purchase_files" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."purchases" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."sales" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."vendors" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow all for authenticated users" ON "public"."assets" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow delete for authenticated users" ON "public"."purchase_line_items" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow delete for authenticated users" ON "public"."sku_base" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow delete for authenticated users" ON "public"."sku_inventory" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow delete for authenticated users" ON "public"."sku_variants" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow full access to auth users" ON "public"."purchase_order_asset_mapping" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."purchase_order_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."purchase_orders" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow insert for authenticated users" ON "public"."purchase_line_items" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow insert for authenticated users" ON "public"."sku_base" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow insert for authenticated users" ON "public"."sku_inventory" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow insert for authenticated users" ON "public"."sku_variants" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow select for authenticated users" ON "public"."purchase_line_items" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow select for authenticated users" ON "public"."sku_base" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow select for authenticated users" ON "public"."sku_inventory" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow select for authenticated users" ON "public"."sku_variants" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow update for authenticated users" ON "public"."purchase_line_items" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow update for authenticated users" ON "public"."sku_base" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow update for authenticated users" ON "public"."sku_inventory" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow update for authenticated users" ON "public"."sku_variants" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can insert models" ON "public"."models" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read models" ON "public"."models" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



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


ALTER TABLE "public"."asset_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."models" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."po_counter" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_line_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_order_asset_mapping" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reorder_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_base" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_category_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_inventory" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_variants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_assets_on_receive"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_assets_on_receive"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_assets_on_receive"() TO "service_role";



GRANT ALL ON FUNCTION "public"."decrement_inventory_on_asset_sold"() TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_inventory_on_asset_sold"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_inventory_on_asset_sold"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_inventory_on_asset_creation"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_inventory_on_asset_creation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_inventory_on_asset_creation"() TO "service_role";



GRANT ALL ON TABLE "public"."_migration_tracking" TO "anon";
GRANT ALL ON TABLE "public"."_migration_tracking" TO "authenticated";
GRANT ALL ON TABLE "public"."_migration_tracking" TO "service_role";



GRANT ALL ON TABLE "public"."accessories" TO "anon";
GRANT ALL ON TABLE "public"."accessories" TO "authenticated";
GRANT ALL ON TABLE "public"."accessories" TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."asset_counters" TO "anon";
GRANT ALL ON TABLE "public"."asset_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_counters" TO "service_role";



GRANT ALL ON TABLE "public"."assets" TO "anon";
GRANT ALL ON TABLE "public"."assets" TO "authenticated";
GRANT ALL ON TABLE "public"."assets" TO "service_role";



GRANT ALL ON TABLE "public"."custom_options" TO "anon";
GRANT ALL ON TABLE "public"."custom_options" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_options" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



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



GRANT ALL ON TABLE "public"."models" TO "anon";
GRANT ALL ON TABLE "public"."models" TO "authenticated";
GRANT ALL ON TABLE "public"."models" TO "service_role";



GRANT ALL ON TABLE "public"."po_counter" TO "anon";
GRANT ALL ON TABLE "public"."po_counter" TO "authenticated";
GRANT ALL ON TABLE "public"."po_counter" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_files" TO "anon";
GRANT ALL ON TABLE "public"."purchase_files" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_files" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_line_items" TO "anon";
GRANT ALL ON TABLE "public"."purchase_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."purchase_order_asset_mapping" TO "anon";
GRANT ALL ON TABLE "public"."purchase_order_asset_mapping" TO "authenticated";
GRANT ALL ON TABLE "public"."purchase_order_asset_mapping" TO "service_role";



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



GRANT ALL ON TABLE "public"."sale_items" TO "anon";
GRANT ALL ON TABLE "public"."sale_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_items" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON TABLE "public"."sku_base" TO "anon";
GRANT ALL ON TABLE "public"."sku_base" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_base" TO "service_role";



GRANT ALL ON TABLE "public"."sku_category_templates" TO "anon";
GRANT ALL ON TABLE "public"."sku_category_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_category_templates" TO "service_role";



GRANT ALL ON TABLE "public"."sku_inventory" TO "anon";
GRANT ALL ON TABLE "public"."sku_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_inventory" TO "service_role";



GRANT ALL ON TABLE "public"."sku_master" TO "anon";
GRANT ALL ON TABLE "public"."sku_master" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_master" TO "service_role";



GRANT ALL ON TABLE "public"."sku_variants" TO "anon";
GRANT ALL ON TABLE "public"."sku_variants" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_variants" TO "service_role";



GRANT ALL ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."v_inventory_status" TO "anon";
GRANT ALL ON TABLE "public"."v_inventory_status" TO "authenticated";
GRANT ALL ON TABLE "public"."v_inventory_status" TO "service_role";



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







