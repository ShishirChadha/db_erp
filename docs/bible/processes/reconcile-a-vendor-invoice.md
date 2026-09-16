---
slug: reconcile-a-vendor-invoice
title: Reconciling a vendor invoice
kind: process
audience: [owner]
module: reconciliation
routes: [/dashboard/recon/vendors]
keywords: [vendor recon, vendor invoice, upload invoice, read with ai, extraction template, save layout, gstin match, vendor correction, fill missing, conflict, bill milan, vendor bill check]
sources:
  - apps/erp/app/dashboard/recon/vendors/page.tsx
  - apps/erp/app/api/documents/route.ts
  - apps/erp/app/api/documents/[id]/route.ts
  - apps/erp/app/api/documents/[id]/parse/route.ts
  - apps/erp/app/api/documents/[id]/parse-ai/route.ts
  - apps/erp/app/api/documents/[id]/save-template/route.ts
  - apps/erp/app/api/vendor-recon/generate/route.ts
  - apps/erp/app/api/vendor-recon/proposals/route.ts
  - apps/erp/app/api/vendor-recon/proposals/[id]/approve/route.ts
  - apps/erp/app/api/vendor-recon/proposals/[id]/reject/route.ts
  - apps/erp/app/api/vendor-recon/approve-all/route.ts
  - apps/erp/lib/recon/pdf-text.ts
  - apps/erp/lib/recon/vendor-matcher.ts
updated: 2026-09-16
---

## What this is

Uploading a vendor's invoice PDF, getting its header fields (GSTIN, address,
phone, totals) read off the page automatically, and using that read to correct
your Vendors master — fill in a blank field, flag a conflict, or derive a value
(e.g. a valid GSTIN on the invoice always implies `has_gst = true`). This does
**not** match invoice line items against stock/PO receipts — that mechanism was
removed 2026-08-31 (see the **reconciliation** module chapter); matching an
invoice's line items to a PO is a manual step today.

## Who can do this

Owner only — every route behind this page checks `isOwner()`, and the page
itself is wrapped in `RequireOwner`.

## The three extraction tiers, and which ones cost money

Every invoice goes through up to three tiers, cheapest first:

- **Tier 0 — probe (free).** Runs the instant you finish uploading. Just checks
  whether the PDF has a real text layer and how many characters/pages it has.
  Never extracts fields.
- **Tier 1 — saved template (free).** Runs automatically right after Tier 0.
  Looks for a saved `extraction_templates` row whose `match_fingerprint`
  (usually the vendor's GSTIN) appears anywhere in the document's text, and if
  found, pulls fields out with that template's regex rules — no API call at
  all. If no template matches, the document is left at status
  `ai_pending_approval` and the page shows a **"Read with AI"** button instead
  of doing anything automatically.
- **Tier 2 — Read with AI (costs real tokens).** Only runs when you explicitly
  click **Read with AI**, and only if you also hit a re-confirmation the route
  itself enforces server-side (`confirm: true` in the request body — the
  button click supplies this, but the point is the API refuses without it, so
  no accidental or scripted call can trigger a paid read). **Every click of
  "Read with AI" — including "Retry" after a failed AI read, and including
  "Read with AI instead" on a needs-review document — is a fresh paid API
  call.** There's no caching between clicks; re-reading the same PDF twice
  costs twice. `ai_input_tokens`/`ai_output_tokens` are recorded on the
  document so token spend per invoice is auditable after the fact.

Saving a layout (see below) is what gets you out of paying for Tier 2 on every
future invoice from the same vendor.

## Steps — upload and first read

1. Open **Reconciliation → Vendor Recon** (`/dashboard/recon/vendors`).
2. Choose a PDF and click **Upload & Parse**. This:
   - gets a signed upload URL and puts the file into the `documents` storage
     bucket;
   - registers it as an `uploaded_documents` row (`doc_kind: vendor_invoice`).
     The server computes a SHA-256 hash of the actual downloaded bytes — not
     anything the browser claims — so re-uploading the exact same file is
     caught as a duplicate and opens the existing record instead of creating a
     second one;
   - runs Tier 0 (probe), then immediately tries Tier 1 (saved template).
3. What you see next depends on the result:
   - **A saved template matched and the numbers add up** → status `parsed`.
     Proposals (see below) generate automatically.
   - **No template matched** → status `ai_pending_approval`. A banner offers
     **Read with AI** — this is the button described above; clicking it spends
     tokens.
   - **A template matched but its own extracted numbers don't add up**
     (subtotal + GST ≠ grand total, or a line total is off) → status
     `needs_review`, with the specific mismatch(es) listed. You get two ways
     out: **Read with AI instead** (paid, Tier 2) or **Reviewed — this is
     correct** (free — `PATCH /api/documents/[id]` with
     `confirm_review: true`, for the common case where the vendor's own
     invoice has a discount line or rounding the template didn't model). Only
     a `parsed`/`confirmed` document can later have its layout saved, so this
     confirmation is also what unblocks that for a needs-review document.
   - **The AI read itself failed** (e.g. no `ANTHROPIC_API_KEY` configured) →
     status `failed`, with a **Retry** button — again, a fresh paid call.

## Steps — vendor match and corrections

4. Once a document reaches `parsed`/`needs_review`/`confirmed`, the page
   auto-resolves the vendor: exact GSTIN match first, then a trigram
   name-similarity match, then whatever vendor a matching template was already
   tied to.
   - **If a vendor resolves confidently**, its name shows as "Matched vendor,"
     and any genuine corrections are listed under **Pending corrections** —
     each one tagged `fill` (field was blank, now has a value), `conflict`
     (existing value disagrees with the invoice), or `derived` (computed, e.g.
     GSTIN present → GST-registered). Approve or reject each one individually,
     or use **Approve all safe fills** to bulk-accept every `fill_missing` +
     `high confidence` proposal in one click — conflicts are never bulk-
     approved, they always need an eyeballed decision.
   - **If nothing resolves confidently**, you get a list of near-match
     candidates (with % similarity) to pick from, a live search across every
     vendor by name, or **Create new vendor** — which opens the normal
     Add Vendor dialog pre-filled from whatever the invoice's own extraction
     already read (name, GSTIN, phone(s), email, address), so you're
     correcting a mostly-right form rather than retyping the letterhead.
5. Approving a proposal writes the field straight to the `vendors` row and
   logs it through the existing field-corrections ledger — reversible the same
   way as any other logged correction, with no separate undo mechanism to
   learn. Rejecting a proposal makes no write at all; it just closes it out.
6. Re-running vendor matching (e.g. after re-parsing) is safe: it clears this
   document's still-*pending* proposals first, so you never end up with stale
   duplicates sitting next to fresh ones. Already-decided (approved/rejected)
   proposals are left alone as history.

## Steps — save a reusable layout

7. Once a document is `parsed` or `confirmed` and a vendor is matched, a
   **Save layout for this vendor** button appears. Click it to derive regex
   field rules from this document's own text plus its already-confirmed
   extraction (free — no AI call), and save them as a new
   `extraction_templates` row fingerprinted on the vendor's GSTIN (or the
   first 40 characters of the vendor name if no GSTIN was read). Every future
   invoice whose text contains that fingerprint will Tier-1-match — and read
   for free — from then on.
8. A saved template only ever learns header fields (vendor identity, invoice
   number/date, totals) — never the line-item table. If you need line items
   from a given invoice too, you still need Tier 2 for that specific document.

## Common mix-ups

- **"I keep clicking Read with AI to try to get a better result."** Each click
  is a separate paid call, with no discount or caching for re-reading the same
  file — if the first AI read already produced usable data, don't re-run it
  just to see if it changes.
- **"There's no Save layout button."** It only appears once the document is
  `parsed`/`confirmed` *and* a vendor has actually matched — a needs-review
  document that hasn't been confirmed via "Reviewed — this is correct" won't
  show it yet, even if the vendor already matched.
- **"A field I know is right got proposed as a conflict."** The current
  `vendors` value and the invoice's read disagree — the page always shows
  both side by side (`current → proposed`) so you can judge which one is
  stale before approving.
- **"I deleted an invoice and its proposals disappeared too."**
  `DELETE /api/documents/[id]` cascades to that document's
  `vendor_correction_proposals` — this is the intended way to cleanly undo a
  bad upload, not something to worry about losing.

## Related

**reconciliation** (the module overview this process sits under, including why
invoice-line-to-stock matching was removed), **customers-vendors**.
