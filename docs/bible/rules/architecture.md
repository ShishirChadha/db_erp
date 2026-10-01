---
slug: architecture
title: System architecture
kind: rule
audience: [owner]
routes: [/dashboard/monitoring]
keywords: [architecture, infrastructure, self-hosted, supabase, vercel, cloudflare, tunnel, prodesk, server, hosting, how it works, stack, deployment, failover, backup]
sources:
  - apps/erp/next.config.ts
  - apps/web/next.config.ts
  - apps/erp/instrumentation.ts
  - apps/erp/instrumentation-node.ts
  - apps/erp/lib/auth/session.ts
  - apps/erp/lib/supabase/service.ts
  - apps/erp/lib/chunked-in.ts
  - packages/db/src/**
updated: 2026-10-01
---

## What this system is

One business running on two public-facing applications and one database.

- **`apps/erp`** — the internal ERP, at `erp.digitalbluez.com`. Purchasing, inventory, sales, repairs, rentals, accounting. Used by the owner and staff.
- **`apps/web`** — the public storefront, at `digitalbluez.com`. Customers browse and buy.
- **One Postgres database** serving both. The ERP is the source of truth; the storefront reads it through publish-safe views and writes orders back into the same tables.

They share code through `packages/{shared,ui,db}` in an npm-workspaces monorepo.

**The single most important structural fact:** the website cannot be separated from the ERP. Its product pages are Postgres *views* over ERP tables, its checkout takes a row lock on `asset_ledger` to stop two customers buying the same one-of-a-kind laptop, and both identities live in one `auth.users` table. Splitting them across two databases would break stock locking, stock decrement and customer identity simultaneously. See `website.md`.

---

## Where everything runs

Since **1 October 2026**, the database runs on hardware the business owns. Before that it was hosted Supabase, which was resource-exhausted and suffering outages.

```
                        Internet
                            |
        +-------------------+--------------------+
        |                                        |
   Vercel (apps)                        Cloudflare edge
   - apps/erp   erp.digitalbluez.com    - TLS, CDN, DDoS
   - apps/web   digitalbluez.com        - caches product images
        |                                        |
        +------> https://db.digitalbluez.com <---+
                            |
                   outbound-only tunnel
                  (no inbound ports open)
                            |
            +---------------------------------+
            |  HP ProDesk 400 G2 Mini         |
            |  Ubuntu Server, i5-6500T        |
            |  32GB RAM, 466GB SSD, on a UPS  |
            |                                 |
            |  Docker: Supabase stack         |
            |    Envoy :8000  (API gateway)   |
            |    Postgres 17.6                |
            |    PostgREST, GoTrue, Storage   |
            |    Realtime, imgproxy, Studio   |
            |                                 |
            |  SSH + Studio: Tailscale only   |
            +---------------------------------+
```

**Nothing listens on the public internet.** `cloudflared` makes an *outbound* connection to Cloudflare; traffic arrives back down that tunnel. The home router has no forwarded ports. Administration (SSH, Supabase Studio) is reachable only over Tailscale, a private mesh VPN.

### Why the apps stayed on Vercel

Only the database moved. The apps are stateless and Vercel's build/deploy pipeline is doing useful work. The consequence is that the storefront's uptime is now the ProDesk's uptime plus the home internet's uptime — mitigated by Cloudflare caching product images at the edge (they are uploaded with `cache-control: immutable`, so most image requests never reach the house).

---

## How a request flows

**Staff loading the Stock page:**

1. Browser → Vercel (Next.js server component / API route)
2. Route calls `getSessionUser()` — verifies the Bearer JWT against the JWKS at `db.digitalbluez.com/auth/v1/.well-known/jwks.json`, then re-checks `profiles.is_active` and session revocation live
3. Route queries Postgres through `supabaseAdmin` (service-role, bypasses RLS)
4. Response is redacted by role before it leaves the server

**Customer viewing a product:** Vercel → `public_products` view → Postgres. Images come straight from Cloudflare's cache, usually without touching the ProDesk.

**Browser talking directly to the database:** some ERP pages (Customers, Vendors, Invoices) query Postgres client-side under RLS, and ~10 components upload files via signed-URL `PUT` straight at `db.digitalbluez.com`. This is why the database must be publicly reachable and cannot hide behind the app server.

---

## Security model

**The API layer is the boundary, not RLS.** Most routes use the service-role client, which bypasses RLS entirely. Role checks happen inside each route handler. There is no `middleware.ts`. `RequireOwner` is UX only — every page it wraps must also check server-side.

Three roles — `owner`, `manager`, `employee` — plus per-page view grants (`profiles.allowed_pages`) and per-page edit grants (`profile_page_actions`). Cost, vendor identity and margin are stripped from employee responses. See `roles-permissions.md`.

**Auth uses asymmetric JWTs.** GoTrue signs with ES256 and publishes a JWKS endpoint; `session.ts` verifies signature, expiry and issuer locally. The issuer string must match `https://db.digitalbluez.com/auth/v1` byte for byte. A self-hosted stack left on its default shared-secret configuration has no usable JWKS endpoint and every API call returns 401.

---

## Infrastructure services on the box

Four systemd timers, all independent of the applications:

| Unit | Interval | Purpose |
|---|---|---|
| `erp-backup.timer` | hourly | `pg_dump -Fc` + daily storage archive |
| `erp-metrics.timer` | 1 min | writes host vitals into `server_metrics` |
| `isp-watchdog.timer` | 30 s | fails LAN over to WiFi when its ISP dies |
| `unattended-upgrades` | daily | security patches; reboots stay manual |

### Internet failover

Two independent connections: ethernet (`enp2s0`, primary) and a USB WiFi dongle (`wlx688fc90618e8`, backup). They are genuinely separate lines — different gateway MACs and different public IPs — despite both routers using `192.168.1.1`.

Failover works at two levels, and the distinction matters:

- **Link down** (cable out, switch dead): handled by route metrics alone. LAN is metric 100, WiFi 600; the kernel switches instantly.
- **Link up but ISP dead**: metrics do *not* help — the kernel sees a healthy cable and keeps using it. This is what took the box offline for 90 minutes on 2026-10-01. `isp-watchdog.sh` pings out through the LAN specifically, and after 3 consecutive failures raises its metric to 2000 so WiFi wins. It restores automatically when the ISP returns, and **refuses to demote unless WiFi is independently verified working**, so a double outage can never leave the box with no default route.

### Backups

Hourly `pg_dump -Fc` to `/var/backups/erp/db`, daily `tar` of the storage volume **including extended attributes** — storage-api reads content-type from xattrs on disk, not from the database, so an archive without them restores images every browser treats as a download.

Retention 72 hourly → 30 daily → 12 monthly. Each dump is written to a `.part` file and renamed only on success, then checked for the `PGDMP` magic header and a minimum size, so a truncated dump can never pass as good.

**Verified by restoring, not by existing** — a restore into a throwaway database reproduced row counts, users, functions and policies exactly.

**Known gap: there is no offsite copy.** Backups live on the same SSD as the database, plus one manual copy on the owner's Mac. Fire or theft loses both.

### Monitoring

The ProDesk writes its own vitals into its own Postgres every minute; the ERP only reads them (`/dashboard/monitoring`). Nothing new listens on the box and there is no exporter to poll. When the machine is down there is nothing to write — **the age of the newest row is itself the alarm**. See `system-health.md`.

**Known gap: there is no external alerting.** The page tells you something is wrong only when you look at it.

---

## Operational rules learned the hard way

These are recorded because each cost real time to diagnose.

**`NEXT_PUBLIC_*` values compile into the browser bundle.** Changing them in Vercel requires a **full rebuild with the build cache disabled**. A cached rebuild silently reproduces the old value. They are also scoped per environment — setting them on Preview does nothing for Production.

**The self-hosted `anon` and `service_role` keys differ from the hosted ones.** A cutover changes three variables per project, not one.

**Node's dual-stack connect must be forced to IPv4.** Cloudflare publishes AAAA records; IPv6 is not routable from the Vercel runtime. Left alone, a fraction of fresh TCP connections burn a ~500ms timeout and `fetch` rejects — which surfaced as users being signed out at random, because a failed `profiles` read is indistinguishable from "no session". Handled in `instrumentation-node.ts`.

**`.in()` filters must be batched.** Envoy (which replaced Kong in the self-hosted stack) caps the request line at ~24KB after Cloudflare's headers, about 650 UUIDs. Over that it returns 400 — and a route that destructures only `.data` turns that into a silently short result. Use `chunkedIn()` from `lib/chunked-in.ts`, which throws rather than returning partial data.

**Never swallow an error into a generic message.** This bit the expense dialog, the Stock enrichment queries and the monitoring page itself in one day. "Could not ask" and "nothing to report" must never render identically.

**`cron.database_name` is hardcoded to `postgres`.** Do not rename the database.

**`pg_trgm` must live in the `extensions` schema**, not `public` — the schema dump references `extensions.gin_trgm_ops` and eight fuzzy-search indexes fail otherwise.

**Migrations no longer go through the Supabase MCP tools.** Those point at the retired hosted project. Apply schema changes directly against the self-hosted database, and back up first.

---

## Rollback

The hosted Supabase project still exists, frozen (`REVOKE` on all writes) with its data intact, and is kept as a rollback target for 30 days from 2026-10-01. **It must be logged into weekly** or the free tier pauses it and the rollback target disappears.

Rolling back is: revert the three environment variables in both Vercel projects, rebuild without cache, then re-`GRANT` writes and restore cron on hosted from `07_cron_jobs.sql`.

**The point of no return has passed** — real writes have landed on self-hosted, so a rollback now means dumping self-hosted back into hosted first.
