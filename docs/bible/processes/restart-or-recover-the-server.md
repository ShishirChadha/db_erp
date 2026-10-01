---
slug: restart-or-recover-the-server
title: Restart or recover the server
kind: process
audience: [owner]
routes: [/dashboard/monitoring]
keywords: [restart, reboot, server down, outage, recover, erp down, website down, not working, band ho gaya, server off, downtime, emergency]
sources:
  - apps/erp/app/dashboard/monitoring/page.tsx
updated: 2026-10-01
---

## Before anything: is it actually the server?

Open **System Health** (`/dashboard/monitoring`). It answers this in one glance.

| What you see | What it means |
|---|---|
| Everything green, no attention items | The server is fine — the problem is elsewhere (your own internet, a browser cache, Vercel) |
| "The server has stopped reporting" | The ProDesk is off, has lost both internet links, or its collector has stopped |
| "Some vitals could not be read" | The server is reachable but a query failed — read the message shown |
| Endpoints red but server green | The box is healthy; Cloudflare or Vercel is the problem |

If the ERP will not load at all, you cannot reach this page — assume the server and continue below.

---

## Planned restart (after a security update)

System Health will say **"Restart needed: Yes"** and name the package. This is the only situation where a restart is genuinely required; uptime alone is never a reason.

1. Pick a time outside working hours and tell anyone using the ERP.
2. Connect over Tailscale and restart:
   ```
   ssh db_erp@100.74.71.92
   sudo reboot
   ```
3. Wait 3–5 minutes.
4. Confirm recovery — all of these start on boot by themselves:
   ```
   ssh db_erp@100.74.71.92 'docker ps --format "{{.Names}}\t{{.Status}}"'
   curl -I https://db.digitalbluez.com/auth/v1/health
   ```
   You want 11 healthy containers and an HTTP response (401 is correct here — it means the gateway answered).
5. Open the ERP and log in.

**Nothing needs starting by hand.** The Supabase stack, Cloudflare tunnel, backup timer, metrics collector and ISP watchdog are all enabled at boot.

---

## The server is unreachable

Work through these in order.

**1. Can you reach it over Tailscale?**
```
ssh db_erp@100.74.71.92 'uptime'
```
If this works, the box is alive and the problem is the tunnel or Cloudflare — skip to step 4.

**2. Is it powered on?** Check the machine physically: power light, and that the UPS has power. This is the most common cause and the quickest to rule out.

**3. Has it lost both internet connections?** The box has two: ethernet (primary) and a WiFi dongle (backup). If the ethernet ISP fails, the watchdog moves traffic to WiFi within about two minutes. If *both* are down, nothing can reach it and nothing can be done remotely — the watchdog deliberately leaves routing alone rather than stranding the box.

With a monitor and keyboard attached:
```
ip route | grep default        # should list two routes
ping -c3 1.1.1.1
sudo cat /var/log/isp-watchdog.log
```

**4. Is the tunnel down?**
```
ssh db_erp@100.74.71.92 'systemctl status cloudflared --no-pager | head -5'
sudo systemctl restart cloudflared
```
A Cloudflare **530** from `db.digitalbluez.com` means Cloudflare is up but cannot reach the origin — that is the tunnel, not the database.

**5. Are the containers up?**
```
ssh db_erp@100.74.71.92 'cd ~/supabase-project && docker compose ps'
sudo docker compose up -d        # from ~/supabase-project
```

---

## If the business must keep working

The hosted Supabase project still exists with its data intact, frozen, kept as a rollback target for 30 days from 2026-10-01. Falling back to it means reverting three environment variables in both Vercel projects, rebuilding without cache, and re-granting writes on hosted.

This is **not** a quick fix — real data has been written to the self-hosted database since the cutover, so anything entered since would have to be carried across. Treat it as a last resort for a prolonged hardware failure, not a response to a short outage.

---

## Restoring from backup

Backups are hourly in `/var/backups/erp/db`, with a daily storage archive alongside. To restore, install the extensions first (`pg_cron`, `pg_net`, and `pg_trgm` **in the `extensions` schema**) or a large number of indexes will fail, then:

```
docker exec -i supabase-db pg_restore -U supabase_admin -d postgres \
  --data-only --disable-triggers --no-owner /tmp/<dump>
```

`--disable-triggers` matters: without it the stock-sync triggers recompute `sku_master.quantity_in_stock` from a half-loaded `stock_movements` table and leave the cache wrong.

Full detail in `back-up-and-restore.md`.
