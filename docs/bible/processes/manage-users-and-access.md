---
slug: manage-users-and-access
title: Managing users, roles, and page access
kind: process
module: settings-admin
audience: [owner]
routes: [/dashboard/settings]
keywords: [users, add user, create user, new employee, staff login, user id, username, role, owner, manager, employee, page access, edit access, deactivate user, activate user, reset password, view password, dekho password, naya user, staff banao, access dena, permission, allowed pages, can edit]
sources:
  - apps/erp/components/UserManager.tsx
  - apps/erp/app/api/users/route.ts
  - apps/erp/app/api/users/[id]/route.ts
  - apps/erp/app/api/users/[id]/password/route.ts
updated: 2026-09-16
---

## What this is

Settings → Users & Access (`UserManager`) is where the owner creates staff
logins, assigns a role, and picks exactly which pages each non-owner account
can see and edit. It also has an owner-only capability most settings screens
don't: revealing a staff member's current plaintext password.

## Who can do this

Owner only — every route behind this screen (`GET`/`POST /api/users`,
`PATCH /api/users/[id]`, `GET /api/users/[id]/password`) checks
`isOwner(sessionUser)` and returns 403 otherwise. There is no manager-level
access to this screen.

## Steps — creating a user

1. Open **Settings → Users & Access**.
2. Fill in the **Create User** form:
   - **User ID** — the login identifier (`profiles.username`). It **cannot
     contain spaces or `@`** — the form and the API both reject it
     (`/[@\s]/.test(...)`) with "User ID cannot contain spaces or "@" — use a
     plain name like ShishirCH." Internally this gets turned into a synthetic
     email address for Supabase Auth (`usernameToSyntheticEmail`), but the
     real login identifier staff type in is just the plain username.
   - **Display Name**, **Employee ID**, **Contact Email** — all optional.
     Contact Email is used only for notification delivery, not login.
   - **Password** — minimum 6 characters, or click **Generate** for a random
     12-character one.
   - **Role** — `employee`, `manager`, or `owner`.
   - **Page Access** — shown only when role isn't `owner` (an owner always
     has full access implicitly, with an empty `allowed_pages` array). Check
     each page the user should see, grouped the same way as the sidebar
     (Dashboard, New Entry, Accessories, Inventory, Live Stock, Sales,
     Contacts, Service, Finance, Activity Hub, Marketing).
3. Click **Create User**. This creates both a Supabase Auth user and a
   `profiles` row in one action; if the profile insert fails, the auth user
   is rolled back (deleted) so you never end up with a login that has no
   profile behind it.

## Steps — granting page access and edit rights

Each page in the access grid can be **view-only** or **view + edit**:

1. Checking a page's box grants view access (`allowed_pages`).
2. If that page has a real edit concept, a second **"Can edit"** checkbox
   appears next to it — this writes to `profile_page_actions`
   (`page_key`, `can_edit=true`). Not every page has this: `dashboard`,
   `pending_tasks`, and `reports` are view-only nav/landing pages with no
   edit concept (the DB's `profile_page_actions.page_key` CHECK constraint
   rejects them). Editable pages are: New Entry, Accessories, Repair Jobs,
   Replacement Jobs, SKU Master, Live Stock, Invoices, Customers,
   Activities, Sales, Stock, Website, Expenses, Quotations, RMA, Marketing.
3. **Unchecking view access for a page automatically drops its edit grant
   too** — edit implies view, so the UI enforces this client-side
   (`PageAccessCheckboxes`'s `toggle`).
4. Click **Save Access** on that user's row. This is a full-replace of their
   `page_edit_keys`: the API deletes all their existing
   `profile_page_actions` rows and re-inserts exactly the submitted set —
   independent of whether `allowed_pages` was also sent in the same request.

To edit an existing user's access later, use **Edit access** on their row
(same grouped checkboxes, pre-filled from their current grant).

## Steps — deactivating, reactivating, editing profile fields

- **Deactivate / Activate** — toggles `profiles.is_active`. There is no hard
  delete of a user; deactivation is the only revoke action, since a hard
  delete would orphan references like `sales.entered_by`/`sold_by`.
  `is_active = false` fully blocks login. Deactivated users are collapsed
  under a "Deactivated Users" disclosure at the bottom of the list, not
  shown alongside active ones.
- **Edit name / ID** — updates `full_name`, `employee_id`, `contact_email`
  in place. (This does not change the login username itself — there's no
  username-rename in this screen.)

## Steps — resetting or viewing a password

- **Set new password** — type a new password (6+ characters) into the field
  on the user's row and click **Set Password**. This calls
  `supabaseAdmin.auth.admin.updateUserById` directly, so it takes effect
  immediately with no email/confirmation step.
- **View password** — for any **non-owner** user, a "View password" button
  reveals that user's *current* password in plaintext, right there in the
  row. This is a real, intentional owner capability, not a bug: manager and
  employee passwords are stored **encrypted** in `profiles.encrypted_password`
  (`lib/auth/password-vault.ts`) specifically so the owner can retrieve them
  later — e.g. to tell a staff member their login again without resetting it.
  - Clicking it calls `GET /api/users/[id]/password`, decrypts the stored
    value, and shows it inline; clicking again ("Hide password") just clears
    the local state, no re-fetch.
  - **Owner passwords are never stored this way** — `encrypted_password` is
    always `NULL` for an `owner`-role profile (set at creation, and wiped
    any time a profile's role is *changed to* owner), and the endpoint
    explicitly refuses with 403 ("Owner passwords cannot be viewed.") for an
    owner target. The "View password" button itself is only rendered for
    non-owner rows in the UI.
  - Setting a new password immediately invalidates any currently-revealed
    view for that user (the UI drops the cached reveal so the next click
    re-fetches the new value, not a stale one).

## Common mix-ups

- **"Why can't I create a User ID with an @ in it?"** — by design; the
  username is not an email address even though Supabase Auth needs an
  email-shaped string internally. Use a plain name like `ShishirCH`.
- **"I unchecked a page but the edit checkbox is still showing."** — it
  shouldn't persist after a save; view access is a precondition for edit
  access both client-side and (implicitly, via the filtered `editKeys`
  array) server-side.
- **"Can a manager see or reset passwords?"** — no, this entire screen,
  including password view/reset, is owner-only regardless of role.
- **"I can't view the owner's own password."** — expected; owner passwords
  are never persisted in retrievable form (`encrypted_password` stays
  `NULL`), only manager/employee ones are.
