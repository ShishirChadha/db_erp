---
slug: create-and-manage-a-task
title: Creating and managing a task (Activity Hub)
kind: process
audience: [owner, manager, employee]
module: activities-notifications
routes: [/dashboard/activities]
keywords: [task, activity, assign, assignee, watcher, checklist, comment, mention, "@mention", tag, due date, reminder, pin, react, reaction, kaam, task banao, naya kaam, activity hub, to-do]
sources:
  - apps/erp/components/ActivityList.tsx
  - apps/erp/components/ActivityCommentThread.tsx
  - apps/erp/lib/activities.ts
  - apps/erp/app/api/activities/route.ts
  - apps/erp/app/api/activities/[id]/route.ts
  - apps/erp/app/api/activities/[id]/checklist/route.ts
  - apps/erp/app/api/activities/[id]/checklist/[itemId]/route.ts
  - apps/erp/app/api/activities/[id]/comments/route.ts
  - apps/erp/app/api/activities/[id]/comments/[commentId]/route.ts
  - apps/erp/app/api/activities/[id]/comments/[commentId]/reactions/route.ts
  - apps/erp/app/api/activities/assignable-users/route.ts
updated: 2026-09-16
---

## What this is

The Activity Hub (`/dashboard/activities`) is the one reusable task/
collaboration model for "someone should do X" — assignment, a checklist,
threaded comments with @mentions, reactions, pinning, due dates/reminders,
and completion tracking. It is a real, stored, editable record — unlike the
derived Pending Tasks checklist (see **work-the-pending-tasks-checklist**),
which is computed live and can't be assigned or commented on.

## Who can do this

Any signed-in staff member with the `activities` page key in their
`allowed_pages` (owners always have it). Visibility past that is per-task:
**owners see every task**; everyone else only sees a task they created, are
assigned to, or are watching (`buildOwnVisibilityFilter` / `canSeeActivity`
in `lib/activities.ts`). A task with no assignees at all is effectively
personal — only its creator and the owner see it.

## Steps — create a task

1. Open **Activity Hub**, click **+ New Task**.
2. Fill in title (required), description, priority, status, due date, and
   an optional reminder time.
3. **Assign to** — check one or more active users who have Activity Hub
   access; leave empty for a personal task. Checking someone as an assignee
   automatically clears them from **Watchers** — the two roles are mutually
   exclusive per person (an assignee already sees and is notified about the
   task).
4. **Watchers (CC)** — grants visibility and a notification without making
   that person responsible for the work, e.g. a manager who should stay
   informed.
5. Add tags (free text, autocompletes from existing tags) and optionally
   link the task to a business record (`related_type`/`related_id` — e.g.
   a specific customer, sale, PO, asset, repair job, invoice, vendor,
   recurring expense, or marketing asset).
6. Save. Every assignee gets a `task_assigned` notification and every
   watcher a `task_watched` notification, each linking straight into the
   task (`/dashboard/activities?open=<id>`).

## Steps — work an existing task

- **Edit** (pencil icon) reopens the same form to change any field,
  including re-assigning or re-watching; assignee/watcher changes are
  diffed and only the actual adds/removals fire new notifications and get
  logged to field-correction history.
- **Checklist** (inside the task's detail view): add an item, check it off,
  or delete it. Anyone who can see the task can add/toggle/delete checklist
  items — it is not owner- or assignee-only.
- **Comment** at the bottom of the detail view. Typing `@` opens a mention
  picker scoped to `mentionPool` — the task's current assignees, watchers,
  and creator. **@mentions are restricted server-side to people who can
  already see the task** (assignees, watchers, the creator, or any owner);
  the API rejects a mention outside that pool with "Can only mention
  someone who can already see this task" rather than silently granting
  that person access. A mentioned user gets a `mention` notification
  (taking priority over the plain `comment_added` notice an assignee/
  creator gets for any new comment).
- **Attach a file to a comment** via the paperclip icon — it uploads
  client-side through the existing signed-URL flow
  (`/api/storage/upload-url`, folder `activities/<id>/comments`) and the
  comment stores `{key, name, size}`; opening it later goes through
  `/api/storage/download-url`.
- **React** to a comment with the paperclip's neighboring smiley icon —
  a fixed six-emoji palette (👍 ❤️ 🎉 👀 🚀 ✅), toggled on/off per user per
  emoji.
- **Pin a comment** (pin icon, only shown if you can pin) to float it to
  the top of the thread — restricted to the task's creator or an owner,
  not any comment author.
- **Edit/delete your own comment** — the comment author or an owner can
  edit the body (marked `edited`) or soft-delete it; nobody else can.
- **Duplicate** (copy icon) clones a task's title (+" (copy)"), description,
  tags, priority, dates, related record, and assignees/watchers into a
  fresh `pending` task.
- **Delete** a task (creator or owner only) soft-deletes it
  (`is_deleted = true`) — recoverable only by an owner from the database,
  per the confirmation dialog's own wording.
- **Add to Calendar** on a task with a due date downloads a one-off `.ics`
  file for that single task (`GET /api/activities/[id]/ics`) — for an
  always-current feed of every visible task instead, see
  **subscribe-to-the-task-calendar-feed**.

## Marking a task done / reviewed

- Change **Status** to **Done** (via Edit, or inline where offered) — this
  stamps `completed_at`/`completed_by` from the transition itself, never a
  client-supplied value, and notifies the task's assignees and creator of
  the status change.
- Once a task is **Done**, an owner can **Mark Reviewed** from the detail
  view — this is owner-only regardless of who created or was assigned the
  task, and stamps `reviewed_at`/`reviewed_by`.
- Reopening a done/cancelled task (moving it back to pending/in_progress),
  or editing its due date, resets the cron due-soon/overdue reminder state
  so a stale task doesn't immediately re-fire a reminder for the old date.

## Common mix-ups

- **"I can't @mention this person."** — they must already be an assignee,
  watcher, the task's creator, or an owner. Add them as a watcher first if
  they need visibility, rather than expecting a mention to grant access.
- **"I assigned someone but they're also listed as a watcher."** — the UI
  won't let this happen going forward (checking a Watcher checkbox that's
  already an assignee is filtered out), but if you see it, re-save the
  task's assignees.
- **"Only I can see this task."** — it has no assignees or watchers, so
  it's a personal task by definition; only you and the owner can see it
  until you assign or watch it out.
- **"I can't Mark Reviewed."** — that action is owner-only and only appears
  once the task's status is Done.
