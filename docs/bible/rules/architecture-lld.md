---
slug: architecture-lld
title: Architecture — Low Level Design (LLD)
kind: rule
audience: [owner]
routes: []
keywords: [lld, low level design, sequence diagram, auth flow, login flow, sale flow, checkout flow, backup flow, failover, state machine, internals, detailed design]
sources:
  - apps/erp/lib/auth/session.ts
  - apps/erp/lib/api-client.ts
  - apps/erp/lib/auth/device-sessions.ts
  - apps/erp/lib/chunked-in.ts
  - apps/erp/app/api/monitoring/route.ts
  - apps/web/lib/order-to-sale.ts
updated: 2026-10-01
---

## 1. Authentication — login and request authorisation

```
  LOGIN
  browser                GoTrue                  Postgres
     |  email+password      |                        |
     |--------------------->|                        |
     |                      |  bcrypt vs             |
     |                      |  auth.users            |
     |                      |----------------------->|
     |  ES256 JWT + refresh |                        |
     |<---------------------|                        |
     |                                               |
     |  POST /api/auth/log-event {event: login}      |
     |  -> registers a device session row            |
     |  -> sets db_session_id cookie                 |

  EVERY SUBSEQUENT API CALL
  browser --Authorization: Bearer <JWT>--> Vercel route
                  |
                  v
          getSessionUser(req)
                  |
         1. jwtVerify(token, JWKS, { issuer })      <- signature, expiry, issuer
         2. in parallel:
              isSessionRevoked(db_session_id cookie)
              SELECT role, is_active, allowed_pages, page actions
         3. null if: bad token | revoked | inactive | no profile
                  |
          null ---+---> 401 ---> api-client signs the user out
          user ---+---> route continues, redaction applied by role
```

**JWKS is fetched once per server instance and cached** by `jose`; it is not a
network call per request.

**Known weakness:** step 3 cannot distinguish "invalid token" from "could not
reach the database". A network failure produces `null`, which produces a 401,
which logs the user out. On a home connection this will recur. The fix is for
routes to answer 503 when the backend is unreachable.

## 2. The 401 → sign-out loop (and why it fired after the migration)

```
  fetch() to Postgres fails (e.g. ETIMEDOUT on an IPv6 attempt)
            |
            v
  supabase-js returns { data: null, error }
            |
            v
  getSessionUser() sees no profile -> returns null
            |
            v
  route answers 401
            |
            v
  api-client.ts: retry once with a fresh token
            |  still 401
            v
  supabase.auth.signOut() + redirect to /login
```

The user experiences "it signed me out at random"; the server logs show nothing
at all, because the TCP connection never completed. Mitigated by forcing IPv4
in `instrumentation-node.ts`.

## 3. A sale, end to end

```
  Sell screen
     |
     | POST /api/sales-entry
     v
  validate unit is in SELLABLE_STATUSES
     |
     +--> asset_ledger.status = 'sold'
     +--> INSERT sales (asset_ledger_id, customer, amounts, payment_account)
     +--> INSERT stock_movements (quantity_change = -1)
                |
                | trigger trg_sync_sku_stock
                v
          sku_master.quantity_in_stock recalculated
     |
     +--> later: sale_payments rows
                |
                | trigger sync_sale_payment_totals
                v
          sales.amount_paid / payment_status derived
     |
     +--> later: invoice via increment_invoice_number (atomic RPC)
```

**Never write `quantity_in_stock` or `amount_paid` directly** — both are
trigger-maintained caches. Insert the movement or the payment row instead.

## 4. Website order → ERP sale

```
  Customer checkout
     |
     | POST /api/checkout/start
     v
  re-price from public_products (client cart price never trusted)
     |
     +--> INSERT orders / order_items
     +--> RPC reserve_order_items
              serialized: lock ONE asset_ledger row
                          FOR UPDATE SKIP LOCKED -> status 'reserved_web'
              fungible:   quantity hold in web_reservations
              both:       15-minute TTL
     |
     v
  Razorpay payment
     |
     | webhook (signature-verified, idempotent)
     v
  apps/web/lib/order-to-sale.ts
     +--> sales row (sold_by='Website', entered_by NULL)
     +--> stock_movements -> same trigger as an in-store sale
     +--> activities task if an upgrade was purchased

  Unpaid after 15 min:
     pg_cron release-expired-web-reservations -> reservation released
```

`FOR UPDATE SKIP LOCKED` is what stops two customers buying the same
one-of-a-kind laptop. **This lock cannot span two databases** — the single
strongest reason the website cannot have its own.

## 5. Internet failover state machine

```
                   +------------------------+
                   |  NORMAL                |
                   |  LAN metric 100        |
                   |  WiFi metric 600       |
                   |  traffic -> LAN        |
                   +-----------+------------+
                               |
            LAN link drops     |     LAN pings fail 3x in a row
            (cable/switch)     |     (cable up, ISP dead)
                   +-----------+-----------+
                   |                       |
                   v                       v
         kernel switches           isp-watchdog.sh:
         instantly (metrics)       is WiFi verified working?
                   |                  |            |
                   |                 yes           no
                   |                  |            |
                   |                  v            v
                   |        LAN metric -> 2000   DO NOTHING
                   |        traffic -> WiFi      (total outage; never
                   |                             strand the box with
                   |                             no default route)
                   +-----------+-----------+
                               |
                   LAN answers twice in a row
                               |
                               v
                   LAN metric -> 100, traffic -> LAN
```

Detection of the "ISP dead" case takes 90–120 seconds (3 failures × 30s timer).
The link-down case is instant.

## 6. Backup and restore

```
  erp-backup.timer (hourly)
     |
     +--> pg_dump -Fc  ->  erp-<ts>.dump.part
     |         |
     |         +--> verify PGDMP header + minimum size
     |         +--> rename to .dump   (only on success)
     |
     +--> once a day: tar --xattrs of the storage volume
     |         ^
     |         +-- xattrs are mandatory: storage-api reads content-type from
     |             user.supabase.content-type on disk, NOT from the database
     |
     +--> prune: 72 hourly / 30 daily / 12 monthly

  RESTORE
     1. create extensions FIRST
        pg_cron, pg_net, pg_trgm SCHEMA extensions   <- not public
     2. pg_restore --data-only --disable-triggers --no-owner
            ^
            +-- without --disable-triggers the stock trigger recomputes
                quantity_in_stock from a half-loaded stock_movements table
     3. connect as supabase_admin (postgres is not a superuser here)
```

## 7. Monitoring data path

```
  ProDesk                                  Vercel                  Browser
  erp-metrics.timer (60s)
     |
     | collects: load, temp, mem, disk, uptime,
     |           container health, route metrics,
     |           link reachability, tunnel, backups,
     |           reboot-required, pending updates
     v
  INSERT public.server_metrics  ------>  GET /api/monitoring  --> page
                                              |                    (30s poll)
                                              +--> probes ERP /
                                                   storefront /
                                                   database API
                                                   from OUTSIDE

  If the box is down: no new rows -> newest row ages ->
  serverStale after 180s -> "The server has stopped reporting"
```

**The box pushes; the ERP never polls it.** Nothing new listens on the machine,
and absence of data is itself the signal — a polling design would simply hang.

## 8. Query-size limit

```
  route builds .in('id', [ ...1195 uuids ])
            |
            v
  URL ~39KB  -->  Envoy per_connection_buffer_limit_bytes = 32768
                  (+ ~7KB Cloudflare headers => ~24KB usable)
            |
            v
         HTTP 400
            |
            v
  a route that reads only `.data` sees null and renders "no data"

  FIX: chunkedIn(ids, fn, 300)
       - batches of 300 (~11KB per request)
       - runs batches concurrently
       - THROWS if any batch fails, rather than returning a short result
```

Measured threshold: 600 ids (22,288 bytes) succeeds, 700 ids (25,988 bytes)
returns 400.

## 9. Authorisation matrix

```
  isOwner()          -> owner only
  isManagerOrAbove() -> owner + manager  (cost/vendor visibility, PO approval)
  hasPageAccess(key) -> owner always; manager/employee need allowed_pages
  canEditPage(key)   -> owner always; others need profile_page_actions.can_edit
                        (manager gets NO automatic bypass here)
```

Enforced in the route handler. `RequireOwner` is UX only. RLS is not the
boundary for most tables because routes use the service-role client.
