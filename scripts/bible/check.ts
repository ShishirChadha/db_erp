#!/usr/bin/env tsx
// Drift check: for every hand-written Bible chapter (modules/processes/rules), maps its
// frontmatter `sources` globs against files git says changed, and fails when a source
// changed more recently than the chapter's `updated` date. This is the mechanism that
// replaces "update the docs" convention with something that actually fails loudly --
// wired as a pre-push hook (warn) and as the input to /bible (.claude/skills/bible/).
//
// Usage:
//   npx tsx scripts/bible/check.ts                 -- check against origin/main...HEAD
//   npx tsx scripts/bible/check.ts --since <ref>    -- check against a specific ref
//   npx tsx scripts/bible/check.ts --all            -- check every chapter against its
//                                                       full history (slow; for audits)
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { globSync } from 'glob'
import * as minimatchPkg from 'minimatch'
import { parseChapterFile } from './lib/frontmatter'

// Defensive: minimatch >=9 exports a named `minimatch` fn; older majors (which can
// still end up hoisted in a workspace with many transitive consumers) export the fn
// as module.exports directly. Support both so a hoisting shuffle doesn't silently break.
const minimatch: (target: string, pattern: string) => boolean =
  (minimatchPkg as any).minimatch ?? (minimatchPkg as any).default ?? (minimatchPkg as any)

const ROOT = resolve(__dirname, '../..')

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function getChangedFiles(since: string): string[] {
  try {
    return git(`diff --name-only ${since}...HEAD`).split('\n').filter(Boolean)
  } catch {
    // No such ref (e.g. shallow clone, or `since` doesn't exist yet) -- fall back to
    // uncommitted + staged changes, which is what matters for a local pre-push check.
    return git(`diff --name-only HEAD`).split('\n').filter(Boolean)
  }
}

function lastCommitDate(file: string): string | null {
  try {
    const out = git(`log -1 --format=%cs -- "${file}"`)
    return out || null
  } catch {
    return null
  }
}

function main() {
  const args = process.argv.slice(2)
  const sinceIdx = args.indexOf('--since')
  const since = sinceIdx >= 0 ? args[sinceIdx + 1] : 'origin/main'
  const checkAll = args.includes('--all')

  const chapterFiles = globSync('docs/bible/{modules,processes,rules}/**/*.md', { cwd: ROOT })
  if (chapterFiles.length === 0) {
    console.log('No hand-written Bible chapters found yet -- nothing to check.')
    return
  }

  const changed = checkAll ? null : new Set(getChangedFiles(since))
  const stale: { slug: string; path: string; reason: string }[] = []

  for (const rel of chapterFiles) {
    const abs = resolve(ROOT, rel)
    let chapter
    try {
      chapter = parseChapterFile(abs)
    } catch (err: any) {
      stale.push({ slug: rel, path: rel, reason: err.message })
      continue
    }
    const sources = chapter.meta.sources || []
    if (sources.length === 0) continue

    for (const glob of sources) {
      if (checkAll) {
        // Full-history mode: find the newest commit touching anything matching this glob.
        const matches = globSync(glob, { cwd: ROOT })
        for (const m of matches) {
          const d = lastCommitDate(m)
          if (d && d > chapter.meta.updated) {
            stale.push({ slug: chapter.meta.slug, path: rel, reason: `${m} last touched ${d}, chapter says updated: ${chapter.meta.updated}` })
            break
          }
        }
      } else {
        const hit = [...changed!].find((f) => minimatch(f, glob) || minimatch(f, glob + '/**'))
        if (hit) {
          stale.push({ slug: chapter.meta.slug, path: rel, reason: `${hit} changed since ${since}, but ${rel}'s frontmatter "updated" wasn't bumped in this diff` })
        }
      }
    }
  }

  if (stale.length === 0) {
    console.log(`bible:check OK -- ${chapterFiles.length} chapters, no drift detected.`)
    return
  }

  console.error(`\nBible drift detected in ${stale.length} chapter(s):\n`)
  for (const s of stale) {
    console.error(`  - ${s.path}\n      ${s.reason}`)
  }
  console.error(`\nEdit the chapter (or confirm it's still accurate) and bump its frontmatter "updated" date.`)
  console.error(`Run \`/bible\` in a Claude Code session to draft the edits automatically.\n`)
  process.exitCode = 1
}

main()
