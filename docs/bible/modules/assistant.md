---
slug: assistant
title: DB — the voice assistant
kind: module
audience: [owner]
routes: [/dashboard/assistant]
keywords: [db, assistant, conversation mode, continuous, read modules, live stock, sold stock, reports, profit, payments due, avatar, tone, casual, teach name, hey db, db suno, wake word, sarvam, credit, balance, usage, voice, secretary, talk, mic, ai, pi by voice, bol ke, hinglish, remember, notes, whatsapp share, proforma by voice]
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
  - apps/erp/lib/assistant/cloud-voices.ts
  - apps/erp/lib/assistant/anthropic-billing.ts
  - apps/erp/lib/assistant/reports.ts
  - apps/erp/lib/assistant/fx.ts
  - apps/erp/components/assistant/DbAvatar.tsx
updated: 2026-11-21
---

## What it is

DB is the owner's assistant. Tap her face at the bottom right of any dashboard page,
then the mic, and speak (Hinglish is fine). On a laptop her panel docks beside the page,
so the ERP stays usable next to her; on a phone it opens full screen. She asks the questions a
staff member would — price, GST included or not, free bag and mouse, which entity —
then shows a card with what she is about to save. Nothing is saved until you say yes
or tap **Confirm**.

She can make **PIs and quotations**, record **expenses**, enter **sales**, and open
**repair** and **replacement** jobs. After a PI she prepares a WhatsApp message with a
PDF link (valid 7 days); you tap the button to send it. She never sends anything
herself.

She also **answers questions about the business** from the modules switched on in
Settings → DB Assistant → *What DB can read*: stock (Live Stock and main ERP stock),
sold stock, sales reports (revenue, GST, profit, margin by day/month/entity/model/
brand/salesperson/customer), payments due, customer history, repairs and
replacements, rentals, purchases and vendor payables, expenses, and tasks. She only
reads; each question that reads a report costs roughly ₹0.30–₹1.50 more and takes a
second or two, and results are capped to the top rows. Sales figures come from
`v_report_sale_lines` (the Reports page's view). A unit whose recorded cost is more
than 3× its sale price (a ₹1 migration placeholder, or a lot price typed on one PO
line) is left out of profit and named, so one bad entry can't turn a month negative.

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

Speaking and listening are chosen separately in Settings → DB Assistant:
- **Her voice:** Microsoft Azure, Google Cloud (Chirp 3 HD), Sarvam AI, or the
  browser. Azure and Google are free within their monthly allowance (about 500,000
  and 1,000,000 characters), and the tab shows how much is used. Pick a voice and
  press Preview (Hinglish and English samples).
- **Hearing you:** Sarvam AI (understands Hinglish) or the browser (free, weaker).
A provider without a saved key falls back to the browser. Recording stops by itself
when you pause (max ~28 s per sentence).

She replies in the language you spoke: English gets English, Hindi/Hinglish gets
Hinglish (written हिंदी + English by default, which is what sounds most natural
aloud; Roman letters is an option).

**Conversation mode:** tap the mic once and talk normally — after each reply she listens
again by herself, until you are quiet for the set number of seconds (default 15), say
"bas"/"bye"/"thank you", tap **End**, or close the panel. Tapping the mic while she
speaks interrupts her; tapping while you speak sends straight away.

**Ignoring other people:** each listen measures how loud the speech was (raw mic
level). Speech quieter than the *Ignore far-away voices* level (off/low/medium/high),
lone fillers ("hmm", "uh") and low-confidence browser results are dropped and she keeps
listening. It cannot tell your voice from someone right next to you — that needs
voice-print matching (paid, adds latency), which is deliberately not used.

**Personality:** very casual (default), friendly, or professional. She is always serious
while reading back money, on errors, and in anything sent to a customer.

**"Hey DB" / "DB, suno":** switch on the wake word in settings. "DB" is hard for speech
recognition, so the listener checks the recogniser's top 5 guesses against a list of
known mishearings (IDBI, TP, TB, DP, TV, the bee…) and the phrases in settings.
*Teach DB her name* listens to you say "Hi DB" and adds whatever the browser heard
as wake phrases. While the ERP is open
on screen, a green dot on her button means she is waiting for it; she then opens,
listens, and keeps listening after each reply until you go quiet. The wait for the
wake phrase uses the browser's free recogniser. Only one recogniser ever runs: it
stops while the tab is hidden or the panel is open, backs off after errors, and gives
up after six failures in a row (the dot turns amber; reload the page to retry). An
earlier version could start a second listener on returning to the tab, and the two
cancelled each other in a loop until Chrome closed.

## Usage and credit

- **Anthropic (real):** paste an Admin API key (`sk-ant-admin…`, Claude Console →
  Settings → Admin keys). The tab then shows Anthropic's own figures for the whole
  account (DB, Marketing, bank statements): this month as billed (typically complete
  within ~4 hours) and today from the token report (~30 minutes behind). Anthropic
  has no API for the prepaid balance (not even with the Admin key), so the balance
  itself is only on Anthropic's billing page; an optional estimate (credit loaded
  minus billed spend) is tucked under the section. Admin keys exist only for team
  organizations (Console → Settings → Organization → *Convert to team*).
- **Dollar rate** is fetched automatically (European Central Bank via Frankfurter,
  ExchangeRate-API as backup, refreshed every 6 hours) — nothing to enter.
- **DB's own usage (live):** every request she makes is costed the moment it
  happens (`assistant_usage`), including Sarvam and the free Azure/Google characters.
