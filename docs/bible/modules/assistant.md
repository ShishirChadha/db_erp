---
slug: assistant
title: DB — the voice assistant
kind: module
audience: [owner]
routes: [/dashboard/assistant]
keywords: [db, assistant, hey db, db suno, wake word, sarvam, credit, balance, usage, voice, secretary, talk, mic, ai, pi by voice, bol ke, hinglish, remember, notes, whatsapp share, proforma by voice]
sources:
  - apps/erp/lib/assistant/identity.ts
  - apps/erp/lib/assistant/call-route.ts
  - apps/erp/lib/assistant/tools.ts
  - apps/erp/lib/assistant/data.ts
  - apps/erp/lib/assistant/loop.ts
  - apps/erp/lib/assistant/playbooks.ts
  - apps/erp/lib/assistant/share.ts
  - apps/erp/app/api/assistant/turn/route.ts
  - apps/erp/app/api/assistant/threads/route.ts
  - apps/erp/app/api/assistant/setup/route.ts
  - apps/erp/app/api/assistant/notes/route.ts
  - apps/erp/components/assistant/AssistantPanel.tsx
  - apps/erp/components/assistant/useVoice.ts
  - apps/erp/app/dashboard/assistant/page.tsx
  - apps/erp/lib/assistant/settings.ts
  - apps/erp/lib/assistant/usage.ts
  - apps/erp/lib/assistant/sarvam.ts
  - apps/erp/app/api/assistant/config/route.ts
  - apps/erp/app/api/assistant/transcribe/route.ts
  - apps/erp/app/api/assistant/speak/route.ts
  - apps/erp/components/assistant/AssistantSettingsManager.tsx
updated: 2026-11-21
---

## What it is

DB is the owner's assistant. Tap the round button at the bottom right of any
dashboard page, then the mic, and speak (Hinglish is fine). She asks the questions a
staff member would — price, GST included or not, free bag and mouse, which entity —
then shows a card with what she is about to save. Nothing is saved until you say yes
or tap **Confirm**.

She can make **PIs and quotations**, record **expenses**, enter **sales**, and open
**repair** and **replacement** jobs. After a PI she prepares a WhatsApp message with a
PDF link (valid 7 days); you tap the button to send it. She never sends anything
herself.

**DB answers to one person.** Only the logins ticked in Settings → DB Assistant can see
her button, her settings tab or use her — other owners included. It starts as Shishir's
login (admin@digitalbluez.com).

## Her own ERP user

DB is a real user (`db`, role manager), created the first time you open the panel
(**Set up DB**). Everything she saves shows **DB** as the creator and in the audit log.
She can only reach the screens her tasks need (PIs, expenses, new entry, repairs,
replacements, customers, stock).

**Off switch:** log her off in Settings → Active Devices ("DB assistant (server)") or
deactivate her in Users. The panel then offers **Wake DB up** (not for a deactivated
DB — undo that in Users).

Owner-only expense types (Salaries etc.) stay owner-only: she will ask you to enter
those yourself.

## How she gives advice

Before proposing, she checks and tells you if:
- the price is below cost or margin, far from the list price, or different from what
  this customer paid or was quoted before, or outside the model's recent sale range;
- stock is short;
- the customer already got a PI for the same item this week, or has no GSTIN;
- an expense looks like a duplicate or is much larger than usual for its type;
- a sale is only partly paid;
- a device has been in for repair before.

## What she remembers

When you state a preference ("ABC ko hamesha free bag"), she offers to remember it.
It is saved only on a yes. **DB Assistant → What DB remembers** lists every note, and
you can delete any of them. She does not learn anything silently.

## Voice and language

With a Sarvam AI key (Settings → DB Assistant → Voice) she listens with Sarvam's
Indian speech recogniser and speaks in a natural Indian female voice (pick and
preview it there). Without a key she falls back to the browser's free, robotic
voice. Recording stops by itself when you pause (max ~28 s per sentence).

She replies in the language you spoke: English gets English, Hindi/Hinglish gets
Hinglish (written हिंदी + English by default, which is what sounds most natural
aloud; Roman letters is an option).

**"Hey DB" / "DB, suno":** switch on the wake word in settings. While the ERP is open
on screen, a green dot on her button means she is waiting for it; she then opens,
listens, and keeps listening after each reply until you go quiet. The wait for the
wake phrase uses the browser's free recogniser.

## Usage and credit

Every request she makes is costed and logged (`assistant_usage`): AI model tokens and
Sarvam seconds/characters, at list prices. Settings shows today and this month.
Neither Anthropic nor Sarvam reports the remaining balance through an API, so enter
the credit you loaded and the date, and the page shows the estimated balance left.
