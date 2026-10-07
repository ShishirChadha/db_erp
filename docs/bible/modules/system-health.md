---
slug: system-health
title: System Health
kind: module
audience: [owner]
routes: [/dashboard/monitoring]
keywords: [monitoring, system health, server, vitals, cpu, temperature, disk, memory, uptime, containers, tunnel, backup status, restart, reboot, shutdown, power off, server down, power outage, power cut, bijli, downtime, availability, kya chal raha hai]
sources:
  - apps/erp/app/dashboard/monitoring/page.tsx
  - apps/erp/app/api/monitoring/route.ts
  - apps/erp/app/api/monitoring/command/route.ts
updated: 2026-10-08
---

## What this page is for

Self-hosting moved the uptime problem onto the business. On 2026-10-01 the ProDesk sat offline for 90 minutes and nobody noticed, because there was no way to see it short of walking over to the machine. This page is the in-app half of fixing that.

**Owner-only.** It exposes infrastructure detail — host vitals, container names, backup sizes — that no other role has a reason to see, and there is no useful partial view to grant, so it is `isOwner()` rather than a page-key grant.

## How it gets its data

The ProDesk writes its own vitals into `public.server_metrics` once a minute, via `/usr/local/bin/erp-metrics.sh` run by `erp-metrics.timer`. The ERP only reads that table.

That direction is deliberate and load-bearing:

- Nothing new listens on the box — no exporter, no extra port, no widened attack surface.
- When the machine is down there is nothing to poll, so a polling design would simply time out. Instead, **the age of the newest row is the alarm**: three missed samples (180s) flips `serverStale` and the page shows "The server has stopped reporting."

Public endpoints are the exception — the ERP, storefront and database API are probed from the Vercel side, so "is the storefront reachable" stays answerable when the box itself is not.

**Power and restart history arrives differently again.** `erp-boot-event.service` runs once at each boot, reads the *previous* boot's journal, and writes one `public.server_boot_events` row. It has to work this way because the classification — planned restart versus power loss — exists nowhere else. A gap in `server_metrics` proves the machine was down but cannot say why, and those two causes produce an identical gap. A planned shutdown leaves a systemd shutdown sequence in the log; a power cut leaves the log stopping mid-line, and **that absence is the evidence**.

Rows are keyed on the kernel's boot id with `ON CONFLICT DO NOTHING`, so the service can retry safely (the database is usually not up yet when it first runs after a cold boot) and its first run backfills every boot still in the journal.

## What it shows

| Section | Contents |
|---|---|
| **Needs your attention** | Readings turned into actions, worst first, in plain language. Says so explicitly when nothing is wrong. |
| **Public endpoints** | ERP, storefront, database API — status and latency, checked from outside the network |
| **Server** | CPU load vs cores, temperature, memory, disk, uptime, restart-needed, pending updates, with 3h sparklines |
| **Internet links** | which link is carrying traffic, LAN/WiFi state, route metrics, tunnel status |
| **Supabase stack** | container health (naming any unhealthy one), database size, connection use, Postgres version |
| **Backups** | last backup age, size, copies kept |
| **Power & restarts** | current uptime, counts of unplanned vs planned restarts, total downtime, availability %, and a table of every recorded restart with its cause and duration |
| **Largest tables / Scheduled jobs** | table sizes and row estimates; every cron job with schedule and on/off state |

## What counts as normal

Thresholds are set against what this specific hardware tolerates, not generic server advice.

| Vital | Normal | Watch | Act |
|---|---|---|---|
| Temperature | under 75 °C | 75–85 °C | over 85 °C |
| CPU load | under 70% of 4 cores | 70–100% | over 100% |
| Memory | under 75% | 75–90% | over 90% |
| Disk | under 70% | 70–85% | over 85% |
| Backup age | under 1.5h | 1.5–3h | over 3h |

The i5-6500T's thermal limit is around 100 °C and it throttles itself long before any damage, so 85 °C leaves real headroom. Disk acts at 85% because Postgres and the hourly backups share the volume.

## When to restart

**Uptime is not a reason to restart.** Linux is happy to run for months; a long uptime is not a problem in itself. This is the most common misconception carried over from Windows.

A restart is genuinely needed in exactly one case: a package upgrade has replaced a kernel or core library that the *running* system is still using. Ubuntu records this in `/var/run/reboot-required` and names the packages in `.pkgs`. The collector reads both, so the page states it as fact — "Restart needed: Yes — plan a restart", with the package named — rather than guessing from uptime.

A restart takes **3–5 minutes** and needs nothing afterwards: the Supabase stack, the Cloudflare tunnel, the backup timer, the metrics collector and the ISP watchdog all start on boot. Plan it outside working hours.

Pending updates are counted with `apt-get` in **simulate** mode, so collecting metrics never installs anything as a side effect.

## Power cuts, and why the server may not come back by itself

The UPS covers brief dips. It does **not** cover an outage that outlasts its battery, and after that the firmware's default is to stay **off** until somebody presses the power button — so a night-time cut keeps the ERP and storefront down until someone reaches the office. This is what happened on 2026-10-02: power failed at 00:51 IST, the machine stayed off for 9h29m, and staff powered it on in the morning.

The fix is a one-time BIOS change: **F10 at startup → Advanced → Power Management Options → After Power Loss = Power On**. `Power On`, not `Previous State` — the previous state was *off*, so that setting would not have helped.

**The page reads this setting live from the firmware** and says so plainly: "Power On — recovers by itself", or the current value plus "needs changing in BIOS", which also raises an attention item. So it confirms the change actually took, rather than relying on anyone's memory of having done it. The collector reads it from `/sys/class/firmware-attributes/hp-bioscfg/attributes/After Power Loss/current_value` into `server_metrics.bios_after_power_loss`, and stores NULL if the interface is absent, so this survives a move to non-HP hardware.

**It cannot be changed remotely, and this was tested rather than assumed.** The `hp-bioscfg` kernel interface is present and every BIOS attribute is *readable* over SSH, but this machine's 2016 firmware (ProDesk 400 G2 Mini, BIOS N23 v02.10) rejects every write with `0x4 "Invalid command type"` — HP did not implement the WMI BIOS-write path on this platform generation. This is a capability gap, not a permissions problem: no Setup Password is set (`is_enabled = 0`, and an auth failure reports differently), and writing an attribute's *own current value* back fails identically. Setting a BIOS Setup Password would not unlock it, and editing the NVRAM directly with `flashrom` risks bricking the server. **Do not spend time retrying this** — it is a five-minute job at the machine, needed once.

**Availability is reported over "the last 30 days or as far back as the record goes, whichever is shorter", with the window length shown next to the percentage.** Dividing a month's worth of downtime by a month while only holding a few days of history would overstate availability several-fold, and an uptime figure that flatters itself is worse than none at all.

An unplanned outage also raises an item under **Needs your attention** for 24 hours afterwards. Without that, the page goes fully green the moment the machine is back and the outage leaves no mark on the thing you actually look at.

## Reading a failure correctly

The page distinguishes two things that look identical on a naive dashboard:

- **"The server has stopped reporting"** — no fresh rows. The box is off, has lost both links, or its collector has stopped.
- **"Some vitals could not be read"** — the queries themselves failed, with the database's own message shown verbatim.

Similarly, a restart whose cause cannot be established is recorded as `unknown` and the earliest boot on record as `first_boot` — neither is counted as downtime, because guessing a cause would be worse than admitting the log no longer goes back that far.

A dashboard whose job is telling you something is wrong cannot afford to render "could not ask" the same as "nothing to report". The first version of this page did exactly that and was briefly misleading.

## Restarting or shutting down from the page (2026-10-08)

**Server control** on this page sends a restart or shutdown request into the database (`public.server_commands`) rather than reaching the box directly — nothing listens for inbound commands on the ProDesk, same as everywhere else on this page. A systemd timer (`erp-command-poller.timer`, every ~10s) checks that table and runs `sudo reboot` or `sudo shutdown -h now` when it finds a pending row. `db_erp` has passwordless sudo on the box, which is what makes this possible without a password prompt baked in anywhere.

- **Restart** is a single confirm dialog — the box comes back on its own in 3–5 minutes, same as the manual `ssh` + `sudo reboot` path this replaces.
- **Shutdown** requires typing `SHUTDOWN` to confirm, enforced server-side in `POST /api/monitoring/command`, not just hidden behind a client dialog. This machine has **no remote power-on** (no Wake-on-LAN, no smart plug), so a shutdown stays down until someone is physically at the office — the dialog says this plainly rather than letting a shutdown look as casual as a restart.
- Only one request can be in flight at a time — the route refuses a second while one is `pending`/`acknowledged`, so a restart can't queue behind a shutdown that may never get a chance to run.
- The poller itself never writes a completion row — the moment it executes the command the box is seconds from disappearing (restart) or gone for good until someone presses the button (shutdown), with no window left to write anything. **`GET /api/monitoring/command` resolves this instead**, every time anyone asks: a `server_boot_events` row booted *after* the command was acknowledged is proof a real reboot happened, and flips the row to `done`. No such boot within 20 minutes flips it to `failed` instead (the poller never ran it, `sudo` failed, or the box genuinely didn't come back), so the page never gets stuck showing "in progress" forever — a real bug the first restart through this feature hit, fixed the same day (2026-10-08).

## Known gaps

- **No external alerting.** This page tells you something is wrong only when you look at it. An outage still goes unnoticed if nobody opens it. An external uptime monitor hitting `https://db.digitalbluez.com/auth/v1/health` is the missing piece.
- **No Vercel or Cloudflare panels yet.** Both need read-only API tokens.
- **The BIOS power-recovery setting can be read but not written.** See above; it needs a physical visit, once.
- **Restart history is limited by journal retention.** Boots older than the journal's rotation window cannot be classified retrospectively; from now on each one is captured as it happens, so the record only gets better.
