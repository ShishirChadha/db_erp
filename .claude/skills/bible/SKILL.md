---
name: bible
description: Fix Bible drift flagged by `npm run bible:check` (or the pre-push hook) — draft the exact chapter edits the check is asking for, in docs/bible/**. Use when the user says "/bible", "fix the bible drift", or asks why bible:check is failing.
---

# /bible — fix Bible drift

The ERP's internal Bible (`docs/bible/**`) is documentation with a CI-style
correctness check. `npm run bible:check` maps each hand-written chapter's
frontmatter `sources` globs against files that changed since `origin/main`; if a
source changed but the chapter's `updated` date wasn't bumped, the check fails
and names the stale chapter(s).

This skill is what closes that loop: instead of the developer manually re-reading
a chapter and guessing what changed, run the check, then **write the actual
content update**, not just touch the date.

## Steps

1. Run `npx tsx scripts/bible/check.ts --all` (broader than the push-time default —
   catches everything, not just this branch's diff) and read every flagged chapter.
2. For each flagged chapter:
   - Read the chapter's current body and its `sources` files.
   - Diff what the chapter *says* against what the source files *actually do* now
     (`git log -p -- <source>` since the chapter's `updated` date is a fast way to
     see exactly what changed).
   - Update the chapter body to match reality — steps, field names, route paths,
     role gates, whatever drifted. Don't just bump the date without reading the
     diff; a bumped date on stale content is worse than a flagged one, since it
     silences the check while still being wrong.
   - Bump `updated:` to today's date (`YYYY-MM-DD`).
   - If the change also affects `sku_category_templates`, `custom_options`,
     `redaction_rules`, RPC signatures, or CHECK constraints, remind the user to
     run `npm run bible:generate` too (chapters don't cover generated/**, that's
     automatic).
3. Run `npm run bible:generate` (safe no-op if nothing DB-side changed) and
   `npm run bible:sync` to push the corrected chapters live.
4. Re-run `npx tsx scripts/bible/check.ts --all` to confirm it's clean.
5. Summarize what changed, chapter by chapter, in plain language for the user —
   this is exactly the CHANGELOG-style summary `docs/README.md`'s update
   convention already asks for.

## Also use this skill when

- The user finishes a feature and asks "did I forget to update the docs?" — run
  `bible:check --all` unprompted as part of answering that.
- A new module/process doesn't have a chapter yet — write one following the
  frontmatter shape in any existing `docs/bible/{modules,processes,rules}/*.md`
  file (`slug`, `title`, `kind`, `audience`, `routes`, `keywords`, `sources`,
  `updated`). `keywords` should include natural English phrasing **and** Hinglish
  synonyms (see existing chapters for the pattern) — that field is what the
  advisor's search resolver matches against, so a chapter with thin keywords is
  effectively invisible to certain phrasings.

## A frontmatter gotcha

A route containing a dynamic segment (e.g. `/dashboard/stock/[id]`) breaks YAML
flow-sequence parsing if left unquoted inside `routes: [...]` — the `[id]`
reads as a nested list. Quote it: `routes: ['/dashboard/stock/[id]']`. This
doesn't affect `sources:`, since those are block-list (`- ` prefixed) entries,
not flow sequences.

## Do not

- Bump `updated:` without actually reading and reconciling the diff.
- Hand-edit anything under `docs/bible/generated/` — that tree is rebuilt by
  `npm run bible:generate` from live schema/route/nav truth; edits there are
  silently overwritten on the next generate.
- Write a chapter as a wall of prose with no `##` headings — `scripts/bible/sync.ts`
  splits chapters into `kb_chapter_sections` by `##`/`###` heading, which is what
  lets the advisor deep-link to the relevant part of a chapter rather than
  returning the whole thing.
