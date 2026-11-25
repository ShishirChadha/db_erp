-- merge_sku_master: move EVERY reference, not just units/POs/invoices.
-- Until now a merge left behind the website photos, publish state + listing +
-- URL, price, each unit's current_sku_id, rentals, online orders and holds,
-- carts/wishlists, price history, competitor links, free-gift promotions,
-- marketing cards and accessory RMA/replacement rows (all FKs to sku_master
-- were listed from pg_constraint on 2026-11-25). Used by the owner's SKU
-- Master merge and by Auto Check's "upgrade to Auto Check naming".
--
-- Also: this SECURITY DEFINER function was executable by anon/authenticated
-- (the website's public key) -- revoked; only the service role calls it.

CREATE OR REPLACE FUNCTION public.merge_sku_master(p_source_ids uuid[], p_target_id uuid, p_actor uuid, p_reason text DEFAULT NULL::text, p_allow_cross_category boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_img_offset int;
  v_has_primary boolean;
  v_images int;
  v_slug text;
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
    -- A unit reassigned to the source (Change SKU) now points at the target; one
    -- that ends up "reassigned" to its own original SKU is simply not reassigned.
    UPDATE asset_ledger SET current_sku_id = p_target_id WHERE current_sku_id = v_source_id;
    UPDATE asset_ledger SET current_sku_id = NULL WHERE current_sku_id = p_target_id AND sku_id = p_target_id;

    -- Everything else that points at a SKU (2026-11-25: the merge used to leave
    -- these behind -- website photos, online orders, rentals, price history...).
    UPDATE rental_agreements SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE order_items SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE web_reservations SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE market_price_observations SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE sku_price_changes SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE replacement_job_parts SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE accessory_replacement_job_parts SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE accessory_replacement_jobs SET old_sku_id = p_target_id WHERE old_sku_id = v_source_id;
    UPDATE accessory_replacement_jobs SET replacement_sku_id = p_target_id WHERE replacement_sku_id = v_source_id;
    UPDATE accessory_rma_events SET sku_id = p_target_id WHERE sku_id = v_source_id;
    UPDATE promotions SET free_gift_sku_id = p_target_id WHERE free_gift_sku_id = v_source_id;
    UPDATE marketing_assets SET source_sku_ids = array_replace(source_sku_ids, v_source_id, p_target_id) WHERE v_source_id = ANY(source_sku_ids);

    -- Unique per SKU: move what doesn't collide, the rest is a duplicate of a row the target already has.
    UPDATE competitor_price_links c SET sku_id = p_target_id
      WHERE c.sku_id = v_source_id
        AND NOT EXISTS (SELECT 1 FROM competitor_price_links t WHERE t.sku_id = p_target_id AND t.competitor_id = c.competitor_id AND t.listing_key IS NOT DISTINCT FROM c.listing_key);
    DELETE FROM competitor_price_links WHERE sku_id = v_source_id;
    UPDATE wishlist_items w SET sku_id = p_target_id
      WHERE w.sku_id = v_source_id AND NOT EXISTS (SELECT 1 FROM wishlist_items t WHERE t.sku_id = p_target_id AND t.customer_id = w.customer_id);
    DELETE FROM wishlist_items WHERE sku_id = v_source_id;
    UPDATE cart_items c SET sku_id = p_target_id
      WHERE c.sku_id = v_source_id
        AND NOT EXISTS (SELECT 1 FROM cart_items t WHERE t.sku_id = p_target_id AND t.customer_id = c.customer_id AND t.selected_upgrades IS NOT DISTINCT FROM c.selected_upgrades);
    DELETE FROM cart_items WHERE sku_id = v_source_id;

    -- Website photos: after the target's own, keeping a single primary.
    SELECT COALESCE(max(sort_order), -1) + 1, COALESCE(bool_or(is_primary), false)
      INTO v_img_offset, v_has_primary FROM product_images WHERE sku_id = p_target_id;
    UPDATE product_images SET sku_id = p_target_id, sort_order = sort_order + v_img_offset,
           is_primary = (is_primary AND NOT v_has_primary)
      WHERE sku_id = v_source_id;
    GET DIAGNOSTICS v_images = ROW_COUNT;

    -- Website listing and catalog facts: the target keeps whatever it has, and
    -- takes the source's where it has none. The public URL (web_slug) moves with
    -- the listing so links customers already have keep working. One selling
    -- price: web_price and selling_price_default move together.
    v_slug := NULL;
    IF v_target.web_slug IS NULL AND v_source.web_slug IS NOT NULL THEN
      v_slug := v_source.web_slug;
      UPDATE sku_master SET web_slug = NULL WHERE id = v_source_id;
    END IF;
    UPDATE sku_master t SET
      is_published         = t.is_published OR COALESCE(v_source.is_published, false),
      published_at         = CASE WHEN t.is_published THEN t.published_at
                                  WHEN v_source.is_published THEN v_source.published_at
                                  ELSE t.published_at END,
      web_slug             = COALESCE(t.web_slug, v_slug),
      web_title            = COALESCE(NULLIF(t.web_title, ''), v_source.web_title),
      web_description      = COALESCE(NULLIF(t.web_description, ''), v_source.web_description),
      web_highlights       = COALESCE(t.web_highlights, v_source.web_highlights),
      web_condition_grade  = COALESCE(NULLIF(t.web_condition_grade, ''), v_source.web_condition_grade),
      market_price         = COALESCE(t.market_price, v_source.market_price),
      selling_price_default = CASE WHEN t.selling_price_default IS NULL THEN v_source.selling_price_default ELSE t.selling_price_default END,
      web_price            = CASE WHEN t.selling_price_default IS NULL THEN v_source.web_price ELSE t.web_price END,
      base_cost            = COALESCE(t.base_cost, v_source.base_cost),
      hsn_code             = COALESCE(NULLIF(t.hsn_code, ''), v_source.hsn_code),
      sac_code_id          = COALESCE(t.sac_code_id, v_source.sac_code_id),
      warranty_label       = COALESCE(NULLIF(t.warranty_label, ''), v_source.warranty_label),
      reorder_level        = GREATEST(COALESCE(t.reorder_level, 0), COALESCE(v_source.reorder_level, 0)),
      -- spec keys the target lacks (e.g. backlit keyboard recorded only on the old SKU)
      specifications       = COALESCE(v_source.specifications, '{}'::jsonb) || COALESCE(t.specifications, '{}'::jsonb),
      updated_at = now(), updated_by = p_actor
    WHERE t.id = p_target_id;
    SELECT * INTO v_target FROM sku_master WHERE id = p_target_id;

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
        UPDATE sku_master SET status = 'archived', is_published = false, full_sku_code = v_new_full,
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
      'assets_moved', v_asset_count, 'quantity_moved', v_qty, 'reorder_rules_dropped', v_reorder_dropped,
      'images_moved', v_images, 'listing_moved', COALESCE(v_source.is_published, false)
    );
  END LOOP;

  RETURN jsonb_build_object('target_id', p_target_id, 'target_full_sku_code', v_target.full_sku_code, 'merged', v_merged);
END;
$function$;

revoke execute on function public.merge_sku_master(uuid[], uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.merge_sku_master(uuid[], uuid, uuid, text, boolean) to service_role;
