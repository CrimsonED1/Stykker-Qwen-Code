@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  Qwen Code Desktop aktualisieren
rem ------------------------------------------------------------
rem  Baut die CLI aus diesem Fork (Branch skymain) neu und kopiert
rem  den Desktop-Runtime in die installierte App.
rem
rem  *** NUR MANUELL AUSFUEHREN ***
rem  Vor dem Start MUESSEN die Desktop-App UND alle Qwen-Code-
rem  Sessions geschlossen sein. Sonst sind die Runtime-Dateien
rem  gesperrt und die laufenden Sessions stuerzen ab. Dieses
rem  Skript wird absichtlich NICHT automatisch gestartet.
rem ============================================================

set "NODE22=<root>\node-v22.23.3-win-x64"
set "DESKTOP=<qwen-root>\qwen-code-desktop"
set "RUNTIME=%DESKTOP%\runtime\qwen-code"
for %%i in ("%~dp0..\..") do set "SRC=%%~fi\"
set "NEWRUNTIME=%SRC%packages\desktop\runtime\qwen-code"

echo ============================================================
echo  Qwen Code Desktop aktualisieren
echo ============================================================
echo  Quelle : %SRC%
echo  Ziel   : %RUNTIME%
echo.

rem --- 1. App darf nicht laufen ---
tasklist /fi "imagename eq qwen-code-desktop.exe" 2>nul | find /i "qwen-code-desktop.exe" >nul
if not errorlevel 1 (
  echo FEHLER: Qwen Code Desktop laeuft noch.
  echo Bitte die App UND alle Qwen-Code-Sessions schliessen und erneut starten.
  echo.
  pause
  exit /b 1
)

rem --- 2. Node 22 vorhanden ---
if not exist "%NODE22%\node.exe" (
  echo FEHLER: Node 22 nicht gefunden unter "%NODE22%".
  echo Der Desktop-Runtime-Build verlangt Node 22 ^(siehe .nvmrc^).
  echo.
  pause
  exit /b 1
)

rem --- 3. Desktop-Runtime aus dem Quellcode bauen ---
set "PATH=%NODE22%;%PATH%"

rem --- Version kennzeichnen: <version>+sky.<commit>[.dirty] ---
rem Anzeige in "qwen --version" und unten in der Seitenleiste.
for /f "usebackq delims=" %%i in (`%NODE22%\node.exe -p "require('%SRC:\=/%package.json').version"`) do set "PKGVER=%%i"
for /f "usebackq delims=" %%i in (`git -C "%SRC%." rev-parse --short^=7 HEAD`) do set "GITSHA=%%i"
set "DIRTY="
for /f "usebackq delims=" %%i in (`git -C "%SRC%." status --porcelain --untracked-files^=no`) do set "DIRTY=.dirty"
set "QWEN_CODE_BUILD_VERSION=!PKGVER!+sky.!GITSHA!!DIRTY!"
echo  Version: !QWEN_CODE_BUILD_VERSION!
echo.

echo [1/3] Baue CLI und Desktop-Runtime ... ^(dauert mehrere Minuten^)
cd /d "%SRC%packages\desktop"
call "%NODE22%\npm.cmd" run build:runtime --workspaces=false
if errorlevel 1 goto :err

if not exist "%NEWRUNTIME%\lib\cli-entry.js" (
  echo FEHLER: Runtime wurde nicht erzeugt: "%NEWRUNTIME%".
  goto :err
)

rem --- 4. Backup der bisherigen Runtime ---
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "STAMP=%%i"
set "BACKUP=%RUNTIME%.bak-!STAMP!"
echo [2/3] Sichere bisherige Runtime nach "!BACKUP!" ...
if exist "!BACKUP!" rmdir /s /q "!BACKUP!"
if exist "%RUNTIME%" (
  move "%RUNTIME%" "!BACKUP!" >nul
  if errorlevel 1 (
    echo FEHLER: Konnte die bisherige Runtime nicht verschieben ^(gesperrt?^).
    echo Ist die Desktop-App wirklich vollstaendig geschlossen?
    goto :err
  )
)

rem --- 5. Neue Runtime kopieren ---
echo [3/3] Kopiere neue Runtime ...
robocopy "%NEWRUNTIME%" "%RUNTIME%" /MIR /NFL /NDL /NJH /NJS /NP
if errorlevel 8 goto :err

echo.
echo === FERTIG ===
echo Desktop-Runtime aktualisiert.
echo Backup der alten Runtime: "!BACKUP!"
echo.
echo Die App kann jetzt wieder gestartet werden.
pause
exit /b 0

:err
echo.
echo === FEHLER - siehe Ausgabe oben ===
echo Es wurde nichts oder nur teilweise aktualisiert. Pruefen, ob die
echo Desktop-App wirklich geschlossen ist, und erneut versuchen.
echo.
pause
exit /b 1
