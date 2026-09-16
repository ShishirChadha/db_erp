#!/usr/bin/env tsx
// Content-hashes every docs/bible/**/*.md chapter and upserts changed ones into
// kb_chapters (the table DB Guide reads at runtime). Deletes rows for chapters
// removed from the repo. Runs on `postbuild`, so a deploy can never ship app
// code that's newer than the Bible rows it references.
//
// Usage: npx tsx scripts/bible/sync.ts
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { globSync } from 'glob'
import { parseChapterFile } from './lib/frontmatter'
import { supabaseAdmin } from './lib/supabase-admin'

const ROOT = resolve(__dirname, '../..')

function summarize(body: string): string {
  // First non-heading paragraph, truncated -- good enough for a search-result snippet.
  const firstPara = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith('|'))
  if (!firstPara) return ''
  return firstPara.length > 240 ? firstPara.slice(0, 237) + '...' : firstPara
}

function extractSections(body: string): { heading: string; anchor: string; body_md: string; sort_order: number }[] {
  const lines = body.split('\n')
  const sections: { heading: string; anchor: string; body_md: string; sort_order: number }[] = []
  let current: { heading: string; anchor: string; buf: string[] } | null = null
  let order = 0

  const flush = () => {
    if (current) {
      sections.push({ heading: current.heading, anchor: current.anchor, body_md: current.buf.join('\n').trim(), sort_order: order++ })
    }
  }

  for (const line of lines) {
    const m = /^(#{2,3})\s+(.*)$/.exec(line)
    if (m) {
      flush()
      const heading = m[2].trim()
      const anchor = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      current = { heading, anchor, buf: [] }
    } else if (current) {
      current.buf.push(line)
    }
  }
  flush()
  return sections
}

async function main() {
  const files = globSync('docs/bible/{modules,processes,rules}/**/*.md', { cwd: ROOT })
  console.log(`Found ${files.length} hand-written chapters.`)

  const seenSlugs = new Set<string>()
  const moduleSlugs = new Set<string>()
  const processModuleRefs: { slug: string; module: string }[] = []
  let upserted = 0, skipped = 0

  for (const rel of files) {
    const abs = resolve(ROOT, rel)
    const chapter = parseChapterFile(abs)
    const { meta, body } = chapter
    seenSlugs.add(meta.slug)
    if (meta.kind === 'module') moduleSlugs.add(meta.slug)
    if (meta.kind === 'process' && meta.module) processModuleRefs.push({ slug: meta.slug, module: meta.module })

    const contentHash = createHash('sha256').update(chapter.raw).digest('hex')

    const { data: existing } = await supabaseAdmin
      .from('kb_chapters')
      .select('content_hash')
      .eq('slug', meta.slug)
      .maybeSingle()

    if (existing?.content_hash === contentHash) {
      skipped++
      continue
    }

    const { error: upsertErr } = await supabaseAdmin.from('kb_chapters').upsert({
      slug: meta.slug,
      title: meta.title,
      kind: meta.kind,
      audience: meta.audience,
      module: meta.module ?? null,
      routes: meta.routes || [],
      keywords: meta.keywords || [],
      summary: summarize(body),
      body_md: body,
      content_hash: contentHash,
      source_globs: meta.sources || [],
      updated_at: meta.updated,
      synced_at: new Date().toISOString(),
    })
    if (upsertErr) {
      console.error(`  FAILED ${meta.slug}: ${upsertErr.message}`)
      process.exitCode = 1
      continue
    }

    // Replace this chapter's sections wholesale -- simplest correct approach at this scale.
    await supabaseAdmin.from('kb_chapter_sections').delete().eq('chapter_slug', meta.slug)
    const sections = extractSections(body)
    if (sections.length > 0) {
      const { error: sectionErr } = await supabaseAdmin
        .from('kb_chapter_sections')
        .insert(sections.map((s) => ({ chapter_slug: meta.slug, ...s })))
      if (sectionErr) console.error(`  section insert failed for ${meta.slug}: ${sectionErr.message}`)
    }

    console.log(`  synced ${meta.slug}`)
    upserted++
  }

  // Remove rows for chapters deleted from the repo.
  const { data: allRows } = await supabaseAdmin.from('kb_chapters').select('slug')
  const orphans = (allRows || []).filter((r) => !seenSlugs.has(r.slug)).map((r) => r.slug)
  if (orphans.length > 0) {
    await supabaseAdmin.from('kb_chapters').delete().in('slug', orphans)
    console.log(`  removed ${orphans.length} orphaned chapter(s): ${orphans.join(', ')}`)
  }

  // A process chapter's `module:` must point at a real module chapter's slug --
  // checked here rather than via a DB foreign key, since chapters are upserted one
  // file at a time with no ordering guarantee (see the kb_chapters.module column
  // comment). Fails loudly instead of silently orphaning the reference.
  const badRefs = processModuleRefs.filter((r) => !moduleSlugs.has(r.module))
  if (badRefs.length > 0) {
    for (const r of badRefs) {
      console.error(`  BAD MODULE REF: ${r.slug} declares module: ${r.module}, no such module chapter exists`)
    }
    process.exitCode = 1
  }

  console.log(`Done. ${upserted} synced, ${skipped} unchanged, ${orphans.length} removed.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
