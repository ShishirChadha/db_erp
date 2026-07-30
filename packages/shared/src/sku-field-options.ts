// Single source of truth mapping a sku_category_templates field to the
// custom_options category backing its dropdown. Every SKU-creating entry point
// (SkuFormModal, Stock Intake, Purchases) imports this instead of keeping its own
// brand/model field list -- that per-file drift (free-text brand/model, or a
// separate `models` table with its own broken normalizer) is what let the same
// physical model get created as several different sku_master rows.
//
// Returns null for fields with no dropdown equivalent -- those fall through to
// whatever free-text/number/select rendering the caller already has.
export function getCustomOptionsCategory(skuCategory: string, fieldName: string): string | null {
  if (fieldName === 'brand') return 'brand'
  if (fieldName === 'model_year') return 'apple_model_year'
  if (fieldName === 'model') {
    if (skuCategory === 'LAP') return 'model_laptop'
    if (skuCategory === 'DES') return 'model_desktop'
    if (skuCategory === 'TAB') return 'model_tablet'
    if (skuCategory === 'MON') return 'model_monitor'
    return null
  }
  if (fieldName === 'series' && skuCategory === 'CPU') return 'cpu_series'
  if (fieldName === 'series' && skuCategory === 'GPU') return 'gpu_series'
  if (fieldName === 'resolution' && skuCategory === 'MON') return 'monitor_resolution'
  if (fieldName === 'storage' && skuCategory === 'TAB') return 'storage' // same GB-capacity concept as SSD
  if (fieldName === 'cpu') return 'cpu'
  if (fieldName === 'generation') return 'generation'
  if (fieldName === 'ram') return 'ram'
  if (fieldName === 'type' && skuCategory === 'RAM') return 'ram_type'
  if (fieldName === 'ssd') return 'storage'
  if (fieldName === 'screen_size' && skuCategory === 'LAP') return 'screen_size_laptop'
  if (fieldName === 'size' && skuCategory === 'MON') return 'screen_size_monitor'
  if (fieldName === 'connector_type' && skuCategory === 'ADP') return 'connector_type'
  return null
}
