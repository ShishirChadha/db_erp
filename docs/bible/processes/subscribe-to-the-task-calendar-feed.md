---
slug: subscribe-to-the-task-calendar-feed
title: Subscribing to your task calendar feed
kind: process
audience: [owner, manager, employee]
module: activities-notifications
routes: [/dashboard/activities]
keywords: [calendar, ical, ics, sync calendar, google calendar, outlook, apple calendar, subscribe, feed url, calendar link, task reminder, calendar mein dekhna]
sources:
  - apps/erp/components/CalendarFeedLink.tsx
  - apps/erp/app/api/activities/calendar-feed/token/route.ts
  - apps/erp/app/api/activities/calendar-feed/[token]/route.ts
updated: 2026-09-16
---

## What this is

A personal, always-current iCal (`.ics`) subscription URL that mirrors your
Activity Hub tasks with due dates into an external calendar app (Google
Calendar, Outlook, Apple Calendar, a phone's built-in calendar). This is
different from the one-off **Add to Calendar** button on a single task's
detail view, which just downloads a single static `.ics` file for that one
task — the feed URL instead stays subscribed and keeps updating as your
tasks change.

## Who can do this

Any signed-in staff member — this is per-user, not owner-gated. You can
only ever reveal or regenerate **your own** feed link; there is no way to
see anyone else's.

## Steps

1. Open **Activity Hub** (`/dashboard/activities`) and click **Sync to
   Calendar**.
2. The modal loads and displays your personal feed URL
   (`GET /api/activities/calendar-feed/token`) — every profile already has
   a `calendar_feed_token` (a UUID, default-generated on the column), so
   there's no separate "set up" step.
3. Click **Copy**, then paste the URL into your calendar app's
   "subscribe from URL" flow:
   - **Google Calendar:** Settings → Add calendar → From URL.
   - **Outlook:** Add calendar → Subscribe from web.
   - **Apple Calendar:** File → New Calendar Subscription.
4. Your calendar app will periodically re-fetch that URL on its own
   schedule (this ERP does not push updates).

## What's in the feed

`GET /api/activities/calendar-feed/[token]` returns every task with a
`due_date` set, excluding `done`/`cancelled` ones, scoped by the same
visibility rule as the Activity Hub itself: an **owner's** feed includes
every such task; everyone else's feed is limited to tasks they created, are
assigned to, or are watching. Each event's reminder is derived from the
gap between the task's `due_date` and its `reminder_at`, if set.

## The URL itself is the credential

**This is the important part.** The feed endpoint has no session or Bearer
auth — calendar apps poll it directly with nothing but the URL, the same
way Google Calendar's own private iCal links work. That means:

- **Anyone who has the link can read that task list** (no further login
  required) — treat it like a password, not a bookmark to share casually.
- If you think it's leaked (shared by mistake, pasted somewhere public),
  click **Regenerate Link** in the same modal
  (`POST /api/activities/calendar-feed/token`). This immediately rotates
  your `calendar_feed_token` to a new UUID — **the old URL stops working
  the instant you regenerate**, so any calendar app still subscribed on
  the old link will simply stop getting updates until you re-subscribe it
  with the new one.

## Common mix-ups

- **"My calendar app isn't showing new tasks I just added."** — subscribed
  calendar feeds refresh on the external app's own polling interval (often
  hours), not instantly; this is normal for iCal subscriptions in general,
  not specific to this feature.
- **"I regenerated the link and now my calendar stopped updating."** — that
  is expected: the old URL is dead the moment you regenerate. Copy the new
  link and re-add the subscription in your calendar app.
- **"Why don't I see a coworker's tasks in my feed?"** — the feed follows
  the exact same visibility rule as the Activity Hub list: non-owners only
  ever see tasks they created, are assigned to, or are watching.
