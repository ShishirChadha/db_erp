#!/usr/bin/env bash
#
# Phase 1 — prepare a Lenovo ThinkPad running Ubuntu Server 24.04 LTS to host
# the self-hosted Supabase stack 24/7.
#
# Safe to re-run: every step is idempotent.
#
# This script deliberately does NOT enable the firewall. Enabling a
# deny-by-default firewall before Tailscale is connected would lock you out of
# SSH with no way back in except a physical keyboard. Run phase1-firewall.sh
# separately, only after you have confirmed SSH-over-Tailscale works.
#
# Usage:  sudo ./phase1-setup.sh

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo:  sudo $0" >&2
  exit 1
fi

REAL_USER="${SUDO_USER:-$USER}"
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$1"; }

step "1/8  System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg lsb-release unattended-upgrades >/dev/null
ok "base packages installed"

step "2/8  Never sleep, never suspend on lid close"
# This is a laptop. By default, closing the lid suspends it and takes the whole
# business offline. systemd-logind must be told to ignore the lid entirely.
install -d /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/99-erp-no-sleep.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
EOF
systemctl restart systemd-logind
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true
ok "lid close and all sleep targets disabled"
warn "TEST THIS: close the lid and confirm you can still SSH in, before relying on it"

step "3/8  Battery charge thresholds (ThinkPad)"
# An always-plugged laptop held at 100% swells its battery within ~18 months --
# and that battery is the UPS that keeps the database alive through power cuts.
# Holding it at 75-80% preserves it for years.
apt-get install -y -qq tlp >/dev/null
if ! grep -q 'START_CHARGE_THRESH_BAT0' /etc/tlp.conf 2>/dev/null; then
  cat >> /etc/tlp.conf <<'EOF'

# ERP host: keep the battery healthy on a permanently plugged-in machine.
START_CHARGE_THRESH_BAT0=75
STOP_CHARGE_THRESH_BAT0=80
EOF
fi
systemctl enable --now tlp >/dev/null 2>&1 || true
if [ -d /sys/class/power_supply/BAT0 ]; then
  ok "tlp active; battery present"
else
  warn "no BAT0 found -- thresholds are a no-op on this machine"
fi

step "4/8  Host clock in UTC"
# Every pg_cron schedule captured from the hosted project is in UTC. Keeping the
# host in UTC too means log timestamps line up with cron runs instead of being
# 5h30m out.
timedatectl set-timezone UTC
timedatectl set-ntp true
ok "timezone $(timedatectl show -p Timezone --value), NTP on"

step "5/8  Docker (official repo, not the snap)"
# The Docker snap sandboxes volume access in ways that break bind mounts for
# this stack. Always use the official apt repo.
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
usermod -aG docker "$REAL_USER"
systemctl enable --now docker >/dev/null 2>&1 || true
ok "docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1), user '$REAL_USER' added to docker group"
warn "log out and back in before 'docker' works without sudo for $REAL_USER"

step "6/8  Cap Docker logs"
# Unbounded json-file logs will quietly consume the SSD over months.
install -d /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
  systemctl restart docker
  ok "log rotation set (10m x 3 per container)"
else
  warn "/etc/docker/daemon.json already exists -- left untouched, verify log-opts yourself"
fi

step "7/8  Security updates, but never automatic reboots"
# Security patches apply themselves; reboots stay manual and announced, because
# an unattended 3am reboot of the database is its own outage.
cat > /etc/apt/apt.conf.d/52-erp-unattended <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
ok "unattended-upgrades on, auto-reboot off"

step "8/8  Tailscale"
# Admin access (SSH, Supabase Studio) rides Tailscale and is never exposed to
# the internet. Only the public API goes through the Cloudflare tunnel later.
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1
fi
ok "tailscale installed"

cat <<'EOF'

────────────────────────────────────────────────────────────────────────
 Phase 1 base setup complete. Three things left, in this order:

 1. Connect Tailscale (opens a URL you authenticate in a browser):

        sudo tailscale up

 2. Note the Tailscale IP this machine gets:

        tailscale ip -4

 3. From your Mac, confirm SSH over Tailscale works:

        ssh <user>@<that-tailscale-ip>

 ONLY once step 3 succeeds, run the firewall script:

        sudo ./phase1-firewall.sh

 Do not run it before then. It denies all inbound traffic except Tailscale,
 so if Tailscale is not working you will lock yourself out of SSH and will
 need a physical keyboard and monitor to recover.
────────────────────────────────────────────────────────────────────────
EOF
