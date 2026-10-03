#!/usr/bin/env python3
"""Record how each boot of this machine began, and how the previous one ended.

Runs once at boot from erp-boot-event.service, and is safe to run by hand at
any time: every boot still in the journal is (re-)evaluated and inserted with
ON CONFLICT DO NOTHING, keyed on the kernel's boot id. So the first run also
backfills whatever history the journal still holds.

The classification is the whole point. A gap in server_metrics tells you the
machine was down; only the previous boot's journal tells you WHY. A planned
restart ends with a systemd shutdown sequence in the log. A mains failure ends
with an ordinary log line and then nothing at all -- the absence of a shutdown
sequence IS the evidence of an unclean loss.
"""
import json
import re
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone

DB = ["docker", "exec", "-i", "supabase-db", "psql", "-U", "supabase_admin",
      "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1"]


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def ts(micros):
    return datetime.fromtimestamp(micros / 1_000_000, tz=timezone.utc)


def classify(boot_id):
    """How did the boot with this id end?"""
    p = run(["journalctl", "-b", boot_id, "--no-pager", "-o", "short-iso"])
    if p.returncode != 0:
        return "unknown", "journal for this boot is no longer available"
    log = p.stdout

    if re.search(r"Kernel panic|BUG: unable to handle", log):
        return "crash", "kernel panic in the log"

    # systemd logs its final action on the way down. Look at the last part of
    # the log only -- these strings also appear during early boot.
    tail = log[-20000:]
    if re.search(r"systemd-shutdown.*[Pp]owering off|Reached target.*Power-Off|"
                 r"reboot: Power down|Starting systemd-poweroff", tail):
        return "clean_shutdown", "shut down normally (powered off on request)"
    if re.search(r"systemd-shutdown.*[Rr]ebooting|Reached target.*Reboot|"
                 r"reboot: Restarting system|Starting systemd-reboot", tail):
        return "clean_reboot", "restarted normally on request"
    if "systemd-shutdown" in tail:
        return "clean_shutdown", "shutdown sequence ran"

    # No shutdown sequence at all: the log simply stops. Power was cut.
    last = [l for l in tail.strip().splitlines() if l.strip()]
    hint = last[-1][:160] if last else ""
    return "power_loss", (
        "no shutdown sequence in the log -- power was cut while running. "
        f"Last thing recorded: {hint}")


def wait_for_db(timeout=600):
    """At boot we may well start before Postgres is accepting connections."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if run(DB + ["-c", "select 1"]).returncode == 0:
            return True
        time.sleep(10)
    return False


def main():
    p = run(["journalctl", "--list-boots", "-o", "json"])
    if p.returncode != 0:
        print("could not list boots:", p.stderr.strip(), file=sys.stderr)
        return 1
    boots = sorted(json.loads(p.stdout), key=lambda b: b["index"])
    if not boots:
        return 0

    if not wait_for_db():
        print("database never became reachable; giving up", file=sys.stderr)
        return 1

    host = socket.gethostname()
    rows = []
    for i, b in enumerate(boots):
        booted_at = ts(b["first_entry"])
        prev = boots[i - 1] if i > 0 else None

        if prev is None:
            # The oldest boot the journal still holds. We cannot see what came
            # before it, so we must not guess at a cause or a downtime.
            kind, detail, prev_id, prev_last, down = (
                "first_boot", "oldest boot still in the journal", None, None, None)
        else:
            kind, detail = classify(prev["boot_id"])
            prev_id = prev["boot_id"]
            prev_last = ts(prev["last_entry"])
            down = int((booted_at - prev_last).total_seconds())

        rows.append((host, b["boot_id"], booted_at, prev_id, prev_last,
                     down, kind, detail))

    def lit(v):
        if v is None:
            return "null"
        if isinstance(v, datetime):
            return "'%s'" % v.isoformat()
        if isinstance(v, int):
            return str(v)
        return "'%s'" % str(v).replace("'", "''")

    values = ",\n".join(
        "(%s)" % ",".join(lit(c) for c in r) for r in rows)
    sql = (
        "insert into public.server_boot_events "
        "(hostname,boot_id,booted_at,previous_boot_id,previous_last_seen_at,"
        "downtime_seconds,shutdown_kind,detail) values\n"
        + values + "\non conflict (boot_id) do nothing;")

    r = run(DB + ["-c", sql])
    if r.returncode != 0:
        print("insert failed:", r.stderr.strip(), file=sys.stderr)
        return 1
    print("recorded/verified %d boot(s)" % len(rows))
    return 0


if __name__ == "__main__":
    sys.exit(main())
