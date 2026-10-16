# ============================================================
#  Windows fuer die Werkzeug-Sandbox (MXC) vorbereiten
# ------------------------------------------------------------
#  Sandbox-Container (AppContainer) duerfen ohne Freigabe nicht
#  einmal die Attribute eines Ordners abfragen. node.exe und npm
#  pruefen beim Start aber jeden Ordner im Pfad (lstat) und
#  brechen dann mit "EPERM: lstat 'C:\Users'" ab.
#
#  Das Skript gibt "ALL APPLICATION PACKAGES" (S-1-15-2-1) und
#  "ALL RESTRICTED APPLICATION PACKAGES" (S-1-15-2-2) nur das
#  Recht, Attribute zu lesen (RA, REA, RC, S = 0x120088):
#    1. am Stamm jedes Laufwerks (per wxc-host-prep.exe aus dem
#       MXC-SDK, offizieller Weg von MXC),
#    2. an jedem Ordner auf dem Weg zu den Sandbox-Pfaden
#       (Qwen-Ordner, TEMP, Projektordner), nicht vererbt,
#    3. an Projekt-Wurzeln zusaetzlich vererbt an Unterordner
#       (nur Ordner, nur Attribute), damit jedes Projekt darunter
#       als Arbeitsordner taugt.
#  Kein Auflisten, kein Lesen von Dateiinhalten, kein Schreiben.
#  Was hinzugefuegt wurde, steht in
#  C:\ProgramData\qwen-code\mxc-host-prep.json; -Undo entfernt
#  genau das wieder.
#
#  Aufruf:  mxc-host-prep.bat                      einrichten (UAC)
#           mxc-host-prep.bat -Check               nur pruefen, ohne Admin
#           mxc-host-prep.bat -Undo                rueckgaengig (UAC)
#           mxc-host-prep.bat -Projects D:\Projekte,D:\Code   weitere Projekt-Wurzeln
#           mxc-host-prep.bat -HostPrep <Pfad zu wxc-host-prep.exe>
#  MXC-Doku: https://github.com/microsoft/mxc/blob/main/docs/backends/process-container/host-prep.md
# ============================================================
param(
  [switch]$Undo,
  [switch]$Check,
  [string[]]$Projects,
  [string]$HostPrep
)

$ErrorActionPreference = 'Stop'
# Ueber -File kommt "A,B" als ein einziger String an.
if ($Projects) { $Projects = $Projects -split ',' | Where-Object { $_ } }

$AppSids = @('S-1-15-2-1', 'S-1-15-2-2')
$Rights = [Security.AccessControl.FileSystemRights]'ReadAttributes, ReadExtendedAttributes, ReadPermissions, Synchronize'
$StateFile = 'C:\ProgramData\qwen-code\mxc-host-prep.json'

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not $Check -and -not (Test-Admin)) {
  # Neu starten mit UAC-Abfrage; dieselben Parameter weiterreichen.
  $forward = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Undo) { $forward += '-Undo' }
  if ($Projects) { $forward += @('-Projects', "`"$($Projects -join ',')`"") }
  if ($HostPrep) { $forward += @('-HostPrep', "`"$HostPrep`"") }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $forward
  exit 0
}

# Hat ein Paket-SID an $dir das Leserecht fuer Attribute (direkt oder geerbt)?
function Test-AppAccess([string]$dir, [string]$sid) {
  $acl = (Get-Item -LiteralPath $dir -Force).GetAccessControl('Access')
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.IdentityReference.Value -ne $sid) { continue }
    if ($rule.AccessControlType -ne 'Allow') { continue }
    if ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
    if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAttributes) -ne 0) { return $true }
  }
  return $false
}

function Add-AppAccess([string]$dir, [string]$sid, [bool]$inherit) {
  $acl = (Get-Item -LiteralPath $dir -Force).GetAccessControl('Access')
  $flags = if ($inherit) { [Security.AccessControl.InheritanceFlags]::ContainerInherit } else { [Security.AccessControl.InheritanceFlags]::None }
  $rule = New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($sid)), $Rights, $flags,
    [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
  (Get-Item -LiteralPath $dir -Force).SetAccessControl($acl)
}

function Remove-AppAccess([string]$dir, [string]$sid, [bool]$inherit) {
  $acl = (Get-Item -LiteralPath $dir -Force).GetAccessControl('Access')
  $flags = if ($inherit) { [Security.AccessControl.InheritanceFlags]::ContainerInherit } else { [Security.AccessControl.InheritanceFlags]::None }
  $rule = New-Object Security.AccessControl.FileSystemAccessRule(
    (New-Object Security.Principal.SecurityIdentifier($sid)), $Rights, $flags,
    [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  [void]$acl.RemoveAccessRuleSpecific($rule)
  (Get-Item -LiteralPath $dir -Force).SetAccessControl($acl)
}

try {
  # --- Orte bestimmen ---------------------------------------------------
  # Der Fork liegt neben qwen-code-desktop; Worktrees liegen daneben.
  $forkRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
  $qwenRoot = Split-Path $forkRoot -Parent

  # Projekt-Wurzeln: vererbt an Unterordner. Weg dorthin: nicht vererbt.
  $projectRoots = @($qwenRoot)
  # Standard-Arbeitsordner der Desktop-App; "Dokumente" kann auf OneDrive
  # umgeleitet sein, deshalb beide Orte.
  foreach ($docs in @("$env:USERPROFILE\Documents", [Environment]::GetFolderPath('MyDocuments'))) {
    $docsQwen = Join-Path $docs 'Qwen'
    if (Test-Path -LiteralPath $docsQwen) { $projectRoots += $docsQwen }
  }
  if ($Projects) { $projectRoots += $Projects }
  $projectRoots = $projectRoots | ForEach-Object { (Resolve-Path -LiteralPath $_).Path.TrimEnd('\') } | Sort-Object -Unique

  # Ordner, die selbst erreichbar sein muessen (nicht vererbt): TEMP.
  $plainTargets = @([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\'))

  # Kette: alle Vorfahren bis unter den Laufwerksstamm.
  $entries = [ordered]@{}
  foreach ($target in $plainTargets + $projectRoots) {
    $p = Split-Path $target -Parent
    while ($p -and (Split-Path $p -Parent)) {
      if (-not $entries.Contains($p)) { $entries[$p] = $false }
      $p = Split-Path $p -Parent
    }
  }
  foreach ($t in $plainTargets) { if (-not $entries.Contains($t)) { $entries[$t] = $false } }
  foreach ($t in $projectRoots) { $entries[$t] = $true }
  $driveRoots = ($plainTargets + $projectRoots + @($env:SystemDrive)) |
    ForEach-Object { [IO.Path]::GetPathRoot("$_\") } | Sort-Object -Unique

  # --- Pruefen ----------------------------------------------------------
  if ($Check) {
    Write-Host "Laufwerksstaemme und Ordner, die Sandbox-Prozesse abfragen koennen muessen:"
    $missing = 0
    foreach ($dir in @($driveRoots) + @($entries.Keys)) {
      $ok = $true
      foreach ($sid in $AppSids) { if (-not (Test-AppAccess $dir $sid)) { $ok = $false } }
      $kind = if ($driveRoots -contains $dir) { 'Stamm' } elseif ($entries[$dir]) { 'Projekt-Wurzel (vererbt)' } else { 'Weg' }
      if ($ok) { Write-Host ("  ok     {0}  [{1}]" -f $dir, $kind) -ForegroundColor Green }
      else { Write-Host ("  FEHLT  {0}  [{1}]" -f $dir, $kind) -ForegroundColor Yellow; $missing++ }
    }
    Write-Host ""
    if ($missing) { Write-Host "$missing Ordner fehlen. Einrichten: mxc-host-prep.bat (UAC)." } else { Write-Host 'Alles vorhanden.' }
    return
  }

  # --- wxc-host-prep.exe fuer die Laufwerksstaemme ------------------------
  $relative = 'node_modules\@microsoft\mxc-sdk\bin\x64\wxc-host-prep.exe'
  $candidates = @()
  if ($HostPrep) { $candidates += $HostPrep }
  $candidates += Join-Path $qwenRoot "qwen-code-desktop\runtime\qwen-code\lib\$relative"
  $candidates += Join-Path $forkRoot $relative
  $candidates += Get-ChildItem -Path $qwenRoot -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName $relative }
  $exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $exe) {
    throw "wxc-host-prep.exe nicht gefunden. Gesucht:`n  $($candidates -join "`n  ")`nMit -HostPrep <Pfad> angeben."
  }
  Write-Host "Werkzeug: $exe"

  $failed = $false
  $driveCommand = if ($Undo) { 'unprepare-system-drive' } else { 'prepare-system-drive' }
  foreach ($root in $driveRoots) {
    Write-Host "== $driveCommand $root"
    & $exe $driveCommand --target $root
    if ($LASTEXITCODE -ne 0) { Write-Host "FEHLER: Exit-Code $LASTEXITCODE fuer $root" -ForegroundColor Red; $failed = $true }
  }

  # --- Ordner auf dem Weg -------------------------------------------------
  New-Item -ItemType Directory -Force (Split-Path $StateFile -Parent) | Out-Null
  $state = @()
  if (Test-Path -LiteralPath $StateFile) { $state = @(Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json) }

  if ($Undo) {
    foreach ($item in $state) {
      if (-not (Test-Path -LiteralPath $item.path)) { continue }
      Remove-AppAccess $item.path $item.sid ([bool]$item.inherit)
      Write-Host ("  entfernt  {0}  {1}" -f $item.path, $item.sid)
    }
    Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
  } else {
    foreach ($dir in $entries.Keys) {
      $inherit = [bool]$entries[$dir]
      foreach ($sid in $AppSids) {
        # Schon vorhanden (z. B. Program Files): nichts anfassen. Projekt-Wurzeln
        # bekommen den vererbten Eintrag, auch wenn der Ordner selbst schon ok ist.
        $already = $state | Where-Object { $_.path -eq $dir -and $_.sid -eq $sid }
        if ($already) { continue }
        if (-not $inherit -and (Test-AppAccess $dir $sid)) { continue }
        Add-AppAccess $dir $sid $inherit
        $state += [pscustomobject]@{ path = $dir; sid = $sid; inherit = $inherit }
        Write-Host ("  gesetzt  {0}  {1}{2}" -f $dir, $sid, $(if ($inherit) { '  (vererbt an Unterordner)' } else { '' }))
      }
    }
    ConvertTo-Json -InputObject @($state) | Set-Content -LiteralPath $StateFile -Encoding UTF8
    Write-Host "Protokoll: $StateFile"
  }
  if ($failed) { exit 1 }
} catch {
  Write-Host "FEHLER: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if (-not $Check) {
    Write-Host ""
    Read-Host 'Enter zum Schliessen'
  }
}
