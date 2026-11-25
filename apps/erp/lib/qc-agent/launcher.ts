// The "DB Auto Check" launcher: one file on a pen drive (or the laptop's
// desktop) so nobody has to type the long irm ... | iex line.
//
//   DB Auto Check.cmd  --double-click-->  asks Windows for admin (click Yes)
//     --> runs  GET /q/go  (this GO script, the same for every laptop)
//     --> asks for the 6-letter code from the engineer's phone, checks it
//         with  GET /q/<code>?check=1  and re-asks on a typo
//     --> runs the normal Auto Check script for that code (GET /q/<code>).
//
// The pen drive file never changes: all logic lives in the GO script, served
// fresh each time. Same rules as script.ts: Windows PowerShell 5.1, ASCII, no
// backticks, no dollar-brace.

const GO_SCRIPT = String.raw`
& {
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
$Base = '__BASE__'
try { $host.UI.RawUI.WindowTitle = 'DB Auto Check' } catch {}
$isAdmin = $false
try { $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch {}
Write-Host ''
Write-Host '  DB Auto Check' -ForegroundColor Cyan
Write-Host '  On your phone: New Entry > Auto Check > Start. It shows a 6-letter code.'
if (-not $isAdmin) { Write-Host '  (Not running as admin - some checks will be skipped. Use the launcher, or Terminal (Admin).)' -ForegroundColor Yellow }
Write-Host ''
$c = ''
while ($true) {
  $c = Read-Host '  Type the code and press Enter'
  $c = ("$c" -replace '[^A-Za-z0-9]', '').ToUpper()
  if ($c.Length -ne 6) { Write-Host '  The code has 6 letters/numbers. Try again.' -ForegroundColor Yellow; continue }
  $ans = $null
  try { $ans = Invoke-RestMethod -Uri ($Base + '/q/' + $c + '?check=1') -UseBasicParsing -TimeoutSec 20 }
  catch { Write-Host '  Cannot reach the ERP. Check the Wi-Fi / internet and try again.' -ForegroundColor Yellow; continue }
  $ans = "$ans".Trim()
  if ($ans -eq 'OK') { break }
  Write-Host ('  ' + $ans) -ForegroundColor Yellow
}
Write-Host ('  Code ' + $c + ' OK - starting.') -ForegroundColor Green
$agent = Invoke-RestMethod -Uri ($Base + '/q/' + $c) -UseBasicParsing
Invoke-Expression $agent
}
`

const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n')
const safe = (base: string) => base.replace(/['"%^&|<>]/g, '')

export function buildGoScript(base: string): string {
  return crlf(GO_SCRIPT.replace('__BASE__', safe(base)))
}

/** The .cmd for the pen drive. fltmc only succeeds as admin, so it doubles as the admin test. */
export function buildLauncherCmd(base: string): string {
  return crlf([
    '@echo off',
    'title DB Auto Check',
    'rem DB ERP Auto Check - double-click this file on the laptop to be checked.',
    'fltmc >nul 2>&1 || (',
    '  echo Asking Windows for admin rights - click Yes.',
    `  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"`,
    '  exit /b',
    ')',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; iex (irm '${safe(base)}/q/go' -UseBasicParsing)"`,
    'echo.',
    'pause',
    '',
  ].join('\n'))
}
