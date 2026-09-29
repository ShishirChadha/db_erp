#!/usr/bin/env bash
#
# Phase 1 (final step) — lock the host down to deny-by-default inbound.
#
# DANGER: this denies inbound SSH on the LAN. After it runs, the ONLY way in is
# over Tailscale. It refuses to run unless it can verify Tailscale is actually
# connected first.
#
# Usage:  sudo ./phase1-firewall.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo:  sudo $0" >&2
  exit 1
fi

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31mREFUSING: %s\033[0m\n' "$1" >&2; exit 1; }

step "Safety checks before locking anything down"

command -v tailscale >/dev/null 2>&1 || die "tailscale is not installed. Run phase1-setup.sh first."

# Must be actually connected, not merely installed.
# Tolerate whitespace around the colon -- tailscale pretty-prints its JSON as
# `"BackendState": "Running"`, so a naive '"BackendState":"' match never fires
# and the check silently reports Unknown.
TS_STATE=$(tailscale status --json 2>/dev/null \
  | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$TS_STATE" ] || TS_STATE="Unknown"
[ "$TS_STATE" = "Running" ] || die "Tailscale backend state is '$TS_STATE', not 'Running'. Run: sudo tailscale up"
ok "tailscale backend is Running"

TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
[ -n "$TS_IP" ] || die "Tailscale has no IPv4 address yet. Run: sudo tailscale up"
ok "tailscale IPv4: $TS_IP"

ip link show tailscale0 >/dev/null 2>&1 || die "interface tailscale0 does not exist"
ok "interface tailscale0 present"

# Confirm the operator has actually tested SSH over Tailscale.
cat <<EOF

  After this script runs, inbound SSH will work ONLY via:

      ssh $(logname 2>/dev/null || echo "$SUDO_USER")@$TS_IP

  If you have not already SUCCESSFULLY connected that way from your Mac,
  stop now, test it, and come back. Recovering from a lockout needs a
  physical keyboard and monitor attached to this machine.

EOF
read -r -p "  Have you confirmed SSH over Tailscale works? (type 'yes' to proceed): " CONFIRM
[ "$CONFIRM" = "yes" ] || die "not confirmed -- nothing changed"

step "Applying firewall rules"
apt-get install -y -qq ufw >/dev/null 2>&1 || true
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow in on tailscale0 >/dev/null
# Tailscale's own WireGuard endpoint must reach us for the tunnel to establish.
ufw allow 41641/udp >/dev/null
ufw --force enable >/dev/null
ok "deny-by-default inbound; tailscale0 allowed; 41641/udp open for WireGuard"

step "Hardening SSH"
# Key-only auth as a backstop. SSH is not internet-facing after this, but
# defence in depth costs nothing here.
#
# The 00- prefix is load-bearing: OpenSSH honours the FIRST occurrence of a
# setting, and Ubuntu ships /etc/ssh/sshd_config.d/50-cloud-init.conf with
# "PasswordAuthentication yes". A 99- file is read after it and silently loses.
install -d /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/00-erp-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
EOF
if sshd -t 2>/dev/null; then
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  ok "password auth disabled, root login disabled"
else
  rm -f /etc/ssh/sshd_config.d/00-erp-hardening.conf
  printf '    \033[33m!\033[0m sshd config test failed -- hardening reverted, SSH left as-is\n'
fi

step "Result"
ufw status verbose | head -12

cat <<EOF

────────────────────────────────────────────────────────────────────────
 Host is locked down. Verify from your Mac, in this order:

   1. Still reachable over Tailscale:     ssh <user>@$TS_IP
   2. NOT reachable on the LAN any more:  ssh <user>@<lan-ip>   (should hang/refuse)

 If step 1 fails, you have a physical-keyboard recovery on your hands:
   sudo ufw disable

 Next: Phase 2, building the Supabase stack.
────────────────────────────────────────────────────────────────────────
EOF
