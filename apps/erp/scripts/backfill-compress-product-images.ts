// One-off backfill: reprocess every existing `product-images` bucket object (SKU
// photos + homepage banners) through the same resize/re-encode pipeline new
// uploads now use (lib/image-process.ts), so photos uploaded before that existed
// aren't left oversized. Safe to re-run -- already-webp objects near the target
// size are skipped.
//
// Usage (from apps/erp):
//   npx tsx scripts/backfill-compress-product-images.ts --dry-run
//   npx tsx scripts/backfill-compress-product-images.ts --limit 5
//   npx tsx scripts/backfill-compress-product-images.ts

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { processUploadedImage } from '../lib/image-process'

// No dotenv dependency for a one-off script -- just enough to read the same
// values Next.js would load from apps/erp/.env.local.
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
}
loadEnvLocal()

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitIdx = args.findIndex((a) => a === '--limit' || a.startsWith('--limit='))
const limit = limitIdx === -1 ? undefined : Number(args[limitIdx].includes('=') ? args[limitIdx].split('=')[1] : args[limitIdx + 1])

interface Row {
  table: 'product_images' | 'homepage_banners'
  id: string
  pathColumn: string
  storagePath: string
  widthColumn: string
  heightColumn: string
}

async function loadRows(): Promise<Row[]> {
  const rows: Row[] = []

  const { data: images, error: imagesErr } = await supabaseAdmin.from('product_images').select('id, storage_path')
  if (imagesErr) throw imagesErr
  for (const img of images ?? []) {
    rows.push({ table: 'product_images', id: img.id, pathColumn: 'storage_path', storagePath: img.storage_path, widthColumn: 'width', heightColumn: 'height' })
  }

  const { data: banners, error: bannersErr } = await supabaseAdmin.from('homepage_banners').select('id, image_path')
  if (bannersErr) throw bannersErr
  for (const b of banners ?? []) {
    rows.push({ table: 'homepage_banners', id: b.id, pathColumn: 'image_path', storagePath: b.image_path, widthColumn: 'image_width', heightColumn: 'image_height' })
  }

  return limit ? rows.slice(0, limit) : rows
}

async function processRow(row: Row) {
  const { data: downloaded, error: downloadErr } = await supabaseAdmin.storage.from('product-images').download(row.storagePath)
  if (downloadErr || !downloaded) {
    console.error(`  SKIP (download failed): ${row.table}/${row.id} -- ${row.storagePath} -- ${downloadErr?.message}`)
    return
  }

  const input = Buffer.from(await downloaded.arrayBuffer())
  const processed = await processUploadedImage(input)

  if (row.storagePath.endsWith('.webp') && input.byteLength <= processed.buffer.byteLength * 1.05) {
    console.log(`  SKIP (already optimal): ${row.table}/${row.id} -- ${row.storagePath} (${input.byteLength}B)`)
    return
  }

  const newPath = row.storagePath.endsWith('.webp') ? row.storagePath : row.storagePath.replace(/\.[a-zA-Z0-9]+$/, '') + '.webp'
  console.log(`  ${row.table}/${row.id}: ${row.storagePath} (${input.byteLength}B) -> ${newPath} (${processed.buffer.byteLength}B)`)
  if (dryRun) return

  const { error: uploadErr } = await supabaseAdmin.storage
    .from('product-images')
    .upload(newPath, processed.buffer, { contentType: 'image/webp', cacheControl: '31536000, immutable', upsert: true })
  if (uploadErr) {
    console.error(`  FAILED upload for ${row.table}/${row.id}: ${uploadErr.message}`)
    return
  }

  const { error: updateErr } = await supabaseAdmin
    .from(row.table)
    .update({ [row.pathColumn]: newPath, [row.widthColumn]: processed.width, [row.heightColumn]: processed.height })
    .eq('id', row.id)
  if (updateErr) {
    console.error(`  FAILED db update for ${row.table}/${row.id}: ${updateErr.message}`)
    return
  }

  // Only remove the old object once the new one is written and the row repointed
  // at it -- never delete before both of those have succeeded.
  if (newPath !== row.storagePath) {
    await supabaseAdmin.storage.from('product-images').remove([row.storagePath])
  }
}

async function main() {
  const rows = await loadRows()
  console.log(`${dryRun ? '[dry run] ' : ''}Processing ${rows.length} image(s)...`)
  for (const row of rows) {
    try {
      await processRow(row)
    } catch (err: any) {
      console.error(`  ERROR ${row.table}/${row.id}: ${err.message}`)
    }
  }
  console.log('Done.')
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
