# ============================================================
#  Windows fuer die Werkzeug-Sandbox (MXC) vorbereiten
# ------------------------------------------------------------
#  Einmalig pro Rechner. Traegt am Stamm der Laufwerke je einen
#  Eintrag fuer "ALL APPLICATION PACKAGES" und "ALL RESTRICTED
#  APPLICATION PACKAGES" ein: nur Attribute lesen, nicht vererbt.
#  Ohne ihn starten node.exe, npm und der Datei-Worker von Qwen
#  in der Sandbox nicht (EPERM bei lstat auf "X:\").
#
#  Das Werkzeug ist wxc-host-prep.exe aus dem MXC-SDK
#  (@microsoft/mxc-sdk, bin\x64). Doku:
#  https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/host-prep.md
#
#  Braucht Administratorrechte; das Skript fordert sie per UAC an.
#
#  Aufruf:  mxc-host-prep.bat                 (einrichten)
#           mxc-host-prep.bat -Undo           (rueckgaengig)
#           mxc-host-prep.bat -Drives C,D     (Laufwerke selbst waehlen)
#           mxc-host-prep.bat -HostPrep <Pfad zu wxc-host-prep.exe>
#           mxc-host-prep.bat -List           (nur anzeigen, ohne Admin)
# ============================================================
param(
  [switch]$Undo,
  [switch]$List,
  [string[]]$Drives,
  [string]$HostPrep
)

$ErrorActionPreference = 'Stop'
# Ueber -File kommt "C,S" als ein einziger String an.
if ($Drives) { $Drives = $Drives -split ',' | Where-Object { $_ } }

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $List -and -not (Test-Admin)) {
  # Neu starten mit UAC-Abfrage; dieselben Parameter weiterreichen.
  $forward = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Undo) { $forward += '-Undo' }
  if ($Drives) { $forward += @('-Drives', ($Drives -join ',')) }
  if ($HostPrep) { $forward += @('-HostPrep', "`"$HostPrep`"") }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $forward
  exit 0
}

try {
  # --- wxc-host-prep.exe finden -----------------------------------------
  # Der Fork liegt neben qwen-code-desktop; Worktrees liegen daneben.
  $forkRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $parent = Split-Path $forkRoot -Parent
  $relative = 'node_modules\@microsoft\mxc-sdk\bin\x64\wxc-host-prep.exe'
  $candidates = @()
  if ($HostPrep) { $candidates += $HostPrep }
  $candidates += Join-Path $parent "qwen-code-desktop\runtime\qwen-code\lib\$relative"
  $candidates += Join-Path $forkRoot $relative
  $candidates += Get-ChildItem -Path $parent -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName $relative }
  $exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $exe) {
    throw "wxc-host-prep.exe nicht gefunden. Gesucht:`n  $($candidates -join "`n  ")`nMit -HostPrep <Pfad> angeben."
  }
  Write-Host "Werkzeug: $exe"

  # --- Laufwerke: Systemlaufwerk, Laufwerk von Qwen, Laufwerk von TEMP ---
  if (-not $Drives) {
    $Drives = @($env:SystemDrive, $forkRoot, $env:TEMP) |
      ForEach-Object { ([IO.Path]::GetPathRoot($_)).TrimEnd('\').TrimEnd(':') }
  }
  $roots = $Drives | ForEach-Object { "$($_.TrimEnd(':', '\').ToUpper()):\" } | Sort-Object -Unique

  $command = if ($Undo) { 'unprepare-system-drive' } else { 'prepare-system-drive' }
  if ($List) {
    Write-Host "Wuerde ausfuehren: $command fuer $($roots -join ', ') (ohne -List, mit Adminrechten)"
    foreach ($root in $roots) { icacls $root | Select-String -Pattern 'S-1-15-2-|PAKET|PACKAGES' }
    return
  }
  $failed = $false
  foreach ($root in $roots) {
    Write-Host ""
    Write-Host "== $command $root"
    & $exe $command --target $root
    if ($LASTEXITCODE -ne 0) {
      Write-Host "FEHLER: Exit-Code $LASTEXITCODE fuer $root" -ForegroundColor Red
      $failed = $true
    } else {
      Write-Host "OK: $root" -ForegroundColor Green
    }
  }

  Write-Host ""
  Write-Host "Ergebnis (Eintraege S-1-15-2-1 / S-1-15-2-2 bzw. ANWENDUNGSPAKETE):"
  foreach ($root in $roots) { icacls $root | Select-String -Pattern 'S-1-15-2-|PAKET|PACKAGES' }
  if ($failed) { exit 1 }
} catch {
  Write-Host "FEHLER: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if (-not $List) {
    Write-Host ""
    Read-Host 'Enter zum Schliessen'
  }
}
