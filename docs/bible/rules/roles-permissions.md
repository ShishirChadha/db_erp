---
slug: roles-permissions
title: Roles and permissions
kind: rule
audience: [owner, manager, employee]
routes: [/dashboard/settings]
keywords: [role, permission, access, owner, manager, employee, page access, edit grant, kaun kar sakta hai, who can, redaction rules]
sources:
  - apps/erp/lib/auth/session.ts
  - apps/erp/lib/auth/redact.ts
  - apps/erp/components/sidebar.tsx
updated: 2026-08-31
---

## The three roles

- **Owner** — full access to everything, always. Never needs an explicit grant.
- **Manager** — sees cost/vendor/margin (same visibility as owner on financial
  fields) and can approve/see more than an employee, but does **not**
  automatically get edit rights on every page it can view — "sees costs,
  approves POs" is a different grant from "can edit this page."
- **Employee** — the operational, day-to-day role. Redacted from cost/vendor/
  margin (see the one accessory exception in **business-rules**). Sees only
  pages it's been explicitly granted.

## Two separate kinds of grant

1. **Page access** (`profiles.allowed_pages`) — can this person even see the
   page? Owners always yes; manager/employee need the page's key in their
   allowlist. Checked via `hasPageAccess()`.
2. **Edit grant** (`profile_page_actions`, `can_edit`) — can this person
   *change* something on a page it can already see? Owner always yes;
   manager/employee need an explicit per-page grant here too, separate from
   page access. Checked via `canEditPage()`.

Owner sets both in **Settings → Users**. For the exact current matrix, see
`generated/permissions.md` — it's built live from these two tables plus the
nav structure, so it's always accurate to what's actually configured today,
not what was configured when this chapter was last written.

The three Reconciliation pages under Finance (`/dashboard/recon/vendors`,
`/dashboard/recon/bank`, `/dashboard/recon/sessions`)
are `ownerOnly: true` at the nav level (matching Vendors/RMA/Quotations), not a
grantable `pageKey` like the rest of Finance — every one of them is cost/
vendor-bearing (an uploaded vendor invoice's cost lines, a bank transaction's
counterpart) — and every API route underneath them checks `isOwner()` directly
regardless of the nav gate. See **reconciliation** for the module itself.

## Field redaction is a third, independent axis

Even on a page an employee can see and edit, specific *fields* can be hidden —
cost price, vendor name, margin — via `redaction_rules` (Settings → Field
Redaction), keyed by a logical shape (`sku_master`, `stock_list`, `accessories`,
`audit_log`, `vendors`) and checked per role (`hidden_from_manager` /
`hidden_from_employee`). This is what implements the cost/vendor/margin rule
from **business-rules** in a way the owner can tune without a code change.

## Where the enforcement actually lives

**Never trust the sidebar or `RequireOwner`/`RequirePageAccess` as the real
boundary** — those exist purely so a user doesn't see a menu item they can't
use; they're a UX convenience. The real check happens inside every API route
handler, via `getSessionUser()` (Bearer-token, for API routes) or
`getCookieSessionUser()` (cookie session, for server components), then
`isOwner()` / `isManagerOrAbove()` / `hasPageAccess()` / `canEditPage()`. A new
route that skips this check is a real security hole, not a cosmetic one — the
whole app runs on `supabaseAdmin` (service role), which bypasses Postgres RLS
entirely, so RLS policies are not a backstop here.

## A quick way to answer "can X role do Y?"

1. Is it a destructive/owner-exclusive action from **business-rules**'
   "Only the owner can" list? → owner only, full stop.
2. Otherwise, check `generated/permissions.md` for the page's current grants.
3. If it's a *field* visible/hidden question (cost, vendor, margin) rather than
   a page/action question, check the Redacted fields table in the same
   generated file.
