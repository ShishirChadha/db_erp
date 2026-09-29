# Source baseline — hosted project `youfkrinsdenhoafgblj`
Captured 2026-09-29, immediately after a dashboard Restart cleared a full outage.
Compare the target against these numbers in Phase 5 (Gate 5).

## Object counts
| Object | Count |
|---|---|
| public functions | 58 |
| triggers (non-internal, all schemas) | 20 |
| policies (public + storage) | 72 |
| views in public | 16 |
| tables in public | 95 |
| auth.users | 113 |
| storage.objects | 240 |
| database size | 41 MB |

## Environment
- **DB timezone: `UTC`** — the self-hosted DB MUST also be UTC. All 7 cron
  schedules below are UTC; running the container in Asia/Kolkata shifts every
  job by 5h30m.
- **Vault secrets: 0** — nothing unrecoverable lives in Vault. The
  `dispatch_digests` x-cron-secret is not Vault-stored, so the "unrecoverable
  secret" risk in the plan does not apply.

## Sequences (only two exist)
| Sequence | last_value |
|---|---|
| `vendor_code_seq` | 103 |
| `website_health_checks_id_seq` | 5381 |

**Note:** invoice / PO / asset / document numbering does NOT use Postgres
sequences — it uses counter *rows* updated atomically via
`INSERT ... ON CONFLICT DO UPDATE SET last_number = last_number + 1`. Those are
ordinary table rows, so a normal data dump captures them. This is less fragile
than the plan assumed; no sequence-reset GST risk from these two.

## Data cleanliness
Scanned for absolute `supabase.co` URLs stored in the data (which would become
dead images after cutover): **0 hits** across `sku_master.web_description`,
`sku_master.web_highlights`, `business_profiles`, `homepage_banners`,
`product_images.storage_path`. All URLs are built by concatenation in code, so
changing `NEXT_PUBLIC_SUPABASE_URL` is sufficient.

## Deltas vs the committed schema backup
`backups/20260929_sales_original_sold_date_schema_backup.sql` matches the public
schema exactly (58 functions, 95 tables, 16 views). It is short by 6 policies and
9 triggers — those live in the `auth`/`storage` schemas, which a public-only dump
excludes. `03_schema_auth_storage.sql` from `capture.sh` covers them.

## Cron discrepancy vs docs
`release-expired-web-reservations` actually runs `7,37 * * * *` (twice hourly),
not "every 5 minutes" as `docs/project-context.md` and `docs/decisions.md` state.
Also, no `website-health-ping` cron job exists in `cron.job` despite being
referenced in `docs/bible/modules/finance-gst-reports.md` — but
`website_health_checks` has 5,381 rows, so it ran historically and was removed or
renamed. Worth reconciling the docs separately.
