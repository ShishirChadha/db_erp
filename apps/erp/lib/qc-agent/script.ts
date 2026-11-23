// The PowerShell the laptop being checked runs, via
//   irm https://erp.digitalbluez.com/q/ABC123 | iex
//
// Served by app/q/[code]/route.ts with the ERP's URL, the code and the run's
// options filled in. Written for Windows PowerShell 5.1 (what every Windows
// 10/11 install has): no ternaries, no ?? , no -Parallel. Everything runs
// inside one & { } block so `return` stops the script without closing the
// window, and nothing leaks into the engineer's PowerShell session.
//
// Phases:
//   1. collect hardware facts and lock/repair signals, upload them (~40 s)
//   2. open the /qc-test page in the laptop's browser
//   3. a background job runs RAM test -> heat test -> disk test (~10 min)
//      while a loop reports what's plugged in every 3 s (USB ports, monitor,
//      LAN, charger) and runs the brightness sweep when the page asks.
//
// Must stay ASCII and must not contain a backtick (PowerShell's escape
// character, and this file's template-literal delimiter) or a dollar sign
// followed by a brace.

const SCRIPT = String.raw`
& {
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$Base = '__BASE__'
$Code = '__CODE__'
$HeatTest = __HEAT__

function Say($text, $color) { if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text } }
function Q([scriptblock]$b) { try { & $b } catch { $null } }
function N($x) { if ($null -eq $x -or "$x" -eq '') { $null } else { [double]$x } }
function Post($path, $obj) {
  $json = ConvertTo-Json -InputObject $obj -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  try {
    Invoke-RestMethod -Uri ($Base + $path) -Method Post -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 -UseBasicParsing
  } catch {
    # 410: the engineer already saved this check (or the code expired) -- stop.
    $status = 0
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    if ($status -eq 410) { return [pscustomobject]@{ stop = $true; gone = $true } }
    $msg = $_.Exception.Message
    try { $msg = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    Say ('  Upload problem: ' + $msg) Yellow
    $null
  }
}

Clear-Host
Say '==============================================' Cyan
Say ('  Digitalbluez ERP - Auto Check   code ' + $Code) Cyan
Say '==============================================' Cyan
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Say 'NOT running as administrator.' Yellow
  Say 'Disk wear, BitLocker and security-chip checks will be skipped.' Yellow
  Say 'For a full check: close this, press Win+X, choose Terminal (Admin), and run the line again.' Yellow
  Start-Sleep -Seconds 4
}

# ---------------------------------------------------------------- 1. facts
Say ''
Say '[1/3] Reading hardware details (about 40 seconds)...'
Add-Type -AssemblyName System.Windows.Forms

$cs    = Q { Get-CimInstance Win32_ComputerSystem }
$csp   = Q { Get-CimInstance Win32_ComputerSystemProduct }
$bios  = Q { Get-CimInstance Win32_BIOS }
$board = Q { Get-CimInstance Win32_BaseBoard }
$encl  = Q { Get-CimInstance Win32_SystemEnclosure }
$osi   = Q { Get-CimInstance Win32_OperatingSystem }
$cv    = Q { Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' }

$r = [ordered]@{ v = 1; is_admin = $isAdmin }
$r.system = [ordered]@{
  manufacturer = "$($cs.Manufacturer)".Trim(); model = "$($cs.Model)".Trim(); version = "$($csp.Version)".Trim()
  family = "$($cs.SystemFamily)".Trim(); pc_system_type = [int]$cs.PCSystemType
  chassis_types = @($encl.ChassisTypes | ForEach-Object { [int]$_ })
}
$biosDate = $null
if ($bios.ReleaseDate) { $biosDate = ([datetime]$bios.ReleaseDate).ToString('yyyy-MM-dd') }
$r.bios = [ordered]@{ serial = "$($bios.SerialNumber)".Trim(); version = "$($bios.SMBIOSBIOSVersion)".Trim(); release_date = $biosDate; vendor = "$($bios.Manufacturer)".Trim() }
$r.board = [ordered]@{ manufacturer = "$($board.Manufacturer)".Trim(); product = "$($board.Product)".Trim(); serial = "$($board.SerialNumber)".Trim() }
$r.enclosure_serial = "$($encl.SerialNumber)".Trim()

$r.cpu = @(Q { Get-CimInstance Win32_Processor } | ForEach-Object {
  [ordered]@{ name = "$($_.Name)".Trim(); cores = [int]$_.NumberOfCores; threads = [int]$_.NumberOfLogicalProcessors; max_mhz = [int]$_.MaxClockSpeed }
})
$r.memory = @(Q { Get-CimInstance Win32_PhysicalMemory } | ForEach-Object {
  [ordered]@{ slot = "$($_.DeviceLocator)".Trim(); gb = [math]::Round([double]$_.Capacity / 1GB, 1); speed = [int]$_.Speed
    configured_speed = [int]$_.ConfiguredClockSpeed; manufacturer = "$($_.Manufacturer)".Trim(); part_number = "$($_.PartNumber)".Trim() }
})
$slotSum = (@(Q { Get-CimInstance Win32_PhysicalMemoryArray }) | Measure-Object -Property MemoryDevices -Sum).Sum
$r.memory_slots = N $slotSum

$r.disks = @(Q { Get-PhysicalDisk } | ForEach-Object {
  $d = $_
  $rc = $null
  if ($isAdmin) { $rc = Q { $d | Get-StorageReliabilityCounter } }
  [ordered]@{
    name = "$($d.FriendlyName)".Trim(); media_type = "$($d.MediaType)"; bus_type = "$($d.BusType)"
    health = "$($d.HealthStatus)"; operational = "$($d.OperationalStatus)"; size_bytes = [double]$d.Size
    wear = (N $rc.Wear); temperature = (N $rc.Temperature); temperature_max = (N $rc.TemperatureMax)
    read_errors_uncorrected = (N $rc.ReadErrorsUncorrected); write_errors_uncorrected = (N $rc.WriteErrorsUncorrected)
    read_errors_total = (N $rc.ReadErrorsTotal); power_on_hours = (N $rc.PowerOnHours)
  }
})

$r.gpus = @(Q { Get-CimInstance Win32_VideoController } | ForEach-Object {
  [ordered]@{ name = "$($_.Name)".Trim(); driver_version = "$($_.DriverVersion)"; status = "$($_.Status)"
    h_res = [int]$_.CurrentHorizontalResolution; v_res = [int]$_.CurrentVerticalResolution }
})

function Dec($a) { if (-not $a) { return '' }; ((@($a) | Where-Object { $_ -ne 0 } | ForEach-Object { [char][int]$_ }) -join '').Trim() }
$monIds   = @(Q { Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID })
$monBasic = @(Q { Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams })
$monConn  = @(Q { Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorConnectionParams })
$r.monitors = @($monIds | ForEach-Object {
  $m = $_
  $b = $monBasic | Where-Object { $_.InstanceName -eq $m.InstanceName } | Select-Object -First 1
  $c = $monConn | Where-Object { $_.InstanceName -eq $m.InstanceName } | Select-Object -First 1
  $tech = -99
  if ($c) { $tech = [int64]$c.VideoOutputTechnology }
  [ordered]@{
    maker_code = (Dec $m.ManufacturerName); product_code = (Dec $m.ProductCodeID); serial = (Dec $m.SerialNumberID)
    name = (Dec $m.UserFriendlyName); year = [int]$m.YearOfManufacture; week = [int]$m.WeekOfManufacture
    width_cm = [int]$b.MaxHorizontalImageSize; height_cm = [int]$b.MaxVerticalImageSize
    internal = (@(6, 11, 13, 2147483648, -2147483648) -contains $tech)
  }
})

$pnp = @(Q { Get-PnpDevice -PresentOnly })
$r.touch = @($pnp | Where-Object { $_.Class -eq 'HIDClass' -and $_.FriendlyName -match 'touch ?screen' }).Count -gt 0
$r.cameras = @($pnp | Where-Object { $_.Class -eq 'Camera' -or $_.Class -eq 'Image' } | ForEach-Object { "$($_.FriendlyName)" })
$r.biometric = @($pnp | Where-Object { $_.Class -eq 'Biometric' } | ForEach-Object { "$($_.FriendlyName)" })
$r.bluetooth = @($pnp | Where-Object { $_.Class -eq 'Bluetooth' -and ($_.InstanceId -like 'USB\*' -or $_.InstanceId -like 'PCI\*' -or $_.InstanceId -like 'UART\*' -or $_.InstanceId -like 'ACPI\*') } |
  ForEach-Object { [ordered]@{ name = "$($_.FriendlyName)"; status = "$($_.Status)" } })

$r.net = @(Q { Get-NetAdapter -Physical } | ForEach-Object {
  $media = 'other'
  if ("$($_.PhysicalMediaType)" -match '802\.11|Wireless') { $media = 'wifi' } elseif ("$($_.PhysicalMediaType)" -match '802\.3') { $media = 'ethernet' }
  [ordered]@{ name = "$($_.Name)"; description = "$($_.InterfaceDescription)"; status = "$($_.Status)"; media = $media }
})
$wl = Q { (netsh wlan show networks mode=bssid) -join [Environment]::NewLine }
if ($wl -and $wl -match 'SSID') {
  $r.wifi_networks = ([regex]::Matches($wl, '(?m)^SSID \d+ :')).Count
  $sig = @([regex]::Matches($wl, 'Signal\s*:\s*(\d+)%') | ForEach-Object { [int]$_.Groups[1].Value })
  if ($sig.Count) { $r.wifi_best_signal = ($sig | Measure-Object -Maximum).Maximum }
} elseif (@($r.net | Where-Object { $_.media -eq 'wifi' }).Count) { $r.wifi_networks = 0 }

# Battery: powercfg's XML report carries design vs full-charge capacity.
$r.battery = $null
if (Q { Get-CimInstance Win32_Battery }) {
  $xmlPath = Join-Path $env:TEMP 'dbqc_battery.xml'
  Q { powercfg /batteryreport /xml /output $xmlPath | Out-Null }
  $bx = Q { [xml](Get-Content $xmlPath -Raw) }
  $bats = @($bx.BatteryReport.Batteries.Battery)
  $first = $bats | Select-Object -First 1
  $design = 0; $full = 0
  foreach ($bt in $bats) { $design += [double]$bt.DesignCapacity; $full += [double]$bt.FullChargeCapacity }
  $cycles = $null
  if ($first -and "$($first.CycleCount)" -ne '') { $cycles = [int]$first.CycleCount }
  $r.battery = [ordered]@{
    present = $true; name = "$($first.Id)".Trim(); manufacturer = "$($first.Manufacturer)".Trim(); serial = "$($first.SerialNumber)".Trim()
    chemistry = "$($first.Chemistry)".Trim(); design_mwh = (N $design); full_mwh = (N $full); cycles = $cycles
  }
  Q { Remove-Item $xmlPath -Force }
}

$installDate = $null
if ($osi.InstallDate) { $installDate = ([datetime]$osi.InstallDate).ToString('yyyy-MM-dd') }
$r.os = [ordered]@{ caption = "$($osi.Caption)".Trim(); version = "$($osi.Version)"; build = "$($osi.BuildNumber)"
  display_version = "$($cv.DisplayVersion)"; edition = "$($cv.EditionID)"; arch = "$($osi.OSArchitecture)"; install_date = $installDate }

$lic = @(Q { Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" })
$licensed = $null
if ($lic.Count) { $licensed = @($lic | Where-Object { $_.LicenseStatus -eq 1 }).Count -gt 0 }
$oemKey = "$((Q { Get-CimInstance SoftwareLicensingService }).OA3xOriginalProductKey)"
$r.activation = [ordered]@{ licensed = $licensed; oem_key_in_bios = ($oemKey.Length -gt 0) }

$ds = Q { (dsregcmd /status) -join [Environment]::NewLine }
$mdm = @(Q { Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Enrollments' } | Where-Object { (Q { (Get-ItemProperty $_.PSPath).ProviderID }) -eq 'MS DM Server' }).Count
$ap = Q { Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Provisioning\Diagnostics\Autopilot' }
$apTenant = "$($ap.CloudAssignedTenantDomain)"
if (-not $apTenant) { $apTenant = "$($ap.CloudAssignedTenantId)" }
$r.join = [ordered]@{
  azure_ad = ($ds -match 'AzureAdJoined\s*:\s*YES'); enterprise = ($ds -match 'EnterpriseJoined\s*:\s*YES')
  domain = [bool]$cs.PartOfDomain; workplace = ($ds -match 'WorkplaceJoined\s*:\s*YES')
  mdm_enrollments = $mdm; autopilot_tenant = $(if ($apTenant) { $apTenant } else { $null })
}

$bl = $null
if ($isAdmin) { $bl = Q { Get-BitLockerVolume -MountPoint $env:SystemDrive } }
if ($bl) {
  $r.bitlocker = [ordered]@{ protection_on = ("$($bl.ProtectionStatus)" -eq 'On'); volume_status = "$($bl.VolumeStatus)"; percent = (N $bl.EncryptionPercentage) }
} else {
  $shellState = Q { (New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive + '\').Self.ExtendedProperty('System.Volume.BitLockerProtection') }
  if ($null -ne $shellState) {
    $vs = 'Unknown'
    if ($shellState -eq 2) { $vs = 'FullyDecrypted' }
    $r.bitlocker = [ordered]@{ protection_on = (@(1, 3, 5) -contains [int]$shellState); volume_status = $vs; percent = $null }
  } else { $r.bitlocker = $null }
}

$tpm = $null
if ($isAdmin) { $tpm = Q { Get-Tpm } }
if ($tpm) {
  $spec = "$((Q { Get-CimInstance -Namespace root\cimv2\security\microsofttpm -ClassName Win32_Tpm }).SpecVersion)"
  $r.tpm = [ordered]@{ present = [bool]$tpm.TpmPresent; ready = [bool]$tpm.TpmReady; version = ($spec -split ',')[0].Trim() }
} else { $r.tpm = $null }
$sb = Q { (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State').UEFISecureBootEnabled }
$r.secure_boot = $(if ($null -eq $sb) { $null } else { [int]$sb -eq 1 })

# BIOS password: only Lenovo, HP and (newer) Dell expose it to Windows.
$bp = [ordered]@{ source = $null; set = $null; detail = $null }
$lp = Q { Get-CimInstance -Namespace root\wmi -ClassName Lenovo_BiosPasswordSettings }
if ($lp) { $bp.source = 'lenovo'; $bp.set = ([int]$lp.PasswordState -ne 0); $bp.detail = 'state ' + [int]$lp.PasswordState }
if ($null -eq $bp.set) {
  $hpw = @(Q { Get-CimInstance -Namespace root\HP\InstrumentedBIOS -ClassName HP_BIOSPassword })
  if ($hpw.Count) {
    $setOnes = @($hpw | Where-Object { [int]$_.IsSet -eq 1 } | ForEach-Object { "$($_.Name)" })
    $bp.source = 'hp'; $bp.set = ($setOnes.Count -gt 0); $bp.detail = ($setOnes -join ', ')
  }
}
if ($null -eq $bp.set) {
  $dpw = @(Q { Get-CimInstance -Namespace root\dcim\sysman\wmisecurity -ClassName PasswordObject })
  if ($dpw.Count) {
    $setOnes = @($dpw | Where-Object { [int]$_.IsPasswordSet -eq 1 } | ForEach-Object { "$($_.NameId)" })
    $bp.source = 'dell'; $bp.set = ($setOnes.Count -gt 0); $bp.detail = ($setOnes -join ', ')
  }
}
$r.bios_password = $bp

# Theft tracking (Computrace / Absolute): the Windows agent, the firmware
# injection slot (WPBT drops wpbbin.exe), and the brand's own BIOS setting.
$sys32 = Join-Path $env:windir 'System32'
$agent = (Test-Path (Join-Path $sys32 'rpcnet.exe')) -or (Test-Path (Join-Path $sys32 'rpcnetp.exe')) -or (@(Q { Get-Service -Name rpcnet, rpcnetp -ErrorAction SilentlyContinue }).Count -gt 0)
$states = @()
$states += @(Q { Get-CimInstance -Namespace root\wmi -ClassName Lenovo_BiosSetting } | Where-Object { "$($_.CurrentSetting)" -match 'Computrace|Absolute' } | ForEach-Object { "$($_.CurrentSetting)" })
$states += @(Q { Get-CimInstance -Namespace root\HP\InstrumentedBIOS -ClassName HP_BIOSSetting } | Where-Object { "$($_.Name)" -match 'Absolute|Computrace|Persistence' } | ForEach-Object { "$($_.Name)=$($_.CurrentValue)$($_.Value)" })
$states += @(Q { Get-CimInstance -Namespace root\dcim\sysman\biosattributes -ClassName EnumerationAttribute } | Where-Object { "$($_.AttributeName)" -match 'Absolute|Computrace' } | ForEach-Object { "$($_.AttributeName)=$($_.CurrentValue)" })
$r.computrace = [ordered]@{ windows_agent = $agent; wpbt_binary = (Test-Path (Join-Path $sys32 'wpbbin.exe')); bios_state = $(if ($states.Count) { $states -join '; ' } else { $null }) }

$r.problem_devices = @(Q { Get-CimInstance Win32_PnPEntity } | Where-Object { $_.ConfigManagerErrorCode -ne 0 -and $_.ConfigManagerErrorCode -ne 45 } |
  Select-Object -First 40 | ForEach-Object { [ordered]@{ name = "$($_.Name)"; class = "$($_.PNPClass)"; code = [int]$_.ConfigManagerErrorCode } })

$r.events = @(Q { Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41, 6008, 7, 51, 129, 153, 17, 18, 19, 47, 1001; StartTime = (Get-Date).AddDays(-90) } -MaxEvents 200 -ErrorAction Stop } |
  ForEach-Object { [ordered]@{ id = [int]$_.Id; provider = "$($_.ProviderName)"; time = $_.TimeCreated.ToString('s') } })

$ps = [System.Windows.Forms.SystemInformation]::PowerStatus
$r.power = [ordered]@{ on_ac = ("$($ps.PowerLineStatus)" -eq 'Online'); percent = [int]([double]$ps.BatteryLifePercent * 100) }

$resp = Post ('/api/qc-agent/' + $Code + '/report') $r
if (-not $resp -or $resp.gone) {
  Say ''
  if ($resp.gone) { Say 'This code is no longer valid (already saved or expired). Start a new Auto Check in the ERP.' Red }
  else { Say 'Could not send the results to the ERP. Check the internet connection and that the code is still valid, then run the line again.' Red }
  return
}
Say ('  Sent. Found: ' + $r.system.manufacturer + ' ' + $r.system.model + ', serial ' + $r.bios.serial) Green

# ---------------------------------------------------------------- 2. test page
Say ''
Say '[2/3] Opening the test page in the browser...'
Start-Process ($Base + '/qc-test/' + $Code)
Say '  Do the steps on that page. Keep this window open.'

# ---------------------------------------------------------------- 3. background tests
$csharp = @'
using System;
using System.IO;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class DbQc {
  public static volatile int Progress;
  public static volatile bool StopBurn;
  public static volatile string Error;
  public static long[] RamResult;
  public static double[] DiskResult;

  static ulong Next(ref ulong x) { x ^= x << 13; x ^= x >> 7; x ^= x << 17; return x; }

  // Fill most free RAM with a pseudo-random pattern, read it all back, repeat
  // with new seeds (alternate passes inverted) until the time budget is used.
  public static void StartRam(long targetBytes, int seconds) {
    RamResult = null; Error = null; Progress = 0;
    var th = new Thread(() => {
      try { RamResult = Ram(targetBytes, seconds); } catch (Exception e) { Error = e.Message; RamResult = new long[] { 0, 0, 0, 0 }; }
    });
    th.IsBackground = true; th.Start();
  }

  static long[] Ram(long targetBytes, int seconds) {
    const long CHUNK_BYTES = 64L * 1024 * 1024;
    var chunks = new List<long[]>();
    try {
      while ((chunks.Count + 1) * CHUNK_BYTES <= targetBytes) chunks.Add(new long[CHUNK_BYTES / 8]);
    } catch (OutOfMemoryException) {
      if (chunks.Count > 0) chunks.RemoveAt(chunks.Count - 1);
    }
    var sw = Stopwatch.StartNew();
    long errors = 0; int passes = 0;
    while (true) {
      ulong seed = 0x9E3779B97F4A7C15UL * (ulong)(passes + 1);
      bool invert = (passes % 2) == 1;
      for (int c = 0; c < chunks.Count; c++) {
        long[] a = chunks[c]; ulong x = seed ^ ((ulong)(c + 1) << 32);
        for (int i = 0; i < a.Length; i++) { long val = (long)Next(ref x); a[i] = invert ? ~val : val; }
      }
      for (int c = 0; c < chunks.Count; c++) {
        long[] a = chunks[c]; ulong x = seed ^ ((ulong)(c + 1) << 32);
        for (int i = 0; i < a.Length; i++) { long val = (long)Next(ref x); if (a[i] != (invert ? ~val : val)) errors++; }
      }
      passes++;
      Progress = (int)Math.Min(100, sw.Elapsed.TotalSeconds * 100 / seconds);
      if ((sw.Elapsed.TotalSeconds >= seconds && passes >= 2) || passes >= 60) break;
    }
    long mb = chunks.Count * 64L;
    chunks.Clear(); chunks = null; GC.Collect();
    Progress = 100;
    return new long[] { mb, passes, errors, (long)sw.Elapsed.TotalSeconds };
  }

  // Full load on every core, at below-normal priority so the test page stays usable.
  public static void StartBurn() {
    StopBurn = false;
    for (int t = 0; t < Environment.ProcessorCount; t++) {
      var th = new Thread(() => {
        double v = 1.0001;
        while (!StopBurn) { for (int i = 0; i < 200000; i++) { v = Math.Sqrt(v * v + 1.0001) * 1.0000001; } }
        if (v == 42) Console.Write("");
      });
      th.IsBackground = true; th.Priority = ThreadPriority.BelowNormal; th.Start();
    }
  }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool WriteFile(SafeFileHandle h, IntPtr buf, uint count, out uint done, IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool ReadFile(SafeFileHandle h, IntPtr buf, uint count, out uint done, IntPtr overlapped);

  const int BLOCK = 4 * 1024 * 1024;

  static void Fill(byte[] buf, long[] tmp, int block) {
    ulong x = 0xD1B54A32D192ED03UL ^ ((ulong)(block + 1) * 0x9E3779B97F4A7C15UL);
    for (int i = 0; i < tmp.Length; i++) tmp[i] = (long)Next(ref x);
    Buffer.BlockCopy(tmp, 0, buf, 0, BLOCK);
  }

  public static void StartDisk(string path, int mb) {
    DiskResult = null; Error = null; Progress = 0;
    var th = new Thread(() => {
      try { DiskResult = Disk(path, mb); } catch (Exception e) { Error = e.Message; DiskResult = new double[] { 0, 0, 0, 0, 0 }; }
      try { File.Delete(path); } catch { }
    });
    th.IsBackground = true; th.Start();
  }

  // Write a file with the OS cache bypassed, read it back the same way and
  // compare every block -- so it tests the disk itself, not RAM.
  static double[] Disk(string path, int mb) {
    int blocks = mb / 4;
    // Unbuffered I/O needs a sector-aligned buffer: over-allocate and align to 4 KB.
    IntPtr raw = Marshal.AllocHGlobal(BLOCK + 4096);
    IntPtr mem = new IntPtr((raw.ToInt64() + 4095) & ~4095L);
    byte[] want = new byte[BLOCK]; byte[] got = new byte[BLOCK]; long[] tmp = new long[BLOCK / 8];
    long mismatches = 0, ioErrors = 0;
    var timer = new Stopwatch();
    try {
      using (var h = CreateFile(path, 0x40000000u, 0u, IntPtr.Zero, 2u, 0xA0000000u, IntPtr.Zero)) {
        if (h.IsInvalid) throw new Exception("could not create the test file (error " + Marshal.GetLastWin32Error() + ")");
        for (int b = 0; b < blocks; b++) {
          Fill(want, tmp, b); Marshal.Copy(want, 0, mem, BLOCK);
          uint n; timer.Start();
          bool ok = WriteFile(h, mem, (uint)BLOCK, out n, IntPtr.Zero);
          timer.Stop();
          if (!ok || n != BLOCK) ioErrors++;
          Progress = b * 50 / blocks;
        }
      }
      double writeSec = timer.Elapsed.TotalSeconds; timer.Reset();
      using (var h = CreateFile(path, 0x80000000u, 1u, IntPtr.Zero, 3u, 0x20000000u, IntPtr.Zero)) {
        if (h.IsInvalid) throw new Exception("could not reopen the test file (error " + Marshal.GetLastWin32Error() + ")");
        for (int b = 0; b < blocks; b++) {
          uint n; timer.Start();
          bool ok = ReadFile(h, mem, (uint)BLOCK, out n, IntPtr.Zero);
          timer.Stop();
          if (!ok || n != BLOCK) { ioErrors++; continue; }
          Marshal.Copy(mem, got, 0, BLOCK); Fill(want, tmp, b);
          for (int i = 0; i < BLOCK; i++) { if (want[i] != got[i]) { mismatches++; break; } }
          Progress = 50 + b * 50 / blocks;
        }
      }
      double readSec = timer.Elapsed.TotalSeconds;
      Progress = 100;
      return new double[] { mb, Math.Round(mb / Math.Max(writeSec, 0.001)), Math.Round(mb / Math.Max(readSec, 0.001)), mismatches, ioErrors };
    } finally { Marshal.FreeHGlobal(raw); }
  }
}
'@

$bgFile = Join-Path $env:TEMP ('dbqc_' + $Code + '.json')
$diskPath = Join-Path $env:TEMP ('dbqc_' + $Code + '_disk.bin')
Q { Remove-Item $bgFile -Force }

$bgScript = {
  param($csharp, $bgFile, $heatTest, $diskPath)
  $ErrorActionPreference = 'SilentlyContinue'
  Add-Type -AssemblyName System.Windows.Forms
  $bg = [ordered]@{ stage = 'ram'; stage_progress = 0 }
  function Save {
    $tmp = $bgFile + '.tmp'
    ConvertTo-Json -InputObject $bg -Depth 6 -Compress | Set-Content -Path $tmp -Encoding UTF8
    Move-Item -Path $tmp -Destination $bgFile -Force
  }
  Save
  try { Add-Type -TypeDefinition $csharp -Language CSharp -ErrorAction Stop } catch {
    $msg = 'could not start the tests: ' + $_.Exception.Message
    $bg.ram = @{ error = $msg }; $bg.heat = @{ error = $msg }; $bg.disk = @{ error = $msg }; $bg.stage = 'done'; Save; return
  }

  # RAM: about 70% of the free memory, capped at 24 GB, for 4 minutes.
  $freeKb = [double](Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
  $target = [long][math]::Min($freeKb * 1024 * 0.7, 24GB)
  [DbQc]::StartRam($target, 240)
  while ($null -eq [DbQc]::RamResult) { Start-Sleep -Seconds 2; $bg.stage_progress = [DbQc]::Progress; Save }
  $rr = [DbQc]::RamResult
  $bg.ram = [ordered]@{ tested_mb = $rr[0]; passes = $rr[1]; errors = $rr[2]; seconds = $rr[3]; error = [DbQc]::Error }

  # Heat: every core at full load for 3 minutes; the speed held at the end
  # (as % of base clock) shows whether it slows itself down when hot.
  $bg.stage = 'heat'; $bg.stage_progress = 0
  if (-not $heatTest) {
    $bg.heat = @{ skipped = $true }
  } else {
    $bg.heat = [ordered]@{ seconds = 180; on_ac = $null; samples = @() }
    $samples = New-Object System.Collections.ArrayList
    $onAc = $true
    [DbQc]::StartBurn()
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt 180) {
      Start-Sleep -Seconds 5
      $pi = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'"
      $tz = @(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation)
      $temp = $null
      if ($tz.Count) {
        $k = ($tz | ForEach-Object { [double]$_.HighPrecisionTemperature / 10 } | Measure-Object -Maximum).Maximum
        if ($k -gt 200) { $temp = [math]::Round($k - 273.15, 1) }
      }
      if ("$([System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus)" -ne 'Online') { $onAc = $false }
      $perf = $null; $util = $null
      if ($pi) { $perf = [double]$pi.PercentProcessorPerformance; $util = [double]$pi.PercentProcessorTime }
      [void]$samples.Add([ordered]@{ t = [int]$sw.Elapsed.TotalSeconds; perf = $perf; util = $util; temp_c = $temp })
      $bg.heat.samples = @($samples); $bg.heat.on_ac = $onAc
      $bg.stage_progress = [int]($sw.Elapsed.TotalSeconds * 100 / 180)
      Save
    }
    [DbQc]::StopBurn = $true
  }

  # Disk: 2 GB written and read back past the cache (less if the disk is nearly full).
  $bg.stage = 'disk'; $bg.stage_progress = 0; Save
  $free = [double](Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':'))).Free
  $mb = 2048
  if ($free -lt 12GB) { $mb = 512 }
  if ($free -lt 3GB) {
    $bg.disk = @{ skipped_reason = 'less than 3 GB free on the system drive' }
  } else {
    [DbQc]::StartDisk($diskPath, $mb)
    while ($null -eq [DbQc]::DiskResult) { Start-Sleep -Seconds 2; $bg.stage_progress = [DbQc]::Progress; Save }
    $dr = [DbQc]::DiskResult
    $bg.disk = [ordered]@{ mb = $dr[0]; write_mbps = $dr[1]; read_mbps = $dr[2]; mismatches = $dr[3]; io_errors = $dr[4]; error = [DbQc]::Error }
  }
  $bg.stage = 'done'; $bg.stage_progress = 100; Save
}

Say ''
Say '[3/3] Background tests running: RAM (4 min), heat (3 min), disk (1-2 min).'
if ($HeatTest) { Say '  Keep the charger plugged in during the heat test.' }
$job = Start-Job -ScriptBlock $bgScript -ArgumentList $csharp, $bgFile, $HeatTest, $diskPath

function UsbNow {
  @(Q { Get-CimInstance Win32_PnPEntity -Filter "DeviceID LIKE 'USB\\VID%'" } | Where-Object { $_.DeviceID -notmatch '&MI_' })
}
$baseline = @{}
foreach ($u in (UsbNow)) { $baseline[$u.DeviceID] = $true }
$paths = @{}
$lastCommand = ''
$discharge = $null
$backup = $null
$deadline = (Get-Date).AddMinutes(60)
$lastStage = ''
$finishedAt = $null

function Sweep {
  $methods = @(Q { Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBrightnessMethods }) | Select-Object -First 1
  if (-not $methods) { Say '  This screen does not allow brightness control from Windows.' Yellow; return }
  $was = (@(Q { Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBrightness }) | Select-Object -First 1).CurrentBrightness
  foreach ($level in 100, 70, 40, 10, 40, 70, 100) {
    Q { Invoke-CimMethod -InputObject $methods -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$level } | Out-Null }
    Start-Sleep -Milliseconds 900
  }
  if ($null -ne $was) { Q { Invoke-CimMethod -InputObject $methods -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$was } | Out-Null } }
}

try {
  while ((Get-Date) -lt $deadline) {
    $bgObj = Q { Get-Content $bgFile -Raw -ErrorAction Stop | ConvertFrom-Json }

    $usb = @()
    foreach ($u in (UsbNow)) {
      if ($baseline.ContainsKey($u.DeviceID)) { continue }
      if (-not $paths.ContainsKey($u.DeviceID)) {
        $lp = Q { (Get-PnpDeviceProperty -InstanceId $u.DeviceID -KeyName 'DEVPKEY_Device_LocationPaths').Data | Select-Object -First 1 }
        if (-not $lp) { $lp = Q { (Get-PnpDeviceProperty -InstanceId $u.DeviceID -KeyName 'DEVPKEY_Device_LocationInfo').Data } }
        $paths[$u.DeviceID] = "$lp"
      }
      $usb += [ordered]@{ id = $u.DeviceID; name = "$($u.Name)"; path = $paths[$u.DeviceID] }
    }
    $ps = [System.Windows.Forms.SystemInformation]::PowerStatus
    $onAc = ("$($ps.PowerLineStatus)" -eq 'Online')
    $pct = [int]([double]$ps.BatteryLifePercent * 100)
    $mons = @(Q { Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams } | Where-Object { $_.Active }).Count
    $lan = @(Q { Get-NetAdapter -Physical } | Where-Object { "$($_.PhysicalMediaType)" -match '802\.3' -and "$($_.Status)" -eq 'Up' }).Count -gt 0

    # Battery backup estimate from any 8+ minute stretch unplugged (not during the heat test).
    $stage = "$($bgObj.stage)"
    if ($r.battery -and -not $onAc -and $stage -ne 'heat') {
      if (-not $discharge) { $discharge = @{ t = Get-Date; p = $pct } }
      else {
        $mins = ((Get-Date) - $discharge.t).TotalMinutes
        $drop = $discharge.p - $pct
        if ($mins -ge 8 -and $drop -ge 2) { $backup = [ordered]@{ minutes = [math]::Round($mins, 1); percent_drop = $drop; hours = [math]::Round(100 * $mins / 60 / $drop, 1) } }
      }
    } else { $discharge = $null }
    if ($bgObj -and $backup) { $bgObj | Add-Member -NotePropertyName backup -NotePropertyValue $backup -Force }

    $live = [ordered]@{ usb = $usb; monitors_active = $mons; ethernet_up = $lan; on_ac = $onAc; battery_percent = $pct }
    $resp = Post ('/api/qc-agent/' + $Code + '/live') ([ordered]@{ live = $live; background = $bgObj })

    if ($stage -ne $lastStage) {
      if ($stage -eq 'heat') { Say '  RAM test done. Heat test running...' }
      if ($stage -eq 'disk') { Say '  Disk test running...' }
      if ($stage -eq 'done') { Say '  All background tests done.' Green }
      $lastStage = $stage
    }
    if ($resp -and $resp.command -and "$($resp.command.at)" -ne $lastCommand) {
      $lastCommand = "$($resp.command.at)"
      if ($resp.command.name -eq 'brightness_sweep') { Say '  Changing brightness...'; Sweep }
    }
    if ($resp -and $resp.stop) { break }
    # Keep reporting for 2 more minutes after everything is finished, then stop.
    if ($stage -eq 'done' -and $resp -and $resp.page_finished) {
      if (-not $finishedAt) { $finishedAt = Get-Date }
      elseif (((Get-Date) - $finishedAt).TotalSeconds -gt 120) { break }
    }
    Start-Sleep -Seconds 3
  }
} finally {
  Q { Stop-Job $job; Remove-Job $job -Force }
  Q { Remove-Item $bgFile -Force }
  Q { Remove-Item ($bgFile + '.tmp') -Force }
  Q { Remove-Item $diskPath -Force }
}
Say ''
Say 'Auto Check finished on this laptop. Review and save it on your ERP screen.' Green
}
`

export function buildAgentScript(opts: { base: string; code: string; heatTest: boolean }): string {
  const safeBase = opts.base.replace(/'/g, '')
  return SCRIPT
    .replace('__BASE__', safeBase)
    .replace(/__CODE__/g, opts.code)
    .replace('__HEAT__', opts.heatTest ? '$true' : '$false')
    // Windows PowerShell 5.1 reads irm's text as-is; CRLF keeps here-strings happy.
    .replace(/\r?\n/g, '\r\n')
}
