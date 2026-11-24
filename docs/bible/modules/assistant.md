---
slug: assistant
title: DB — the voice assistant
kind: module
audience: [owner]
routes: [/dashboard/assistant]
keywords: [db, assistant, fast, slow, short link, whatsapp link, photo, camera, label, screenshot, invoice photo, theek hai, option space, shortcut, what db heard, customer return, return, refund, credit note, wapas, allow, permission, page access, trade-in, upgrade, exchange, buyback, stock in, stock entry, serial number, accessories receive, maal aaya, photo, picture, realistic, avatar photo, open page, kholo, dikhao, open tab, cost, saving money, instant reply, free reply, fresh conversation, look and feel, theme, orb, voice stage, captions, fold, galaxy, minimise, edge glow, vibrate, stop, interrupt, learnings, skills, haiku, sonnet, opus, model, cheaper, conversation mode, continuous, read modules, live stock, sold stock, reports, profit, payments due, avatar, tone, casual, teach name, hey db, db suno, wake word, sarvam, credit, balance, usage, voice, secretary, talk, mic, ai, pi by voice, bol ke, hinglish, remember, notes, whatsapp share, proforma by voice]
sources:
  - apps/erp/lib/assistant/identity.ts
  - apps/erp/lib/assistant/call-route.ts
  - apps/erp/lib/assistant/trade-in.ts
  - apps/erp/lib/assistant/customer-return.ts
  - apps/erp/components/assistant/useVoice.ts
  - apps/web/app/d/**
  - apps/web/lib/document-share.ts
  - supabase/migrations/20261124b_document_share_links.sql
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
  - apps/erp/app/api/assistant/lease/route.ts
  - apps/erp/components/assistant/instant-replies.ts
  - apps/erp/components/assistant/names.ts
  - apps/erp/lib/assistant/approval.ts
  - apps/erp/lib/assistant/permissions.ts
  - apps/erp/app/api/assistant/avatar/route.ts
  - apps/erp/lib/assistant/stock-in.ts
updated: 2026-11-24
---

## What it is

DB is the owner's assistant. Tap her face at the bottom right of any dashboard page,
then the mic, and speak (Hinglish is fine). On a laptop her panel docks beside the page,
so the ERP stays usable next to her; on a phone it opens full screen. She asks the questions a
staff member would — price, GST included or not, which entity — one short question at a
time, then shows a card with what she is about to save. Nothing is saved until you say
yes or tap **Confirm**.

She can make **PIs and quotations**, record **expenses**, enter **sales**, open
**repair** and **replacement** jobs, and do **stock in** — laptops/desktops by serial
number and accessories by quantity (see Stock in below). After a PI she prepares a WhatsApp message with a
short link (see WhatsApp links below); you tap the button to send it. She never sends
anything herself. You can also **send her a photo** (see Photos below).

## Fast, like a person at the counter (2026-11-24)

A voice PI took 13 minutes on 24 Nov: 19 spoken round trips, each reply 15–20 s of
audio. The model replies in 1–2 s, so the time went into extra turns and long answers.
Since then:
- **Lookups forgive how things are said.** Customers: exact name → spaces removed
  ("Hyper Scale" = HYPERSCALE) → words in order → closest names by spelling
  ("Hyperskill"), which come back as `close_match` so she asks "Hyperscale, yahi?"
  instead of asking for a mobile number. Products: "type c" = Type-C, "65 watt" = 65w,
  charger = adapter, bag = backpack, then typo-tolerant ("quantum wireless" = "Quantrum
  Wirless"); laptops and in-stock items come first (`lib/assistant/data.ts`).
- **One short question at a time**, about 20 words at most per reply. She never asks
  about optional extras (free bag, mouse, charger) unless you mention them or a learning
  tells her to (your "ask me about charger on every laptop sale" learning still applies).
  X13 / T14 / 840 G6 are models, never quantities.
- **No read-back.** Every detail is on the card; she says any warning in a few words,
  then only the total: "Card ready, 27,500 GST ke saath. Confirm kar dijiye." Serials are
  still spelled back (stock in, sale, trade-in, return). After saving: "Ho gaya, PI 72."
- **Room chatter is ignored.** In conversation mode, words clearly not meant for her
  ("Ram Ram sir", a phone call) get a silent "…", shown in the panel as *ignored*.
Replaying that same PI after the change: the card on the 4th real turn (5 with one
ignored greeting), replies of 10–30 words.

## WhatsApp links

The message carries **digitalbluez.com/d/&lt;code&gt;** instead of a ~300-character storage
link (WhatsApp can't show "click here" text). That website page (`apps/web/app/d/[code]`)
shows the document's name — WhatsApp turns it into a preview card, "Proforma Invoice
PI2026/27-00072 · Digitalbluez" — and a **View / download PDF** button that opens a fresh
10-minute signed link to the private `documents` bucket. The code is 10 characters (no
look-alike letters) and works for **30 days**; opens are counted on the PDF button, not
the page (WhatsApp's preview fetcher loads the page). `document_share_links` is
service-role only; the page is `noindex`.

## Photos

The **camera** button beside her text box sends a photo with your next message (typed
or spoken, or none): a laptop label, a BIOS/Windows screenshot, a box sticker, a
purchase invoice or a sales bill. The panel shrinks it to 1600 px JPEG first. It goes to
the model for that turn only: the saved conversation keeps a "[photo …]" note (telling
her later turns she saw it — without that she doubted a serial she had read correctly),
never the image. About ₹0.03–0.05 a photo on Haiku.
- **Label / screenshot** → the serial (the S/N, never a part or product number) and the
  model, then stock in, or the serial for a sale, return, trade-in, replacement, repair.
- **Purchase invoice** → laptops: stock in the listed serials (you attach PO and cost on
  Purchase Orders); accessories: receive stock with vendor, quantity, price, GST.
- **Sales invoice / bill** → she asks which kind: **our own** bill not yet in the ERP
  (she prepares the sale from it, if the unit is still in stock) or a **customer's old
  bill** from elsewhere (only model, serial, purchase date — for a trade-in, repair or
  return).
- She never guesses an unclear character ("8 hai ya B?"), and spells photo serials back
  like spoken ones.

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

## Expenses: full access

With **Full expense access** on (Settings → DB Assistant → What DB can do; default on),
DB may record your **private (owner-only) expense categories** — Bank Charges, Fuel, GST
Payment, OLX, Rent, Salaries — which the Expenses route otherwise refuses for her
non-owner login (`lib/assistant/permissions.ts`). Staff still never see those categories
or their expenses (the Expenses list filters them by type for every non-owner). She
matches what you say to an existing category (spelling and meaning: "petrol" → Fuel)
and only creates a new one after asking (private or not); she can also merge duplicate
categories (`propose_merge_expense_types`: past expenses re-labelled, merged entries
retired from the dropdown, privacy changes warned). Everything shows on her
confirmation card first and is audit-logged as DB.

## Several devices in one room, and pausing

**Only one device answers.** Before answering "Hey DB", a device asks the server for a
short lease (`assistant_device_lease`, one row; `/api/assistant/lease`). With the laptop
and the phone in the same room, the first to ask answers and the other stays quiet with a
small "Answered on your laptop/phone" note. The device in a conversation renews the lease
every 8 s, so the other won't wake meanwhile; tapping the mic on the other device takes
the conversation over there ("Continued on your other device").

**Pause (moon button)** pauses **this device only** — 30 min, 1 h, 3 h or until you resume
her (kept in this browser). The same menu has **All my devices** (1 h or until resumed),
saved on the server for phone calls. While paused she doesn't listen on that device, her
button turns grey with a moon, the header shows a green **Resume** button and a banner says
where she is paused. The first version paused every device by default and its option
"Until I turn her on" read like a button that turns her on.

**iPhones and Android phones** share the same rules: an open microphone ducks or mutes
playback (iPhone routes it to the earpiece), and sound routed through Web Audio obeys the
iPhone's silent switch — so on phones nothing listens while she speaks, her voice skips
Web Audio, and on iPhone the audio session (`navigator.audioSession`) switches per
phase: *playback* just before she speaks (loudspeaker, past the silent switch) and *auto*
before anything listens. A *playback* session has no microphone — the first version set
it for the whole page, and after "Suno DB" → *Yes Jaanu?* the iPhone "listened" to nothing.
Sound unlocks on a completed tap (Safari) as well as a press (Chrome).

**Her voice in DuckDuckGo / WebView browsers:** sound is allowed only from a play started
inside a tap, and her replies come seconds later — so one audio player is unlocked on your
first tap and reused for every reply. If a browser can't play her voice at all, the panel
says so instead of staying silent.

**She knows when you didn't hear her.** Each message tells her whether you spoke or typed
(speech heard by the browser's own recogniser used to arrive marked "typed", so she
assumed you were reading and said "I'm only replying in text"), whether her voice is
muted on that device, and whether her previous reply stayed silent there (the browser
blocked the sound until a tap, or couldn't play it). If you say you can't hear her she
suggests the fix on your side (volume, iPhone silent switch, tap the page or *Tap to hear
DB*, the replay button) and doesn't pretend she is text-only.

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
face (outfit, skin tone, bindi, earrings), glowing orb, initials, or **your picture** —
a live preview of each state, captions, glowing screen edge while she listens/speaks,
vibration on Android, soft chimes, reduced animations, text size, bubble style, message
times. All SVG/CSS apart from that one picture — no video or 3D, so no cost and light on
the battery. Copy and replay buttons sit under each of her messages (replay uses the
voice service again).

**Your picture** (a realistic look): upload any picture in *Her look → Your picture*; the
browser crops it to a centred 512 px square, and it is stored privately
(`documents/assistant/avatar/<version>`, read only through `/api/assistant/avatar` with
your login, never a public link). It is shown in a circle with the same listening /
thinking / speaking glow as the other looks, a slow breath while idle — it does not move
its lips (a talking, lip-synced face would need a paid video-avatar service and adds a
second or two before she speaks). Use an AI-generated picture of a made-up person, not a
real woman's photo or a stock model's, which needs that person's permission for this use.
Without a picture she shows the illustrated face.

## Her own ERP user

DB is a real user (`db`, role manager), created the first time you open the panel
(**Set up DB**). Everything she saves shows **DB** as the creator and in the audit log.

**Her page access follows her skills (2026-11-24).** Each skill in *What DB can do*
grants exactly the pages its route checks (`SKILL_PAGES` in `lib/assistant/identity.ts`),
and switching a skill off removes them; saving that section or tapping an **Allow** card
re-syncs her grants. With every skill on she has view *PIs & Quotations, Expenses, New
Entry, RMA* and edit *Quotations, Expenses, RMA*, nothing else. Her reads (stock, sales,
reports) run on the server and need no page grants. Until 2026-11-24 her access could
also be set in Users, and had grown to 18 pages she had no tools for; Users now shows it
read-only (`PATCH /api/users/[id]` refuses page changes for her).

**Off switch:** log her off in Settings → Active Devices ("DB assistant (server)") or
deactivate her in Users — only you (DB's master) can; other owners are refused. The
panel then offers **Wake DB up** (not for a deactivated DB — undo that in Users).

Owner-only expense types (Salaries etc.) she records only with *Full expense access*
on (see Expenses: full access above).

## Stock in

The same two doors staff use, through her own login (skill *Stock in* in What DB can do;
a newly added skill starts switched on until you save that section with it off).
- **Laptops, desktops, monitors, tablets** — like New Entry / Live Stock → New entry
  (`/api/stock-intake`): "Do Latitude 5490 aaye hain…". She finds the model in the
  catalogue (or, for a model not in it, asks for the category's required fields — CPU, RAM
  for a laptop — and warns if similar models exist), asks for each serial number, who
  bought it (Digitalbluez / Techtenth / Cash / Other), condition, and any charger or bag
  that came with each unit. Units go live as **QC pending** with no cost, vendor or asset
  number, entered by DB; you attach the PO later as usual. One call per serial; if one is
  refused the others still save and she tells you which.
- **Accessories** — like Accessories → Receive stock (`/api/sku-master/[id]/stock-movement`,
  a `receipt`): quantity, and if you say them vendor (matched to an existing vendor; she
  asks if several match), total price, GST %, purchase date, payment account. She warns if
  the price per piece is far from the last receipts.

**Serial numbers are spelled back.** Speech recognition mixes up B/D/P, 0/O and 8/H, so
the card shows every serial and its spelling ("5 C D zero letter-O one X") and she reads
each one out character by character before you confirm; a serial with a letter O or I
next to digits, an odd length, or other characters is flagged. A serial already in the
ERP, or the same one twice, is refused before any card. You can always type serials into
her chat instead of saying them.

## Trade-ins (upgrades)

Skill *Trade-ins (upgrades)*. When you say upgrade / exchange / "purana le liya", she
treats it as a trade-in, not a replacement (asking "Warranty replacement hai, ya upgrade
jismein purana humne kharida?" if unclear): the new laptop is sold at its **full** price
and the old one is bought back at the value you give. One card saves both
(`propose_sale` with `trade_in`: the sale, then `/api/trade-ins` on the unit it sold);
for a sale already saved, `propose_trade_in` takes the new laptop's serial. She checks
the old serial (ours → when, to whom and for how much it was sold; new to us → asks the
model; already in stock → refused), spells it back, warns if the value is more than they
paid or close to what the model sells for, and keeps only the ID's last 4 characters.
Trade-ins are money, so with *tap to confirm money* on they need the Confirm tap. The done
card links to the buyback slip. If the trade-in part is refused after the sale saved, she
says so and it can be added from the Sales Ledger. See **take-a-trade-in**.

## Customer returns

Skill *Customer returns*. A customer gives back a laptop/desktop we sold and takes no
other unit ("wapas kar diya", "paise wapas"): `propose_customer_return` with the serial
and the reason. It goes through the RMA page's own door (`POST /api/rma`, direction
`from_customer`, `lib/rma.ts` `processCustomerReturn`): the unit goes to **QC pending**,
stock +1, accessories sold with it come back, the sale is cancelled, and a refund
(`sale_refunds`, amount + account) or credit note (`customer_credit_ledger`) is recorded.
- If anything was paid she asks **refund or credit note** first, and for a refund how
  much and from which account. A refund below what was paid is allowed; she warns that the
  kept part won't show as a sale anywhere, since the whole sale is cancelled.
- She warns if the refund account differs from the sale's entity, if the sale is already
  **invoiced** (the invoice needs its own credit note or cancellation on the Invoices
  page), and which bundled accessories come back.
- Refused before any card: serial not in the ERP (accessory-only returns stay on the RMA
  page), unit not `sold` (on rent → Rentals page), and a sale with an active **trade-in**
  (the owner undoes the trade-in first, on the Trade-ins page).
- A return is money, so with *tap to confirm money* on it needs the Confirm tap.
Not for a warranty swap (replacement job) or an upgrade (trade-in): she asks if unclear.

**Replacement cards are checked before you see them.** Whatever was paid on the old unit
carries over to the replacement automatically, so she now does the ERP's own sum at
propose time and refuses the card (instead of failing on your yes) when the carried-over
amount plus top-up exceeds the new unit's price, pointing to a trade-in when it's really
an upgrade. The card also shows the carried-over amount.

**She offers only options the ERP gave her.** After the 2026-11-23 conversation where she
suggested "carry-over 26,000 karwa dein" (no such field) and "credit owed ke saath save
kar doon", her rules say never to invent an ERP field, setting or workaround; if she
doesn't know how the ERP handles a case she says so and offers to open the page.

## Opening pages for you

Ask her to open any ERP page and she does — "Sales Ledger kholo", "Ramesh ka customer
dikhao", "PI 245 kholo", "stock mein 840 G6 dikhao" (`open_page`, always on; it saves
nothing, so no card to confirm). List pages that keep their search in the address
(Sales, Customers, PIs & quotations, Invoices, Leads, Stock / Live Stock, Accessories,
Repair jobs, Purchase orders, Vendors, Price Board, SKU Master) open with the search
already filled. One record opens on its own page by the number you say — a PI or
quotation, invoice, purchase order, rental, or a stock unit by asset or serial number;
part of the number is enough, and if several match she asks which. Customers and sales
have no page of their own, so those open as a searched list. She can only open the ERP's
own pages (a fixed list), and each page still applies your normal access. On the laptop
the page opens beside her; on a phone, or where her panel floats over the ERP, she
minimises herself; either way she stops listening after "Khol diya" so you can work.
Her card keeps an **Open …** button to go back to it.

## Who can use her, and how saving is protected

Security review of 22 Nov. Only DB's master login (yours) can open, talk to or set her
up; every `/api/assistant/*` route checks it, and her tables have no browser access.
- **Your account and hers are protected from other owners.** Any owner used to be able
  to reset any account's password — including yours — and then sign in as you and use
  DB. Now only you can change your account (password, role, access, active, devices),
  nobody can view or set DB's password or role, only you can switch her off, and her
  login is refused at the browser login screen. See [[manage-users-and-access]].
- **Your yes is checked by the ERP, not by her.** A card is saved only when you tap its
  **Confirm** (the panel sends that card's id) or your whole message is a plain yes —
  "haan", "kar do", "theek hai", "confirm" (`lib/assistant/approval.ts`). "Haan,
  lekin…", anything with a change, a number or a "nahi", and any text she read in a
  record can't save anything; she asks again. Before, the AI itself judged whether you
  had said yes.
- **Sales and expenses: confirm by tap only** (off by default; *What DB can do*): a
  spoken "haan" won't save a sale or expense. She can't tell your voice from someone
  else's, so switch it on when people are near your phone or laptop — or pause her.
- **ERP text is data, never instructions.** Names, notes, descriptions and comments
  (typed by staff, or by website customers) are only information to her; if a record
  seems to tell her to do something she doesn't, and tells you which record.
- **Where words go:** with "Hey DB" on, Chrome's free recogniser sends room audio to
  Google (Safari's to Apple) while the ERP is open; after waking, iPhone/DuckDuckGo
  recordings go to Azure; conversation text and the ERP data she reads go to Anthropic
  (not used for training by default). Pause her for private conversations.

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
replacements, new customers, learning by herself, stock in, trade-ins, customer returns)
on or off; a switched-off skill's tools are removed from her tool list and refused
server-side. Each skill's row shows the ERP pages it gives her.

**Allow card (2026-11-24).** If you ask for something whose skill is off, she says so
and calls `enable_skill`, which shows an **Allow** card naming the skill and the pages it
grants. Only a tap on Allow switches it on (`ALWAYS_TAP_KINDS`: a spoken yes never does,
whatever *tap to confirm money* says), then her grants re-sync and the turn reloads her
tools so she carries on with the task. It's audit-logged as "DB skill allowed". Switch it
off again in Settings. She can't be allowed a task no skill exists for (e.g. invoices).
**How much she says**: short (default) or normal.

**Stopping her:** say "stop", "ruko", "bas", "pata hai", "chup" — or, since 24 Nov, just
"theek hai", "ok", "achha", "samajh gaya", "okay I understood" on its own — while she
talks, press
Esc, or tap the mic, and she stops at once. **On Android the spoken "stop" is off** —
opening the microphone there makes Google's speech service take the phone's audio and
mute her — so tap the square instead. If Chrome blocks her voice because the page hasn't
been tapped yet (e.g. woken by "Hey DB" straight away), a **Tap to hear DB** button
appears. A small browser recogniser runs only while
she speaks; her own voice from the speakers is filtered (a stop word counts on its own,
or inside a phrase only if she isn't saying it; words she says herself — ok, achha,
theek hai — count only when they aren't in what she is saying). A "theek hai" that stops
her never confirms a card; that still needs its own yes or tap. The next turn tells her you cut her
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
  the audio herself (16 kHz WAV) and sends it to Azure automatically. **iPhone/iPad**
  too: Safari's recogniser goes deaf once any audio element has played (her voice!) —
  it shows "listening" and never answers, even after a reload (WebKit bug 321436, iOS
  26.6+) — so on iPhone she records and uses Azure for everything you say; Safari's
  recogniser only listens for "Suno DB". Because of the same bug, "Suno DB" may not wake
  her again for a minute or so after she has spoken: tap her button or the mic instead.
  Recording needs the audio engine running, which on iPhone only a tap can start: any
  tap on the page starts it; if it isn't, she says "Tap the mic once" instead of
  listening forever, and a recording that gets no sound for 3 s stops with a message.
  Azure doesn't detect the language (it uses the one set in Settings), so she judges
  English vs Hinglish from your words. Every browser listen also has a watchdog: no
  audio in 5 s marks the browser broken and switches to Azure; nothing may listen
  longer than 25–30 s.
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
**Settings → DB Assistant → Voice → What DB heard when you called her** lists the last
calls the listener caught in this browser tab (what Chrome heard, wakes, mic errors,
pauses); **That was me** on a line adds it as a wake phrase (kept in the tab only,
never sent anywhere). **⌥ Option + Space** (Alt + Space) anywhere in the ERP opens her
already listening — no wake answer, just a chime. On a computer she now keeps listening
while the ERP tab is in the background (you're on WhatsApp Web); if Chrome refuses
there, she falls back to listening only while the tab is in front. Phones keep the
tab-visible rule. She addresses you by *She calls
you* (default "Boss"). "DB" is hard for speech
recognition, so the listener checks the recogniser's top 5 guesses against a list of
known mishearings (IDBI, TP, TB, DP, TV, the bee…) and the phrases in settings.
*Teach DB her name* listens to you say "Hi DB" and adds whatever the browser heard
as wake phrases. Only phrases of two or more words are kept (a single word like "idbi"
would wake her whenever someone says "IDBI bank"). While the ERP is open
on screen, a green dot on her button means she is waiting for it; she then opens,
listens, and keeps listening after each reply until you go quiet. The wait for the
wake phrase uses the browser's free recogniser. Only one recogniser ever runs: it
stops while the tab is hidden (phones; computers since 24 Nov keep going) or the panel is busy, backs off after errors, and gives
up after six failures in a row (the dot turns amber; reload the page to retry). An
earlier version could start a second listener on returning to the tab, and the two
cancelled each other in a loop until Chrome closed.

## What a message costs, and how DB saves

Only her thinking (Anthropic) costs money; her Azure voice and listening are inside the
free monthly allowance and her ERP lookups are the ERP's own database. Each message is
billed for re-reading her cached instructions, caching the new part of the chat, and her
reply. Measured on Sonnet 5.5 (22 Nov): "Hey DB" → *Yes Jaanu?* ₹0 (no AI — the wake
answer is a saved recording); a bare "sun rahi ho?" ₹0.17; a normal step ₹0.20–0.35 (a
task with lookups takes 2–3 steps); the first message after an hour's break ₹4–6. Haiku
5.5 is about 20× cheaper per token. She does not "learn" answers: every reply is
worked out and billed afresh; learnings are notes she reads each time.

Settings → DB Assistant → *Saving money*:
- **Free instant replies** (default on): when your *whole* message is only a greeting
  ("Hi DB", her name or a mishearing of it, a taught wake phrase), a hearing check ("sun
  rahi ho?", "can you hear me?"), thanks or bye, the panel answers at once with a fixed
  line — the wake answer for a greeting — without asking the AI, and marks it *instant ·
  free*. These lines are not saved in the conversation. Any other word, a number or a
  "nahi" sends it to her as usual, and "haan", "ji", "ok", "theek hai" or "bas" on
  their own always reach her (they are often the answer to her question). The word lists
  are in `components/assistant/instant-replies.ts`.
- **Fresh conversation after an hour's break** (default on): after 60 minutes without a
  message (when her instruction cache has expired anyway) the next message starts a new
  conversation, with a small note in the panel, so she doesn't re-read the whole old
  chat on every reply (an 80-message chat cost ~70% more per reply). She forgets that
  chat, not her learnings. A card waiting for your yes keeps the old chat open.

## Usage and credit

- **Anthropic (real):** paste an Admin API key (`sk-ant-admin…`, Claude Console →
  Settings → Admin keys). The tab then shows Anthropic's own figures for the whole
  account (DB, Marketing, bank statements): this month as billed (typically complete
  within ~4 hours) and today from the token report (~30 minutes behind). Anthropic
  has no API for the prepaid balance (not even with the Admin key), so the balance
  itself is only on Anthropic's billing page; an optional estimate (credit loaded
  minus billed spend) is tucked under the section. Admin keys exist only for team
  organizations (Console → Settings → Organization → *Convert to team*).
- **Prompt cache:** her instructions and tool list (~11,000 tokens) are cached for 1
  hour (owner's choice), so a message after a break of under an hour re-reads them for
  ~₹0.10 (Sonnet) instead of loading them again; after more than an hour — or after any
  change to her settings, prompt or model — the first
  message loads them again (~₹4 on Sonnet, ~₹0.20 on Haiku). The conversation history
  keeps the normal 5-minute cache (writing large report results at the 1-hour rate
  cost more than it saved). For the owner's bursty use (gaps of 10–25 minutes) the
  1-hour cache is the cheaper choice: on 22 Nov a 5-minute cache would have meant about
  seven reloads (~₹17) instead of one (₹4).
- **Dollar rate** is fetched automatically (European Central Bank via Frankfurter,
  ExchangeRate-API as backup, refreshed every 6 hours) — nothing to enter.
- **DB's own usage (live):** every request she makes is costed the moment it
  happens (`assistant_usage`), including Sarvam and the free Azure/Google characters.
