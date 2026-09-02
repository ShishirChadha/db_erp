


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


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






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


CREATE OR REPLACE FUNCTION "public"."apply_backup_restore"("p_payload" "jsonb", "p_selected" "jsonb", "p_created_by" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_safety_id uuid;
  v_summary jsonb := '{}'::jsonb;
  v_table text;
  v_apply_order text[] := array['customers','vendors','sku_master','purchases',
                                 'purchase_orders','purchase_order_items','asset_ledger','stock_movements',
                                 'sales_documents','sales_document_items','invoices','invoice_items',
                                 'repair_jobs','sales','sale_payments'];
  v_ids uuid[];
  v_all_cols text[];
  v_select_list text;
  v_set_list text;
  v_col text;
  v_excluded text[];
  v_has_updated_at boolean;
  v_has_updated_by boolean;
  v_affected int;
begin
  v_safety_id := public.generate_backup_snapshot(array['full'], 'pre_restore_safety', p_created_by);

  foreach v_table in array v_apply_order loop
    continue when not (p_payload ? v_table);
    select array(select (jsonb_array_elements_text(coalesce(p_selected->v_table, '[]'::jsonb)))::uuid) into v_ids;
    continue when v_ids is null or array_length(v_ids,1) is null;

    -- Trigger-derived columns must never be written by application code (CLAUDE.md invariant).
    v_excluded := case v_table
      when 'sku_master' then array['quantity_in_stock']
      when 'sales' then array['amount_paid','payment_status']
      else array[]::text[]
    end;

    select array_agg(column_name order by ordinal_position) into v_all_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = v_table;

    v_has_updated_at := 'updated_at' = any(v_all_cols);
    v_has_updated_by := 'updated_by' = any(v_all_cols);

    -- SELECT list: every real column from the staged jsonb rows, except updated_at/updated_by
    -- (always forced to now()/actor below, on both insert and update -- a restore-time write is
    -- a real touch of the record either way).
    select string_agg(
      case
        when c = 'updated_at' then 'now() as updated_at'
        when c = 'updated_by' then format('%L::uuid as updated_by', p_created_by)
        else format('%I', c)
      end,
      ', ' order by ord
    ) into v_select_list
    from unnest(v_all_cols) with ordinality as t(c, ord);

    -- ON CONFLICT SET list: every column except id, created_at, created_by (provenance is
    -- immutable -- restore never rewrites who/when a record was first created) and the
    -- trigger-derived exclusions for this table.
    select string_agg(
      case
        when c = 'updated_at' then 'updated_at = now()'
        when c = 'updated_by' then format('updated_by = %L::uuid', p_created_by)
        else format('%1$I = excluded.%1$I', c)
      end,
      ', '
    ) into v_set_list
    from unnest(v_all_cols) c
    where c not in ('id','created_at','created_by')
      and not (c = any(v_excluded));

    execute format(
      'insert into public.%1$I (%2$s)
       select %3$s from jsonb_populate_recordset(null::public.%1$I,
         (select jsonb_agg(elem) from jsonb_array_elements($1) elem where (elem->>''id'')::uuid = any($2))
       )
       on conflict (id) do update set %4$s',
      v_table,
      array_to_string(v_all_cols, ', '),
      v_select_list,
      v_set_list
    ) using (p_payload -> v_table), v_ids;

    get diagnostics v_affected = row_count;
    v_summary := v_summary || jsonb_build_object(v_table, jsonb_build_object('applied', v_affected));
  end loop;

  return v_summary || jsonb_build_object('safetySnapshotId', v_safety_id);
end;
$_$;


ALTER FUNCTION "public"."apply_backup_restore"("p_payload" "jsonb", "p_selected" "jsonb", "p_created_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bible_introspect_rpcs"() RETURNS TABLE("function_name" "text", "arguments" "text", "return_type" "text", "function_comment" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  select
    p.proname::text as function_name,
    pg_get_function_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as return_type,
    obj_description(p.oid, 'pg_proc') as function_comment
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.prokind = 'f'
    and p.proname not like 'bible_introspect_%'
  order by p.proname;
$$;


ALTER FUNCTION "public"."bible_introspect_rpcs"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bible_introspect_rpcs"() IS 'Build-tooling only (scripts/bible/generate.ts). Not for application code.';



CREATE OR REPLACE FUNCTION "public"."bible_introspect_schema"() RETURNS TABLE("table_name" "text", "table_comment" "text", "column_name" "text", "ordinal_position" integer, "data_type" "text", "is_nullable" boolean, "column_default" "text", "column_comment" "text", "is_primary_key" boolean, "foreign_table" "text", "foreign_column" "text", "row_estimate" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  select
    c.relname::text as table_name,
    obj_description(c.oid, 'pg_class') as table_comment,
    a.attname::text as column_name,
    a.attnum::int as ordinal_position,
    format_type(a.atttypid, a.atttypmod) as data_type,
    not a.attnotnull as is_nullable,
    pg_get_expr(ad.adbin, ad.adrelid) as column_default,
    col_description(c.oid, a.attnum) as column_comment,
    exists (
      select 1 from pg_constraint pk
      where pk.conrelid = c.oid and pk.contype = 'p' and a.attnum = any(pk.conkey)
    ) as is_primary_key,
    ft.relname::text as foreign_table,
    fa.attname::text as foreign_column,
    c.reltuples::bigint as row_estimate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
  left join pg_constraint fk on fk.conrelid = c.oid and fk.contype = 'f' and a.attnum = fk.conkey[1]
  left join pg_class ft on ft.oid = fk.confrelid
  left join pg_attribute fa on fa.attrelid = ft.oid and fa.attnum = fk.confkey[1]
  where c.relkind = 'r'
  order by c.relname, a.attnum;
$$;


ALTER FUNCTION "public"."bible_introspect_schema"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bible_introspect_schema"() IS 'Build-tooling only (scripts/bible/generate.ts). Not for application code.';



CREATE OR REPLACE FUNCTION "public"."bible_introspect_status_values"() RETURNS TABLE("table_name" "text", "column_name" "text", "constraint_name" "text", "check_clause" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  select
    c.relname::text as table_name,
    coalesce(a.attname::text, '') as column_name,
    con.conname::text as constraint_name,
    pg_get_constraintdef(con.oid) as check_clause
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  left join pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
  where con.contype = 'c'
  order by c.relname, con.conname;
$$;


ALTER FUNCTION "public"."bible_introspect_status_values"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bible_introspect_status_values"() IS 'Build-tooling only (scripts/bible/generate.ts). Not for application code.';



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


CREATE OR REPLACE FUNCTION "public"."dispatch_digests"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cfg record;
  sub record;
begin
  select * into cfg from public.digest_channel_config where id = true;
  if cfg.dispatch_url is null or cfg.dispatch_secret is null then
    return;
  end if;

  for sub in
    select s.*, p.is_active
    from public.digest_subscriptions s
    join public.profiles p on p.id = s.profile_id
    where s.enabled and p.is_active
  loop
    declare
      offset_hours numeric := case sub.timezone when 'Asia/Kolkata' then 5.5 else 0 end;
      local_hour int := floor((extract(hour from now() at time zone 'UTC') + offset_hours))::int % 24;
    begin
      if local_hour <> sub.hour_local then
        continue;
      end if;
    end;

    if exists (
      select 1 from public.digest_runs
      where subscription_id = sub.id and sent_at::date = current_date
    ) then
      continue;
    end if;

    perform net.http_post(
      url := cfg.dispatch_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', cfg.dispatch_secret),
      body := jsonb_build_object('subscription_id', sub.id)
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."dispatch_digests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_bank_match_amount_cap"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_txn_id uuid := coalesce(new.bank_transaction_id, old.bank_transaction_id);
  v_applied numeric;
  v_txn_amount numeric;
begin
  select coalesce(sum(amount_applied), 0) into v_applied from bank_transaction_matches where bank_transaction_id = v_txn_id;
  select coalesce(debit, credit, 0) into v_txn_amount from bank_transactions where id = v_txn_id;

  if v_applied > v_txn_amount + 0.5 then
    raise exception 'Matched amount (%) exceeds the transaction amount (%) for bank_transaction %', v_applied, v_txn_amount, v_txn_id;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."enforce_bank_match_amount_cap"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."generate_backup_snapshot"("p_modules" "text"[], "p_trigger_type" "text", "p_created_by" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
  v_payload jsonb := '{}'::jsonb;
  v_row_counts jsonb := '{}'::jsonb;
  v_tables text[] := array[]::text[];
  v_table text;
  v_rows jsonb;
  v_error text;
  v_retention smallint;
begin
  if p_trigger_type not in ('scheduled','manual','pre_restore_safety') then
    raise exception 'invalid trigger_type: %', p_trigger_type;
  end if;

  if 'full' = any(p_modules) then
    v_tables := array['sales','sale_payments','purchase_orders','purchase_order_items','purchases',
                       'sku_master','asset_ledger','stock_movements','repair_jobs','customers','vendors',
                       'invoices','invoice_items','sales_documents','sales_document_items'];
  else
    if 'sales' = any(p_modules) then v_tables := v_tables || array['sales','sale_payments']; end if;
    if 'purchases' = any(p_modules) then v_tables := v_tables || array['purchase_orders','purchase_order_items','purchases']; end if;
    if 'inventory' = any(p_modules) then v_tables := v_tables || array['sku_master','asset_ledger','stock_movements']; end if;
    if 'repairs' = any(p_modules) then v_tables := v_tables || array['repair_jobs']; end if;
    if 'customers_vendors' = any(p_modules) then v_tables := v_tables || array['customers','vendors']; end if;
    if 'invoices_quotations' = any(p_modules) then v_tables := v_tables || array['invoices','invoice_items','sales_documents','sales_document_items']; end if;
  end if;

  if array_length(v_tables,1) is null then
    raise exception 'no valid modules resolved from %', p_modules;
  end if;

  begin
    foreach v_table in array v_tables loop
      execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', v_table) into v_rows;
      v_payload := v_payload || jsonb_build_object(v_table, v_rows);
      v_row_counts := v_row_counts || jsonb_build_object(v_table, jsonb_array_length(v_rows));
    end loop;
  exception when others then
    get stacked diagnostics v_error = message_text;
    insert into public.backup_snapshots (created_by, trigger_type, modules, payload, row_counts, status, error_message, size_bytes)
    values (p_created_by, p_trigger_type, p_modules, '{}'::jsonb, '{}'::jsonb, 'failed', v_error, 0)
    returning id into v_id;
    return v_id;
  end;

  insert into public.backup_snapshots (created_by, trigger_type, modules, payload, row_counts, status, size_bytes)
  values (p_created_by, p_trigger_type, p_modules, v_payload, v_row_counts, 'complete', octet_length(v_payload::text))
  returning id into v_id;

  if p_trigger_type = 'scheduled' then
    insert into public.notifications (recipient_id, type, actor_id, activity_id, comment_id, title, body, link)
    select pr.id, 'backup_ready', null, null, null,
           'New backup ready',
           format('Scheduled backup completed (%s tables, ~%s KB).', array_length(v_tables,1), greatest(octet_length(v_payload::text) / 1024, 1)),
           '/dashboard/settings/backup'
    from public.profiles pr where pr.role = 'owner';

    select retention_count into v_retention from public.backup_settings where id = true;
    delete from public.backup_snapshots
    where trigger_type = 'scheduled'
      and id not in (
        select id from public.backup_snapshots where trigger_type = 'scheduled'
        order by created_at desc limit v_retention
      );
  end if;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."generate_backup_snapshot"("p_modules" "text"[], "p_trigger_type" "text", "p_created_by" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."generate_replacement_job_number"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
declare
  cur_year text := to_char(current_date, 'YY');
  next_num integer;
begin
  insert into public.replacement_job_counter (year, last_number)
  values (cur_year, 1)
  on conflict (year) do update set last_number = replacement_job_counter.last_number + 1
  returning last_number into next_num;

  return 'RPL-' || cur_year || '-' || lpad(next_num::text, 3, '0');
end;
$$;


ALTER FUNCTION "public"."generate_replacement_job_number"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."is_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true
  );
$$;


ALTER FUNCTION "public"."is_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kb_chapters_search_tsv_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
begin
  new.search_tsv :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(new.keywords, ' ')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.body_md, '')), 'C');
  return new;
end;
$$;


ALTER FUNCTION "public"."kb_chapters_search_tsv_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kb_search"("p_query" "text", "p_role" "text", "p_limit" integer DEFAULT 3) RETURNS TABLE("slug" "text", "title" "text", "summary" "text", "body_md" "text", "kind" "text", "rank" real)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
  select
    c.slug, c.title, c.summary, c.body_md, c.kind,
    ts_rank(c.search_tsv, websearch_to_tsquery('english', p_query)) as rank
  from kb_chapters c
  where c.search_tsv @@ websearch_to_tsquery('english', p_query)
    and p_role = any(c.audience)
  order by rank desc
  limit p_limit;
$$;


ALTER FUNCTION "public"."kb_search"("p_query" "text", "p_role" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."kb_search"("p_query" "text", "p_role" "text", "p_limit" integer) IS 'Ranked Bible full-text search for the DB advisor (process/fallback resolvers) -- ts_rank ordering that PostgREST cannot express via .textSearch() alone.';



CREATE OR REPLACE FUNCTION "public"."match_customers_by_name"("p_name" "text", "p_limit" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "customer_name" "text", "similarity" real)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select c.id, c.customer_name, similarity(c.customer_name, p_name) as similarity
  from customers c
  where c.is_deleted is not true
    and c.customer_name % p_name
  order by similarity desc
  limit p_limit;
$$;


ALTER FUNCTION "public"."match_customers_by_name"("p_name" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_vendors_by_name"("p_name" "text", "p_limit" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "company_name" "text", "gst_company_name" "text", "similarity" real)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select v.id, v.company_name, v.gst_company_name,
         greatest(similarity(v.company_name, p_name), similarity(coalesce(v.gst_company_name, ''), p_name)) as similarity
  from vendors v
  where v.is_deleted is not true
    and (v.company_name % p_name or coalesce(v.gst_company_name, '') % p_name)
  order by similarity desc
  limit p_limit;
$$;


ALTER FUNCTION "public"."match_vendors_by_name"("p_name" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_sku_master"("p_source_ids" "uuid"[], "p_target_id" "uuid", "p_actor" "uuid", "p_reason" "text" DEFAULT NULL::"text", "p_allow_cross_category" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_target sku_master%ROWTYPE;
  v_source sku_master%ROWTYPE;
  v_source_id uuid;
  v_new_full text;
  v_new_base text;
  v_suffix int;
  v_qty int;
  v_asset_count int;
  v_reorder_dropped int;
  v_merged jsonb := '[]'::jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'p_actor is required';
  END IF;
  IF p_source_ids IS NULL OR array_length(p_source_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'source_ids must contain at least one id';
  END IF;
  IF p_target_id = ANY(p_source_ids) THEN
    RAISE EXCEPTION 'target_id cannot also appear in source_ids';
  END IF;
  IF (SELECT count(*) FROM sku_master WHERE id = ANY(p_source_ids)) <> array_length(p_source_ids, 1) THEN
    RAISE EXCEPTION 'one or more source_ids do not exist';
  END IF;

  SELECT * INTO v_target FROM sku_master WHERE id = p_target_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target SKU % not found', p_target_id;
  END IF;
  IF v_target.status = 'archived' THEN
    RAISE EXCEPTION 'target SKU % is already archived -- pick an active SKU as the target', p_target_id;
  END IF;

  -- Lock + validate every source row up front, sorted, before mutating anything
  -- so a bad row in the batch fails the whole transaction cleanly.
  FOR v_source IN SELECT * FROM sku_master WHERE id = ANY(p_source_ids) ORDER BY id FOR UPDATE LOOP
    IF v_source.status = 'archived' THEN
      RAISE EXCEPTION 'source SKU % (%) is already archived', v_source.id, v_source.full_sku_code;
    END IF;
    IF NOT p_allow_cross_category AND v_source.category <> v_target.category THEN
      RAISE EXCEPTION 'source SKU % (category %) does not match target category % -- pass allow_cross_category to override',
        v_source.full_sku_code, v_source.category, v_target.category;
    END IF;
  END LOOP;

  FOREACH v_source_id IN ARRAY p_source_ids LOOP
    SELECT * INTO v_source FROM sku_master WHERE id = v_source_id;

    UPDATE asset_ledger SET sku_id = p_target_id WHERE sku_id = v_source_id;
    GET DIAGNOSTICS v_asset_count = ROW_COUNT;

    UPDATE purchase_order_items SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE invoice_items SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE invoice_items SET accessory_id = p_target_id WHERE accessory_id = v_source_id;
    UPDATE sales_document_items SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE sales_document_items SET accessory_id = p_target_id WHERE accessory_id = v_source_id;
    UPDATE sales SET accessory_id = p_target_id WHERE accessory_id = v_source_id;
    UPDATE repair_job_parts SET sku_id = p_target_id WHERE sku_id = v_source_id;

    -- reorder_rules: UNIQUE(sku_id, vendor_id) -- move only non-conflicting rows,
    -- then drop whatever's left (the conflicting ones) rather than let ON DELETE
    -- CASCADE silently vanish an owner-configured policy with no record of it.
    UPDATE reorder_rules r SET sku_id = p_target_id
      WHERE r.sku_id = v_source_id
        AND NOT EXISTS (SELECT 1 FROM reorder_rules t WHERE t.sku_id = p_target_id AND t.vendor_id = r.vendor_id);
    DELETE FROM reorder_rules WHERE sku_id = v_source_id;
    GET DIAGNOSTICS v_reorder_dropped = ROW_COUNT;

    -- stock_movements: deliberately NOT rewritten in place -- trg_sync_sku_stock
    -- is BEFORE INSERT only, so an UPDATE would desync quantity_in_stock, and
    -- rewriting history contradicts the existing reassign-sku precedent. Move the
    -- *current* quantity via one new adjustment pair instead.
    v_qty := COALESCE(v_source.quantity_in_stock, 0);
    IF v_qty <> 0 THEN
      INSERT INTO stock_movements (sku_id, movement_type, quantity_change, notes, created_by)
      VALUES
        (v_source_id, 'adjustment', -v_qty, 'Merged into ' || v_target.full_sku_code || COALESCE(' -- ' || p_reason, ''), p_actor),
        (p_target_id, 'adjustment', v_qty, 'Absorbed ' || v_source.full_sku_code || ' via merge' || COALESCE(' -- ' || p_reason, ''), p_actor);
    END IF;

    -- Archive the source. Rewrite BOTH full_sku_code and base_sku_code so
    -- resolveOrCreateSku() can never re-match a fresh entry onto this row again.
    v_new_full := 'ARCHIVED-' || v_source.full_sku_code;
    v_new_base := 'ARCHIVED-' || v_source.base_sku_code;
    v_suffix := 1;
    LOOP
      BEGIN
        UPDATE sku_master SET status = 'archived', full_sku_code = v_new_full,
               base_sku_code = v_new_base, updated_at = now(), updated_by = p_actor
          WHERE id = v_source_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_suffix := v_suffix + 1;
        v_new_full := 'ARCHIVED-' || v_source.full_sku_code || '-' || v_suffix;
      END;
    END LOOP;

    INSERT INTO field_corrections (table_name, record_id, field_name, old_value, new_value, changed_by, reason)
    VALUES ('sku_master', v_source_id, 'merged_into', v_source.full_sku_code, p_target_id::text, p_actor, p_reason);

    v_merged := v_merged || jsonb_build_object(
      'source_id', v_source_id, 'source_full_sku_code', v_source.full_sku_code,
      'assets_moved', v_asset_count, 'quantity_moved', v_qty, 'reorder_rules_dropped', v_reorder_dropped
    );
  END LOOP;

  RETURN jsonb_build_object('target_id', p_target_id, 'target_full_sku_code', v_target.full_sku_code, 'merged', v_merged);
END;
$$;


ALTER FUNCTION "public"."merge_sku_master"("p_source_ids" "uuid"[], "p_target_id" "uuid", "p_actor" "uuid", "p_reason" "text", "p_allow_cross_category" boolean) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."prevent_self_tier_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.tier IS DISTINCT FROM OLD.tier AND auth.uid() IS NOT NULL AND NOT public.is_staff() THEN
    RAISE EXCEPTION 'tier can only be changed by staff';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_self_tier_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_expired_reservations"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  released record;
  affected_order_ids uuid[] := array[]::uuid[];
begin
  for released in
    update web_reservations
    set released_at = now()
    where released_at is null and expires_at <= now()
    returning id, order_item_id, asset_id, previous_asset_status
  loop
    if released.asset_id is not null then
      update asset_ledger
      set status = coalesce(released.previous_asset_status, 'ready_for_sale')
      where id = released.asset_id and status = 'reserved_web';
    end if;

    affected_order_ids := affected_order_ids || (
      select order_id from order_items where id = released.order_item_id
    );
  end loop;

  update orders
  set status = 'expired'
  where id = any(affected_order_ids)
    and status = 'pending_payment';
end;
$$;


ALTER FUNCTION "public"."release_expired_reservations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_breakdown"("p_from" "date", "p_to" "date", "p_dimension" "text", "p_include_financials" boolean DEFAULT false, "p_limit" integer DEFAULT 20) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result jsonb;
begin
  if p_dimension = 'vendor' then
    if not p_include_financials then
      return '[]'::jsonb;
    end if;
    select coalesce(jsonb_agg(row_data), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'label', vendor_name_canonical,
        'spend', coalesce(sum(line_total), 0),
        'units', coalesce(sum(quantity), 0)
      ) as row_data, sum(line_total) as sort_key
      from v_report_purchase_lines
      where po_date between p_from and p_to
      group by vendor_name_canonical
      order by sort_key desc
      limit p_limit
    ) t;
    return result;
  end if;

  if p_dimension = 'expense_type' then
    select coalesce(jsonb_agg(row_data), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'label', coalesce(type, 'Unknown'),
        'amount', coalesce(sum(amount), 0),
        'count', count(*)
      ) as row_data, sum(amount) as sort_key
      from v_report_expense_lines l
      where expense_date between p_from and p_to
        and (p_include_financials or not exists (
          select 1 from custom_options co
          where co.category = 'expense_types' and co.owner_only and lower(co.value) = lower(coalesce(l.type, ''))
        ))
      group by coalesce(type, 'Unknown')
      order by sort_key desc
      limit p_limit
    ) t;
    return result;
  end if;

  if p_dimension = 'expense_vendor' then
    if not p_include_financials then
      return '[]'::jsonb;
    end if;
    select coalesce(jsonb_agg(row_data), '[]'::jsonb) into result
    from (
      select jsonb_build_object(
        'label', vendor_name_canonical,
        'amount', coalesce(sum(amount), 0),
        'count', count(*)
      ) as row_data, sum(amount) as sort_key
      from v_report_expense_lines
      where expense_date between p_from and p_to
        and vendor_id is not null
      group by vendor_name_canonical
      order by sort_key desc
      limit p_limit
    ) t;
    return result;
  end if;

  select coalesce(jsonb_agg(row_data), '[]'::jsonb) into result
  from (
    select
      jsonb_build_object(
        'label', label,
        'revenue_incl', coalesce(sum(revenue_incl), 0),
        'units', coalesce(sum(units), 0),
        'order_count', count(*)
      ) || case when p_include_financials then jsonb_build_object(
        'gross_margin_known', coalesce(sum(revenue_incl) filter (where cogs_known), 0) - coalesce(sum(cogs) filter (where cogs_known), 0),
        'revenue_of_costed', coalesce(sum(revenue_incl) filter (where cogs_known), 0)
      ) else '{}'::jsonb end as row_data,
      sum(revenue_incl) as sort_key
    from (
      select
        coalesce(
          case p_dimension
            when 'brand' then brand
            when 'category' then category
            when 'staff' then sold_by_canonical
            when 'entity' then entity
            when 'sale_type' then sale_type
            when 'customer' then customer_name_canonical
          end, 'Unknown') as label,
        revenue_incl, units, cogs_known, cogs
      from v_report_sale_lines
      where sale_date between p_from and p_to
        and p_dimension in ('brand', 'category', 'staff', 'entity', 'sale_type', 'customer')
    ) labeled
    group by label
    order by sort_key desc
    limit p_limit
  ) t;

  return result;
end;
$$;


ALTER FUNCTION "public"."report_breakdown"("p_from" "date", "p_to" "date", "p_dimension" "text", "p_include_financials" boolean, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_data_health"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_object_agg(issue, row_count), '{}'::jsonb) from v_report_data_health;
$$;


ALTER FUNCTION "public"."report_data_health"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_expense_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text" DEFAULT 'day'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  trunc_unit text;
  result jsonb;
begin
  trunc_unit := case when p_grain in ('day', 'week', 'month') then p_grain else 'day' end;

  select coalesce(jsonb_agg(row_data order by bucket), '[]'::jsonb) into result
  from (
    select
      date_trunc(trunc_unit, expense_date)::date as bucket,
      jsonb_build_object(
        'date', date_trunc(trunc_unit, expense_date)::date,
        'total_amount', coalesce(sum(amount), 0),
        'entry_count', count(*)
      ) as row_data
    from v_report_expense_lines
    where expense_date between p_from and p_to
    group by 1
  ) t;

  return result;
end;
$$;


ALTER FUNCTION "public"."report_expense_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_expense_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text" DEFAULT 'day'::"text", "p_include_financials" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  trunc_unit text;
  result jsonb;
begin
  trunc_unit := case when p_grain in ('day', 'week', 'month') then p_grain else 'day' end;

  select coalesce(jsonb_agg(row_data order by bucket), '[]'::jsonb) into result
  from (
    select
      date_trunc(trunc_unit, l.expense_date)::date as bucket,
      jsonb_build_object(
        'date', date_trunc(trunc_unit, l.expense_date)::date,
        'total_amount', coalesce(sum(l.amount), 0),
        'entry_count', count(*)
      ) as row_data
    from v_report_expense_lines l
    where l.expense_date between p_from and p_to
      and (p_include_financials or not exists (
        select 1 from custom_options co
        where co.category = 'expense_types' and co.owner_only and lower(co.value) = lower(coalesce(l.type, ''))
      ))
    group by 1
  ) t;

  return result;
end;
$$;


ALTER FUNCTION "public"."report_expense_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text", "p_include_financials" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_expenses"("p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total_amount', coalesce(sum(amount), 0),
    'entry_count', count(*),
    'avg_amount', case when count(*) > 0 then round(coalesce(sum(amount), 0) / count(*), 2) else 0 end
  ) into result
  from v_report_expense_lines
  where expense_date between p_from and p_to;

  return result;
end;
$$;


ALTER FUNCTION "public"."report_expenses"("p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_expenses"("p_from" "date", "p_to" "date", "p_include_financials" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total_amount', coalesce(sum(l.amount), 0),
    'entry_count', count(*),
    'avg_amount', case when count(*) > 0 then round(coalesce(sum(l.amount), 0) / count(*), 2) else 0 end
  ) into result
  from v_report_expense_lines l
  where l.expense_date between p_from and p_to
    and (p_include_financials or not exists (
      select 1 from custom_options co
      where co.category = 'expense_types' and co.owner_only and lower(co.value) = lower(coalesce(l.type, ''))
    ));

  return result;
end;
$$;


ALTER FUNCTION "public"."report_expenses"("p_from" "date", "p_to" "date", "p_include_financials" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_fy"("d" "date") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when extract(month from d) >= 4
    then extract(year from d)::text || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1)::text || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0')
  end
$$;


ALTER FUNCTION "public"."report_fy"("d" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_gst_summary"("p_from" "date", "p_to" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result jsonb;
  not_invoiced int;
begin
  select coalesce(jsonb_agg(row_data order by row_data->>'month', row_data->>'entity'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'month', month_start, 'entity', coalesce(entity, 'Unknown'),
      'taxable_value', coalesce(sum(revenue_ex_gst) filter (where sale_type = 'GST'), 0),
      'gst', coalesce(sum(gst), 0),
      'cash_revenue', coalesce(sum(revenue_incl) filter (where sale_type = 'Cash'), 0)
    ) as row_data
    from v_report_sale_lines
    where sale_date between p_from and p_to
    group by month_start, entity
  ) t;

  select count(*) into not_invoiced
  from v_report_sale_lines where sale_date between p_from and p_to and sale_type = 'GST' and not invoice_finalized;

  return jsonb_build_object('by_month_entity', result, 'gst_sales_not_invoiced', not_invoiced);
end;
$$;


ALTER FUNCTION "public"."report_gst_summary"("p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_inventory"("p_include_financials" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  units_summary jsonb;
  ageing jsonb;
  accessories jsonb;
begin
  select jsonb_build_object(
    'sellable_count', count(*) filter (where status_bucket = 'sellable'),
    'on_hand_count', count(*) filter (where status_bucket = 'on_hand'),
    'qc_pending_count', count(*) filter (where status = 'qc_pending'),
    'faulty_count', count(*) filter (where status_bucket = 'faulty'),
    'rma_count', count(*) filter (where status_bucket = 'rma'),
    'sold_without_sale_row', count(*) filter (where status_bucket = 'sold' and not has_sale_row)
  ) || case when p_include_financials then jsonb_build_object(
    'stock_value_at_cost', coalesce(sum(cost_price) filter (where status_bucket in ('sellable', 'on_hand') and cost_known), 0),
    'stock_value_costed_count', count(*) filter (where status_bucket in ('sellable', 'on_hand') and cost_known),
    'stock_value_at_sell', coalesce(sum(selling_price_default) filter (where status_bucket in ('sellable', 'on_hand')), 0)
  ) else '{}'::jsonb end
  into units_summary
  from v_report_inventory_units;

  select coalesce(jsonb_agg(row_data order by (row_data->>'bucket')), '[]'::jsonb) into ageing
  from (
    select jsonb_build_object('bucket', bucket, 'count', cnt) as row_data
    from (
      select
        case when age_days <= 30 then '0-30' when age_days <= 60 then '31-60' when age_days <= 90 then '61-90' else '90+' end as bucket,
        count(*) as cnt
      from v_report_inventory_units
      where status_bucket in ('sellable', 'on_hand')
      group by 1
    ) g
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sku_id', sku_id, 'full_sku_code', full_sku_code, 'brand', brand, 'category', category,
    'quantity_in_stock', quantity_in_stock, 'low_stock', low_stock, 'needs_po_qty', needs_po_qty
  ) order by low_stock desc, quantity_in_stock asc), '[]'::jsonb)
  into accessories
  from v_report_accessory_stock
  where low_stock or needs_po_qty > 0;

  return jsonb_build_object('units', units_summary, 'ageing', ageing, 'accessories_attention', accessories);
end;
$$;


ALTER FUNCTION "public"."report_inventory"("p_include_financials" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_kpis"("p_from" "date", "p_to" "date", "p_compare_from" "date" DEFAULT NULL::"date", "p_compare_to" "date" DEFAULT NULL::"date", "p_include_financials" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cur jsonb;
  prev jsonb;
  result jsonb;
begin
  select jsonb_build_object(
    'revenue_incl', coalesce(sum(revenue_incl), 0),
    'revenue_ex_gst', coalesce(sum(revenue_ex_gst), 0),
    'gst', coalesce(sum(gst), 0),
    'units', coalesce(sum(units), 0),
    'order_count', count(*),
    'collections', coalesce(sum(amount_paid), 0),
    'outstanding', coalesce(sum(outstanding), 0),
    'new_customers', (
      select count(distinct customer_id) from v_report_sale_lines s2
      where s2.sale_date between p_from and p_to and s2.customer_id is not null
        and not exists (select 1 from v_report_sale_lines s3 where s3.customer_id = s2.customer_id and s3.sale_date < p_from)
    ),
    'repeat_customers', (
      select count(distinct customer_id) from v_report_sale_lines s2
      where s2.sale_date between p_from and p_to and s2.customer_id is not null
        and exists (select 1 from v_report_sale_lines s3 where s3.customer_id = s2.customer_id and s3.sale_date < p_from)
    )
  ) || case when p_include_financials then jsonb_build_object(
    'cogs_known', coalesce(sum(cogs) filter (where cogs_known), 0),
    'revenue_of_costed', coalesce(sum(revenue_incl) filter (where cogs_known), 0),
    'gross_margin_known', coalesce(sum(revenue_incl) filter (where cogs_known), 0) - coalesce(sum(cogs) filter (where cogs_known), 0),
    'unit_sales_total', count(*) filter (where line_kind = 'unit'),
    'unit_sales_costed', count(*) filter (where line_kind = 'unit' and cogs_known),
    'cost_coverage_pct', case when count(*) filter (where line_kind = 'unit') > 0
      then round(100.0 * count(*) filter (where line_kind = 'unit' and cogs_known) / count(*) filter (where line_kind = 'unit'), 1)
      else null end
  ) else '{}'::jsonb end
  into cur
  from v_report_sale_lines
  where sale_date between p_from and p_to;

  if p_compare_from is not null and p_compare_to is not null then
    select jsonb_build_object('revenue_incl', coalesce(sum(revenue_incl), 0), 'units', coalesce(sum(units), 0))
    into prev
    from v_report_sale_lines where sale_date between p_compare_from and p_compare_to;
  else
    prev := null;
  end if;

  result := jsonb_build_object('current', cur, 'period', jsonb_build_object('from', p_from, 'to', p_to));

  if prev is not null then
    result := result || jsonb_build_object(
      'previous', prev,
      'compare_period', jsonb_build_object('from', p_compare_from, 'to', p_compare_to),
      'revenue_growth_pct', case when (prev->>'revenue_incl')::numeric > 0
        then round(100.0 * ((cur->>'revenue_incl')::numeric - (prev->>'revenue_incl')::numeric) / (prev->>'revenue_incl')::numeric, 1)
        else null end
    );
  end if;

  return result;
end;
$$;


ALTER FUNCTION "public"."report_kpis"("p_from" "date", "p_to" "date", "p_compare_from" "date", "p_compare_to" "date", "p_include_financials" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_receivables"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  by_bucket jsonb;
  top_debtors jsonb;
begin
  select coalesce(jsonb_agg(row_data order by row_data->>'bucket'), '[]'::jsonb) into by_bucket
  from (
    select jsonb_build_object('bucket', ageing_bucket, 'count', count(*), 'outstanding', coalesce(sum(outstanding), 0)) as row_data
    from v_report_receivables group by ageing_bucket
  ) t;

  select coalesce(jsonb_agg(row_data), '[]'::jsonb) into top_debtors
  from (
    select jsonb_build_object(
      'customer_name', customer_name_canonical, 'outstanding', sum(outstanding), 'sales_count', count(*),
      'oldest_days', max(days_outstanding)
    ) as row_data, sum(outstanding) as sort_key
    from v_report_receivables group by customer_name_canonical
    order by sort_key desc limit 15
  ) t;

  return jsonb_build_object('by_bucket', by_bucket, 'top_debtors', top_debtors);
end;
$$;


ALTER FUNCTION "public"."report_receivables"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text" DEFAULT 'day'::"text", "p_include_financials" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  trunc_unit text;
  result jsonb;
begin
  trunc_unit := case when p_grain in ('day', 'week', 'month') then p_grain else 'day' end;

  select coalesce(jsonb_agg(row_data order by bucket), '[]'::jsonb) into result
  from (
    select
      date_trunc(trunc_unit, sale_date)::date as bucket,
      jsonb_build_object(
        'date', date_trunc(trunc_unit, sale_date)::date,
        'revenue_incl', coalesce(sum(revenue_incl), 0),
        'units', coalesce(sum(units), 0),
        'order_count', count(*)
      ) || case when p_include_financials then jsonb_build_object(
        'gross_margin_known', coalesce(sum(revenue_incl) filter (where cogs_known), 0) - coalesce(sum(cogs) filter (where cogs_known), 0),
        'cost_coverage_pct', case when count(*) filter (where line_kind = 'unit') > 0
          then round(100.0 * count(*) filter (where line_kind = 'unit' and cogs_known) / count(*) filter (where line_kind = 'unit'), 1)
          else null end
      ) else '{}'::jsonb end as row_data
    from v_report_sale_lines
    where sale_date between p_from and p_to
    group by 1
  ) t;

  return result;
end;
$$;


ALTER FUNCTION "public"."report_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text", "p_include_financials" boolean) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."reserve_order_items"("p_order_id" "uuid", "p_ttl_minutes" integer DEFAULT 15) RETURNS TABLE("order_item_id" "uuid", "reserved" boolean, "reason" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  item record;
  candidate_asset_id uuid;
  candidate_prev_status text;
  active_reserved_qty integer;
  current_stock integer;
  expires timestamptz := now() + (p_ttl_minutes || ' minutes')::interval;
begin
  for item in
    select oi.id, oi.sku_id, oi.quantity, sm.category
    from order_items oi
    join sku_master sm on sm.id = oi.sku_id
    where oi.order_id = p_order_id
  loop
    if item.category = any (array['RAM','SSD','CPU','GPU','KBD','MOUSE','ACC','ADP']) then
      select coalesce(sum(wr.quantity), 0) into active_reserved_qty
      from web_reservations wr
      where wr.sku_id = item.sku_id and wr.released_at is null and wr.expires_at > now();

      select quantity_in_stock into current_stock from sku_master where id = item.sku_id;

      if current_stock - active_reserved_qty >= item.quantity then
        insert into web_reservations (order_item_id, sku_id, quantity, expires_at)
        values (item.id, item.sku_id, item.quantity, expires);
        order_item_id := item.id; reserved := true; reason := null;
      else
        order_item_id := item.id; reserved := false; reason := 'sold_out';
      end if;
    else
      candidate_asset_id := null;
      select al.id, al.status into candidate_asset_id, candidate_prev_status
      from asset_ledger al
      where al.sku_id = item.sku_id
        and al.is_deleted = false
        and al.status in ('qc_passed', 'ready_for_sale')
        and not exists (
          select 1 from web_reservations wr
          where wr.asset_id = al.id and wr.released_at is null and wr.expires_at > now()
        )
      order by al.created_at
      limit 1
      for update of al skip locked;

      if candidate_asset_id is not null then
        update asset_ledger set status = 'reserved_web' where id = candidate_asset_id;
        insert into web_reservations (order_item_id, sku_id, asset_id, quantity, previous_asset_status, expires_at)
        values (item.id, item.sku_id, candidate_asset_id, 1, candidate_prev_status, expires);
        order_item_id := item.id; reserved := true; reason := null;
      else
        order_item_id := item.id; reserved := false; reason := 'sold_out';
      end if;
    end if;
    return next;
  end loop;
end;
$$;


ALTER FUNCTION "public"."reserve_order_items"("p_order_id" "uuid", "p_ttl_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_scheduled_backup"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_settings record;
begin
  select * into v_settings from public.backup_settings where id = true;
  if v_settings is null or not v_settings.enabled then
    return;
  end if;
  perform public.generate_backup_snapshot(v_settings.modules, 'scheduled', null);
end;
$$;


ALTER FUNCTION "public"."run_scheduled_backup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scan_activity_due_dates"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  act RECORD;
  recipient uuid;
BEGIN
  FOR act IN
    UPDATE activities a
    SET due_soon_notified_at = now()
    WHERE a.is_deleted = false
      AND a.status NOT IN ('done', 'cancelled')
      AND a.due_date IS NOT NULL
      AND a.due_date > now()
      AND a.due_date <= now() + interval '24 hours'
      AND a.due_soon_notified_at IS NULL
    RETURNING a.id, a.title, a.created_by, a.due_date
  LOOP
    FOR recipient IN
      SELECT DISTINCT uid FROM (
        SELECT act.created_by AS uid
        UNION
        SELECT user_id AS uid FROM activity_assignees WHERE activity_id = act.id
      ) x
    LOOP
      INSERT INTO notifications (recipient_id, type, actor_id, activity_id, title, body, link)
      VALUES (recipient, 'due_soon', NULL, act.id, act.title,
              'Due ' || to_char(act.due_date, 'DD Mon HH24:MI'),
              '/dashboard/activities?open=' || act.id);
    END LOOP;
  END LOOP;

  FOR act IN
    UPDATE activities a
    SET overdue_notified_at = now()
    WHERE a.is_deleted = false
      AND a.status NOT IN ('done', 'cancelled')
      AND a.due_date IS NOT NULL
      AND a.due_date < now()
      AND a.overdue_notified_at IS NULL
    RETURNING a.id, a.title, a.created_by, a.due_date
  LOOP
    FOR recipient IN
      SELECT DISTINCT uid FROM (
        SELECT act.created_by AS uid
        UNION
        SELECT user_id AS uid FROM activity_assignees WHERE activity_id = act.id
      ) x
    LOOP
      INSERT INTO notifications (recipient_id, type, actor_id, activity_id, title, body, link)
      VALUES (recipient, 'overdue', NULL, act.id, act.title,
              'Was due ' || to_char(act.due_date, 'DD Mon HH24:MI'),
              '/dashboard/activities?open=' || act.id);
    END LOOP;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."scan_activity_due_dates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scan_recurring_expenses"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rule record;
  act_id uuid;
  recipient uuid;
begin
  for rule in
    update recurring_expense_rules r
    set next_due_date = r.next_due_date + (case r.interval_unit
          when 'weekly' then interval '7 days'
          when 'monthly' then interval '1 month'
          when 'yearly' then interval '1 year'
        end),
        last_reminded_at = now()
    where r.is_active
      and r.next_due_date <= (current_date + r.reminder_lead_days)
    returning
      r.id, r.type, r.description, r.entity_key, r.created_by, r.assignee_id,
      (r.next_due_date - (case r.interval_unit
          when 'weekly' then interval '7 days'
          when 'monthly' then interval '1 month'
          when 'yearly' then interval '1 year'
        end))::date as due_date
  loop
    recipient := coalesce(rule.assignee_id, rule.created_by);

    insert into activities (user_id, title, description, due_date, related_type, related_id, created_by, priority, status)
    values (
      recipient,
      'Record recurring expense: ' || rule.type || case when rule.entity_key is not null then ' (' || rule.entity_key || ')' else '' end,
      rule.description,
      rule.due_date::timestamptz,
      'recurring_expense',
      rule.id,
      recipient,
      'normal',
      'pending'
    )
    returning id into act_id;

    insert into activity_assignees (activity_id, user_id, assigned_by)
    values (act_id, recipient, recipient);

    insert into notifications (recipient_id, type, actor_id, activity_id, title, body, link)
    values (
      recipient, 'task_assigned', null, act_id,
      'Recurring expense due: ' || rule.type,
      'Due ' || to_char(rule.due_date, 'DD Mon YYYY'),
      '/dashboard/activities?open=' || act_id
    );
  end loop;
end;
$$;


ALTER FUNCTION "public"."scan_recurring_expenses"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_bank_transaction_recon_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_txn_id uuid := coalesce(new.bank_transaction_id, old.bank_transaction_id);
  v_applied numeric;
  v_txn_amount numeric;
  v_has_transfer boolean;
  v_status text;
begin
  select coalesce(sum(amount_applied), 0) into v_applied from bank_transaction_matches where bank_transaction_id = v_txn_id;
  select coalesce(debit, credit, 0) into v_txn_amount from bank_transactions where id = v_txn_id;
  select exists (select 1 from bank_transaction_matches where bank_transaction_id = v_txn_id and match_type = 'transfer_pair') into v_has_transfer;

  if v_has_transfer then
    v_status := 'transfer';
  elsif v_applied <= 0 then
    v_status := 'open';
  elsif v_applied >= v_txn_amount - 0.5 then
    v_status := 'matched';
  else
    v_status := 'split';
  end if;

  update bank_transactions set recon_status = v_status where id = v_txn_id and recon_status not in ('explained', 'ignored');
  -- 'explained'/'ignored' are owner-set terminal states (a non-purchase debit or a
  -- deliberately-skipped row) -- a match insert/delete never overrides those; the
  -- owner un-explains a row explicitly first if it turns out to need matching.

  return null;
end;
$$;


ALTER FUNCTION "public"."sync_bank_transaction_recon_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_expense_reimbursement_status_on_paid_by_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' or new.paid_by_staff is distinct from old.paid_by_staff then
    if new.paid_by_staff is null then
      new.reimbursement_status := 'not_applicable';
    elsif new.reimbursed_amount <= 0 then
      new.reimbursement_status := 'pending';
    elsif new.reimbursed_amount >= coalesce(new.amount, 0) - 0.5 then
      new.reimbursement_status := 'reimbursed';
    else
      new.reimbursement_status := 'partial';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_expense_reimbursement_status_on_paid_by_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_expense_reimbursement_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_expense_id uuid := coalesce(new.expense_id, old.expense_id);
  v_total numeric;
  v_amount numeric;
  v_paid_by_staff text;
begin
  select coalesce(sum(amount), 0) into v_total from expense_reimbursements where expense_id = v_expense_id;
  select amount, paid_by_staff into v_amount, v_paid_by_staff from expenses where id = v_expense_id;

  update expenses
  set reimbursed_amount = v_total,
      reimbursement_status = case
        when v_paid_by_staff is null then 'not_applicable'
        when v_total <= 0 then 'pending'
        when v_amount is not null and v_total >= v_amount - 0.5 then 'reimbursed'
        else 'partial'
      end
  where id = v_expense_id;

  return null;
end;
$$;


ALTER FUNCTION "public"."sync_expense_reimbursement_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_po_payment_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_po_id uuid := coalesce(new.po_id, old.po_id);
  v_total numeric;
  v_grand_total numeric;
begin
  select coalesce(sum(amount), 0) into v_total from vendor_payments where po_id = v_po_id;
  select grand_total into v_grand_total from purchase_orders where id = v_po_id;

  update purchase_orders
  set amount_paid = v_total,
      payment_status = case
        when v_total <= 0 then 'pending'
        when v_grand_total is not null and v_total >= v_grand_total - 0.5 then 'paid'
        else 'partial'
      end
  where id = v_po_id;

  return null;
end;
$$;


ALTER FUNCTION "public"."sync_po_payment_totals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_sale_payment_totals"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_sale_id uuid := coalesce(new.sale_id, old.sale_id);
  v_total numeric;
  v_sale_total numeric;
begin
  select coalesce(sum(amount), 0) into v_total from sale_payments where sale_id = v_sale_id;
  select sale_total into v_sale_total from sales where id = v_sale_id;

  update sales
  set amount_paid = v_total,
      payment_status = case
        when v_total <= 0 then 'pending'
        when v_sale_total is not null and v_total >= v_sale_total - 0.5 then 'paid'
        else 'partial'
      end
  where id = v_sale_id;

  return null;
end;
$$;


ALTER FUNCTION "public"."sync_sale_payment_totals"() OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."backup_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "frequency" "text" DEFAULT 'weekly'::"text" NOT NULL,
    "day_of_week" smallint,
    "hour_local" smallint DEFAULT 3 NOT NULL,
    "timezone" "text" DEFAULT 'Asia/Kolkata'::"text" NOT NULL,
    "modules" "text"[] DEFAULT ARRAY['full'::"text"] NOT NULL,
    "retention_count" smallint DEFAULT 10 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "backup_settings_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "backup_settings_frequency_check" CHECK (("frequency" = ANY (ARRAY['daily'::"text", 'weekly'::"text"]))),
    CONSTRAINT "backup_settings_hour_local_check" CHECK ((("hour_local" >= 0) AND ("hour_local" <= 23))),
    CONSTRAINT "backup_settings_retention_count_check" CHECK ((("retention_count" >= 1) AND ("retention_count" <= 100))),
    CONSTRAINT "backup_settings_singleton" CHECK (("id" = true))
);


ALTER TABLE "public"."backup_settings" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_backup_settings"("p_enabled" boolean, "p_frequency" "text", "p_day_of_week" smallint, "p_hour_local" smallint, "p_modules" "text"[], "p_retention_count" smallint, "p_timezone" "text", "p_cron_expression" "text", "p_updated_by" "uuid") RETURNS "public"."backup_settings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.backup_settings;
begin
  update public.backup_settings set
    enabled = p_enabled,
    frequency = p_frequency,
    day_of_week = p_day_of_week,
    hour_local = p_hour_local,
    modules = p_modules,
    retention_count = p_retention_count,
    timezone = p_timezone,
    updated_at = now(),
    updated_by = p_updated_by
  where id = true
  returning * into v_row;

  perform cron.schedule('erp-scheduled-backup', p_cron_expression, 'select public.run_scheduled_backup();');

  return v_row;
end;
$$;


ALTER FUNCTION "public"."update_backup_settings"("p_enabled" boolean, "p_frequency" "text", "p_day_of_week" smallint, "p_hour_local" smallint, "p_modules" "text"[], "p_retention_count" smallint, "p_timezone" "text", "p_cron_expression" "text", "p_updated_by" "uuid") OWNER TO "postgres";


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
    "created_by" "uuid" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "related_type" "text",
    "related_id" "uuid",
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "is_deleted" boolean DEFAULT false NOT NULL,
    "due_soon_notified_at" timestamp with time zone,
    "overdue_notified_at" timestamp with time zone,
    CONSTRAINT "activities_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "activities_related_pair_check" CHECK ((("related_type" IS NULL) = ("related_id" IS NULL))),
    CONSTRAINT "activities_related_type_check" CHECK ((("related_type" IS NULL) OR ("related_type" = ANY (ARRAY['customer'::"text", 'sale'::"text", 'purchase_order'::"text", 'asset'::"text", 'repair_job'::"text", 'invoice'::"text", 'vendor'::"text", 'recurring_expense'::"text"])))),
    CONSTRAINT "activities_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_assignees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "assigned_by" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_assignees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_checklist_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "text" "text" NOT NULL,
    "is_done" boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "completed_by" "uuid"
);


ALTER TABLE "public"."activity_checklist_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_comment_reactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_comment_reactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "mentioned_user_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "edited" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attachments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "pinned" boolean DEFAULT false NOT NULL,
    "pinned_by" "uuid",
    "pinned_at" timestamp with time zone
);


ALTER TABLE "public"."activity_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_watchers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "activity_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "added_by" "uuid",
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."activity_watchers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."advisor_queries" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "raw_text" "text" NOT NULL,
    "matched_resolver" "text",
    "role" "text" NOT NULL,
    "user_id" "uuid",
    "duration_ms" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."advisor_queries" OWNER TO "postgres";


COMMENT ON TABLE "public"."advisor_queries" IS 'DB advisor miss log -- every question asked, whether a resolver matched, and how long it took. Feeds the Bible backlog (unmatched questions -> which chapter/keyword to add next).';



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
    "battery_health_percent" smallint,
    "estimated_backup_hours" numeric(4,1),
    "screen_condition" "text",
    "keyboard_condition" "text",
    "body_condition" "text",
    "included_accessories" "text",
    CONSTRAINT "asset_ledger_battery_health_percent_check" CHECK ((("battery_health_percent" IS NULL) OR (("battery_health_percent" >= 0) AND ("battery_health_percent" <= 100)))),
    CONSTRAINT "asset_ledger_estimated_backup_hours_check" CHECK ((("estimated_backup_hours" IS NULL) OR ("estimated_backup_hours" >= (0)::numeric))),
    CONSTRAINT "asset_ledger_qc_grade_check" CHECK (("qc_grade" = ANY (ARRAY['A'::"text", 'B'::"text", 'C'::"text", 'D'::"text", 'Scrap'::"text"]))),
    CONSTRAINT "asset_ledger_qc_status_check" CHECK (("qc_status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'passed'::"text", 'failed'::"text"]))),
    CONSTRAINT "asset_ledger_source_check" CHECK (("source" = ANY (ARRAY['purchase_order'::"text", 'legacy_purchase'::"text", 'employee_intake'::"text"]))),
    CONSTRAINT "asset_ledger_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'reserved'::"text", 'received'::"text", 'in_stock'::"text", 'sold'::"text", 'faulty'::"text", 'returned'::"text", 'qc_pending'::"text", 'qc_passed'::"text", 'ready_for_sale'::"text", 'rma_sent'::"text", 'rma_returned'::"text", 'scrapped'::"text", 'pending_sale'::"text", 'pending_replacement'::"text", 'reserved_web'::"text"]))),
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


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "actor_email" "text",
    "actor_role" "text",
    "action_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "module" "text" NOT NULL,
    "table_name" "text",
    "record_id" "uuid",
    "record_label" "text",
    "field_correction_ids" "uuid"[],
    "snapshot" "jsonb",
    "restore_status" "text" DEFAULT 'not_applicable'::"text" NOT NULL,
    "restored_at" timestamp with time zone,
    "restored_by" "uuid",
    "reason" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_action_type_check" CHECK (("action_type" = ANY (ARRAY['create'::"text", 'update'::"text", 'status_change'::"text", 'soft_delete'::"text", 'restore'::"text", 'hard_delete'::"text", 'void'::"text", 'login'::"text", 'login_failed'::"text", 'logout'::"text"]))),
    CONSTRAINT "audit_log_restore_status_check" CHECK (("restore_status" = ANY (ARRAY['not_applicable'::"text", 'restorable'::"text", 'restored'::"text", 'restore_failed'::"text"]))),
    CONSTRAINT "audit_log_severity_check" CHECK (("severity" = ANY (ARRAY['major'::"text", 'minor'::"text"])))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log" IS 'Row-per-action audit trail across every module -- distinct from the unrelated activities/"Activity Hub" task system. Written via lib/audit-log.ts logAuditEvent(). References field_corrections rows (via field_correction_ids) for update-type events rather than duplicating field-diff storage.';



CREATE TABLE IF NOT EXISTS "public"."backup_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "trigger_type" "text" NOT NULL,
    "modules" "text"[] NOT NULL,
    "payload" "jsonb" NOT NULL,
    "row_counts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'complete'::"text" NOT NULL,
    "error_message" "text",
    "downloaded_at" timestamp with time zone,
    "size_bytes" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "backup_snapshots_status_check" CHECK (("status" = ANY (ARRAY['complete'::"text", 'failed'::"text"]))),
    CONSTRAINT "backup_snapshots_trigger_type_check" CHECK (("trigger_type" = ANY (ARRAY['scheduled'::"text", 'manual'::"text", 'pre_restore_safety'::"text"])))
);


ALTER TABLE "public"."backup_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "bank_name" "text",
    "account_number_last4" "text",
    "opening_balance" numeric DEFAULT 0 NOT NULL,
    "opening_balance_date" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bank_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_categorization_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_account_id" "uuid",
    "narration_pattern" "text" NOT NULL,
    "category" "text" NOT NULL,
    "auto_apply" boolean DEFAULT false NOT NULL,
    "times_used" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bank_categorization_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_column_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_account_id" "uuid" NOT NULL,
    "source_format" "text" DEFAULT 'csv'::"text" NOT NULL,
    "column_map" "jsonb" NOT NULL,
    "date_format" "text" DEFAULT 'DD/MM/YYYY'::"text" NOT NULL,
    "amount_style" "text" DEFAULT 'split_dr_cr'::"text" NOT NULL,
    "header_fingerprint" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_column_profiles_amount_style_check" CHECK (("amount_style" = ANY (ARRAY['split_dr_cr'::"text", 'signed'::"text"]))),
    CONSTRAINT "bank_column_profiles_source_format_check" CHECK (("source_format" = ANY (ARRAY['csv'::"text", 'pdf'::"text"])))
);


ALTER TABLE "public"."bank_column_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_statements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_account_id" "uuid" NOT NULL,
    "document_id" "uuid",
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "opening_balance" numeric,
    "closing_balance" numeric,
    "continuity_status" "text" DEFAULT 'ok'::"text" NOT NULL,
    "continuity_notes" "jsonb",
    "row_count" integer DEFAULT 0 NOT NULL,
    "inserted_count" integer DEFAULT 0 NOT NULL,
    "duplicate_count" integer DEFAULT 0 NOT NULL,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_statements_continuity_status_check" CHECK (("continuity_status" = ANY (ARRAY['ok'::"text", 'gap'::"text", 'mismatch'::"text"])))
);


ALTER TABLE "public"."bank_statements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_transaction_matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_transaction_id" "uuid" NOT NULL,
    "match_type" "text" NOT NULL,
    "sale_payment_id" "uuid",
    "vendor_payment_id" "uuid",
    "expense_id" "uuid",
    "counterpart_txn_id" "uuid",
    "amount_applied" numeric NOT NULL,
    "variance" numeric,
    "variance_reason" "text",
    "matched_by" "uuid",
    "matched_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_transaction_matches_amount_applied_check" CHECK (("amount_applied" > (0)::numeric)),
    CONSTRAINT "bank_transaction_matches_match_type_check" CHECK (("match_type" = ANY (ARRAY['sale_payment'::"text", 'vendor_payment'::"text", 'expense'::"text", 'transfer_pair'::"text"])))
);


ALTER TABLE "public"."bank_transaction_matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bank_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_account_id" "uuid" NOT NULL,
    "bank_statement_id" "uuid",
    "txn_date" "date" NOT NULL,
    "value_date" "date",
    "narration" "text" NOT NULL,
    "reference" "text",
    "debit" numeric,
    "credit" numeric,
    "running_balance" numeric,
    "category" "text",
    "recon_status" "text" DEFAULT 'open'::"text" NOT NULL,
    "dedupe_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bank_transactions_recon_status_check" CHECK (("recon_status" = ANY (ARRAY['open'::"text", 'matched'::"text", 'split'::"text", 'explained'::"text", 'transfer'::"text", 'ignored'::"text"])))
);


ALTER TABLE "public"."bank_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blog_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "excerpt" "text",
    "body" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "blog_posts_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."blog_posts" OWNER TO "postgres";


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
    "invoicing_mode" "text" DEFAULT 'erp'::"text" NOT NULL,
    CONSTRAINT "business_profiles_invoicing_mode_check" CHECK (("invoicing_mode" = ANY (ARRAY['erp'::"text", 'external'::"text"]))),
    CONSTRAINT "business_profiles_key_check" CHECK (("key" = ANY (ARRAY['digitalbluez'::"text", 'techtenth'::"text", 'cash'::"text"])))
);


ALTER TABLE "public"."business_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cart_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "selected_upgrades" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "cart_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."cart_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "owner_only" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."custom_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_profiles" (
    "id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "full_name" "text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tier" "text" DEFAULT 'standard'::"text" NOT NULL,
    CONSTRAINT "customer_profiles_tier_check" CHECK (("tier" = ANY (ARRAY['standard'::"text", 'vip'::"text", 'wholesale'::"text"])))
);


ALTER TABLE "public"."customer_profiles" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."digest_channel_config" (
    "id" boolean DEFAULT true NOT NULL,
    "email_enabled" boolean DEFAULT false NOT NULL,
    "email_from_override" "text",
    "whatsapp_enabled" boolean DEFAULT false NOT NULL,
    "whatsapp_phone_number_id" "text",
    "whatsapp_access_token_encrypted" "text",
    "whatsapp_template_name" "text",
    "whatsapp_graph_api_version" "text" DEFAULT 'v21.0'::"text" NOT NULL,
    "dispatch_url" "text",
    "dispatch_secret" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "digest_channel_config_singleton" CHECK (("id" = true))
);


ALTER TABLE "public"."digest_channel_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."digest_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subscription_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "channel" "text" NOT NULL,
    "status" "text" NOT NULL,
    "provider_message_id" "text",
    "error_message" "text",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "digest_runs_channel_check" CHECK (("channel" = ANY (ARRAY['email'::"text", 'whatsapp'::"text", 'in_app'::"text"]))),
    CONSTRAINT "digest_runs_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."digest_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."digest_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "period" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "channels" "jsonb" DEFAULT '{"email": true, "in_app": true, "whatsapp": false}'::"jsonb" NOT NULL,
    "hour_local" smallint DEFAULT 21 NOT NULL,
    "timezone" "text" DEFAULT 'Asia/Kolkata'::"text" NOT NULL,
    "whatsapp_number" "text",
    "email_override" "text",
    "blocks" "text"[] DEFAULT ARRAY['kpis'::"text", 'inventory'::"text"] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "digest_subscriptions_hour_local_check" CHECK ((("hour_local" >= 0) AND ("hour_local" <= 23))),
    CONSTRAINT "digest_subscriptions_period_check" CHECK (("period" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'fortnightly'::"text", 'monthly'::"text"])))
);


ALTER TABLE "public"."digest_subscriptions" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."expense_reimbursements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expense_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "payment_account" "text",
    "note" "text",
    "recorded_by" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "expense_reimbursements_payment_account_check" CHECK (("payment_account" = ANY (ARRAY['Digitalbluez'::"text", 'Techtenth'::"text", 'Cash'::"text"])))
);


ALTER TABLE "public"."expense_reimbursements" OWNER TO "postgres";


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
    "payment_account" "text",
    "entity_key" "text",
    "vendor_id" "uuid",
    "created_by" "uuid",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "attachments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "paid_by_staff" "text",
    "reimbursed_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "reimbursement_status" "text" DEFAULT 'not_applicable'::"text" NOT NULL,
    CONSTRAINT "expenses_payment_account_check" CHECK (("payment_account" = ANY (ARRAY['Digitalbluez'::"text", 'Techtenth'::"text", 'Cash'::"text"]))),
    CONSTRAINT "expenses_reimbursement_status_check" CHECK (("reimbursement_status" = ANY (ARRAY['not_applicable'::"text", 'pending'::"text", 'partial'::"text", 'reimbursed'::"text"]))),
    CONSTRAINT "expenses_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'bank_recon'::"text"])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."extraction_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_kind" "text" NOT NULL,
    "vendor_id" "uuid",
    "bank_account_id" "uuid",
    "match_fingerprint" "text" NOT NULL,
    "field_rules" "jsonb" NOT NULL,
    "times_used" integer DEFAULT 0 NOT NULL,
    "last_used_at" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "extraction_templates_template_kind_check" CHECK (("template_kind" = ANY (ARRAY['vendor_invoice'::"text", 'bank_statement'::"text"])))
);


ALTER TABLE "public"."extraction_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."field_corrections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "field_name" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason" "text"
);


ALTER TABLE "public"."field_corrections" OWNER TO "postgres";


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
    "repair_job_id" "uuid",
    CONSTRAINT "invoice_items_gst_type_check" CHECK (("gst_type" = ANY (ARRAY['IGST'::"text", 'CGST_SGST'::"text"]))),
    CONSTRAINT "invoice_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['asset'::"text", 'accessory'::"text", 'custom'::"text", 'repair'::"text"])))
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
    "source" "text" DEFAULT 'system_issued'::"text" NOT NULL,
    "imported_by" "uuid",
    "imported_at" timestamp with time zone,
    CONSTRAINT "invoices_invoice_type_check" CHECK (("invoice_type" = ANY (ARRAY['sales'::"text", 'purchase'::"text", 'credit_note'::"text"]))),
    CONSTRAINT "invoices_source_check" CHECK (("source" = ANY (ARRAY['system_issued'::"text", 'imported_zoho'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_chapter_sections" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "chapter_slug" "text" NOT NULL,
    "heading" "text" NOT NULL,
    "anchor" "text" NOT NULL,
    "body_md" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."kb_chapter_sections" OWNER TO "postgres";


COMMENT ON TABLE "public"."kb_chapter_sections" IS 'Heading-level chunks of a kb_chapters row, for search-hit highlighting/deep-linking within a chapter.';



CREATE TABLE IF NOT EXISTS "public"."kb_chapters" (
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "audience" "text"[] DEFAULT '{owner,manager,employee}'::"text"[] NOT NULL,
    "routes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "keywords" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "summary" "text" DEFAULT ''::"text" NOT NULL,
    "body_md" "text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "source_globs" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "updated_at" "date" NOT NULL,
    "search_tsv" "tsvector",
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "kb_chapters_kind_check" CHECK (("kind" = ANY (ARRAY['module'::"text", 'process'::"text", 'rule'::"text", 'generated'::"text"])))
);


ALTER TABLE "public"."kb_chapters" OWNER TO "postgres";


COMMENT ON TABLE "public"."kb_chapters" IS 'DB advisor Bible chapters -- synced from docs/bible/**/*.md via scripts/bible/sync.ts. Never write here directly; edit the markdown and re-sync.';



CREATE TABLE IF NOT EXISTS "public"."market_price_observations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sku_id" "uuid",
    "competitor" "text" NOT NULL,
    "price" numeric(12,2) NOT NULL,
    "condition_grade" "text",
    "source_url" "text",
    "notes" "text",
    "observed_by" "uuid",
    "observed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."market_price_observations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."newsletter_subscribers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "subscribed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "unsubscribed_at" timestamp with time zone
);


ALTER TABLE "public"."newsletter_subscribers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "actor_id" "uuid",
    "activity_id" "uuid",
    "comment_id" "uuid",
    "title" "text" NOT NULL,
    "body" "text",
    "link" "text",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "unit_price" numeric(12,2) NOT NULL,
    "title_snapshot" "text",
    "erp_sale_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "selected_upgrades" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_promotional_gift" boolean DEFAULT false NOT NULL,
    CONSTRAINT "order_items_quantity_check" CHECK (("quantity" > 0))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending_payment'::"text" NOT NULL,
    "total_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "shipping_address" "jsonb",
    "razorpay_order_id" "text",
    "razorpay_payment_id" "text",
    "razorpay_signature" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "paid_at" timestamp with time zone,
    "discount_amount" numeric(10,2) DEFAULT 0,
    "applied_promotion_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['pending_payment'::"text", 'paid'::"text", 'cancelled'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."po_counter" (
    "year" integer NOT NULL,
    "last_number" integer DEFAULT 0
);


ALTER TABLE "public"."po_counter" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_images" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "alt_text" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "width" integer,
    "height" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."product_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_page_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "page_key" "text" NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_page_actions_page_key_check" CHECK (("page_key" = ANY (ARRAY['new_entry'::"text", 'accessories'::"text", 'repair_jobs'::"text", 'replacement_jobs'::"text", 'sku_master'::"text", 'live_stock'::"text", 'invoices'::"text", 'customers'::"text", 'activities'::"text", 'sales'::"text", 'stock'::"text", 'website'::"text", 'expenses'::"text", 'quotations'::"text", 'rma'::"text"])))
);


ALTER TABLE "public"."profile_page_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'employee'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "allowed_pages" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "username" "text",
    "contact_email" "text",
    "employee_id" "text",
    "encrypted_password" "text",
    "calendar_feed_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ui_preferences" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "profiles_allowed_pages_check" CHECK (("allowed_pages" <@ ARRAY['dashboard'::"text", 'pending_tasks'::"text", 'new_entry'::"text", 'accessories'::"text", 'repair_jobs'::"text", 'replacement_jobs'::"text", 'sku_master'::"text", 'live_stock'::"text", 'invoices'::"text", 'customers'::"text", 'activities'::"text", 'sales'::"text", 'stock'::"text", 'website'::"text", 'expenses'::"text", 'reports'::"text", 'quotations'::"text", 'rma'::"text"])),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'employee'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promotion_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promotion_id" "uuid" NOT NULL,
    "customer_id" "uuid",
    "order_id" "uuid",
    "redeemed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."promotion_redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promotions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "promo_type" "text" NOT NULL,
    "code" "text",
    "discount_percent" numeric(5,2),
    "discount_flat" numeric(10,2),
    "free_gift_sku_id" "uuid",
    "scope_type" "text" NOT NULL,
    "scope_value" "text",
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "is_stackable" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "min_order_value" numeric(10,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "promotions_check" CHECK (((("promo_type" = 'percent_off'::"text") AND ("discount_percent" IS NOT NULL)) OR (("promo_type" = 'flat_off'::"text") AND ("discount_flat" IS NOT NULL)) OR (("promo_type" = 'free_gift'::"text") AND ("free_gift_sku_id" IS NOT NULL)) OR ("promo_type" = 'coupon_code'::"text"))),
    CONSTRAINT "promotions_check1" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "promotions_promo_type_check" CHECK (("promo_type" = ANY (ARRAY['percent_off'::"text", 'flat_off'::"text", 'free_gift'::"text", 'coupon_code'::"text"]))),
    CONSTRAINT "promotions_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['product'::"text", 'brand'::"text", 'category'::"text", 'sitewide'::"text"])))
);


ALTER TABLE "public"."promotions" OWNER TO "postgres";


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
    "is_published" boolean DEFAULT false NOT NULL,
    "web_price" numeric(12,2),
    "market_price" numeric(12,2),
    "web_slug" "text",
    "web_title" "text",
    "web_description" "text",
    "web_highlights" "jsonb",
    "web_condition_grade" "text",
    "published_at" timestamp with time zone,
    CONSTRAINT "sku_master_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'discontinued'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."sku_master" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_asset_test_report" WITH ("security_invoker"='false') AS
 SELECT "al"."sku_id",
    "al"."serial_number",
    "qc"."check_item",
    "qc"."result"
   FROM (("public"."asset_qc_checks" "qc"
     JOIN "public"."asset_ledger" "al" ON (("al"."id" = "qc"."asset_id")))
     JOIN "public"."sku_master" "sm" ON (("sm"."id" = "al"."sku_id")))
  WHERE (("al"."is_deleted" = false) AND ("al"."status" = ANY (ARRAY['qc_passed'::"text", 'ready_for_sale'::"text"])) AND ("sm"."is_published" = true) AND ("sm"."status" = 'active'::"text"));


ALTER VIEW "public"."public_asset_test_report" OWNER TO "postgres";


COMMENT ON VIEW "public"."public_asset_test_report" IS 'Anon-safe per-unit Test Report checklist. Never selects checked_by (staff uuid) or notes (internal shorthand). Never rolls up across units of a SKU.';



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


CREATE OR REPLACE VIEW "public"."public_categories" WITH ("security_invoker"='false') AS
 SELECT "category",
    "display_name",
    "field_schema"
   FROM "public"."sku_category_templates";


ALTER VIEW "public"."public_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sku_cross_sell_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_category" "text" NOT NULL,
    "suggested_category" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sku_cross_sell_rules" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_cross_sell_rules" WITH ("security_invoker"='false') AS
 SELECT "source_category",
    "suggested_category",
    "sort_order"
   FROM "public"."sku_cross_sell_rules"
  WHERE ("is_active" = true)
  ORDER BY "sort_order";


ALTER VIEW "public"."public_cross_sell_rules" OWNER TO "postgres";


COMMENT ON VIEW "public"."public_cross_sell_rules" IS 'Anon-safe active cross-sell category mapping for "Complete your setup".';



CREATE OR REPLACE VIEW "public"."public_product_images" WITH ("security_invoker"='false') AS
 SELECT "pi"."id",
    "pi"."sku_id",
    "pi"."storage_path",
    "pi"."alt_text",
    "pi"."sort_order",
    "pi"."is_primary",
    "pi"."width",
    "pi"."height"
   FROM ("public"."product_images" "pi"
     JOIN "public"."sku_master" "sm" ON (("sm"."id" = "pi"."sku_id")))
  WHERE (("sm"."is_published" = true) AND ("sm"."status" = 'active'::"text"));


ALTER VIEW "public"."public_product_images" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_product_units" WITH ("security_invoker"='false') AS
 SELECT "al"."sku_id",
    "al"."serial_number",
    "al"."qc_grade",
    "al"."qc_at",
    "al"."battery_health_percent",
    "al"."estimated_backup_hours",
    "al"."screen_condition",
    "al"."keyboard_condition",
    "al"."body_condition",
    "al"."included_accessories",
    "al"."warranty_type",
    "al"."warranty_duration_months"
   FROM ("public"."asset_ledger" "al"
     JOIN "public"."sku_master" "sm" ON (("sm"."id" = "al"."sku_id")))
  WHERE (("al"."is_deleted" = false) AND ("al"."status" = ANY (ARRAY['qc_passed'::"text", 'ready_for_sale'::"text"])) AND ("sm"."is_published" = true) AND ("sm"."status" = 'active'::"text"));


ALTER VIEW "public"."public_product_units" OWNER TO "postgres";


COMMENT ON VIEW "public"."public_product_units" IS 'Anon-safe per-unit QC/condition/warranty info for the product page "this exact unit" card. Never select qc_by (staff uuid) or qc_notes (internal shorthand) here.';



CREATE OR REPLACE VIEW "public"."public_products" WITH ("security_invoker"='false') AS
 SELECT "id",
    "web_slug",
    "full_sku_code",
    "category",
    "item_type",
    "brand",
    "model_name",
    "specifications",
    "web_title",
    "web_description",
    "web_highlights",
    "web_condition_grade",
    COALESCE("web_price", "selling_price_default") AS "web_price",
    "market_price",
    "hsn_code",
    "published_at",
        CASE
            WHEN ("category" = ANY (ARRAY['RAM'::"text", 'SSD'::"text", 'CPU'::"text", 'GPU'::"text", 'KBD'::"text", 'MOUSE'::"text", 'ACC'::"text", 'ADP'::"text"])) THEN
            CASE
                WHEN ("quantity_in_stock" <= 0) THEN 'sold_out'::"text"
                WHEN ("quantity_in_stock" <= 2) THEN 'low_stock'::"text"
                ELSE 'in_stock'::"text"
            END
            ELSE
            CASE
                WHEN (( SELECT "count"(*) AS "count"
                   FROM "public"."asset_ledger" "al"
                  WHERE (("al"."sku_id" = "sm"."id") AND ("al"."is_deleted" = false) AND ("al"."status" = ANY (ARRAY['qc_passed'::"text", 'ready_for_sale'::"text"])))) <= 0) THEN 'sold_out'::"text"
                WHEN (( SELECT "count"(*) AS "count"
                   FROM "public"."asset_ledger" "al"
                  WHERE (("al"."sku_id" = "sm"."id") AND ("al"."is_deleted" = false) AND ("al"."status" = ANY (ARRAY['qc_passed'::"text", 'ready_for_sale'::"text"])))) <= 1) THEN 'low_stock'::"text"
                ELSE 'in_stock'::"text"
            END
        END AS "availability_bucket",
    ( SELECT "pi"."storage_path"
           FROM "public"."product_images" "pi"
          WHERE ("pi"."sku_id" = "sm"."id")
          ORDER BY "pi"."is_primary" DESC, "pi"."sort_order"
         LIMIT 1) AS "primary_image_path"
   FROM "public"."sku_master" "sm"
  WHERE (("is_published" = true) AND ("status" = 'active'::"text"));


ALTER VIEW "public"."public_products" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_promotions" WITH ("security_invoker"='false') AS
 SELECT "id",
    "name",
    "promo_type",
    "code",
    "discount_percent",
    "discount_flat",
    "free_gift_sku_id",
    "scope_type",
    "scope_value",
    "is_stackable",
    "min_order_value"
   FROM "public"."promotions"
  WHERE (("is_active" = true) AND (("now"() >= "starts_at") AND ("now"() <= "ends_at")));


ALTER VIEW "public"."public_promotions" OWNER TO "postgres";


COMMENT ON VIEW "public"."public_promotions" IS 'Anon-safe active promotions for the storefront. Never exposes created_by.';



CREATE TABLE IF NOT EXISTS "public"."sku_upgrade_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "field_name" "text" NOT NULL,
    "from_value" "text" NOT NULL,
    "to_value" "text" NOT NULL,
    "price_delta" numeric(10,2) NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "sku_upgrade_rules_field_name_check" CHECK (("field_name" = ANY (ARRAY['ram'::"text", 'ssd'::"text", 'warranty_months'::"text"]))),
    CONSTRAINT "sku_upgrade_rules_price_delta_check" CHECK (("price_delta" >= (0)::numeric))
);


ALTER TABLE "public"."sku_upgrade_rules" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_upgrade_options" WITH ("security_invoker"='false') AS
 SELECT "category",
    "field_name",
    "from_value",
    "to_value",
    "price_delta"
   FROM "public"."sku_upgrade_rules"
  WHERE ("is_active" = true);


ALTER VIEW "public"."public_upgrade_options" OWNER TO "postgres";


COMMENT ON VIEW "public"."public_upgrade_options" IS 'Anon-safe active upgrade-pricing rules for the storefront upgrade selector.';



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
    "amount_paid" numeric DEFAULT 0 NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    CONSTRAINT "purchase_orders_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'partial'::"text", 'paid'::"text"]))),
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


CREATE TABLE IF NOT EXISTS "public"."recon_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bank_account_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "open_count" integer DEFAULT 0 NOT NULL,
    "matched_count" integer DEFAULT 0 NOT NULL,
    "total_count" integer DEFAULT 0 NOT NULL,
    "closed_by" "uuid",
    "closed_at" timestamp with time zone,
    "reopened_by" "uuid",
    "reopened_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recon_sessions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."recon_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_expense_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "description" "text",
    "payment_account" "text" NOT NULL,
    "entity_key" "text",
    "vendor_id" "uuid",
    "expected_amount" numeric(10,2),
    "interval_unit" "text" NOT NULL,
    "next_due_date" "date" NOT NULL,
    "reminder_lead_days" integer DEFAULT 3 NOT NULL,
    "assignee_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "last_reminded_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recurring_expense_rules_interval_unit_check" CHECK (("interval_unit" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "recurring_expense_rules_payment_account_check" CHECK (("payment_account" = ANY (ARRAY['Digitalbluez'::"text", 'Techtenth'::"text", 'Cash'::"text"])))
);


ALTER TABLE "public"."recurring_expense_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."redaction_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shape" "text" NOT NULL,
    "field_name" "text" NOT NULL,
    "hidden_from_employee" boolean DEFAULT true NOT NULL,
    "hidden_from_manager" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."redaction_rules" OWNER TO "postgres";


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
    "sku_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "stock_movement_id" "uuid"
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


CREATE TABLE IF NOT EXISTS "public"."replacement_job_counter" (
    "year" "text" NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."replacement_job_counter" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."replacement_job_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "replacement_job_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "quantity" integer NOT NULL,
    "stock_movement_id" "uuid"
);


ALTER TABLE "public"."replacement_job_parts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."replacement_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "job_number" "text",
    "customer_id" "uuid" NOT NULL,
    "is_own_stock" boolean DEFAULT false NOT NULL,
    "asset_id" "uuid",
    "customer_device_description" "text",
    "customer_device_serial" "text",
    "replacement_asset_id" "uuid" NOT NULL,
    "problem_description" "text",
    "solution_description" "text",
    "status" "text" DEFAULT 'intake'::"text" NOT NULL,
    "amount_charged" numeric,
    "entered_by" "uuid",
    "finalized_by" "uuid",
    "finalized_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_account" "text",
    "job_date" "date",
    CONSTRAINT "replacement_jobs_payment_account_check" CHECK (("payment_account" = ANY (ARRAY['Digitalbluez'::"text", 'Techtenth'::"text", 'Cash'::"text"]))),
    CONSTRAINT "replacement_jobs_status_check" CHECK (("status" = ANY (ARRAY['intake'::"text", 'in_progress'::"text", 'done'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."replacement_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sale_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "payment_account" "text",
    "note" "text",
    "recorded_by" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sale_payments_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."sale_payments" OWNER TO "postgres";


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
    "notes" "text",
    "repair_job_id" "uuid",
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
    "created_by" "uuid",
    "vendor_id" "uuid",
    "unit_price" numeric,
    "purchase_date" "date",
    "payment_account" "text"
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."uploaded_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_kind" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text",
    "page_count" integer,
    "text_layer_chars" integer,
    "extraction_tier" "text",
    "extraction_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "extraction_template_id" "uuid",
    "vendor_id" "uuid",
    "bank_account_id" "uuid",
    "document_date" "date",
    "ai_approved_by" "uuid",
    "ai_approved_at" timestamp with time zone,
    "ai_input_tokens" integer,
    "ai_output_tokens" integer,
    "raw_extraction" "jsonb",
    "validation_errors" "jsonb",
    "content_hash" "text" NOT NULL,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "uploaded_documents_doc_kind_check" CHECK (("doc_kind" = ANY (ARRAY['vendor_invoice'::"text", 'bank_statement'::"text"]))),
    CONSTRAINT "uploaded_documents_extraction_status_check" CHECK (("extraction_status" = ANY (ARRAY['pending'::"text", 'probed'::"text", 'parsed'::"text", 'needs_review'::"text", 'ai_pending_approval'::"text", 'failed'::"text", 'confirmed'::"text"]))),
    CONSTRAINT "uploaded_documents_extraction_tier_check" CHECK (("extraction_tier" = ANY (ARRAY['0_probe'::"text", '1_template'::"text", '2_ai'::"text", '3_manual'::"text"])))
);


ALTER TABLE "public"."uploaded_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_report_accessory_stock" AS
 SELECT "sm"."id" AS "sku_id",
    "sm"."full_sku_code",
    "sm"."brand",
    "sm"."category",
    "sm"."model_name",
    "sm"."quantity_in_stock",
    "sm"."reorder_level",
    ("sm"."quantity_in_stock" <= "sm"."reorder_level") AS "low_stock",
    COALESCE("recv"."qty", (0)::bigint) AS "received_qty",
    COALESCE("sold"."qty", (0)::bigint) AS "sold_qty",
    COALESCE("adj"."qty", (0)::bigint) AS "adjusted_qty",
    COALESCE("needs_po"."qty", (0)::bigint) AS "needs_po_qty",
    NULLIF("sm"."base_cost", (0)::numeric) AS "base_cost"
   FROM (((("public"."sku_master" "sm"
     LEFT JOIN LATERAL ( SELECT "sum"("stock_movements"."quantity_change") AS "qty"
           FROM "public"."stock_movements"
          WHERE (("stock_movements"."sku_id" = "sm"."id") AND ("stock_movements"."movement_type" = 'receipt'::"public"."movement_type_enum"))) "recv" ON (true))
     LEFT JOIN LATERAL ( SELECT "sum"((- "stock_movements"."quantity_change")) AS "qty"
           FROM "public"."stock_movements"
          WHERE (("stock_movements"."sku_id" = "sm"."id") AND ("stock_movements"."movement_type" = 'sale'::"public"."movement_type_enum"))) "sold" ON (true))
     LEFT JOIN LATERAL ( SELECT "sum"("stock_movements"."quantity_change") AS "qty"
           FROM "public"."stock_movements"
          WHERE (("stock_movements"."sku_id" = "sm"."id") AND ("stock_movements"."movement_type" = 'adjustment'::"public"."movement_type_enum"))) "adj" ON (true))
     LEFT JOIN LATERAL ( SELECT "sum"("stock_movements"."quantity_change") AS "qty"
           FROM "public"."stock_movements"
          WHERE (("stock_movements"."sku_id" = "sm"."id") AND ("stock_movements"."movement_type" = 'receipt'::"public"."movement_type_enum") AND ("stock_movements"."po_item_id" IS NULL))) "needs_po" ON (true))
  WHERE ("sm"."category" = ANY (ARRAY['RAM'::"text", 'SSD'::"text", 'CPU'::"text", 'GPU'::"text", 'KBD'::"text", 'MOUSE'::"text", 'ACC'::"text", 'ADP'::"text"]));


ALTER VIEW "public"."v_report_accessory_stock" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_report_sale_lines" AS
 SELECT "s"."id",
    "s"."sale_date",
    "public"."report_fy"("s"."sale_date") AS "fy",
    ("date_trunc"('month'::"text", ("s"."sale_date")::timestamp with time zone))::"date" AS "month_start",
    "s"."payment_account" AS "entity",
    "s"."sale_type",
    COALESCE("s"."sale_base_price", (0)::numeric) AS "revenue_ex_gst",
    COALESCE("s"."sale_gst", (0)::numeric) AS "gst",
    COALESCE("s"."sale_total", (0)::numeric) AS "revenue_incl",
    COALESCE("s"."accessory_quantity", 1) AS "units",
    "s"."customer_id",
    COALESCE("c"."customer_name", "s"."customer_name", 'Unknown'::"text") AS "customer_name_canonical",
    COALESCE(NULLIF(TRIM(BOTH FROM "s"."sold_by"), ''::"text"), 'Unknown'::"text") AS "sold_by_canonical",
    COALESCE("sku_a"."brand", "sku_b"."brand") AS "brand",
    COALESCE("sku_a"."category", "sku_b"."category") AS "category",
        CASE
            WHEN ("s"."repair_job_id" IS NOT NULL) THEN 'repair'::"text"
            WHEN ("s"."accessory_id" IS NOT NULL) THEN 'accessory'::"text"
            WHEN ("s"."asset_ledger_id" IS NOT NULL) THEN 'unit'::"text"
            ELSE 'other'::"text"
        END AS "line_kind",
    "s"."asset_ledger_id",
    "a"."asset_number",
    "a"."serial_number",
    COALESCE("s"."amount_paid", (0)::numeric) AS "amount_paid",
    GREATEST((COALESCE("s"."sale_total", (0)::numeric) - COALESCE("s"."amount_paid", (0)::numeric)), (0)::numeric) AS "outstanding",
    "s"."payment_status",
    "s"."finalized" AS "invoice_finalized",
    "s"."entered_by",
    "s"."created_at",
    "cogs_resolved"."cogs",
    "cogs_resolved"."cogs_known"
   FROM (((((("public"."sales" "s"
     LEFT JOIN "public"."customers" "c" ON (("c"."id" = "s"."customer_id")))
     LEFT JOIN "public"."asset_ledger" "a" ON (("a"."id" = "s"."asset_ledger_id")))
     LEFT JOIN "public"."sku_master" "sku_a" ON (("sku_a"."id" = "a"."sku_id")))
     LEFT JOIN "public"."sku_master" "sku_b" ON (("sku_b"."id" = "s"."accessory_id")))
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN ("a"."id" IS NOT NULL) THEN COALESCE((NULLIF("a"."cost_price", (0)::numeric) + COALESCE(( SELECT "sum"("ac"."amount") AS "sum"
                       FROM "public"."asset_cost_adjustments" "ac"
                      WHERE ("ac"."asset_id" = "a"."id")), (0)::numeric)), NULLIF(( SELECT "poi"."unit_price"
                       FROM "public"."purchase_order_items" "poi"
                      WHERE ("poi"."id" = "a"."po_item_id")), (0)::numeric), NULLIF(( SELECT "p"."total_price"
                       FROM "public"."purchases" "p"
                      WHERE (("p"."serial_number" IS NOT NULL) AND ("a"."serial_number" IS NOT NULL) AND ("lower"(TRIM(BOTH FROM "p"."serial_number")) = "lower"(TRIM(BOTH FROM "a"."serial_number"))) AND (NOT COALESCE("p"."is_deleted", false)))
                      ORDER BY "p"."created_at"
                     LIMIT 1), (0)::numeric))
                    WHEN ("s"."accessory_id" IS NOT NULL) THEN NULLIF(( SELECT "sm"."unit_price"
                       FROM "public"."stock_movements" "sm"
                      WHERE (("sm"."sku_id" = "s"."accessory_id") AND ("sm"."movement_type" = 'receipt'::"public"."movement_type_enum") AND ("sm"."unit_price" > (0)::numeric))
                      ORDER BY "sm"."created_at" DESC
                     LIMIT 1), (0)::numeric)
                    ELSE NULL::numeric
                END AS "cogs_raw") "cogs_calc" ON (true))
     CROSS JOIN LATERAL ( SELECT (COALESCE("cogs_calc"."cogs_raw", (0)::numeric) * (COALESCE("s"."accessory_quantity", 1))::numeric) AS "cogs",
            ("cogs_calc"."cogs_raw" IS NOT NULL) AS "cogs_known") "cogs_resolved")
  WHERE (NOT COALESCE("s"."is_deleted", false));


ALTER VIEW "public"."v_report_sale_lines" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_report_sale_lines" IS 'Canonical revenue+COGS grain, one row per sales row. cogs_known=false means cost genuinely unrecoverable -- never treat cogs as 0 in that case, exclude from margin calcs instead.';



CREATE OR REPLACE VIEW "public"."v_report_data_health" AS
 SELECT 'sold_assets_without_sale_row'::"text" AS "issue",
    "count"(*) AS "row_count"
   FROM "public"."asset_ledger" "a"
  WHERE (("a"."status" = 'sold'::"text") AND (NOT COALESCE("a"."is_deleted", false)) AND (NOT (EXISTS ( SELECT 1
           FROM "public"."sales" "s"
          WHERE (("s"."asset_ledger_id" = "a"."id") AND (NOT COALESCE("s"."is_deleted", false)))))))
UNION ALL
 SELECT 'sales_with_unknown_cogs'::"text" AS "issue",
    "count"(*) AS "row_count"
   FROM "public"."v_report_sale_lines"
  WHERE (("v_report_sale_lines"."line_kind" = 'unit'::"text") AND (NOT "v_report_sale_lines"."cogs_known"))
UNION ALL
 SELECT 'skus_without_base_cost'::"text" AS "issue",
    "count"(*) AS "row_count"
   FROM "public"."sku_master"
  WHERE (COALESCE("sku_master"."base_cost", (0)::numeric) = (0)::numeric)
UNION ALL
 SELECT 'receipts_without_unit_price'::"text" AS "issue",
    "count"(*) AS "row_count"
   FROM "public"."stock_movements"
  WHERE (("stock_movements"."movement_type" = 'receipt'::"public"."movement_type_enum") AND (COALESCE("stock_movements"."unit_price", (0)::numeric) = (0)::numeric))
UNION ALL
 SELECT 'sales_year_month_mismatch'::"text" AS "issue",
    "count"(*) AS "row_count"
   FROM "public"."sales"
  WHERE ((NOT COALESCE("sales"."is_deleted", false)) AND (("sales"."sale_year" IS DISTINCT FROM (EXTRACT(year FROM "sales"."sale_date"))::integer) OR (("sales"."sale_month")::"text" IS DISTINCT FROM "to_char"(("sales"."sale_date")::timestamp with time zone, 'FMMonth'::"text"))))
UNION ALL
 SELECT 'sales_without_asset_or_accessory_link'::"text" AS "issue",
    "count"(*) AS "row_count"
   FROM "public"."sales"
  WHERE ((NOT COALESCE("sales"."is_deleted", false)) AND ("sales"."asset_ledger_id" IS NULL) AND ("sales"."accessory_id" IS NULL) AND ("sales"."repair_job_id" IS NULL))
UNION ALL
 SELECT 'po_items_without_price'::"text" AS "issue",
    "count"(*) AS "row_count"
   FROM "public"."purchase_order_items"
  WHERE (COALESCE("purchase_order_items"."unit_price", (0)::numeric) = (0)::numeric);


ALTER VIEW "public"."v_report_data_health" OWNER TO "postgres";


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
    "vendor_code" character varying(20),
    "supplies_accessories" boolean DEFAULT false NOT NULL,
    "alt_phone" "text"
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


COMMENT ON COLUMN "public"."vendors"."alt_phone" IS 'Secondary phone/mobile number -- distinct from phone, never overwrites it. Filled manually or via Vendor Reconciliation when an invoice prints a second number.';



CREATE OR REPLACE VIEW "public"."v_report_expense_lines" AS
 SELECT "e"."id",
    "e"."expense_date",
    "e"."type",
    "e"."entity_key",
    "e"."payment_account",
    "e"."vendor_id",
    COALESCE("v"."company_name", 'Unknown'::"text") AS "vendor_name_canonical",
    "e"."amount",
    "e"."description"
   FROM ("public"."expenses" "e"
     LEFT JOIN "public"."vendors" "v" ON (("v"."id" = "e"."vendor_id")))
  WHERE ("e"."is_deleted" = false);


ALTER VIEW "public"."v_report_expense_lines" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_report_inventory_units" AS
 SELECT "a"."id",
    "a"."sku_id",
    "sm"."brand",
    "sm"."category",
    "sm"."model_name",
    "a"."status",
        CASE
            WHEN ("a"."status" = ANY (ARRAY['ready_for_sale'::"text", 'qc_passed'::"text"])) THEN 'sellable'::"text"
            WHEN ("a"."status" = 'sold'::"text") THEN 'sold'::"text"
            WHEN ("a"."status" = ANY (ARRAY['faulty'::"text", 'scrapped'::"text"])) THEN 'faulty'::"text"
            WHEN ("a"."status" = ANY (ARRAY['rma_sent'::"text", 'rma_returned'::"text"])) THEN 'rma'::"text"
            ELSE 'on_hand'::"text"
        END AS "status_bucket",
    "a"."source",
    "a"."po_id",
    "a"."asset_number",
    "a"."serial_number",
    COALESCE("a"."received_at", "a"."created_at") AS "intake_at",
    (EXTRACT(day FROM ("now"() - COALESCE("a"."received_at", "a"."created_at"))))::integer AS "age_days",
    (NULLIF("a"."cost_price", (0)::numeric) + COALESCE(( SELECT "sum"("ac"."amount") AS "sum"
           FROM "public"."asset_cost_adjustments" "ac"
          WHERE ("ac"."asset_id" = "a"."id")), (0)::numeric)) AS "cost_price",
    (NULLIF("a"."cost_price", (0)::numeric) IS NOT NULL) AS "cost_known",
    "sm"."selling_price_default",
    "a"."sold_at",
    (EXISTS ( SELECT 1
           FROM "public"."sales" "s"
          WHERE (("s"."asset_ledger_id" = "a"."id") AND (NOT COALESCE("s"."is_deleted", false))))) AS "has_sale_row"
   FROM ("public"."asset_ledger" "a"
     LEFT JOIN "public"."sku_master" "sm" ON (("sm"."id" = "a"."sku_id")))
  WHERE (NOT COALESCE("a"."is_deleted", false));


ALTER VIEW "public"."v_report_inventory_units" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_report_purchase_lines" AS
 SELECT "poi"."id",
    "po"."po_date",
    "public"."report_fy"("po"."po_date") AS "fy",
    ("date_trunc"('month'::"text", ("po"."po_date")::timestamp with time zone))::"date" AS "month_start",
    "po"."vendor_id",
    COALESCE("v"."company_name", "po"."vendor_name", 'Unknown'::"text") AS "vendor_name_canonical",
    "po"."purchased_by_type",
    "po"."purchase_type",
    "poi"."sku_id",
    "sm"."brand",
    "sm"."category",
    "poi"."quantity",
    COALESCE("poi"."base_price", (0)::numeric) AS "base_price",
    COALESCE("poi"."gst_amount", (0)::numeric) AS "gst_amount",
    COALESCE("poi"."line_total", (0)::numeric) AS "line_total",
    "po"."po_number",
    "po"."po_status"
   FROM ((("public"."purchase_order_items" "poi"
     JOIN "public"."purchase_orders" "po" ON (("po"."id" = "poi"."po_id")))
     LEFT JOIN "public"."vendors" "v" ON (("v"."id" = "po"."vendor_id")))
     LEFT JOIN "public"."sku_master" "sm" ON (("sm"."id" = "poi"."sku_id")))
  WHERE (NOT COALESCE("po"."is_deleted", false));


ALTER VIEW "public"."v_report_purchase_lines" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_report_receivables" AS
 SELECT "id",
    "sale_date",
    "entity",
    "customer_id",
    "customer_name_canonical",
    "revenue_incl",
    "amount_paid",
    "outstanding",
    "payment_status",
    (CURRENT_DATE - "sale_date") AS "days_outstanding",
        CASE
            WHEN ((CURRENT_DATE - "sale_date") <= 15) THEN '0-15'::"text"
            WHEN ((CURRENT_DATE - "sale_date") <= 30) THEN '16-30'::"text"
            WHEN ((CURRENT_DATE - "sale_date") <= 60) THEN '31-60'::"text"
            ELSE '60+'::"text"
        END AS "ageing_bucket"
   FROM "public"."v_report_sale_lines" "s"
  WHERE ("outstanding" > 0.5);


ALTER VIEW "public"."v_report_receivables" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vendor_code_seq"
    START WITH 63
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendor_code_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_correction_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "field_name" "text" NOT NULL,
    "current_value" "text",
    "proposed_value" "text",
    "change_kind" "text" NOT NULL,
    "confidence" "text" DEFAULT 'high'::"text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "decided_by" "uuid",
    "decided_at" timestamp with time zone,
    "field_correction_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_correction_proposals_change_kind_check" CHECK (("change_kind" = ANY (ARRAY['fill_missing'::"text", 'conflict'::"text", 'derived'::"text"]))),
    CONSTRAINT "vendor_correction_proposals_confidence_check" CHECK (("confidence" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"]))),
    CONSTRAINT "vendor_correction_proposals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."vendor_correction_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "po_id" "uuid" NOT NULL,
    "purchase_invoice_id" "uuid",
    "amount" numeric NOT NULL,
    "payment_account" "text",
    "paid_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "method" "text",
    "reference" "text",
    "note" "text",
    "recorded_by" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "vendor_payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "vendor_payments_payment_account_check" CHECK (("payment_account" = ANY (ARRAY['Digitalbluez'::"text", 'Techtenth'::"text", 'Cash'::"text"])))
);


ALTER TABLE "public"."vendor_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."web_reservations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "order_item_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "asset_id" "uuid",
    "quantity" integer DEFAULT 1 NOT NULL,
    "previous_asset_status" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "released_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."web_reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."wishlist_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "sku_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."wishlist_items" OWNER TO "postgres";


ALTER TABLE ONLY "public"."_migration_tracking"
    ADD CONSTRAINT "_migration_tracking_pkey" PRIMARY KEY ("old_purchase_id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_assignees"
    ADD CONSTRAINT "activity_assignees_activity_id_user_id_key" UNIQUE ("activity_id", "user_id");



ALTER TABLE ONLY "public"."activity_assignees"
    ADD CONSTRAINT "activity_assignees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_checklist_items"
    ADD CONSTRAINT "activity_checklist_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_comment_reactions"
    ADD CONSTRAINT "activity_comment_reactions_comment_id_user_id_emoji_key" UNIQUE ("comment_id", "user_id", "emoji");



ALTER TABLE ONLY "public"."activity_comment_reactions"
    ADD CONSTRAINT "activity_comment_reactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_comments"
    ADD CONSTRAINT "activity_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."activity_watchers"
    ADD CONSTRAINT "activity_watchers_activity_id_user_id_key" UNIQUE ("activity_id", "user_id");



ALTER TABLE ONLY "public"."activity_watchers"
    ADD CONSTRAINT "activity_watchers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."advisor_queries"
    ADD CONSTRAINT "advisor_queries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_cost_adjustments"
    ADD CONSTRAINT "asset_cost_adjustments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_counters"
    ADD CONSTRAINT "asset_counters_pkey" PRIMARY KEY ("prefix", "year");



ALTER TABLE ONLY "public"."asset_qc_checks"
    ADD CONSTRAINT "asset_qc_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_rma_events"
    ADD CONSTRAINT "asset_rma_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backup_settings"
    ADD CONSTRAINT "backup_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backup_snapshots"
    ADD CONSTRAINT "backup_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_categorization_rules"
    ADD CONSTRAINT "bank_categorization_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_column_profiles"
    ADD CONSTRAINT "bank_column_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_transaction_matches"
    ADD CONSTRAINT "bank_transaction_matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_bank_account_id_dedupe_hash_key" UNIQUE ("bank_account_id", "dedupe_hash");



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."business_profiles"
    ADD CONSTRAINT "business_profiles_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."business_profiles"
    ADD CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_customer_id_sku_id_upgrades_key" UNIQUE ("customer_id", "sku_id", "selected_upgrades");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_options"
    ADD CONSTRAINT "custom_options_category_value_key" UNIQUE ("category", "value");



ALTER TABLE ONLY "public"."custom_options"
    ADD CONSTRAINT "custom_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digest_channel_config"
    ADD CONSTRAINT "digest_channel_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digest_runs"
    ADD CONSTRAINT "digest_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digest_runs"
    ADD CONSTRAINT "digest_runs_subscription_id_period_period_start_channel_key" UNIQUE ("subscription_id", "period", "period_start", "channel");



ALTER TABLE ONLY "public"."digest_subscriptions"
    ADD CONSTRAINT "digest_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digest_subscriptions"
    ADD CONSTRAINT "digest_subscriptions_profile_id_period_key" UNIQUE ("profile_id", "period");



ALTER TABLE ONLY "public"."document_sends"
    ADD CONSTRAINT "document_sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expense_reimbursements"
    ADD CONSTRAINT "expense_reimbursements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."extraction_templates"
    ADD CONSTRAINT "extraction_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."field_corrections"
    ADD CONSTRAINT "field_corrections_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."kb_chapter_sections"
    ADD CONSTRAINT "kb_chapter_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_chapters"
    ADD CONSTRAINT "kb_chapters_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."market_price_observations"
    ADD CONSTRAINT "market_price_observations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."newsletter_subscribers"
    ADD CONSTRAINT "newsletter_subscribers_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."newsletter_subscribers"
    ADD CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."po_counter"
    ADD CONSTRAINT "po_counter_pkey" PRIMARY KEY ("year");



ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_page_actions"
    ADD CONSTRAINT "profile_page_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_page_actions"
    ADD CONSTRAINT "profile_page_actions_profile_id_page_key_key" UNIQUE ("profile_id", "page_key");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_calendar_feed_token_key" UNIQUE ("calendar_feed_token");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promotion_redemptions"
    ADD CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."recon_sessions"
    ADD CONSTRAINT "recon_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recurring_expense_rules"
    ADD CONSTRAINT "recurring_expense_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."redaction_rules"
    ADD CONSTRAINT "redaction_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."redaction_rules"
    ADD CONSTRAINT "redaction_rules_shape_field_name_key" UNIQUE ("shape", "field_name");



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



ALTER TABLE ONLY "public"."replacement_job_counter"
    ADD CONSTRAINT "replacement_job_counter_pkey" PRIMARY KEY ("year");



ALTER TABLE ONLY "public"."replacement_job_parts"
    ADD CONSTRAINT "replacement_job_parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."replacement_jobs"
    ADD CONSTRAINT "replacement_jobs_job_number_key" UNIQUE ("job_number");



ALTER TABLE ONLY "public"."replacement_jobs"
    ADD CONSTRAINT "replacement_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sale_payments"
    ADD CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."sku_cross_sell_rules"
    ADD CONSTRAINT "sku_cross_sell_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_cross_sell_rules"
    ADD CONSTRAINT "sku_cross_sell_rules_source_category_suggested_category_key" UNIQUE ("source_category", "suggested_category");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_full_sku_code_key" UNIQUE ("full_sku_code");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sku_upgrade_rules"
    ADD CONSTRAINT "sku_upgrade_rules_category_field_name_from_value_to_value_key" UNIQUE ("category", "field_name", "from_value", "to_value");



ALTER TABLE ONLY "public"."sku_upgrade_rules"
    ADD CONSTRAINT "sku_upgrade_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."uploaded_documents"
    ADD CONSTRAINT "uploaded_documents_content_hash_key" UNIQUE ("content_hash");



ALTER TABLE ONLY "public"."uploaded_documents"
    ADD CONSTRAINT "uploaded_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_correction_proposals"
    ADD CONSTRAINT "vendor_correction_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_vendor_code_key" UNIQUE ("vendor_code");



ALTER TABLE ONLY "public"."web_reservations"
    ADD CONSTRAINT "web_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wishlist_items"
    ADD CONSTRAINT "wishlist_items_customer_id_sku_id_key" UNIQUE ("customer_id", "sku_id");



ALTER TABLE ONLY "public"."wishlist_items"
    ADD CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id");



CREATE INDEX "asset_cost_adjustments_asset_id_idx" ON "public"."asset_cost_adjustments" USING "btree" ("asset_id");



CREATE INDEX "backup_snapshots_created_at_idx" ON "public"."backup_snapshots" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_activities_completed_by" ON "public"."activities" USING "btree" ("completed_by");



CREATE INDEX "idx_activities_created_by" ON "public"."activities" USING "btree" ("created_by") WHERE ("is_deleted" = false);



CREATE INDEX "idx_activities_due_date" ON "public"."activities" USING "btree" ("due_date");



CREATE INDEX "idx_activities_not_deleted" ON "public"."activities" USING "btree" ("is_deleted");



CREATE INDEX "idx_activities_reminder_at" ON "public"."activities" USING "btree" ("reminder_at");



CREATE INDEX "idx_activities_reviewed_by" ON "public"."activities" USING "btree" ("reviewed_by");



CREATE INDEX "idx_activities_user_id" ON "public"."activities" USING "btree" ("user_id");



CREATE INDEX "idx_activity_assignees_activity" ON "public"."activity_assignees" USING "btree" ("activity_id");



CREATE INDEX "idx_activity_assignees_assigned_by" ON "public"."activity_assignees" USING "btree" ("assigned_by");



CREATE INDEX "idx_activity_assignees_user" ON "public"."activity_assignees" USING "btree" ("user_id");



CREATE INDEX "idx_activity_checklist_items_activity" ON "public"."activity_checklist_items" USING "btree" ("activity_id");



CREATE INDEX "idx_activity_checklist_items_completed_by" ON "public"."activity_checklist_items" USING "btree" ("completed_by");



CREATE INDEX "idx_activity_checklist_items_created_by" ON "public"."activity_checklist_items" USING "btree" ("created_by");



CREATE INDEX "idx_activity_comment_reactions_comment" ON "public"."activity_comment_reactions" USING "btree" ("comment_id");



CREATE INDEX "idx_activity_comment_reactions_user_id" ON "public"."activity_comment_reactions" USING "btree" ("user_id");



CREATE INDEX "idx_activity_comments_activity" ON "public"."activity_comments" USING "btree" ("activity_id");



CREATE INDEX "idx_activity_comments_author_id" ON "public"."activity_comments" USING "btree" ("author_id");



CREATE INDEX "idx_activity_comments_pinned_by" ON "public"."activity_comments" USING "btree" ("pinned_by");



CREATE INDEX "idx_activity_watchers_activity" ON "public"."activity_watchers" USING "btree" ("activity_id");



CREATE INDEX "idx_activity_watchers_added_by" ON "public"."activity_watchers" USING "btree" ("added_by");



CREATE INDEX "idx_activity_watchers_user" ON "public"."activity_watchers" USING "btree" ("user_id");



CREATE INDEX "idx_advisor_queries_user_id" ON "public"."advisor_queries" USING "btree" ("user_id");



CREATE INDEX "idx_asset_cost_adjustments_added_by" ON "public"."asset_cost_adjustments" USING "btree" ("added_by");



CREATE INDEX "idx_asset_ledger_entered_by" ON "public"."asset_ledger" USING "btree" ("entered_by");



CREATE INDEX "idx_asset_ledger_legacy_purchase_id" ON "public"."asset_ledger" USING "btree" ("legacy_purchase_id");



CREATE INDEX "idx_asset_ledger_po_id" ON "public"."asset_ledger" USING "btree" ("po_id");



CREATE INDEX "idx_asset_ledger_po_item_id" ON "public"."asset_ledger" USING "btree" ("po_item_id");



CREATE INDEX "idx_asset_ledger_qc_by" ON "public"."asset_ledger" USING "btree" ("qc_by");



CREATE INDEX "idx_asset_ledger_vendor_id" ON "public"."asset_ledger" USING "btree" ("vendor_id");



CREATE INDEX "idx_asset_qc_checks_asset" ON "public"."asset_qc_checks" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_qc_checks_checked_by" ON "public"."asset_qc_checks" USING "btree" ("checked_by");



CREATE INDEX "idx_asset_rma_events_asset" ON "public"."asset_rma_events" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_rma_events_created_by" ON "public"."asset_rma_events" USING "btree" ("created_by");



CREATE INDEX "idx_asset_rma_events_vendor_id" ON "public"."asset_rma_events" USING "btree" ("vendor_id");



CREATE INDEX "idx_asset_sku" ON "public"."asset_ledger" USING "btree" ("sku_id");



CREATE INDEX "idx_asset_status" ON "public"."asset_ledger" USING "btree" ("status");



CREATE INDEX "idx_audit_log_actor" ON "public"."audit_log" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "idx_audit_log_created" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_log_module" ON "public"."audit_log" USING "btree" ("module", "created_at" DESC);



CREATE INDEX "idx_audit_log_restored_by" ON "public"."audit_log" USING "btree" ("restored_by");



CREATE INDEX "idx_audit_log_table_record" ON "public"."audit_log" USING "btree" ("table_name", "record_id");



CREATE INDEX "idx_backup_settings_updated_by" ON "public"."backup_settings" USING "btree" ("updated_by");



CREATE INDEX "idx_backup_snapshots_created_by" ON "public"."backup_snapshots" USING "btree" ("created_by");



CREATE INDEX "idx_bank_statements_account" ON "public"."bank_statements" USING "btree" ("bank_account_id");



CREATE INDEX "idx_bank_transactions_account" ON "public"."bank_transactions" USING "btree" ("bank_account_id");



CREATE INDEX "idx_bank_transactions_date" ON "public"."bank_transactions" USING "btree" ("txn_date");



CREATE INDEX "idx_bank_transactions_status" ON "public"."bank_transactions" USING "btree" ("recon_status");



CREATE INDEX "idx_btm_expense" ON "public"."bank_transaction_matches" USING "btree" ("expense_id") WHERE ("expense_id" IS NOT NULL);



CREATE INDEX "idx_btm_sale_payment" ON "public"."bank_transaction_matches" USING "btree" ("sale_payment_id") WHERE ("sale_payment_id" IS NOT NULL);



CREATE INDEX "idx_btm_transaction" ON "public"."bank_transaction_matches" USING "btree" ("bank_transaction_id");



CREATE INDEX "idx_btm_vendor_payment" ON "public"."bank_transaction_matches" USING "btree" ("vendor_payment_id") WHERE ("vendor_payment_id" IS NOT NULL);



CREATE INDEX "idx_cart_items_sku_id" ON "public"."cart_items" USING "btree" ("sku_id");



CREATE INDEX "idx_customer_profiles_customer_id" ON "public"."customer_profiles" USING "btree" ("customer_id");



CREATE INDEX "idx_digest_channel_config_updated_by" ON "public"."digest_channel_config" USING "btree" ("updated_by");



CREATE INDEX "idx_digest_runs_subscription" ON "public"."digest_runs" USING "btree" ("subscription_id", "sent_at" DESC);



CREATE INDEX "idx_document_sends_sent_by" ON "public"."document_sends" USING "btree" ("sent_by");



CREATE INDEX "idx_extraction_templates_fingerprint" ON "public"."extraction_templates" USING "btree" ("match_fingerprint") WHERE "is_active";



CREATE INDEX "idx_extraction_templates_vendor_id" ON "public"."extraction_templates" USING "btree" ("vendor_id") WHERE ("vendor_id" IS NOT NULL);



CREATE INDEX "idx_field_corrections_changed_by" ON "public"."field_corrections" USING "btree" ("changed_by");



CREATE INDEX "idx_field_corrections_record" ON "public"."field_corrections" USING "btree" ("table_name", "record_id");



CREATE INDEX "idx_invoice_items_accessory_id" ON "public"."invoice_items" USING "btree" ("accessory_id");



CREATE INDEX "idx_invoice_items_asset_id" ON "public"."invoice_items" USING "btree" ("asset_id");



CREATE INDEX "idx_invoice_items_invoice_id" ON "public"."invoice_items" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_items_ledger_asset_id" ON "public"."invoice_items" USING "btree" ("ledger_asset_id");



CREATE INDEX "idx_invoice_items_repair_job_id" ON "public"."invoice_items" USING "btree" ("repair_job_id");



CREATE INDEX "idx_invoice_items_sku_id" ON "public"."invoice_items" USING "btree" ("sku_id");



CREATE INDEX "idx_invoices_approved_by" ON "public"."invoices" USING "btree" ("approved_by");



CREATE INDEX "idx_invoices_created_by" ON "public"."invoices" USING "btree" ("created_by");



CREATE INDEX "idx_invoices_customer_id" ON "public"."invoices" USING "btree" ("customer_id");



CREATE INDEX "idx_invoices_entity_key" ON "public"."invoices" USING "btree" ("entity_key");



CREATE INDEX "idx_invoices_imported_by" ON "public"."invoices" USING "btree" ("imported_by");



CREATE INDEX "idx_market_price_observations_observed_by" ON "public"."market_price_observations" USING "btree" ("observed_by");



CREATE INDEX "idx_notifications_activity_id" ON "public"."notifications" USING "btree" ("activity_id");



CREATE INDEX "idx_notifications_actor_id" ON "public"."notifications" USING "btree" ("actor_id");



CREATE INDEX "idx_notifications_comment_id" ON "public"."notifications" USING "btree" ("comment_id");



CREATE INDEX "idx_notifications_recipient_created" ON "public"."notifications" USING "btree" ("recipient_id", "created_at" DESC);



CREATE INDEX "idx_notifications_recipient_unread" ON "public"."notifications" USING "btree" ("recipient_id", "read_at");



CREATE INDEX "idx_order_items_erp_sale_id" ON "public"."order_items" USING "btree" ("erp_sale_id");



CREATE INDEX "idx_order_items_order_id" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_order_items_sku_id" ON "public"."order_items" USING "btree" ("sku_id");



CREATE INDEX "idx_orders_customer_id" ON "public"."orders" USING "btree" ("customer_id");



CREATE INDEX "idx_po_date" ON "public"."purchase_orders" USING "btree" ("po_date");



CREATE INDEX "idx_po_status" ON "public"."purchase_orders" USING "btree" ("po_status");



CREATE INDEX "idx_po_vendor" ON "public"."purchase_orders" USING "btree" ("vendor_id");



CREATE INDEX "idx_poi_po" ON "public"."purchase_order_items" USING "btree" ("po_id");



CREATE INDEX "idx_poi_sku" ON "public"."purchase_order_items" USING "btree" ("sku_id");



CREATE INDEX "idx_promotion_redemptions_customer_id" ON "public"."promotion_redemptions" USING "btree" ("customer_id");



CREATE INDEX "idx_promotion_redemptions_order_id" ON "public"."promotion_redemptions" USING "btree" ("order_id");



CREATE INDEX "idx_promotion_redemptions_promotion_id" ON "public"."promotion_redemptions" USING "btree" ("promotion_id");



CREATE INDEX "idx_promotions_created_by" ON "public"."promotions" USING "btree" ("created_by");



CREATE INDEX "idx_promotions_free_gift_sku_id" ON "public"."promotions" USING "btree" ("free_gift_sku_id");



CREATE INDEX "idx_purchase_files_asset_ledger_id" ON "public"."purchase_files" USING "btree" ("asset_ledger_id");



CREATE INDEX "idx_purchase_files_purchase_id" ON "public"."purchase_files" USING "btree" ("purchase_id");



CREATE INDEX "idx_purchase_orders_created_by" ON "public"."purchase_orders" USING "btree" ("created_by");



CREATE INDEX "idx_purchase_orders_updated_by" ON "public"."purchase_orders" USING "btree" ("updated_by");



CREATE INDEX "idx_purchases_sku_variant_id" ON "public"."purchases" USING "btree" ("sku_variant_id");



CREATE INDEX "idx_purchases_vendor_id" ON "public"."purchases" USING "btree" ("vendor_id");



CREATE INDEX "idx_recon_sessions_account" ON "public"."recon_sessions" USING "btree" ("bank_account_id");



CREATE INDEX "idx_reorder_sku" ON "public"."reorder_rules" USING "btree" ("sku_id");



CREATE INDEX "idx_reorder_vendor" ON "public"."reorder_rules" USING "btree" ("vendor_id");



CREATE INDEX "idx_repair_job_parts_repair_job_id" ON "public"."repair_job_parts" USING "btree" ("repair_job_id");



CREATE INDEX "idx_repair_job_parts_sku_id" ON "public"."repair_job_parts" USING "btree" ("sku_id");



CREATE INDEX "idx_repair_job_parts_stock_movement_id" ON "public"."repair_job_parts" USING "btree" ("stock_movement_id");



CREATE INDEX "idx_repair_jobs_asset_id" ON "public"."repair_jobs" USING "btree" ("asset_id");



CREATE INDEX "idx_repair_jobs_customer_id" ON "public"."repair_jobs" USING "btree" ("customer_id");



CREATE INDEX "idx_repair_jobs_entered_by" ON "public"."repair_jobs" USING "btree" ("entered_by");



CREATE INDEX "idx_repair_jobs_finalized_by" ON "public"."repair_jobs" USING "btree" ("finalized_by");



CREATE INDEX "idx_repair_jobs_replacement_asset_id" ON "public"."repair_jobs" USING "btree" ("replacement_asset_id");



CREATE INDEX "idx_replacement_job_parts_replacement_job_id" ON "public"."replacement_job_parts" USING "btree" ("replacement_job_id");



CREATE INDEX "idx_replacement_job_parts_sku_id" ON "public"."replacement_job_parts" USING "btree" ("sku_id");



CREATE INDEX "idx_replacement_job_parts_stock_movement_id" ON "public"."replacement_job_parts" USING "btree" ("stock_movement_id");



CREATE INDEX "idx_replacement_jobs_asset_id" ON "public"."replacement_jobs" USING "btree" ("asset_id");



CREATE INDEX "idx_replacement_jobs_customer_id" ON "public"."replacement_jobs" USING "btree" ("customer_id");



CREATE INDEX "idx_replacement_jobs_entered_by" ON "public"."replacement_jobs" USING "btree" ("entered_by");



CREATE INDEX "idx_replacement_jobs_finalized_by" ON "public"."replacement_jobs" USING "btree" ("finalized_by");



CREATE INDEX "idx_replacement_jobs_replacement_asset_id" ON "public"."replacement_jobs" USING "btree" ("replacement_asset_id");



CREATE INDEX "idx_sale_payments_recorded_by" ON "public"."sale_payments" USING "btree" ("recorded_by");



CREATE INDEX "idx_sale_payments_sale_id" ON "public"."sale_payments" USING "btree" ("sale_id");



CREATE INDEX "idx_sales_accessory_id" ON "public"."sales" USING "btree" ("accessory_id");



CREATE INDEX "idx_sales_asset_ledger_id" ON "public"."sales" USING "btree" ("asset_ledger_id");



CREATE INDEX "idx_sales_customer_id" ON "public"."sales" USING "btree" ("customer_id");



CREATE INDEX "idx_sales_document_items_accessory_id" ON "public"."sales_document_items" USING "btree" ("accessory_id");



CREATE INDEX "idx_sales_document_items_sale_id" ON "public"."sales_document_items" USING "btree" ("sale_id");



CREATE INDEX "idx_sales_document_items_sales_document_id" ON "public"."sales_document_items" USING "btree" ("sales_document_id");



CREATE INDEX "idx_sales_document_items_sku_id" ON "public"."sales_document_items" USING "btree" ("sku_id");



CREATE INDEX "idx_sales_documents_created_by" ON "public"."sales_documents" USING "btree" ("created_by");



CREATE INDEX "idx_sales_documents_customer_id" ON "public"."sales_documents" USING "btree" ("customer_id");



CREATE INDEX "idx_sales_documents_entity_key" ON "public"."sales_documents" USING "btree" ("entity_key");



CREATE INDEX "idx_sales_entered_by" ON "public"."sales" USING "btree" ("entered_by");



CREATE INDEX "idx_sales_finalized_by" ON "public"."sales" USING "btree" ("finalized_by");



CREATE INDEX "idx_sales_invoice_id" ON "public"."sales" USING "btree" ("invoice_id");



CREATE INDEX "idx_sales_repair_job_id" ON "public"."sales" USING "btree" ("repair_job_id");



CREATE INDEX "idx_sku_base_code" ON "public"."sku_master" USING "btree" ("base_sku_code");



CREATE INDEX "idx_sku_category" ON "public"."sku_master" USING "btree" ("category");



CREATE INDEX "idx_sku_full_code" ON "public"."sku_master" USING "btree" ("full_sku_code");



CREATE INDEX "idx_sku_master_created_by" ON "public"."sku_master" USING "btree" ("created_by");



CREATE INDEX "idx_sku_master_updated_by" ON "public"."sku_master" USING "btree" ("updated_by");



CREATE INDEX "idx_sku_quantity" ON "public"."sku_master" USING "btree" ("quantity_in_stock");



CREATE INDEX "idx_sku_upgrade_rules_created_by" ON "public"."sku_upgrade_rules" USING "btree" ("created_by");



CREATE INDEX "idx_stock_invoice" ON "public"."stock_movements" USING "btree" ("invoice_id");



CREATE INDEX "idx_stock_movements_created_by" ON "public"."stock_movements" USING "btree" ("created_by");



CREATE INDEX "idx_stock_movements_vendor_id" ON "public"."stock_movements" USING "btree" ("vendor_id");



CREATE INDEX "idx_stock_po" ON "public"."stock_movements" USING "btree" ("po_id");



CREATE INDEX "idx_stock_sku" ON "public"."stock_movements" USING "btree" ("sku_id");



CREATE INDEX "idx_uploaded_documents_doc_kind" ON "public"."uploaded_documents" USING "btree" ("doc_kind");



CREATE INDEX "idx_uploaded_documents_status" ON "public"."uploaded_documents" USING "btree" ("extraction_status");



CREATE INDEX "idx_uploaded_documents_vendor_id" ON "public"."uploaded_documents" USING "btree" ("vendor_id") WHERE ("vendor_id" IS NOT NULL);



CREATE INDEX "idx_vendor_correction_proposals_document" ON "public"."vendor_correction_proposals" USING "btree" ("document_id");



CREATE INDEX "idx_vendor_correction_proposals_status" ON "public"."vendor_correction_proposals" USING "btree" ("status");



CREATE INDEX "idx_vendor_correction_proposals_vendor" ON "public"."vendor_correction_proposals" USING "btree" ("vendor_id");



CREATE INDEX "idx_vendor_payments_po_id" ON "public"."vendor_payments" USING "btree" ("po_id");



CREATE INDEX "idx_vendor_payments_purchase_invoice_id" ON "public"."vendor_payments" USING "btree" ("purchase_invoice_id") WHERE ("purchase_invoice_id" IS NOT NULL);



CREATE INDEX "idx_web_reservations_order_item_id" ON "public"."web_reservations" USING "btree" ("order_item_id");



CREATE INDEX "idx_wishlist_items_sku_id" ON "public"."wishlist_items" USING "btree" ("sku_id");



CREATE INDEX "kb_chapter_sections_chapter_idx" ON "public"."kb_chapter_sections" USING "btree" ("chapter_slug");



CREATE INDEX "kb_chapters_search_tsv_idx" ON "public"."kb_chapters" USING "gin" ("search_tsv");



CREATE INDEX "market_price_observations_sku_id_idx" ON "public"."market_price_observations" USING "btree" ("sku_id");



CREATE INDEX "product_images_sku_id_idx" ON "public"."product_images" USING "btree" ("sku_id");



CREATE UNIQUE INDEX "profiles_username_unique_idx" ON "public"."profiles" USING "btree" ("lower"("username")) WHERE ("username" IS NOT NULL);



CREATE UNIQUE INDEX "promotions_code_unique" ON "public"."promotions" USING "btree" ("code") WHERE ("code" IS NOT NULL);



CREATE UNIQUE INDEX "sku_master_web_slug_key" ON "public"."sku_master" USING "btree" ("web_slug") WHERE ("web_slug" IS NOT NULL);



CREATE INDEX "web_reservations_active_idx" ON "public"."web_reservations" USING "btree" ("sku_id", "expires_at") WHERE ("released_at" IS NULL);



CREATE INDEX "web_reservations_asset_idx" ON "public"."web_reservations" USING "btree" ("asset_id") WHERE ("released_at" IS NULL);



CREATE OR REPLACE TRIGGER "customer_profiles_tier_guard" BEFORE UPDATE ON "public"."customer_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_self_tier_change"();



CREATE OR REPLACE TRIGGER "trg_compute_warranty_expiry" BEFORE INSERT OR UPDATE OF "warranty_start_date", "warranty_duration_months" ON "public"."asset_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."compute_warranty_expiry"();



CREATE OR REPLACE TRIGGER "trg_enforce_bank_match_amount_cap" AFTER INSERT OR UPDATE ON "public"."bank_transaction_matches" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_bank_match_amount_cap"();



CREATE OR REPLACE TRIGGER "trg_kb_chapters_search_tsv" BEFORE INSERT OR UPDATE ON "public"."kb_chapters" FOR EACH ROW EXECUTE FUNCTION "public"."kb_chapters_search_tsv_update"();



CREATE OR REPLACE TRIGGER "trg_sync_bank_transaction_recon_status" AFTER INSERT OR DELETE ON "public"."bank_transaction_matches" FOR EACH ROW EXECUTE FUNCTION "public"."sync_bank_transaction_recon_status"();



CREATE OR REPLACE TRIGGER "trg_sync_expense_reimbursement_status_on_paid_by_change" BEFORE INSERT OR UPDATE ON "public"."expenses" FOR EACH ROW EXECUTE FUNCTION "public"."sync_expense_reimbursement_status_on_paid_by_change"();



CREATE OR REPLACE TRIGGER "trg_sync_expense_reimbursement_totals" AFTER INSERT OR DELETE OR UPDATE ON "public"."expense_reimbursements" FOR EACH ROW EXECUTE FUNCTION "public"."sync_expense_reimbursement_totals"();



CREATE OR REPLACE TRIGGER "trg_sync_po_payment_totals" AFTER INSERT OR DELETE OR UPDATE ON "public"."vendor_payments" FOR EACH ROW EXECUTE FUNCTION "public"."sync_po_payment_totals"();



CREATE OR REPLACE TRIGGER "trg_sync_sale_payment_totals" AFTER INSERT OR DELETE OR UPDATE ON "public"."sale_payments" FOR EACH ROW EXECUTE FUNCTION "public"."sync_sale_payment_totals"();



CREATE OR REPLACE TRIGGER "trg_sync_sku_stock" BEFORE INSERT ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."sync_sku_stock_from_movement"();



CREATE OR REPLACE TRIGGER "vendors_vendor_code" BEFORE INSERT ON "public"."vendors" FOR EACH ROW WHEN (("new"."vendor_code" IS NULL)) EXECUTE FUNCTION "public"."generate_vendor_code"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_assignees"
    ADD CONSTRAINT "activity_assignees_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_assignees"
    ADD CONSTRAINT "activity_assignees_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_assignees"
    ADD CONSTRAINT "activity_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_checklist_items"
    ADD CONSTRAINT "activity_checklist_items_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_checklist_items"
    ADD CONSTRAINT "activity_checklist_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_checklist_items"
    ADD CONSTRAINT "activity_checklist_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_comment_reactions"
    ADD CONSTRAINT "activity_comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."activity_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_comment_reactions"
    ADD CONSTRAINT "activity_comment_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_comments"
    ADD CONSTRAINT "activity_comments_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_comments"
    ADD CONSTRAINT "activity_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_comments"
    ADD CONSTRAINT "activity_comments_pinned_by_fkey" FOREIGN KEY ("pinned_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_watchers"
    ADD CONSTRAINT "activity_watchers_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."activity_watchers"
    ADD CONSTRAINT "activity_watchers_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_watchers"
    ADD CONSTRAINT "activity_watchers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."advisor_queries"
    ADD CONSTRAINT "advisor_queries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



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



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_restored_by_fkey" FOREIGN KEY ("restored_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."backup_settings"
    ADD CONSTRAINT "backup_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."backup_snapshots"
    ADD CONSTRAINT "backup_snapshots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bank_accounts"
    ADD CONSTRAINT "bank_accounts_entity_key_fkey" FOREIGN KEY ("entity_key") REFERENCES "public"."business_profiles"("key");



ALTER TABLE ONLY "public"."bank_categorization_rules"
    ADD CONSTRAINT "bank_categorization_rules_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id");



ALTER TABLE ONLY "public"."bank_categorization_rules"
    ADD CONSTRAINT "bank_categorization_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bank_column_profiles"
    ADD CONSTRAINT "bank_column_profiles_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_column_profiles"
    ADD CONSTRAINT "bank_column_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id");



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."uploaded_documents"("id");



ALTER TABLE ONLY "public"."bank_statements"
    ADD CONSTRAINT "bank_statements_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bank_transaction_matches"
    ADD CONSTRAINT "bank_transaction_matches_bank_transaction_id_fkey" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bank_transaction_matches"
    ADD CONSTRAINT "bank_transaction_matches_counterpart_txn_id_fkey" FOREIGN KEY ("counterpart_txn_id") REFERENCES "public"."bank_transactions"("id");



ALTER TABLE ONLY "public"."bank_transaction_matches"
    ADD CONSTRAINT "bank_transaction_matches_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id");



ALTER TABLE ONLY "public"."bank_transaction_matches"
    ADD CONSTRAINT "bank_transaction_matches_matched_by_fkey" FOREIGN KEY ("matched_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bank_transaction_matches"
    ADD CONSTRAINT "bank_transaction_matches_sale_payment_id_fkey" FOREIGN KEY ("sale_payment_id") REFERENCES "public"."sale_payments"("id");



ALTER TABLE ONLY "public"."bank_transaction_matches"
    ADD CONSTRAINT "bank_transaction_matches_vendor_payment_id_fkey" FOREIGN KEY ("vendor_payment_id") REFERENCES "public"."vendor_payments"("id");



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id");



ALTER TABLE ONLY "public"."bank_transactions"
    ADD CONSTRAINT "bank_transactions_bank_statement_id_fkey" FOREIGN KEY ("bank_statement_id") REFERENCES "public"."bank_statements"("id");



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cart_items"
    ADD CONSTRAINT "cart_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."digest_channel_config"
    ADD CONSTRAINT "digest_channel_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."digest_runs"
    ADD CONSTRAINT "digest_runs_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."digest_subscriptions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."digest_subscriptions"
    ADD CONSTRAINT "digest_subscriptions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_sends"
    ADD CONSTRAINT "document_sends_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."expense_reimbursements"
    ADD CONSTRAINT "expense_reimbursements_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expense_reimbursements"
    ADD CONSTRAINT "expense_reimbursements_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_entity_key_fkey" FOREIGN KEY ("entity_key") REFERENCES "public"."business_profiles"("key");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."extraction_templates"
    ADD CONSTRAINT "extraction_templates_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id");



ALTER TABLE ONLY "public"."extraction_templates"
    ADD CONSTRAINT "extraction_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."extraction_templates"
    ADD CONSTRAINT "extraction_templates_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."field_corrections"
    ADD CONSTRAINT "field_corrections_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_accessory_id_fkey" FOREIGN KEY ("accessory_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."purchases"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_ledger_asset_id_fkey" FOREIGN KEY ("ledger_asset_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_repair_job_id_fkey" FOREIGN KEY ("repair_job_id") REFERENCES "public"."repair_jobs"("id");



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



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."kb_chapter_sections"
    ADD CONSTRAINT "kb_chapter_sections_chapter_slug_fkey" FOREIGN KEY ("chapter_slug") REFERENCES "public"."kb_chapters"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."market_price_observations"
    ADD CONSTRAINT "market_price_observations_observed_by_fkey" FOREIGN KEY ("observed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."market_price_observations"
    ADD CONSTRAINT "market_price_observations_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."activity_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_erp_sale_id_fkey" FOREIGN KEY ("erp_sale_id") REFERENCES "public"."sales"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer_profiles"("id");



ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_page_actions"
    ADD CONSTRAINT "profile_page_actions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promotion_redemptions"
    ADD CONSTRAINT "promotion_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."promotion_redemptions"
    ADD CONSTRAINT "promotion_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."promotion_redemptions"
    ADD CONSTRAINT "promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."promotions"
    ADD CONSTRAINT "promotions_free_gift_sku_id_fkey" FOREIGN KEY ("free_gift_sku_id") REFERENCES "public"."sku_master"("id");



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



ALTER TABLE ONLY "public"."recon_sessions"
    ADD CONSTRAINT "recon_sessions_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id");



ALTER TABLE ONLY "public"."recon_sessions"
    ADD CONSTRAINT "recon_sessions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recon_sessions"
    ADD CONSTRAINT "recon_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recon_sessions"
    ADD CONSTRAINT "recon_sessions_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recurring_expense_rules"
    ADD CONSTRAINT "recurring_expense_rules_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recurring_expense_rules"
    ADD CONSTRAINT "recurring_expense_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recurring_expense_rules"
    ADD CONSTRAINT "recurring_expense_rules_entity_key_fkey" FOREIGN KEY ("entity_key") REFERENCES "public"."business_profiles"("key");



ALTER TABLE ONLY "public"."recurring_expense_rules"
    ADD CONSTRAINT "recurring_expense_rules_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."reorder_rules"
    ADD CONSTRAINT "reorder_rules_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reorder_rules"
    ADD CONSTRAINT "reorder_rules_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."repair_job_parts"
    ADD CONSTRAINT "repair_job_parts_repair_job_id_fkey" FOREIGN KEY ("repair_job_id") REFERENCES "public"."repair_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."repair_job_parts"
    ADD CONSTRAINT "repair_job_parts_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."repair_job_parts"
    ADD CONSTRAINT "repair_job_parts_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id");



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



ALTER TABLE ONLY "public"."replacement_job_parts"
    ADD CONSTRAINT "replacement_job_parts_replacement_job_id_fkey" FOREIGN KEY ("replacement_job_id") REFERENCES "public"."replacement_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."replacement_job_parts"
    ADD CONSTRAINT "replacement_job_parts_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."replacement_job_parts"
    ADD CONSTRAINT "replacement_job_parts_stock_movement_id_fkey" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id");



ALTER TABLE ONLY "public"."replacement_jobs"
    ADD CONSTRAINT "replacement_jobs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."replacement_jobs"
    ADD CONSTRAINT "replacement_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."replacement_jobs"
    ADD CONSTRAINT "replacement_jobs_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."replacement_jobs"
    ADD CONSTRAINT "replacement_jobs_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."replacement_jobs"
    ADD CONSTRAINT "replacement_jobs_replacement_asset_id_fkey" FOREIGN KEY ("replacement_asset_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."sale_payments"
    ADD CONSTRAINT "sale_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sale_payments"
    ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_repair_job_id_fkey" FOREIGN KEY ("repair_job_id") REFERENCES "public"."repair_jobs"("id");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sku_master"
    ADD CONSTRAINT "sku_master_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sku_upgrade_rules"
    ADD CONSTRAINT "sku_upgrade_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."uploaded_documents"
    ADD CONSTRAINT "uploaded_documents_ai_approved_by_fkey" FOREIGN KEY ("ai_approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."uploaded_documents"
    ADD CONSTRAINT "uploaded_documents_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id");



ALTER TABLE ONLY "public"."uploaded_documents"
    ADD CONSTRAINT "uploaded_documents_extraction_template_id_fkey" FOREIGN KEY ("extraction_template_id") REFERENCES "public"."extraction_templates"("id");



ALTER TABLE ONLY "public"."uploaded_documents"
    ADD CONSTRAINT "uploaded_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."uploaded_documents"
    ADD CONSTRAINT "uploaded_documents_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."vendor_correction_proposals"
    ADD CONSTRAINT "vendor_correction_proposals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."vendor_correction_proposals"
    ADD CONSTRAINT "vendor_correction_proposals_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."uploaded_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_correction_proposals"
    ADD CONSTRAINT "vendor_correction_proposals_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id");



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."web_reservations"
    ADD CONSTRAINT "web_reservations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_ledger"("id");



ALTER TABLE ONLY "public"."web_reservations"
    ADD CONSTRAINT "web_reservations_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."web_reservations"
    ADD CONSTRAINT "web_reservations_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id");



ALTER TABLE ONLY "public"."wishlist_items"
    ADD CONSTRAINT "wishlist_items_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."wishlist_items"
    ADD CONSTRAINT "wishlist_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "public"."sku_master"("id") ON DELETE CASCADE;



CREATE POLICY "Admin full access" ON "public"."expenses" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."purchase_files" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."purchases" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Admin full access" ON "public"."sales" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Allow full access to auth users" ON "public"."activities" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."activity_assignees" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."activity_checklist_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."activity_comment_reactions" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."activity_comments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."activity_watchers" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."asset_cost_adjustments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."asset_ledger" TO "authenticated" USING (( SELECT "public"."is_staff"() AS "is_staff")) WITH CHECK (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Allow full access to auth users" ON "public"."asset_qc_checks" TO "authenticated" USING (( SELECT "public"."is_staff"() AS "is_staff")) WITH CHECK (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Allow full access to auth users" ON "public"."asset_rma_events" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."field_corrections" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."notifications" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."purchase_order_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Allow full access to auth users" ON "public"."purchase_orders" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Customers can update own profile" ON "public"."customer_profiles" FOR UPDATE USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Customers can view own order items" ON "public"."order_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND ("o"."customer_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Customers can view own orders" ON "public"."orders" FOR SELECT USING (("customer_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Customers can view own profile" ON "public"."customer_profiles" FOR SELECT USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Customers manage own cart" ON "public"."cart_items" USING (("customer_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("customer_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Customers manage own wishlist" ON "public"."wishlist_items" TO "authenticated" USING (("customer_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("customer_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Enable all for authenticated users" ON "public"."invoice_items" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable all for authenticated users" ON "public"."invoice_sequences" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable all for authenticated users" ON "public"."invoices" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Owner manage page actions" ON "public"."profile_page_actions" USING (( SELECT "public"."is_owner"() AS "is_owner")) WITH CHECK (( SELECT "public"."is_owner"() AS "is_owner"));



CREATE POLICY "Owner manage redaction rules" ON "public"."redaction_rules" USING (( SELECT "public"."is_owner"() AS "is_owner")) WITH CHECK (( SELECT "public"."is_owner"() AS "is_owner"));



CREATE POLICY "Public reads active upgrade rules" ON "public"."sku_upgrade_rules" FOR SELECT USING (("is_active" = true));



CREATE POLICY "Published posts are publicly readable" ON "public"."blog_posts" FOR SELECT TO "authenticated", "anon" USING (("status" = 'published'::"text"));



CREATE POLICY "Staff full access" ON "public"."customers" USING (( SELECT "public"."is_staff"() AS "is_staff")) WITH CHECK (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Staff manage cross-sell rules" ON "public"."sku_cross_sell_rules" TO "authenticated" USING (( SELECT "public"."is_staff"() AS "is_staff")) WITH CHECK (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Staff manage promotions" ON "public"."promotions" TO "authenticated" USING (( SELECT "public"."is_staff"() AS "is_staff")) WITH CHECK (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Staff manage upgrade rules" ON "public"."sku_upgrade_rules" TO "authenticated" USING (( SELECT "public"."is_staff"() AS "is_staff")) WITH CHECK (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Staff read own page actions" ON "public"."profile_page_actions" FOR SELECT USING ((("profile_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_owner"() AS "is_owner")));



CREATE POLICY "Staff view redemptions" ON "public"."promotion_redemptions" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Users can insert SKUs" ON "public"."sku_master" FOR INSERT WITH CHECK (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Users can update SKUs" ON "public"."sku_master" FOR UPDATE USING (( SELECT "public"."is_staff"() AS "is_staff"));



CREATE POLICY "Users can view SKUs" ON "public"."sku_master" FOR SELECT USING (( SELECT "public"."is_staff"() AS "is_staff"));



ALTER TABLE "public"."_migration_tracking" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_assignees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_checklist_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_comment_reactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."activity_watchers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."advisor_queries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "advisor_queries_select_owner" ON "public"."advisor_queries" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_owner"() AS "is_owner"));



ALTER TABLE "public"."asset_cost_adjustments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_qc_checks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_rma_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backup_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_categorization_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_column_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_statements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_transaction_matches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bank_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cart_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_options" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_options_select_authenticated" ON "public"."custom_options" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "custom_options_write_owner" ON "public"."custom_options" USING (( SELECT "public"."is_owner"() AS "is_owner")) WITH CHECK (( SELECT "public"."is_owner"() AS "is_owner"));



ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."digest_channel_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."digest_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."digest_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_sends" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expense_reimbursements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extraction_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."field_corrections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_chapter_sections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kb_chapter_sections_select_authenticated" ON "public"."kb_chapter_sections" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."kb_chapters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "kb_chapters_select_authenticated" ON "public"."kb_chapters" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."market_price_observations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."newsletter_subscribers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."po_counter" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_page_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



ALTER TABLE "public"."promotion_redemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promotions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recon_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recurring_expense_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."redaction_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reorder_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."repair_job_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "repair_job_parts_authenticated" ON "public"."repair_job_parts" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



ALTER TABLE "public"."repair_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "repair_jobs_authenticated" ON "public"."repair_jobs" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



ALTER TABLE "public"."replacement_job_counter" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "replacement_job_counter_authenticated" ON "public"."replacement_job_counter" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



ALTER TABLE "public"."replacement_job_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "replacement_job_parts_authenticated" ON "public"."replacement_job_parts" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



ALTER TABLE "public"."replacement_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "replacement_jobs_authenticated" ON "public"."replacement_jobs" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



ALTER TABLE "public"."sale_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sale_payments_all" ON "public"."sale_payments" USING (true) WITH CHECK (true);



ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_document_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_category_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_cross_sell_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_master" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sku_upgrade_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."uploaded_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_correction_proposals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendors_owner_only" ON "public"."vendors" USING (( SELECT "public"."is_owner"() AS "is_owner")) WITH CHECK (( SELECT "public"."is_owner"() AS "is_owner"));



ALTER TABLE "public"."web_reservations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wishlist_items" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";








































































































































































































































































REVOKE ALL ON FUNCTION "public"."apply_backup_restore"("p_payload" "jsonb", "p_selected" "jsonb", "p_created_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_backup_restore"("p_payload" "jsonb", "p_selected" "jsonb", "p_created_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bible_introspect_rpcs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bible_introspect_rpcs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."bible_introspect_schema"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bible_introspect_schema"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."bible_introspect_status_values"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bible_introspect_status_values"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_warranty_expiry"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_warranty_expiry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_warranty_expiry"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."dispatch_digests"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dispatch_digests"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_bank_match_amount_cap"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_bank_match_amount_cap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_bank_match_amount_cap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_asset_number_with_prefix"("prefix" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_backup_snapshot"("p_modules" "text"[], "p_trigger_type" "text", "p_created_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_backup_snapshot"("p_modules" "text"[], "p_trigger_type" "text", "p_created_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_po_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_repair_job_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_repair_job_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_repair_job_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_replacement_job_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_replacement_job_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_replacement_job_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_vendor_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_invoice_number"("p_prefix" "text", "p_financial_year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_staff"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_staff"() TO "service_role";



GRANT ALL ON FUNCTION "public"."kb_chapters_search_tsv_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."kb_chapters_search_tsv_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."kb_chapters_search_tsv_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."kb_search"("p_query" "text", "p_role" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."kb_search"("p_query" "text", "p_role" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."match_customers_by_name"("p_name" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."match_customers_by_name"("p_name" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."match_vendors_by_name"("p_name" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."match_vendors_by_name"("p_name" "text", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."merge_sku_master"("p_source_ids" "uuid"[], "p_target_id" "uuid", "p_actor" "uuid", "p_reason" "text", "p_allow_cross_category" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."merge_sku_master"("p_source_ids" "uuid"[], "p_target_id" "uuid", "p_actor" "uuid", "p_reason" "text", "p_allow_cross_category" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."next_document_number"("p_entity_key" "text", "p_doc_type" "text", "p_financial_year" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."next_document_number"("p_entity_key" "text", "p_doc_type" "text", "p_financial_year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_document_number"("p_entity_key" "text", "p_doc_type" "text", "p_financial_year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_self_tier_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_expired_reservations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_expired_reservations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_breakdown"("p_from" "date", "p_to" "date", "p_dimension" "text", "p_include_financials" boolean, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_breakdown"("p_from" "date", "p_to" "date", "p_dimension" "text", "p_include_financials" boolean, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_data_health"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_data_health"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_expense_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_expense_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_expense_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text", "p_include_financials" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_expense_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text", "p_include_financials" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_expenses"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_expenses"("p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_expenses"("p_from" "date", "p_to" "date", "p_include_financials" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_expenses"("p_from" "date", "p_to" "date", "p_include_financials" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."report_fy"("d" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."report_fy"("d" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_fy"("d" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_gst_summary"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_gst_summary"("p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_inventory"("p_include_financials" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_inventory"("p_include_financials" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_kpis"("p_from" "date", "p_to" "date", "p_compare_from" "date", "p_compare_to" "date", "p_include_financials" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_kpis"("p_from" "date", "p_to" "date", "p_compare_from" "date", "p_compare_to" "date", "p_include_financials" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_receivables"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_receivables"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."report_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text", "p_include_financials" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."report_timeseries"("p_from" "date", "p_to" "date", "p_grain" "text", "p_include_financials" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reserve_assets"("p_prefix" "text", "purchased_by_type" "text", "qty" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_order_items"("p_order_id" "uuid", "p_ttl_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_order_items"("p_order_id" "uuid", "p_ttl_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_scheduled_backup"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_scheduled_backup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."scan_activity_due_dates"() TO "anon";
GRANT ALL ON FUNCTION "public"."scan_activity_due_dates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."scan_activity_due_dates"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."scan_recurring_expenses"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."scan_recurring_expenses"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_bank_transaction_recon_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_bank_transaction_recon_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_bank_transaction_recon_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_expense_reimbursement_status_on_paid_by_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_expense_reimbursement_status_on_paid_by_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_expense_reimbursement_status_on_paid_by_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_expense_reimbursement_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_expense_reimbursement_totals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_expense_reimbursement_totals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_po_payment_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_po_payment_totals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_po_payment_totals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_sale_payment_totals"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_sale_payment_totals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_sale_payment_totals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_sku_stock_from_movement"() TO "service_role";



GRANT ALL ON TABLE "public"."backup_settings" TO "anon";
GRANT ALL ON TABLE "public"."backup_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_settings" TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_backup_settings"("p_enabled" boolean, "p_frequency" "text", "p_day_of_week" smallint, "p_hour_local" smallint, "p_modules" "text"[], "p_retention_count" smallint, "p_timezone" "text", "p_cron_expression" "text", "p_updated_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_backup_settings"("p_enabled" boolean, "p_frequency" "text", "p_day_of_week" smallint, "p_hour_local" smallint, "p_modules" "text"[], "p_retention_count" smallint, "p_timezone" "text", "p_cron_expression" "text", "p_updated_by" "uuid") TO "service_role";
























GRANT ALL ON TABLE "public"."_migration_tracking" TO "anon";
GRANT ALL ON TABLE "public"."_migration_tracking" TO "authenticated";
GRANT ALL ON TABLE "public"."_migration_tracking" TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."activity_assignees" TO "anon";
GRANT ALL ON TABLE "public"."activity_assignees" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_assignees" TO "service_role";



GRANT ALL ON TABLE "public"."activity_checklist_items" TO "anon";
GRANT ALL ON TABLE "public"."activity_checklist_items" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_checklist_items" TO "service_role";



GRANT ALL ON TABLE "public"."activity_comment_reactions" TO "anon";
GRANT ALL ON TABLE "public"."activity_comment_reactions" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_comment_reactions" TO "service_role";



GRANT ALL ON TABLE "public"."activity_comments" TO "anon";
GRANT ALL ON TABLE "public"."activity_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_comments" TO "service_role";



GRANT ALL ON TABLE "public"."activity_watchers" TO "anon";
GRANT ALL ON TABLE "public"."activity_watchers" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_watchers" TO "service_role";



GRANT ALL ON TABLE "public"."advisor_queries" TO "anon";
GRANT ALL ON TABLE "public"."advisor_queries" TO "authenticated";
GRANT ALL ON TABLE "public"."advisor_queries" TO "service_role";



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



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."backup_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."backup_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."backup_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."bank_accounts" TO "anon";
GRANT ALL ON TABLE "public"."bank_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."bank_categorization_rules" TO "anon";
GRANT ALL ON TABLE "public"."bank_categorization_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_categorization_rules" TO "service_role";



GRANT ALL ON TABLE "public"."bank_column_profiles" TO "anon";
GRANT ALL ON TABLE "public"."bank_column_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_column_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."bank_statements" TO "anon";
GRANT ALL ON TABLE "public"."bank_statements" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_statements" TO "service_role";



GRANT ALL ON TABLE "public"."bank_transaction_matches" TO "anon";
GRANT ALL ON TABLE "public"."bank_transaction_matches" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_transaction_matches" TO "service_role";



GRANT ALL ON TABLE "public"."bank_transactions" TO "anon";
GRANT ALL ON TABLE "public"."bank_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."bank_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."blog_posts" TO "anon";
GRANT ALL ON TABLE "public"."blog_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."blog_posts" TO "service_role";



GRANT ALL ON TABLE "public"."business_profiles" TO "anon";
GRANT ALL ON TABLE "public"."business_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."business_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."cart_items" TO "anon";
GRANT ALL ON TABLE "public"."cart_items" TO "authenticated";
GRANT ALL ON TABLE "public"."cart_items" TO "service_role";



GRANT ALL ON TABLE "public"."custom_options" TO "anon";
GRANT ALL ON TABLE "public"."custom_options" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_options" TO "service_role";



GRANT ALL ON TABLE "public"."customer_profiles" TO "anon";
GRANT ALL ON TABLE "public"."customer_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."digest_channel_config" TO "anon";
GRANT ALL ON TABLE "public"."digest_channel_config" TO "authenticated";
GRANT ALL ON TABLE "public"."digest_channel_config" TO "service_role";



GRANT ALL ON TABLE "public"."digest_runs" TO "anon";
GRANT ALL ON TABLE "public"."digest_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."digest_runs" TO "service_role";



GRANT ALL ON TABLE "public"."digest_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."digest_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."digest_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."document_sends" TO "anon";
GRANT ALL ON TABLE "public"."document_sends" TO "authenticated";
GRANT ALL ON TABLE "public"."document_sends" TO "service_role";



GRANT ALL ON TABLE "public"."expense_reimbursements" TO "anon";
GRANT ALL ON TABLE "public"."expense_reimbursements" TO "authenticated";
GRANT ALL ON TABLE "public"."expense_reimbursements" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."extraction_templates" TO "anon";
GRANT ALL ON TABLE "public"."extraction_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."extraction_templates" TO "service_role";



GRANT ALL ON TABLE "public"."field_corrections" TO "anon";
GRANT ALL ON TABLE "public"."field_corrections" TO "authenticated";
GRANT ALL ON TABLE "public"."field_corrections" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_sequences" TO "anon";
GRANT ALL ON TABLE "public"."invoice_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."kb_chapter_sections" TO "anon";
GRANT ALL ON TABLE "public"."kb_chapter_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_chapter_sections" TO "service_role";



GRANT ALL ON TABLE "public"."kb_chapters" TO "anon";
GRANT ALL ON TABLE "public"."kb_chapters" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_chapters" TO "service_role";



GRANT ALL ON TABLE "public"."market_price_observations" TO "anon";
GRANT ALL ON TABLE "public"."market_price_observations" TO "authenticated";
GRANT ALL ON TABLE "public"."market_price_observations" TO "service_role";



GRANT ALL ON TABLE "public"."newsletter_subscribers" TO "anon";
GRANT ALL ON TABLE "public"."newsletter_subscribers" TO "authenticated";
GRANT ALL ON TABLE "public"."newsletter_subscribers" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."po_counter" TO "anon";
GRANT ALL ON TABLE "public"."po_counter" TO "authenticated";
GRANT ALL ON TABLE "public"."po_counter" TO "service_role";



GRANT ALL ON TABLE "public"."product_images" TO "anon";
GRANT ALL ON TABLE "public"."product_images" TO "authenticated";
GRANT ALL ON TABLE "public"."product_images" TO "service_role";



GRANT ALL ON TABLE "public"."profile_page_actions" TO "anon";
GRANT ALL ON TABLE "public"."profile_page_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_page_actions" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."promotion_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."promotion_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."promotion_redemptions" TO "service_role";



GRANT ALL ON TABLE "public"."promotions" TO "anon";
GRANT ALL ON TABLE "public"."promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."promotions" TO "service_role";



GRANT ALL ON TABLE "public"."sku_master" TO "anon";
GRANT ALL ON TABLE "public"."sku_master" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_master" TO "service_role";



GRANT ALL ON TABLE "public"."public_asset_test_report" TO "anon";
GRANT ALL ON TABLE "public"."public_asset_test_report" TO "authenticated";
GRANT ALL ON TABLE "public"."public_asset_test_report" TO "service_role";



GRANT ALL ON TABLE "public"."sku_category_templates" TO "anon";
GRANT ALL ON TABLE "public"."sku_category_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_category_templates" TO "service_role";



GRANT ALL ON TABLE "public"."public_categories" TO "anon";
GRANT ALL ON TABLE "public"."public_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."public_categories" TO "service_role";



GRANT ALL ON TABLE "public"."sku_cross_sell_rules" TO "anon";
GRANT ALL ON TABLE "public"."sku_cross_sell_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_cross_sell_rules" TO "service_role";



GRANT ALL ON TABLE "public"."public_cross_sell_rules" TO "anon";
GRANT ALL ON TABLE "public"."public_cross_sell_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."public_cross_sell_rules" TO "service_role";



GRANT ALL ON TABLE "public"."public_product_images" TO "anon";
GRANT ALL ON TABLE "public"."public_product_images" TO "authenticated";
GRANT ALL ON TABLE "public"."public_product_images" TO "service_role";



GRANT ALL ON TABLE "public"."public_product_units" TO "anon";
GRANT ALL ON TABLE "public"."public_product_units" TO "authenticated";
GRANT ALL ON TABLE "public"."public_product_units" TO "service_role";



GRANT ALL ON TABLE "public"."public_products" TO "anon";
GRANT ALL ON TABLE "public"."public_products" TO "authenticated";
GRANT ALL ON TABLE "public"."public_products" TO "service_role";



GRANT ALL ON TABLE "public"."public_promotions" TO "anon";
GRANT ALL ON TABLE "public"."public_promotions" TO "authenticated";
GRANT ALL ON TABLE "public"."public_promotions" TO "service_role";



GRANT ALL ON TABLE "public"."sku_upgrade_rules" TO "anon";
GRANT ALL ON TABLE "public"."sku_upgrade_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."sku_upgrade_rules" TO "service_role";



GRANT ALL ON TABLE "public"."public_upgrade_options" TO "anon";
GRANT ALL ON TABLE "public"."public_upgrade_options" TO "authenticated";
GRANT ALL ON TABLE "public"."public_upgrade_options" TO "service_role";



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



GRANT ALL ON TABLE "public"."recon_sessions" TO "anon";
GRANT ALL ON TABLE "public"."recon_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."recon_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_expense_rules" TO "anon";
GRANT ALL ON TABLE "public"."recurring_expense_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_expense_rules" TO "service_role";



GRANT ALL ON TABLE "public"."redaction_rules" TO "anon";
GRANT ALL ON TABLE "public"."redaction_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."redaction_rules" TO "service_role";



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



GRANT ALL ON TABLE "public"."replacement_job_counter" TO "anon";
GRANT ALL ON TABLE "public"."replacement_job_counter" TO "authenticated";
GRANT ALL ON TABLE "public"."replacement_job_counter" TO "service_role";



GRANT ALL ON TABLE "public"."replacement_job_parts" TO "anon";
GRANT ALL ON TABLE "public"."replacement_job_parts" TO "authenticated";
GRANT ALL ON TABLE "public"."replacement_job_parts" TO "service_role";



GRANT ALL ON TABLE "public"."replacement_jobs" TO "anon";
GRANT ALL ON TABLE "public"."replacement_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."replacement_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."sale_payments" TO "anon";
GRANT ALL ON TABLE "public"."sale_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."sale_payments" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON TABLE "public"."sales_document_items" TO "anon";
GRANT ALL ON TABLE "public"."sales_document_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_document_items" TO "service_role";



GRANT ALL ON TABLE "public"."sales_documents" TO "anon";
GRANT ALL ON TABLE "public"."sales_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_documents" TO "service_role";



GRANT ALL ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."uploaded_documents" TO "anon";
GRANT ALL ON TABLE "public"."uploaded_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."uploaded_documents" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."v_report_accessory_stock" TO "anon";
GRANT ALL ON TABLE "public"."v_report_accessory_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."v_report_accessory_stock" TO "service_role";



GRANT ALL ON TABLE "public"."v_report_sale_lines" TO "anon";
GRANT ALL ON TABLE "public"."v_report_sale_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."v_report_sale_lines" TO "service_role";



GRANT ALL ON TABLE "public"."v_report_data_health" TO "anon";
GRANT ALL ON TABLE "public"."v_report_data_health" TO "authenticated";
GRANT ALL ON TABLE "public"."v_report_data_health" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";



GRANT ALL ON TABLE "public"."v_report_expense_lines" TO "anon";
GRANT ALL ON TABLE "public"."v_report_expense_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."v_report_expense_lines" TO "service_role";



GRANT ALL ON TABLE "public"."v_report_inventory_units" TO "anon";
GRANT ALL ON TABLE "public"."v_report_inventory_units" TO "authenticated";
GRANT ALL ON TABLE "public"."v_report_inventory_units" TO "service_role";



GRANT ALL ON TABLE "public"."v_report_purchase_lines" TO "anon";
GRANT ALL ON TABLE "public"."v_report_purchase_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."v_report_purchase_lines" TO "service_role";



GRANT ALL ON TABLE "public"."v_report_receivables" TO "anon";
GRANT ALL ON TABLE "public"."v_report_receivables" TO "authenticated";
GRANT ALL ON TABLE "public"."v_report_receivables" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_code_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_code_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_code_seq" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_correction_proposals" TO "anon";
GRANT ALL ON TABLE "public"."vendor_correction_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_correction_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_payments" TO "anon";
GRANT ALL ON TABLE "public"."vendor_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_payments" TO "service_role";



GRANT ALL ON TABLE "public"."web_reservations" TO "anon";
GRANT ALL ON TABLE "public"."web_reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."web_reservations" TO "service_role";



GRANT ALL ON TABLE "public"."wishlist_items" TO "anon";
GRANT ALL ON TABLE "public"."wishlist_items" TO "authenticated";
GRANT ALL ON TABLE "public"."wishlist_items" TO "service_role";









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































