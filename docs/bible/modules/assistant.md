---
slug: assistant
title: DB — the voice assistant
kind: module
audience: [owner]
routes: [/dashboard/assistant]
keywords: [db, assistant, look and feel, theme, orb, voice stage, captions, fold, galaxy, minimise, edge glow, vibrate, stop, interrupt, learnings, skills, haiku, sonnet, opus, model, cheaper, conversation mode, continuous, read modules, live stock, sold stock, reports, profit, payments due, avatar, tone, casual, teach name, hey db, db suno, wake word, sarvam, credit, balance, usage, voice, secretary, talk, mic, ai, pi by voice, bol ke, hinglish, remember, notes, whatsapp share, proforma by voice]
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
  - apps/erp/components/assistant/AssistantLearnings.tsx
  - apps/erp/components/assistant/AssistantLookSettings.tsx
  - apps/erp/components/assistant/appearance.ts
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

## Pausing her on every device

The moon button in her header (and on the voice screen) pauses DB on **all your devices**
— laptop and phone — for 30 minutes, 1 hour, 3 hours or until you resume her
(`assistant_settings.paused_until`). While paused she doesn't listen anywhere (no "Hey DB",
mic disabled; typing still works), her button turns grey with a moon, and a banner offers
**Resume DB** (the header shows a green **Resume** button). Other devices pick the change up within 30 seconds, or at once when you
return to the tab. (The first wording, "Until I turn her on", read like a button that turns
her on and left her paused by accident; the options now all start with "Pause".)

## Look, layout and screens

**Where she sits** (by screen width): under 600 px — phones and the Galaxy Z Fold's
cover screen — full screen, sized to the visible area so the keyboard never hides the
input; 600–1279 px — the Fold opened, tablets, split windows — **beside the ERP**
(split; the page narrows) or **floating over it**, owner's choice; 1280 px and up —
docked beside the ERP. Folding or unfolding re-lays her out without interrupting the
conversation. Panel side, width, and her button's side and size are settings. **Minimise**
(—) keeps a conversation running in her floating button (with a LIVE tag) while you use
the ERP; **Close** (✕) ends it.

**While you talk** (patterns from ChatGPT Voice and Gemini Live): *chat* shows the live
transcript; the *voice stage* shows a big avatar, captions of what she says and what she
heard, and large buttons (keyboard → chat, mic, end). *Automatic* uses the stage on
phones/the Fold and chat on a laptop.

**Look and feel** (Settings → DB Assistant): colour theme (6), her look — illustrated
face (outfit, skin tone, bindi, earrings), glowing orb, or initials — a live preview of
each state, captions, glowing screen edge while she listens/speaks, vibration on Android,
soft chimes, reduced animations, text size, bubble style, message times. All SVG/CSS —
no images, video or 3D, so no cost and light on the battery. Copy and replay buttons sit
under each of her messages (replay uses the voice service again).

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

## When something fails

Anthropic seals each of DB's thinking steps to the exact instructions it was made with,
so any change to her settings, learnings, prompt or model used to make every saved
conversation fail with **"AI service error (400)"**. Each request now asks Anthropic to
drop stale thinking instead (`thinking.block_binding.prefix_mismatch_behavior:
"drop_block"`, beta `thinking-binding-controls-2026-08-01`). A turn that fails before
any answer is not saved, so one error can't leave a conversation stuck, and the error
shown includes Anthropic's reason. If an error repeats, start a new conversation with **+**.

## Brain (model) and skills

DB thinks with the server's `ANTHROPIC_API_KEY` (the same key Marketing, bank-statement
reading and document extraction use). **The live Vercel project must have it set** —
without it every AI feature fails there, and DB now says so in plain words instead of
the SDK's "Could not resolve authentication method". A copy can also be pasted in
Settings → DB Assistant → Brain, which makes DB (only) work on a server without it.

Settings → DB Assistant → **Brain**: Opus 5.5 (high, ≈₹3–8 a conversation), Sonnet 5.5
(medium, ≈₹1.5–4) or Haiku 5.5 (low, ≈₹0.10–0.25; measured ₹0.013 for a greeting and
₹0.11 for a stock question). Haiku has no server-side fallback model, so the loop only
sends `fallbacks` for the other two. Switching takes effect from her next reply; her
learnings, checks and confirmation cards are the same on every model.

**What DB can do** switches her write skills (PIs/quotations, expenses, sales, repairs,
replacements, new customers, learning by herself) on or off; a switched-off skill's
tools are removed from her tool list and refused server-side, and she says it's off.
**How much she says**: short (default) or normal.

**Stopping her:** say "stop", "ruko", "bas", "pata hai", "chup"… while she talks, press
Esc, or tap the mic, and she stops at once. **On Android the spoken "stop" is off** —
opening the microphone there makes Google's speech service take the phone's audio and
mute her — so tap the square instead. If Chrome blocks her voice because the page hasn't
been tapped yet (e.g. woken by "Hey DB" straight away), a **Tap to hear DB** button
appears. A small browser recogniser runs only while
she speaks; her own voice from the speakers is filtered (a stop word counts on its own,
or inside a phrase only if she isn't saying it). The next turn tells her you cut her
off, so she doesn't repeat herself.

## What she remembers

When you state a preference ("ABC ko hamesha free bag"), she offers to remember it.
It is saved only on a yes. Settings → DB Assistant → **DB's learnings** lists every
learning (general or per customer, "learned in a conversation" or "added by you"), and
you can add, edit, pause or delete any of them there. General learnings are sent with
every request (after the cached instructions, so editing one never re-writes that
cache); customer learnings come back with `find_customer`. She does not learn anything
silently, and the model itself never changes: "learning" is these notes plus the ERP
history she reads.

## Voice and language

Speaking and listening are chosen separately in Settings → DB Assistant:
- **Her voice:** Microsoft Azure, Google Cloud (Chirp 3 HD), Sarvam AI, or the
  browser. Azure and Google are free within their monthly allowance (about 500,000
  and 1,000,000 characters), and the tab shows how much is used. Pick a voice and
  press Preview (Hinglish and English samples).
- **Hearing you:** the browser (free, Chrome only — it also powers "Hey DB"), Microsoft
  Azure speech-to-text (any browser; same key as her Azure voice; 5 free hours a month on
  F0; English-India or Hindi output) or Sarvam AI (paid). In browsers whose own speech
  recognition doesn't work — **DuckDuckGo on Android** and other WebView/in-app browsers
  hide it or expose one that never answers, so DB used to "listen" forever — she records
  the audio herself (16 kHz WAV) and sends it to Azure automatically. Every browser listen
  also has a watchdog: no audio in 5 s marks the browser broken and switches to Azure;
  nothing may listen longer than 25 s.
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
voice-print matching (paid, adds latency), which is deliberately not used. Nothing is
dropped silently: ignored speech appears in her panel with **That was me, send it**, and
Settings has a 10-second **Mic check** showing where your voice lands against the levels.
The browser console logs each listen (`[DB] heard … peak … -> sent/too_quiet`). If the
mic level can't be measured (suspended audio, muted second stream) the loudness filter
is skipped rather than dropping everything.

**Personality:** very casual (default), friendly, or professional. She is always serious
while reading back money, on errors, and in anything sent to a customer.

**"Hey DB" / "DB, suno":** switch on the wake word in settings. She listens for it
whenever she is idle — with her panel closed **or open** (an earlier version paused it
while the docked panel was open, so it almost never listened). When woken she answers
with the *wake answer* ("Yes Boss?" by default, cached after the first play so it is
instant and free) and starts a conversation. Only one recogniser runs at a time: her
own listening, the stop listener and the name trainer take the mic from the wake
listener and it waits until they are done. Only one browser tab listens at a time
(Chrome allows one): the ERP tab you used last claims it and the others say "listening in
your other ERP tab". After repeated errors it rests a minute and retries (it used to give
up until reload); only a blocked microphone stops it, with the reason in her status line.
The browser console logs what the wake
listener hears (`[DB wake] heard …` / `woke on …`). She addresses you by *She calls
you* (default "Boss"). "DB" is hard for speech
recognition, so the listener checks the recogniser's top 5 guesses against a list of
known mishearings (IDBI, TP, TB, DP, TV, the bee…) and the phrases in settings.
*Teach DB her name* listens to you say "Hi DB" and adds whatever the browser heard
as wake phrases. Only phrases of two or more words are kept (a single word like "idbi"
would wake her whenever someone says "IDBI bank"). While the ERP is open
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
- **Prompt cache:** her instructions and tool list are cached for 1 hour (owner's
  choice), so the first message after a break costs ~₹0.20 instead of ~₹2.50; the
  conversation history keeps the normal 5-minute cache (writing large report results
  at the 1-hour rate cost more than it saved).
- **Dollar rate** is fetched automatically (European Central Bank via Frankfurter,
  ExchangeRate-API as backup, refreshed every 6 hours) — nothing to enter.
- **DB's own usage (live):** every request she makes is costed the moment it
  happens (`assistant_usage`), including Sarvam and the free Azure/Google characters.
