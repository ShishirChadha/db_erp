---
slug: architecture-hld
title: Architecture — High Level Design (HLD)
kind: rule
audience: [owner]
routes: []
keywords: [hld, high level design, architecture diagram, system design, context diagram, deployment, topology, components, overview, how it works]
sources:
  - apps/erp/next.config.ts
  - apps/web/next.config.ts
  - packages/db/src/**
updated: 2026-10-01
---

## 1. System context

Who and what talks to this system, and over what.

```
                 +-------------------+
   Staff  -----> |   ERP (Next.js)   |  erp.digitalbluez.com
  (owner,        |   apps/erp        |
  manager,       +---------+---------+
  employee)                |
                           |          +----------------------+
   Customers ----> +-------+------+   |  Razorpay (payments) |
   (public)        | Storefront   |-->|  webhook -> order    |
                   | apps/web     |   +----------------------+
                   +-------+------+
                           |          +----------------------+
                           |          |  Resend (email)      |
                           +--------->|  invoices, digests   |
                           |          +----------------------+
                           v
                 +---------------------+
                 |  ONE Postgres DB    |  db.digitalbluez.com
                 |  (self-hosted)      |
                 +---------------------+
```

**The defining constraint:** there is exactly one database. The storefront's
product pages are Postgres *views* over ERP tables; checkout takes a row lock on
`asset_ledger`; staff and customers share one `auth.users`. The two apps cannot
be given separate databases without breaking stock locking, stock decrement and
customer identity at the same time.

## 2. Component view

```
  +---------------------------- monorepo ----------------------------+
  |                                                                  |
  |   apps/erp                         apps/web                      |
  |   - dashboard pages                - storefront pages            |
  |   - /api/** route handlers         - /api/checkout, /api/webhooks|
  |          \                                 /                     |
  |           \                               /                      |
  |            +----- packages/shared --------+   SELLABLE_STATUSES, |
  |            |      packages/ui             |   financialYear,     |
  |            |      packages/db             |   UI primitives,     |
  |            +------------------------------+   supabase clients   |
  +------------------------------|-----------------------------------+
                                 |
                                 v
        +--------------------------------------------------+
        |  Supabase stack (Docker, on the ProDesk)         |
        |                                                  |
        |   Envoy :8000  — API gateway, apikey enforcement  |
        |      |                                            |
        |      +-- PostgREST  — tables & views as REST       |
        |      +-- GoTrue     — auth, ES256 JWTs, JWKS       |
        |      +-- Storage    — files on disk + xattrs       |
        |      +-- Realtime   — (not used by this codebase)  |
        |      +-- imgproxy, postgres-meta, Studio           |
        |      |                                            |
        |   Postgres 17.6 — tables, views, RPCs, RLS,        |
        |                   triggers, pg_cron, pg_net        |
        +--------------------------------------------------+
```

## 3. Deployment topology

```
   INTERNET
      |
      |  (1) DNS: *.digitalbluez.com -> Cloudflare
      v
  +---------------------------+
  |  Cloudflare               |  TLS termination, CDN cache,
  |  - proxied DNS            |  DDoS protection, WAF
  |  - Tunnel ingress         |
  +------+-------------+------+
         |             |
   (2)   |             |  (3) outbound-only tunnel
  apps   v             v      NO inbound ports on the router
  +-------------+   +-----------------------------------+
  |   Vercel    |   |  HP ProDesk 400 G2 Mini           |
  |  apps/erp   |   |  Ubuntu Server / i5-6500T         |
  |  apps/web   |   |  32GB RAM / 466GB SSD / on UPS    |
  +------+------+   |                                   |
         |          |  cloudflared ---> Envoy :8000     |
         +--------->|  docker compose: 11 containers    |
          (4) HTTPS |                                   |
                    |  Admin plane (Tailscale only):    |
                    |    SSH, Supabase Studio           |
                    +-----------------------------------+
                              |          |
                        (5) LAN       (6) WiFi dongle
                        primary          backup ISP
```

1. All public hostnames resolve to Cloudflare, never to the house.
2. The two Next.js apps are built and served by Vercel.
3. `cloudflared` dials **out** to Cloudflare. The home router has no port
   forwarding; there is nothing to scan.
4. Both apps reach the database over ordinary HTTPS to `db.digitalbluez.com`.
5. / 6. Two independent internet connections with automatic failover.

**Blast radius:** if the ProDesk or both internet links go down, the ERP and
storefront stay *served* by Vercel but cannot read or write data. Cloudflare
continues serving cached product images, so the storefront degrades rather than
disappearing.

## 4. Request flows

```
  STAFF READ (e.g. Stock page)
  browser --Bearer JWT--> Vercel route
                             |  verify JWT against JWKS (cached)
                             |  re-check profiles.is_active + session revoked
                             |  query via service-role (bypasses RLS)
                             |  redact cost/vendor fields by role
                             v
                          response

  CUSTOMER READ (product page)
  browser --> Vercel --> public_products view --> Postgres
  browser --> Cloudflare cache --> (image, usually never reaches the house)

  BROWSER-DIRECT (Customers/Vendors/Invoices pages, file uploads)
  browser --anon key + RLS--> db.digitalbluez.com
  (this is why the database must be publicly reachable)
```

## 5. Quality attributes

| Attribute | How it is met | Residual risk |
|---|---|---|
| Availability | Two ISPs with automatic failover; UPS; stack restarts on boot | Single machine, single site |
| Security | No inbound ports; admin on a private VPN; API-layer authorisation; role-based redaction | Shares a LAN with other devices |
| Durability | Hourly dumps, daily storage archive, restore-tested | No offsite copy |
| Performance | 35MB database on 32GB RAM; Cloudflare caches images | Home upstream bandwidth |
| Observability | Self-reported vitals + System Health page | No external alerting |
| Cost | Zero recurring database cost | Owner carries the operational burden |

## 6. Known architectural gaps

- **No offsite backup.** Backups share a disk with the database they protect.
- **No external alerting.** An outage is only visible to someone looking at the page.
- **Single site, single machine.** No redundancy for hardware failure.
- **A backend network error reads as "not signed in"**, so a blip can log users
  out. Routes should answer 503 for unreachable-backend instead.
