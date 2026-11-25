// The Auto Check script for a Mac, the macOS twin of script.ts:
//   Terminal:  curl -L erp.digitalbluez.com/mac | bash
// /mac (MAC_BOOTSTRAP below) asks for the 6-letter code, checks it, then runs
// this script from /q/<code>?os=mac.
//
// Built-in macOS tools only -- bash 3.2, curl, system_profiler, diskutil,
// ioreg, pmset, profiles, fdesetup, perl, shasum, osascript (JavaScript).
// Nothing is installed. The Mac's password, if given, is used locally by sudo
// for a few read-only checks and never leaves the Mac.
//
// It sends the same HardwareReport shape as the Windows script (platform:
// 'mac' plus a `mac` block) to the same /report, /live endpoints, so the
// rules, review screen and save are shared.
//
// Must stay ASCII, and must not contain a backtick or a dollar sign followed
// by a brace (this file's template-literal delimiters). In bash that means no
// brace-style variable expansion: plain $VAR, $(cmd) and arithmetic only.

const SCRIPT = String.raw`#!/bin/bash
BASE='__BASE__'
CODE='__CODE__'
HEAT=__HEAT__
QUICK=__QUICK__

T=$(mktemp -d /tmp/dbqc.XXXXXX) || exit 1
BGPID=''
KEEPPID=''
CAFPID=''
cleanup() {
  if [ -n "$BGPID" ]; then pkill -P "$BGPID" 2>/dev/null; kill "$BGPID" 2>/dev/null; fi
  if [ -n "$KEEPPID" ]; then kill "$KEEPPID" 2>/dev/null; fi
  if [ -n "$CAFPID" ]; then kill "$CAFPID" 2>/dev/null; fi
  rm -rf "$T"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

say()  { printf '%s\n' "$1"; }
good() { printf '\033[32m%s\033[0m\n' "$1"; }
warn() { printf '\033[33m%s\033[0m\n' "$1"; }
bad()  { printf '\033[31m%s\033[0m\n' "$1"; }
now()  { perl -MTime::HiRes=time -e 'printf "%.3f", time' 2>/dev/null || date +%s; }
jesc() { printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
# post PATH FILE -> HTTP status on stdout, response body in $T/resp
post() { curl -s -m 30 -o "$T/resp" -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "@$2" "$BASE$1" 2>/dev/null || printf '000'; }

say ''
say '  DB Auto Check (Mac)'
say ''

# ---------------------------------------------------------------- password
ADMIN=0
if [ "$QUICK" != 1 ]; then
  say "  Type this Mac's login password and press Enter. It stays on this Mac."
  say '  (Just press Enter to skip - a few checks will then say "could not check".)'
  printf '  Password: '
  IFS= read -r -s PW </dev/tty
  printf '\n'
  if [ -n "$PW" ]; then
    if printf '%s\n' "$PW" | sudo -S -v -p '' 2>/dev/null; then ADMIN=1; good '  Password OK.'; else warn '  Wrong password - continuing without it.'; fi
  fi
  PW=''
fi
if [ "$ADMIN" = 1 ]; then
  ( while true; do sudo -n -v 2>/dev/null; sleep 50; done ) &
  KEEPPID=$!
fi
caffeinate -dimsu -w $$ &
CAFPID=$!

# ---------------------------------------------------------------- 1. facts
say ''
say '[1/3] Reading this Mac (about 20 seconds)...'
system_profiler -json SPHardwareDataType SPPowerDataType SPDisplaysDataType SPCameraDataType SPBluetoothDataType SPAirPortDataType SPSoftwareDataType > "$T/sp.json" 2>/dev/null
diskutil info disk0 > "$T/disk0.txt" 2>/dev/null
ioreg -rn AppleSmartBattery > "$T/batt.txt" 2>/dev/null
profiles status -type enrollment > "$T/enroll.txt" 2>&1
fdesetup status > "$T/fv.txt" 2>&1
nvram fmm-mobileme-token-FMM > "$T/fmm.txt" 2>&1
sw_vers -productVersion > "$T/osver.txt" 2>/dev/null
sysctl -n machdep.cpu.brand_string > "$T/cpu.txt" 2>/dev/null
sysctl -n hw.physicalcpu > "$T/pcpu.txt" 2>/dev/null
sysctl -n hw.logicalcpu > "$T/lcpu.txt" 2>/dev/null
sysctl -n hw.memsize > "$T/mem.txt" 2>/dev/null
networksetup -listallhardwareports > "$T/ports.txt" 2>/dev/null
find /Library/Logs/DiagnosticReports -maxdepth 2 -mtime -90 -name '*.panic' 2>/dev/null | wc -l | tr -d ' ' > "$T/panics.txt"
pmset -g batt > "$T/pmset.txt" 2>/dev/null
if [ "$ADMIN" = 1 ]; then
  sudo -n profiles show -type enrollment > "$T/dep.txt" 2>&1
  if grep -qi intel "$T/cpu.txt"; then sudo -n firmwarepasswd -check > "$T/fw.txt" 2>&1; fi
fi

cat > "$T/collect.js" <<'JS'
ObjC.import('Foundation');
function rd(p) { var s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null); return (s && !s.isNil()) ? s.js : ''; }
function num(x) { var n = parseFloat(String(x == null ? '' : x).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; }
function grab(text, re) { var m = String(text || '').match(re); return m ? m[1].trim() : null; }
function run(argv) {
  var T = argv[0], admin = argv[1] === '1';
  var sp = {}; try { sp = JSON.parse(rd(T + '/sp.json')); } catch (e) {}
  function list(k) { return (sp[k] && sp[k].length) ? sp[k] : []; }
  var hw = list('SPHardwareDataType')[0] || {};
  var sw = list('SPSoftwareDataType')[0] || {};
  var chip = hw.chip_type || '';
  var cpuBrand = rd(T + '/cpu.txt').trim();
  var intel = !chip && /intel/i.test(cpuBrand + ' ' + (hw.cpu_type || ''));
  var r = { v: 1, platform: 'mac', is_admin: admin };
  r.system = { manufacturer: 'Apple Inc.', model: hw.machine_name || 'Mac', family: hw.machine_model || '' };
  r.bios = { serial: hw.serial_number || '', version: hw.boot_rom_version || '', vendor: 'Apple' };
  r.cpu = [{ name: chip || cpuBrand || hw.cpu_type || '', cores: num(rd(T + '/pcpu.txt')), threads: num(rd(T + '/lcpu.txt')) }];
  var memBytes = num(rd(T + '/mem.txt'));
  r.memory = memBytes ? [{ slot: 'Built-in', gb: Math.round(memBytes / 1073741824) }] : [];
  r.memory_slots = null;

  var d0 = rd(T + '/disk0.txt');
  var size = num(grab(d0, /Disk Size:.*?\((\d+) Bytes\)/));
  var smart = grab(d0, /SMART Status:\s*(.+)/);
  r.disks = size ? [{
    name: grab(d0, /Device \/ Media Name:\s*(.+)/) || 'Apple SSD',
    media_type: /Solid State:\s*Yes/.test(d0) ? 'SSD' : 'HDD',
    bus_type: grab(d0, /Protocol:\s*(.+)/) || 'internal',
    health: smart && /verified/i.test(smart) ? 'Healthy' : (smart || ''),
    size_bytes: size, wear: null
  }] : [];

  r.gpus = []; r.monitors = [];
  list('SPDisplaysDataType').forEach(function (g) {
    var vram = String(g.spdisplays_vram || g._spdisplays_vram || '');
    var vm = vram.match(/([\d.]+)\s*(GB|MB)/i);
    var entry = { name: g.sppci_model || g._name || '', status: 'OK', h_res: 0, v_res: 0,
      vram_bytes: vm ? parseFloat(vm[1]) * (vm[2].toUpperCase() === 'GB' ? 1073741824 : 1048576) : null };
    (g.spdisplays_ndrvs || []).forEach(function (s) {
      var internal = s.spdisplays_connection_type === 'spdisplays_internal' || /built-?in/i.test(String(s.spdisplays_display_type || ''));
      var px = String(s._spdisplays_pixels || s.spdisplays_pixelresolution || '').match(/(\d+)\s*x\s*(\d+)/);
      if (internal && px) { entry.h_res = +px[1]; entry.v_res = +px[2]; }
      r.monitors.push({ name: s._name || '', internal: !!internal });
    });
    r.gpus.push(entry);
  });

  r.touch = false;
  // Built-in cameras only: not an iPhone's Continuity Camera, Desk View or virtual ones.
  r.cameras = list('SPCameraDataType').map(function (c) { return c._name || 'Camera'; }).filter(function (n) { return !/iphone|continuity|desk view|virtual|obs/i.test(n); });
  r.biometric = [];

  var bt = list('SPBluetoothDataType')[0] || {};
  var cp = bt.controller_properties || bt.local_device_title || null;
  r.bluetooth = cp ? [{ name: 'Bluetooth ' + (cp.controller_chipset || ''), status: /_on$/i.test(String(cp.controller_state || cp.general_power || '')) ? 'OK' : 'Off' }] : [];

  r.net = [];
  var ifs = ((list('SPAirPortDataType')[0] || {}).spairport_airport_interfaces) || [];
  var wifi = ifs.filter(function (i) { return i.spairport_wireless_card_type; })[0];
  if (wifi) {
    var st = String(wifi.spairport_status_information || '');
    r.net.push({ name: wifi._name || 'en0', description: 'Wi-Fi', status: /off/i.test(st) ? 'Disabled' : 'Up', media: 'wifi' });
    r.wifi_networks = (wifi.spairport_airport_other_local_wireless_networks || []).length + (wifi.spairport_current_network_information ? 1 : 0);
  }
  var lan = grab(rd(T + '/ports.txt'), /Hardware Port: Ethernet\n\s*Device:\s*(\S+)/);
  if (lan) r.net.push({ name: lan, description: 'Ethernet', status: '?', media: 'ethernet' });

  var batt = rd(T + '/batt.txt');
  var pw = list('SPPowerDataType').filter(function (p) { return p._name === 'spbattery_information'; })[0];
  var hi = (pw && pw.sppower_battery_health_info) || {};
  var design = num(grab(batt, /"DesignCapacity" = (\d+)/));
  var rawMax = num(grab(batt, /"AppleRawMaxCapacity" = (\d+)/));
  if (rawMax == null) { var mc = num(grab(batt, /"MaxCapacity" = (\d+)/)); if (mc != null && mc > 200) rawMax = mc; }
  r.battery = (pw || design) ? {
    present: true,
    name: (pw && pw.sppower_battery_model_info && pw.sppower_battery_model_info.sppower_battery_device_name) || '',
    manufacturer: grab(batt, /"Manufacturer" = "([^"]*)"/) || '',
    design_mwh: design, full_mwh: rawMax,
    cycles: num(hi.sppower_battery_cycle_count != null ? hi.sppower_battery_cycle_count : grab(batt, /"CycleCount" = (\d+)/))
  } : null;

  var pm = rd(T + '/pmset.txt');
  r.power = { on_ac: /AC Power/.test(pm), percent: num(grab(pm, /(\d+)%/)) };
  r.os = { caption: 'macOS', version: rd(T + '/osver.txt').trim(), build: grab(sw.os_version || '', /\((\w+)\)/) };
  r.events = []; r.problem_devices = [];

  var al = String(hw.activation_lock_status || '');
  var fmm = rd(T + '/fmm.txt');
  var enroll = rd(T + '/enroll.txt');
  var dep = rd(T + '/dep.txt');
  var fw = rd(T + '/fw.txt');
  var fv = rd(T + '/fv.txt');
  r.mac = {
    model_identifier: hw.machine_model || '',
    model_number: hw.model_number || '',
    chip: chip,
    intel: intel,
    activation_lock: /enabled/i.test(al) ? 'enabled' : /disabled/i.test(al) ? 'disabled' : null,
    find_my_token: /fmm-mobileme-token-FMM\s+\S/.test(fmm) ? true : /error|not found/i.test(fmm) ? false : null,
    dep: /Enrolled via DEP:\s*Yes/i.test(enroll) ? true : /Enrolled via DEP:\s*No/i.test(enroll) ? false : null,
    mdm: /MDM enrollment:\s*Yes/i.test(enroll) ? true : /MDM enrollment:\s*No/i.test(enroll) ? false : null,
    dep_assigned: !admin ? null : /ConfigurationURL|OrganizationName|IsMDMUnremovable/i.test(dep) ? true : /not DEP enabled|\(null\)|No Device Enrollment|Device Enrollment configuration:\s*$/i.test(dep) ? false : null,
    firmware_password: (!intel || !admin) ? null : /Password Enabled:\s*Yes/i.test(fw) ? true : /Password Enabled:\s*No/i.test(fw) ? false : null,
    filevault: /FileVault is On/i.test(fv) ? true : /FileVault is Off/i.test(fv) ? false : null,
    smart_status: smart,
    battery_condition: hi.sppower_battery_health || null,
    max_capacity_pct: num(hi.sppower_battery_health_maximum_capacity),
    panics_90d: num(rd(T + '/panics.txt'))
  };
  return JSON.stringify(r);
}
JS
osascript -l JavaScript "$T/collect.js" "$T" "$ADMIN" > "$T/report.json" 2>"$T/collect.err"
if [ ! -s "$T/report.json" ]; then
  bad '  Could not read this Mac:'
  head -3 "$T/collect.err"
  exit 1
fi
HC=$(post "/api/qc-agent/$CODE/report" "$T/report.json")
if [ "$HC" = 410 ] || [ "$HC" = 404 ]; then bad '  This code is no longer valid (already saved or expired). Start a new Auto Check in the ERP.'; exit 1; fi
if [ "$HC" != 200 ]; then bad "  Could not send the results to the ERP (error $HC). Check the internet and run the line again."; exit 1; fi
good "  Sent. Found: $(sysctl -n hw.model 2>/dev/null), serial $(sed -n 's/.*"serial":"\([^"]*\)".*/\1/p' "$T/report.json" | head -1)"

# ---------------------------------------------------------------- 2. test page
say ''
say '[2/3] Opening the test page in the browser...'
open "$BASE/qc-test/$CODE"
say '  Do the steps on that page. Keep this window open.'

# ---------------------------------------------------------------- 3. background tests
cat > "$T/ram.pl" <<'PL'
use strict; use Time::HiRes qw(time);
my ($mb, $secs, $bg) = @ARGV;
my $blk = 1048576; my $per = $mb < 256 ? $mb : 256;
sub prog { my $p = shift; if (open(my $f, '>', "$bg.tmp")) { print $f '{"stage":"ram","stage_progress":' . $p . '}'; close $f; rename("$bg.tmp", $bg); } }
my @c; my $want = int($mb / $per); $want = 1 if $want < 1;
for (1 .. $want) { my $s = eval { "\0" x ($per * $blk) }; last unless defined $s; push @c, $s; }
my ($t0, $err, $passes) = (time, 0, 0);
srand(time);
while (time - $t0 < $secs) {
  $passes++;
  my $b = pack('L*', map { int(rand(4294967296)) } 1 .. ($blk / 4));
  $b = ~$b if $passes % 2 == 0;
  $_ = $b x $per for @c;
  for my $s (@c) { for (my $o = 0; $o < length($s); $o += $blk) { $err++ if substr($s, $o, $blk) ne $b; } }
  my $p = int(100 * (time - $t0) / $secs); prog($p > 99 ? 99 : $p);
}
printf '{"tested_mb":%d,"passes":%d,"errors":%d,"seconds":%d,"error":null}', scalar(@c) * $per, $passes, $err, int(time - $t0);
PL

bgw() { printf '%s' "$1" > "$T/bg.tmp" && mv "$T/bg.tmp" "$T/bg.json"; }

background() {
  PAGESZ=$(sysctl -n hw.pagesize)
  FREEP=$(vm_stat | awk '/Pages free|Pages inactive|Pages speculative/ { gsub(/\./, "", $NF); s += $NF } END { printf "%d", s }')
  MB=$(( FREEP * PAGESZ / 1048576 * 6 / 10 ))
  [ "$MB" -gt 16384 ] && MB=16384
  [ "$MB" -lt 256 ] && MB=256
  SECS=240
  if [ "$QUICK" = 1 ]; then MB=256; SECS=10; fi
  bgw '{"stage":"ram","stage_progress":0}'
  RAMJ=$(perl "$T/ram.pl" "$MB" "$SECS" "$T/bg.json" 2>/dev/null)
  [ -z "$RAMJ" ] && RAMJ='{"error":"the RAM test could not run (perl missing or out of memory)"}'

  HEATJ='{"skipped":true}'
  if [ "$HEAT" = 1 ]; then
    bgw "{\"stage\":\"heat\",\"stage_progress\":0,\"ram\":$RAMJ}"
    N=$(sysctl -n hw.logicalcpu)
    PIDS=''
    i=0
    while [ "$i" -lt "$N" ]; do yes > /dev/null & PIDS="$PIDS $!"; i=$((i + 1)); done
    DUR=180
    [ "$QUICK" = 1 ] && DUR=20
    START=$(date +%s)
    S=''
    ONAC=true
    EL=0
    while :; do
      sleep 5
      EL=$(( $(date +%s) - START ))
      UTIL=$(ps -A -o %cpu= | awk -v n="$N" '{ s += $1 } END { printf "%d", s / n }')
      PERF=null
      PRESS=null
      L=$(pmset -g therm 2>/dev/null | awk -F'= ' '/CPU_Speed_Limit/ { print $2 }' | tr -d ' ')
      [ -n "$L" ] && PERF=$L
      if [ "$ADMIN" = 1 ] && [ -z "$L" ]; then
        P=$(sudo -n powermetrics -n 1 -i 1000 --samplers thermal 2>/dev/null | awk -F': ' '/pressure level/ { print $2 }' | tr -d ' ')
        [ -n "$P" ] && PRESS="\"$P\""
      fi
      pmset -g batt | grep -q 'AC Power' || ONAC=false
      [ -n "$S" ] && S="$S,"
      S="$S{\"t\":$EL,\"perf\":$PERF,\"util\":$UTIL,\"pressure\":$PRESS}"
      bgw "{\"stage\":\"heat\",\"stage_progress\":$(( EL * 100 / DUR )),\"ram\":$RAMJ}"
      [ "$EL" -ge "$DUR" ] && break
    done
    kill $PIDS 2>/dev/null
    HEATJ="{\"seconds\":$EL,\"on_ac\":$ONAC,\"samples\":[$S]}"
  fi

  bgw "{\"stage\":\"disk\",\"stage_progress\":0,\"ram\":$RAMJ,\"heat\":$HEATJ}"
  DMB=2048
  [ "$QUICK" = 1 ] && DMB=64
  FREEMB=$(df -m "$T" | awk 'NR == 2 { print $4 }')
  if [ "$FREEMB" -lt $(( DMB + 2048 )) ]; then
    DISKJ="{\"skipped_reason\":\"not enough free space ($FREEMB MB free)\"}"
  else
    T1=$(now)
    H1=$(dd if=/dev/urandom bs=1048576 count=$DMB 2>/dev/null | tee "$T/disk.bin" | shasum -a 256 | awk '{ print $1 }')
    sync
    T2=$(now)
    FL=false
    if [ "$ADMIN" = 1 ] && sudo -n purge 2>/dev/null; then FL=true; fi
    T3=$(now)
    H2=$(shasum -a 256 "$T/disk.bin" 2>/dev/null | awk '{ print $1 }')
    T4=$(now)
    rm -f "$T/disk.bin"
    W=$(perl -e "printf '%d', $DMB / (($T2 - $T1) || 0.001)")
    R=$(perl -e "printf '%d', $DMB / (($T4 - $T3) || 0.001)")
    MIS=0
    [ "$H1" != "$H2" ] && MIS=1
    IOE=0
    if [ -z "$H1" ] || [ -z "$H2" ]; then IOE=1; fi
    DISKJ="{\"mb\":$DMB,\"write_mbps\":$W,\"read_mbps\":$R,\"mismatches\":$MIS,\"io_errors\":$IOE,\"cache_flushed\":$FL}"
  fi
  bgw "{\"stage\":\"done\",\"stage_progress\":100,\"ram\":$RAMJ,\"heat\":$HEATJ,\"disk\":$DISKJ}"
}

say ''
if [ "$HEAT" = 1 ]; then
  say '[3/3] Background tests running: RAM (4 min), heat (3 min), disk (1-2 min).'
  say '  Keep the charger plugged in during the heat test.'
else
  say '[3/3] Background tests running: RAM (4 min), disk (1-2 min).'
fi
bgw '{"stage":"ram","stage_progress":0}'
background &
BGPID=$!

# ---------------------------------------------------------------- live loop
usbnow() { ioreg -p IOUSB -w0 2>/dev/null | sed -n 's/^[ |]*+-o \(.*\)@\([0-9a-fA-F]*\)  *<class IOUSB[A-Za-z]*Device,.*/\2|\1/p'; }
usbnow > "$T/usb0.txt"
LANDEV=$(awk '/^Hardware Port: Ethernet$/ { getline; print $2 }' "$T/ports.txt" | head -1)
HASBATT=0
grep -q DesignCapacity "$T/batt.txt" && HASBATT=1
LOOPS=0
MONS=1
DSTART=''
DPCT=0
BACKUP=''
FIN=0
LAST=''
END=$(( $(date +%s) + 3600 ))
while [ "$(date +%s)" -lt "$END" ]; do
  LOOPS=$((LOOPS + 1))
  USBJ=''
  usbnow > "$T/usb.txt"
  while IFS='|' read -r LOC NAME; do
    [ -z "$LOC" ] && continue
    grep -Fqx "$LOC|$NAME" "$T/usb0.txt" && continue
    [ -n "$USBJ" ] && USBJ="$USBJ,"
    USBJ="$USBJ{\"id\":\"$LOC\",\"name\":\"$(jesc "$NAME")\",\"path\":\"$LOC\"}"
  done < "$T/usb.txt"
  if [ $((LOOPS % 3)) = 1 ]; then MONS=$(system_profiler SPDisplaysDataType 2>/dev/null | grep -c 'Resolution:'); fi
  PM=$(pmset -g batt 2>/dev/null)
  ONAC=false
  printf '%s' "$PM" | grep -q 'AC Power' && ONAC=true
  PCT=$(printf '%s' "$PM" | grep -o '[0-9]*%' | head -1 | tr -d '%')
  [ -z "$PCT" ] && PCT=null
  LAN=null
  if [ -n "$LANDEV" ]; then LAN=false; ifconfig "$LANDEV" 2>/dev/null | grep -q 'status: active' && LAN=true; fi
  STAGE=$(sed -n 's/.*"stage":"\([a-z]*\)".*/\1/p' "$T/bg.json" 2>/dev/null)

  # Battery backup estimate from any 8+ minute stretch unplugged (not during the heat test).
  if [ "$HASBATT" = 1 ] && [ "$ONAC" = false ] && [ "$STAGE" != heat ] && [ "$PCT" != null ]; then
    if [ -z "$DSTART" ]; then DSTART=$(date +%s); DPCT=$PCT
    else
      MINS=$(( ($(date +%s) - DSTART) / 60 ))
      DROP=$(( DPCT - PCT ))
      if [ "$MINS" -ge 8 ] && [ "$DROP" -ge 2 ]; then
        BACKUP=$(perl -e "printf '{\"minutes\":%d,\"percent_drop\":%d,\"hours\":%.1f}', $MINS, $DROP, 100 * $MINS / 60 / $DROP")
      fi
    fi
  else DSTART=''; fi

  BG=$(cat "$T/bg.json" 2>/dev/null)
  [ -z "$BG" ] && BG=null
  if [ -n "$BACKUP" ] && [ "$BG" != null ]; then BG=$(printf '%s' "$BG" | sed 's/}$/,"backup":'"$BACKUP"'}/'); fi
  printf '{"live":{"usb":[%s],"monitors_active":%s,"ethernet_up":%s,"on_ac":%s,"battery_percent":%s},"background":%s}' \
    "$USBJ" "$MONS" "$LAN" "$ONAC" "$PCT" "$BG" > "$T/live.json"
  HC=$(post "/api/qc-agent/$CODE/live" "$T/live.json")
  if [ "$HC" = 410 ]; then say ''; good '  This check was saved in the ERP.'; break; fi

  if [ "$STAGE" != "$LAST" ]; then
    case "$STAGE" in
      "heat") say '  RAM test done. Heat test running...' ;;
      "disk") say '  Disk test running...' ;;
      "done") good '  All background tests done.' ;;
    esac
    LAST=$STAGE
  fi
  # Keep reporting for 2 more minutes after everything is finished, then stop.
  if [ "$STAGE" = "done" ] && grep -q '"page_finished":true' "$T/resp" 2>/dev/null; then
    [ "$FIN" = 0 ] && FIN=$(date +%s)
    [ $(( $(date +%s) - FIN )) -gt 120 ] && break
  fi
  sleep 3
done
say ''
good 'Auto Check is finished on this Mac. Review and save on your ERP screen. You can close this window.'
`

// /mac -- the fixed line for every Mac. Asks for the code (re-asks on a typo),
// checks it, then fetches and runs that code's Mac script.
const BOOTSTRAP = String.raw`#!/bin/bash
BASE='__BASE__'
printf '\n  DB Auto Check (Mac)\n  On your phone: New Entry > Auto Check > Start. It shows a 6-letter code.\n\n'
while :; do
  printf '  Type the code and press Enter: '
  IFS= read -r C </dev/tty || exit 1
  C=$(printf '%s' "$C" | tr -cd 'A-Za-z0-9' | tr 'a-z' 'A-Z')
  if [ "$(printf '%s' "$C" | wc -c | tr -d ' ')" != 6 ]; then printf '\033[33m  The code has 6 letters/numbers. Try again.\033[0m\n'; continue; fi
  A=$(curl -s -m 20 "$BASE/q/$C?check=1")
  if [ -z "$A" ]; then printf '\033[33m  Cannot reach the ERP. Check the Wi-Fi / internet and try again.\033[0m\n'; continue; fi
  [ "$A" = OK ] && break
  printf '\033[33m  %s\033[0m\n' "$A"
done
printf '\033[32m  Code %s OK - starting.\033[0m\n' "$C"
F=$(mktemp /tmp/dbqc-agent.XXXXXX) || exit 1
if curl -s -m 60 -o "$F" "$BASE/q/$C?os=mac"; then bash "$F"; fi
rm -f "$F"
`

const safe = (base: string) => base.replace(/['"\\$\s]/g, '')

export function buildMacScript(opts: { base: string; code: string; heatTest: boolean; quick?: boolean }): string {
  return SCRIPT
    .replace('__BASE__', safe(opts.base))
    .replace(/__CODE__/g, opts.code)
    .replace('__HEAT__', opts.heatTest ? '1' : '0')
    .replace('__QUICK__', opts.quick ? '1' : '0')
}

export function buildMacBootstrap(base: string): string {
  return BOOTSTRAP.replace('__BASE__', safe(base))
}

/** The line typed in Terminal, without the scheme (curl -L follows the https redirect). */
export function macCommand(origin: string): string {
  return `curl -L ${origin.replace(/^https?:\/\//, '')}/mac | bash`
}
