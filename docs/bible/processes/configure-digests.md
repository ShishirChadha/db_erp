---
slug: configure-digests
title: Configuring email/WhatsApp/in-app digests
kind: process
module: settings-admin
audience: [owner]
routes: [/dashboard/settings]
keywords: [digests, digest email, daily digest, weekly report, fortnightly digest, monthly digest, whatsapp digest, send now, preview digest, test digest, email report, business summary, digest bhejo]
sources:
  - apps/erp/components/DigestsManager.tsx
  - apps/erp/app/api/settings/digests/route.ts
  - apps/erp/app/api/digests/run/route.ts
updated: 2026-09-16
---

## What this is

Settings → Digests (`DigestsManager`) configures scheduled "insight nugget"
summaries — built on the same numbers as Dashboard → Reports — sent on a
per-person, per-period basis over up to three channels: email, WhatsApp, and
in-app notification. It's two things in one screen: a **channel config**
(shared credentials/settings for the whole business) and a list of
**per-person subscriptions** (who gets what, how often, over which
channels).

## Who can do this

Owner only. Both `GET`/`PUT /api/settings/digests` and
`POST /api/digests/run?preview=1` (the "send test now" path) check
`isOwner(sessionUser)`. The non-preview run path
(`POST /api/digests/run` without `?preview=1`) is called by a `pg_cron` job,
authenticated by a shared `x-cron-secret` header matched against
`digest_channel_config.dispatch_secret` — not by a user session at all.

## The four periods

Every person can have up to four independent subscriptions, one per period:

| Period | What it covers |
|---|---|
| Daily | Yesterday, in full — a fresh closed day every morning. |
| Weekly | The Monday–Sunday week that just ended, sent every Monday. |
| Fortnightly | The half-month that just ended (1st–15th or 16th–end), sent on the 1st and 16th. |
| Monthly | This month so far, 1st to today — not a rolling 30 days, so it grows through the month. |

## Steps — channel configuration

1. Open **Settings → Digests**, expand the **Channels** card (collapsed by
   default, showing a one-line status summary).
2. **Email** — check "Email enabled." Email sending itself relies on
   `RESEND_API_KEY`/`RESEND_FROM_EMAIL` already configured in the server
   environment; an optional **From-address override** can be set here per
   business preference.
3. **WhatsApp** (Meta WhatsApp Cloud API) — check "WhatsApp enabled," then
   fill in **Phone Number ID**, **Template name**, **Access token** (a
   password-style field — it's encrypted at rest and never round-tripped
   back to the browser after saving; the field just shows a "stored" badge
   once set, and leaving it blank on a later save keeps the existing token
   rather than wiping it), and **Graph API version** (defaults `v21.0`). A
   free Meta tier supports up to 5 test recipients and 250
   conversations/day; the approved template needs five body placeholders in
   this fixed order: period label, revenue, units, collections, outstanding.
4. **Dispatch URL / secret** — the deployed URL the `pg_cron` job calls
   (`.../api/digests/run`) and a shared secret it sends as `x-cron-secret`.
   Leaving the URL blank just keeps automatic scheduling off — "Send now"
   still works regardless, since that path authenticates as the owner
   instead.
5. Click **Save Channels**.

## Steps — per-person subscriptions

1. Each active profile gets its own collapsed card, showing a compact
   status pill per period (e.g. "Daily · 9pm") when enabled, with a small
   send icon next to each pill for a quick test send without expanding.
2. Expand a person's card to edit any of their four period tabs
   (Daily/Weekly/Fortnightly/Monthly) individually:
   - **Send this digest** — enables/disables that one subscription.
   - **Hour** (0–23, in the fixed `Asia/Kolkata` timezone) — when it goes
     out.
   - **Channels** — independent checkboxes for Email / WhatsApp / In-app.
   - **Email recipients** (only shown if Email is checked) — comma-separated
     override addresses; leave blank to use that person's account email
     (`contact_email`, falling back to their Auth email).
   - **WhatsApp number** (only shown if WhatsApp is checked) — with country
     code, no leading `+`.
   - **Sections in this digest** — a checklist of content blocks
     (`blockCatalog`), filtered to only the blocks that person's *role* is
     allowed to see — a manager or employee subscription can never be given
     a financial block even by a crafted request, since the block list is
     re-filtered server-side by role on every save
     (`sanitizeBlocks(s.blocks, role)`), not just hidden in the UI.
3. Click **Save** to persist that one period's settings.

## Steps — sending a test / preview digest

Click **Send test now** (or the small send icon on the collapsed card) on
any period tab — even one that's never been saved. This silently saves just
that one subscription row first if it doesn't have an id yet, then calls
`POST /api/digests/run?preview=1`. A preview send:

- Ignores the `enabled` flag and the "is this period actually due today"
  check that governs real scheduled sends.
- Still actually delivers over whichever channels are checked (it's a real
  send, not a dry-run render) — but it does **not** write a
  `digest_runs` claim row the way a real cron-triggered send does, so
  sending a preview never blocks or gets blocked by the real scheduled send
  for that same period.
- Shows a per-channel result inline next to the button (e.g.
  "email: sent · whatsapp: Already sent for this period" — that specific
  message only applies to a real, non-preview run).

## Recent Sends

The bottom card (collapsed by default) lists the last 50 actual dispatch
attempts (`digest_runs`) — sent time, period, channel, status, and error
message if any. Each `(subscription, period, period_start, channel)`
combination can only be claimed once, which is what prevents an overlapping
cron tick from double-sending the same digest.

## Common mix-ups

- **"I saved a WhatsApp token but the field looks empty now."** — expected;
  secrets are write-only fields. The "stored" badge next to the label is
  the confirmation it's saved, not the field itself re-populating.
- **"A manager's digest doesn't show the revenue chart I picked."** — check
  the block is actually allowed for that role; role-inappropriate blocks
  are silently dropped server-side even if you managed to select one in a
  stale UI state.
- **"Send test now didn't seem to log anywhere."** — correct; a preview
  send never writes a `digest_runs` row at all (the claim step is skipped
  outright when `preview` is true), so it will never show up in **Recent
  Sends** — the result is only ever shown inline next to the button at send
  time.
