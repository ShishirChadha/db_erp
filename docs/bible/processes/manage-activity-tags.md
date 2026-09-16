---
slug: manage-activity-tags
title: Managing activity tags
kind: process
module: settings-admin
audience: [owner]
routes: [/dashboard/settings]
keywords: [activity tags, task tags, rename tag, merge tag, delete tag, tag cleanup, tag typo, activities tags, tag management]
sources:
  - apps/erp/components/TagsManager.tsx
  - apps/erp/app/api/tags/route.ts
updated: 2026-09-16
---

## What this is

Settings → Activity Tags (`TagsManager`) is a cleanup tool for the free-text
tags used on `activities` (the Activity Hub task/collaboration system — see
`activities-and-tasks`). Tags are added freely by *anyone* directly on a
task in the Activity Hub — `activities.tags` is a plain `text[]` column, not
a normalized lookup table — so this screen exists specifically to fix a
typo'd tag or merge two spellings **across every task that uses it at
once**, rather than requiring someone to edit each task individually.

## Who can do this

- **Viewing** the current list of distinct tags in use
  (`GET /api/tags`) only requires being signed in *and* having page access
  to `activities` — it's not owner-restricted, since this same endpoint
  backs tag-autocomplete suggestions anywhere in the Activity Hub, not just
  this Settings screen.
- **Renaming, merging, or deleting** a tag (`PATCH /api/tags`) is
  **owner-only** — the endpoint explicitly checks `isOwner(sessionUser)`
  and refuses with "Only the owner can manage tags." otherwise. This
  dedicated Settings screen is also gated owner-only at the tab level
  (`activity_tags`, `ownerOnly: true`).

## Steps

1. Open **Settings → Activity Tags**. The list shows every distinct tag
   currently used by at least one non-deleted activity, alphabetically.
2. **Rename a tag** — click **Rename**, type the corrected spelling in the
   prompt, confirm. This calls `PATCH /api/tags` with `{oldTag, newTag}`.
   - Every activity carrying the old tag gets it rewritten to the new
     spelling.
   - **If the new spelling already exists on a given task**, the two are
     deduplicated (via a `Set`) rather than creating a duplicate entry in
     that task's tag array — so renaming one tag onto an existing one is
     effectively a **merge**, not just a plain string replace.
3. **Delete a tag** — click **Delete**, confirm the "remove this tag from
   every task that uses it" prompt. This calls the same `PATCH /api/tags`
   endpoint with `newTag: null`, which simply filters the tag out of every
   affected activity's array rather than renaming it to anything.
4. Both actions report back how many activities were actually affected
   (`updated` count) and log an audit event summarizing the bulk change.

## Common mix-ups

- **"I renamed a tag onto an existing spelling — did it create a
  duplicate?"** — no; the merge is deduplicated per-task automatically, a
  task that already had both spellings ends up with just one tag, not two
  identical entries.
- **"Can an employee fix their own typo'd tag?"** — no, not through this
  bulk mechanism; renaming/merging/deleting here is owner-only. An
  individual task's own tag list can still be hand-edited by whoever has
  edit access to that specific activity, one task at a time — this screen
  is specifically the bulk/global fix.
- **"The tag disappeared from the list here but the task still shows the
  old text."** — that would mean the underlying `activities.tags` update
  failed for that row; the endpoint returns an error per failed row rather
  than silently skipping it, so check for an error message rather than
  assuming partial success went unnoticed.
