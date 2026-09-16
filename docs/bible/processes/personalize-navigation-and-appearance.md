---
slug: personalize-navigation-and-appearance
title: Personalizing your sidebar and theme (My Navigation & Appearance)
kind: process
module: settings-admin
audience: [owner, manager, employee]
routes: [/dashboard/settings]
keywords: [my navigation, sidebar, hide menu item, pin favorite, reorder sidebar, reset navigation, appearance, theme, dark mode, color theme, slate, ocean, forest, amber, midnight, personalize, apna sidebar, theme badlo]
sources:
  - apps/erp/components/NavigationManager.tsx
  - apps/erp/components/AppearanceManager.tsx
  - apps/erp/lib/useNavPrefs.ts
updated: 2026-09-16
---

## What this is

Two self-service Settings tabs — **My Navigation** and **Appearance** — that
let any signed-in user personalize their own view of the app: which sidebar
items show, in what order, which are pinned as quick-access favorites, and
which color theme is active. Both are purely display-layer preferences on
top of (never a substitute for) the role-based access already enforced
elsewhere — hiding a page from your own sidebar never changes what you're
actually allowed to open, and it's still reachable via ⌘K search.

## Who can do this

**Every signed-in role** — owner, manager, and employee alike. Unlike the
other 8 chapters in this module, these two tabs are explicitly **not**
owner-gated: in the Settings page's `CATEGORIES` list, `appearance` and
`navigation` are the only two entries (alongside `audit_log`) marked
`ownerOnly: false`. Every other tab in Settings defaults to owner-only.

## Steps — My Navigation

1. Open **Settings → My Navigation**. It lists every sidebar group/item you
   currently have access to (filtered by your actual role/page grants
   first — this screen never shows you a toggle for something you can't
   open anyway).
2. **Hide/show an item** — check or uncheck the box next to a top-level
   group (if it has no children) or an individual child item within a
   group. Unchecking hides it from your sidebar; it doesn't touch anyone
   else's view or your actual access rights.
3. **Pin to Favorites** — click the star icon next to any group or item to
   pin it, up to **6 items maximum** (`MAX_PINNED_ITEMS`). Once you're at
   the limit, the star button disables on anything not already pinned until
   you unpin something. Pinned items surface at the top of your sidebar as
   quick-access favorites.
4. **Reorder groups** — use the up/down arrows on a group's row to move it
   earlier or later in your sidebar. This only reorders top-level groups,
   not the items within a group.
5. **Reset to default** — clears all of the above (hidden items, pins, and
   custom order) back to the standard sidebar layout in one click.

Every change saves immediately and individually (no separate Save button) —
each toggle/pin/reorder action calls `PATCH /api/profile/preferences` with
just that one patch, persisted server-side per profile so it follows you
across devices, not just stored locally in the browser.

## Steps — Appearance

1. Open **Settings → Appearance**. Five color themes are shown as cards:
   **Slate** (default — blue accent, neutral grays), **Ocean** (teal-blue
   accent, cool neutrals), **Forest** (green accent, warm neutrals),
   **Amber** (orange accent, warm neutrals), and **Midnight** (dark
   background, blue accent — the only genuinely dark theme of the five).
2. Click any theme card to apply it. It takes effect **instantly** across
   the app and is saved to your account, so it follows you across devices
   the same way navigation preferences do — not a local browser-only
   setting.

## Common mix-ups

- **"I hid a page from my sidebar — can I still get to it?"** — yes, via
  ⌘K search, or a direct link/bookmark; hiding is purely cosmetic on the
  sidebar itself and never revokes actual page access.
- **"I pinned 6 items and can't pin a 7th."** — expected; unpin something
  else first. The limit is a fixed constant (`MAX_PINNED_ITEMS = 6`), not
  configurable.
- **"My employee's sidebar looks different from mine."** — expected and
  intended; these are strictly per-person preferences, not something the
  owner sets on someone else's behalf from this screen.
- **"I switched themes but it looks the same on my other device."** — it
  should sync automatically since the preference is saved server-side; if
  it doesn't reflect immediately, a refresh on the other device should pick
  up the change.
