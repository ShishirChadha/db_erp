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
  - apps/erp/lib/auth/account-lock.ts
  - apps/erp/app/api/users/[id]/password/route.ts
updated: 2026-11-26
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

## Protected accounts: DB's master and DB

Two accounts can't be changed by other owners (`lib/assistant/permissions.ts`,
2026-11-22 security review — before this, any owner could reset any account's
password, including another owner's, then sign in as them):
- **DB's master** (the owner DB answers to, Settings → DB Assistant): only that
  owner can change their own password, role, access or active status, or log off
  their devices. Other owners see "Protected: only DB's master can change this
  account" on that row and every route answers 403 (`PATCH /api/users/[id]`,
  `DELETE /api/user-sessions/[id]`; "Log off all" skips them).
- **DB** (`username = db`): nobody can view or set her password or change her
  role — only the server signs her in, and anyone holding the password could act
  in her name. Her activate/deactivate (the off switch) can be changed only by
  DB's master. Her **page access is not edited here** (2026-11-24): it follows her
  skills in Settings → DB Assistant → What DB can do, so her row has no Edit access
  button and the route refuses page changes for her (**assistant**). Her login is also refused at the browser login
  (`/api/auth/log-event`, `/api/auth/session-register`).

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
     Contacts, Leads, Service, Finance, Activity Hub, Marketing).
     **Granting the `leads` key is not enough on its own** — it only shows an
     empty Leads screen until a Lead Set is actually assigned to that person
     (either they create one themselves, which auto-assigns it to them, or a
     manager/owner reassigns an existing one to them from the Leads page).
     See **leads** and the "Leads" section of **roles-permissions**.
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
   Replacement Jobs, SKU Master, Live Stock, Invoices, Customers, Leads,
   Activities, Sales, Stock, Website, Expenses, Quotations, RMA, Marketing,
   Rentals, Attendance.
3. **Unchecking view access for a page automatically drops its edit grant
   too** — edit implies view, so the UI enforces this client-side
   (`PageAccessCheckboxes`'s `toggle`).
4. Click **Save Access** on that user's row. This is a full-replace of their
   `page_edit_keys`: the API deletes all their existing
   `profile_page_actions` rows and re-inserts exactly the submitted set —
   independent of whether `allowed_pages` was also sent in the same request.

To edit an existing user's access later, use **Edit access** on their row
(same grouped checkboxes, pre-filled from their current grant).

**Trade-ins list (2026-11-23)** is a separate view grant under Sales. It
shows what we paid for each traded-in laptop (a purchase cost), so leave it
off for staff unless they should see buyback prices. Anyone who can sell can
still take a trade-in on a sale and print its slip without it. View-only:
there is no "Can edit" for it, since undo is owner-only.

## Steps — deactivating, reactivating, editing profile fields

- **Deactivate** — turns `profiles.is_active` off and closes the login itself:
  the account is banned, every device and sign-in is ended, the password is
  replaced with a random one, the calendar feed link changes, and the linked
  staff record is made inactive. History (sales, attendance) is kept. There is
  no hard delete of a user, since that would orphan references like
  `sales.entered_by`. Deactivated users are collapsed under a "Deactivated
  Users" disclosure at the bottom of the list.
- **Activate** (or **Restore** in the Audit Log) — lifts the ban and makes the
  staff record active again. The old password stays dead, so set a new one.
  The DB assistant's account is the exception: its switch only turns DB on and off.
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
