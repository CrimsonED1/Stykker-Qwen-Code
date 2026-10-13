@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  Qwen Code Desktop aktualisieren
rem ------------------------------------------------------------
rem  Baut die CLI aus diesem Fork (Branch skymain) neu und kopiert
rem  den Desktop-Runtime in die installierte App.
rem
rem  Zuerst wird das Manifest der installierten Runtime geprueft:
rem  Stimmen Commit, Version und Node-Version mit dem Quellcode ueberein
rem  und ist der Quellcode sauber, wird nichts gebaut. Der Build
rem  entfaellt also beim zweiten Lauf ohne Aenderung.
rem
rem  Parameter: /F erzwingt den Neubau (z. B. wenn eine Runtime
rem  beschaedigt ist und ihr Manifest trotzdem passt).
rem
rem  *** NUR MANUELL AUSFUEHREN ***
rem  Vor dem Start MUESSEN die Desktop-App UND alle Qwen-Code-
rem  Sessions geschlossen sein. Sonst sind die Runtime-Dateien
rem  gesperrt und die laufenden Sessions stuerzen ab. Dieses
rem  Skript wird absichtlich NICHT automatisch gestartet.
rem ============================================================

set "FORCE=0"
if /i "%~1"=="/F" set "FORCE=1"
if /i "%~1"=="--force" set "FORCE=1"

rem Pfade relativ zum Skript, nicht zu einem festen Laufwerk: der Fork
rem liegt neben qwen-code-desktop, Node 22 eine Ebene darueber.
for %%i in ("%~dp0..\..") do set "SRC=%%~fi\"
for %%i in ("%SRC%..\qwen-code-desktop") do set "DESKTOP=%%~fi"
for %%i in ("%SRC%..\..\node-v22.23.3-win-x64") do set "NODE22=%%~fi"
set "RUNTIME=%DESKTOP%\runtime\qwen-code"
set "NEWRUNTIME=%SRC%packages\desktop\runtime\qwen-code"

echo ============================================================
echo  Qwen Code Desktop aktualisieren
echo ============================================================
echo  Quelle : %SRC%
echo  Ziel   : %RUNTIME%
echo.

rem --- 1. Node 22 vorhanden ---
if not exist "%NODE22%\node.exe" (
  echo FEHLER: Node 22 nicht gefunden unter "%NODE22%".
  echo Der Desktop-Runtime-Build verlangt Node 22 ^(siehe .nvmrc^).
  echo.
  pause
  exit /b 1
)

set "PATH=%NODE22%;%PATH%"

rem --- Versionsstand des Quellcodes ermitteln ---
rem Kennzeichnung: <version>+sky.<commit>[.dirty]
rem Anzeige in "qwen --version" und unten in der Seitenleiste.
for /f "usebackq delims=" %%i in (`%NODE22%\node.exe -p "require('%SRC:\=/%package.json').version"`) do set "PKGVER=%%i"
for /f "usebackq delims=" %%i in (`git -C "%SRC%." rev-parse --short^=7 HEAD`) do set "GITSHA=%%i"
for /f "usebackq delims=" %%i in (`git -C "%SRC%." rev-parse HEAD`) do set "GITSHAFULL=%%i"
for /f "usebackq delims=" %%i in (`%NODE22%\node.exe -v`) do set "NODEVER=%%i"
set "DIRTY="
for /f "usebackq delims=" %%i in (`git -C "%SRC%." status --porcelain --untracked-files^=no`) do set "DIRTY=.dirty"
set "QWEN_CODE_BUILD_VERSION=!PKGVER!+sky.!GITSHA!!DIRTY!"
echo  Quelle : Version !QWEN_CODE_BUILD_VERSION!
echo.

rem --- 2. Ist die installierte Runtime bereits genau dieser Build? ---
rem Das Manifest nennt Commit, Version und Node-Version, mit denen die
rem installierte Runtime gebaut wurde. Sind alle drei gleich, ist der
rem Quellcode sauber und die Runtime vollstaendig, liefert ein Neubau
rem dasselbe Ergebnis - dann nur melden und beenden.
set "MF="
if exist "%RUNTIME%\manifest.json" for /f "usebackq delims=" %%i in (`%NODE22%\node.exe -p "const m=require('%RUNTIME:\=/%/manifest.json');[m.qwenCodeCommit,m.qwenCodeVersion,m.node].join('|')"`) do set "MF=%%i"
if "!FORCE!"=="1" goto :bauen
if not defined MF (
  echo  Manifest fehlt oder unlesbar - Build wird ausgefuehrt.
  echo.
  goto :bauen
)
for /f "tokens=1-3 delims=|" %%a in ("!MF!") do (
  set "MFCOMMIT=%%a"
  set "MFVERSION=%%b"
  set "MFNODE=%%c"
)
if not "!MFCOMMIT!"=="!GITSHAFULL!" (
  echo  Abweichung: Runtime von Commit !MFCOMMIT!, Quellcode bei !GITSHAFULL!
  echo.
  goto :bauen
)
if not "!MFVERSION!"=="!PKGVER!" (
  echo  Abweichung: Runtime hat Version !MFVERSION!, Quellcode !PKGVER!
  echo.
  goto :bauen
)
if not "!MFNODE!"=="!NODEVER!" (
  echo  Abweichung: Runtime mit !MFNODE! gebaut, Quellcode erwartet !NODEVER!
  echo.
  goto :bauen
)
if defined DIRTY (
  echo  Abweichung: Arbeitsstand hat nicht committete Aenderungen.
  echo.
  goto :bauen
)
if not exist "%RUNTIME%\lib\cli-entry.js" (
  echo  Abweichung: Runtime unvollstaendig - lib\cli-entry.js fehlt.
  echo.
  goto :bauen
)

echo ============================================================
echo  NICHTS ZU TUN - die installierte Runtime ist aktuell.
echo ============================================================
echo  Installiert : Commit !MFCOMMIT!
echo               Version !MFVERSION! ^(Node !MFNODE!^)
echo  Quellcode  : Commit !GITSHAFULL!
echo               Version !PKGVER! ^(Node !NODEVER!^)
echo               sauber, Arbeitsstand identisch
echo.
echo  Gebaut wird nur bei einer Abweichung. Erzwingen mit "%~nx0" /F
echo.
pause
exit /b 0

:bauen
rem --- 3. App darf nicht laufen ---
tasklist /fi "imagename eq qwen-code-desktop.exe" 2>nul | find /i "qwen-code-desktop.exe" >nul
if not errorlevel 1 (
  echo FEHLER: Qwen Code Desktop laeuft noch.
  echo Bitte die App UND alle Qwen-Code-Sessions schliessen und erneut starten.
  echo.
  pause
  exit /b 1
)

rem --- 4. Desktop-Runtime aus dem Quellcode bauen ---
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
