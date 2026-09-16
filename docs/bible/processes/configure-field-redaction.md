---
slug: configure-field-redaction
title: Configuring which fields are hidden from Manager/Employee (Field Redaction)
kind: process
module: settings-admin
audience: [owner]
routes: [/dashboard/settings]
keywords: [field redaction, hide field, redact cost, hide vendor, hide margin, shape, redaction rules, employee visibility, manager visibility, who can see cost, cost price hide karo, field chupao]
sources:
  - apps/erp/components/FieldRedactionManager.tsx
  - apps/erp/app/api/settings/redaction-rules/route.ts
  - apps/erp/lib/auth/redact.ts
updated: 2026-09-16
---

## What this is

Settings → Field Redaction (`FieldRedactionManager`) is the owner's live
control panel over which individual fields are stripped from API responses
for the `manager` and `employee` roles. It's the configuration surface
behind the redaction mechanism described in `roles-permissions` — this
chapter is about *using the screen*, not the underlying architecture.

## What a "shape" is

A **shape** (`redaction_rules.shape`) is a logical record type, not always a
literal SQL table — it's whatever key a particular API route passes to
`redactForRole()`/`redactManyForRole()` (`lib/auth/redact.ts`) when it
serializes its response. Today's shapes, with their UI labels:

| shape | label shown in this screen |
|---|---|
| `sku_master` | SKU Master |
| `stock_list` | Stock (Live Stock / New Entry / Invoices) |
| `accessories` | Accessories |
| `vendors` | Vendors |

(`redact.ts`'s `RedactableShape` type also includes `audit_log`, used by the
audit-log feed's field-level redaction check, `isFieldHiddenForRole` — that
one drops a changed-field diff entry entirely rather than masking an object
key, since an audit row's redactable field is a *value*
(`row.field_name`), not a literal object key.)

Each row in this screen is one `{shape, field_name}` pair — e.g.
`{sku_master, cost_price}` — with two independent toggles.

## Who can do this

Owner only, both directions: `GET`/`PATCH /api/settings/redaction-rules`
both check `isOwner(sessionUser)` and return 403 otherwise. Managers see the
*effect* of this policy (costs shown or hidden per the rules), but never the
policy surface itself — a manager cannot open this screen or call these
routes to see what's configured to be hidden from them.

## Steps

1. Open **Settings → Field Redaction**. Rules are grouped by shape, each in
   its own table with one row per field.
2. For each field, two checkboxes:
   - **Hidden from Employee** — sets `hidden_from_employee`.
   - **Hidden from Manager** — sets `hidden_from_manager`.
   These are independent — a field can be hidden from Employee but visible
   to Manager, or vice versa, or hidden from both, or neither.
3. Toggling a checkbox saves immediately (`PATCH` fires on
   `onCheckedChange`, no separate Save button) and the row dims briefly
   while the request is in flight.
4. **The owner always sees everything** — redaction rules never apply to
   the owner role; `redactForRole`/`redactManyForRole` short-circuit and
   return the row unmodified when `role === 'owner'`.

## Effective immediately — no deploy or restart

Unchecking (or checking) a box here changes live API responses right away,
for every request from that point on — this is a database-driven policy
table read at request time, not a code constant. There's a small in-memory
cache (`rulesCache`, 60-second TTL in `lib/auth/redact.ts`) for performance,
but every `PATCH` explicitly calls `invalidateRedactionRulesCache()` before
returning, so a change made through this screen is visible on the very next
request from any user, not just after the cache would naturally expire.

## Common mix-ups

- **"I hid a field but the employee still sees it in a place I didn't
  expect."** — redaction only strips fields at the specific shape a route
  actually passes to `redactForRole`. A route that fetches the same
  underlying column but serializes it under a different shape (or doesn't
  call `redactForRole` at all) isn't covered by this rule. Per the coding
  convention, new employee-facing routes should avoid `.select()`ing
  sensitive columns in the first place rather than relying on fetch-then-redact.
- **"Why is this field not listed as an option at all?"** — this screen
  only shows rows that already exist in `redaction_rules`; a genuinely new
  field needs a new row seeded in the table (a schema-level change, not
  something addable from this UI) before it can be toggled here.
- **"I'm a manager and I can't find this screen."** — expected; it's not
  just hidden by page-access grants, the API itself refuses non-owners.
