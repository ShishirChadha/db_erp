// Minimal frontmatter reader for docs/bible/**/*.md chapters. Deliberately not a new
// dependency (gray-matter isn't installed) -- js-yaml is already hoisted into
// node_modules, and our frontmatter shape is fixed and simple, so a ~15-line parse is
// enough. Used by generate.ts (drift-check `sources` globs), check.ts, and sync.ts.
import { readFileSync } from 'node:fs'
import yaml from 'js-yaml'

export type ChapterKind = 'module' | 'process' | 'rule' | 'generated'
export type Audience = 'owner' | 'manager' | 'employee'

export interface ChapterFrontmatter {
  slug: string
  title: string
  kind: ChapterKind
  audience: Audience[]
  routes?: string[]
  keywords?: string[]
  sources?: string[]
  updated: string // YYYY-MM-DD
}

export interface Chapter {
  meta: ChapterFrontmatter
  body: string // markdown body, frontmatter stripped
  raw: string // full file content
  path: string
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseChapterFile(path: string): Chapter {
  const raw = readFileSync(path, 'utf8')
  const match = FM_RE.exec(raw)
  if (!match) {
    throw new Error(`${path}: missing YAML frontmatter (expected a leading --- block)`)
  }
  const [, fmBlock, body] = match
  const meta = yaml.load(fmBlock) as ChapterFrontmatter
  if (!meta || typeof meta !== 'object') {
    throw new Error(`${path}: frontmatter did not parse to an object`)
  }
  for (const required of ['slug', 'title', 'kind', 'audience', 'updated'] as const) {
    if (!(required in meta)) {
      throw new Error(`${path}: frontmatter missing required field "${required}"`)
    }
  }
  // js-yaml parses an unquoted YYYY-MM-DD scalar as a native Date, not a string --
  // silently breaking every string-typed consumer (check.ts's `>` comparison against
  // a git-log date string always evaluated false this way, since it fell back to
  // comparing against Date.prototype.toString()'s "Sat Aug 29 2026..." format instead
  // of the ISO date). Normalize back to the YYYY-MM-DD string the type promises.
  if (meta.updated instanceof Date) {
    meta.updated = meta.updated.toISOString().slice(0, 10)
  }
  return { meta, body: body.trim(), raw, path }
}
