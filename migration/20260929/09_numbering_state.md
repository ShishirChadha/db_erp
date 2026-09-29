# Numbering high-water marks — captured 2026-09-29 from hosted project

These are ordinary table rows (not Postgres sequences), so a `--data-only` dump
captures them. This file is the human-readable cross-check: after restore, these
values must be **identical or higher**. A regression here re-issues an invoice or
asset number a customer already has — a GST compliance incident, not a bug.

## invoice_sequences (FY 2026-27)
| doc_type | entity_key | prefix | last_number |
|---|---|---|---|
| sales_invoice | digitalbluez | — | **680** |
| sales_invoice | techtenth | — | 13 |
| sales_invoice | cash | — | 1 |
| proforma | digitalbluez | — | 21 |
| proforma | techtenth | — | 7 |
| quotation | digitalbluez | — | 3 |
| quotation | techtenth | — | 2 |
| (null) | (null) | DBIN | 26 |

## Other counters
| Table | Key | last_number |
|---|---|---|
| po_counter | 2026 | 73 |
| repair_job_counter | 26 | 103 |
| replacement_job_counter | 26 | 9 |
| rental_agreement_counter | 26 | 1 |

## asset_counters
| prefix | year | last_number |
|---|---|---|
| DBAS | 2026 | **259** |
| DBAS | 2025 | 256 |
| DBAS | 2023 | 183 |
| DBAS | 2022 | 101 |
| DBAS | 2021 | 29 |
| TTAS | 2026 | 58 |
| C | 2026 | 24 |
| CSAS | 2022 | 15 |
| CSAS | 2026 | 0 |
| CSAS | 2021 | 1 |
| SHIS | 2026 | 1 |
| OTHR | 2026 | 1 |
