@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  Qwen Code Desktop aktualisieren und neu starten
rem ------------------------------------------------------------
rem  Ein-Klick-Ablauf fuer die installierte Desktop-App:
rem    1. laufende App samt Kindprozessen beenden und warten,
rem       bis die Runtime-Dateien freigegeben sind
rem    2. update-desktop.bat aufrufen (baut nur bei Abweichung)
rem    3. Desktop-App wieder starten
rem
rem  Die eigentliche Arbeit - Manifest pruefen, bauen, Backup,
rem  kopieren - macht update-desktop.bat im selben Ordner. Hier
rem  steht nur Beenden und Neustart drumherum.
rem
rem  *** ACHTUNG ***
rem  Es werden ALLE Qwen-Code-Fenster und Sessions beendet, auch
rem  ungespeicherte Arbeit darin. Deshalb NICHT aus einer laufenden
rem  Qwen-Session heraus starten (die wuerde sich selbst abschiessen),
rem  sondern per Doppelklick auf die Verknuepfung.
rem
rem  Parameter werden an update-desktop.bat durchgereicht,
rem  z. B. /F fuer einen erzwungenen Neubau.
rem ============================================================

rem Pfad relativ zum Skript, nicht zu einem festen Laufwerk: der Fork
rem liegt neben qwen-code-desktop.
for %%i in ("%~dp0..\..\..\qwen-code-desktop") do set "DESKTOP=%%~fi"
set "APP=%DESKTOP%\qwen-code-desktop.exe"
set "RUNTIME=%DESKTOP%\runtime\qwen-code"
set "SCRIPT=%~dp0update-desktop.bat"

echo ============================================================
echo  Qwen Code Desktop aktualisieren und neu starten
echo ============================================================
echo.

if not exist "%APP%" (
  echo FEHLER: Desktop-App nicht gefunden unter "%APP%".
  echo.
  pause
  exit /b 1
)
if not exist "%SCRIPT%" (
  echo FEHLER: "%SCRIPT%" fehlt - falscher Ordner?
  echo.
  pause
  exit /b 1
)

rem --- 1. Laufendes Qwen beenden ---
echo [1/3] Beende laufendes Qwen Code Desktop ...
taskkill /im qwen-code-desktop.exe /t /f >nul 2>&1
if errorlevel 1 (
  echo       Keine laufende App gefunden.
) else (
  echo       App und Kindprozesse beendet.
)

rem Nach dem Beenden kann ein Runtime-Prozess kurz nachleben. Solange
rem laeuft, ist runtime\qwen-code gesperrt und das Verschieben der alten
rem Runtime schlaegt fehl - also warten und Nachzuegler nachziehen.
rem Kennzeichen: node.exe, deren ExecutablePath im Runtime-Ordner liegt.
set "WAIT=0"
:warte
set "BUSY="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-CimInstance Win32_Process ^| Where-Object { $_.Name -eq 'node.exe' -and $_.ExecutablePath -like '!RUNTIME!*' } ^| ForEach-Object { $_.ProcessId }"`) do set "BUSY=!BUSY! %%i"
if not defined BUSY goto :frei
for %%p in (!BUSY!) do taskkill /pid %%p /t /f >nul 2>&1
set /a WAIT+=1
if !WAIT! geq 20 (
  echo FEHLER: Runtime-Prozesse lassen sich nicht beenden:!BUSY!
  echo Bitte diese Prozesse von Hand schliessen und erneut starten.
  echo.
  pause
  exit /b 1
)
>nul timeout /t 1 /nobreak
goto :warte

:frei
echo       Runtime ist frei.
echo.

rem --- 2. Aktualisieren ---
rem Eingabe auf NUL: die pause-Aufrufe in update-desktop.bat sollen
rem die Ausgabe hier nicht anhalten. Das Fenster bleibt offen.
echo [2/3] Aktualisiere die Runtime ...
echo.
call "%SCRIPT%" %* < nul
set "RC=!errorlevel!"
echo.
if not "!RC!"=="0" (
  echo FEHLER: update-desktop.bat endete mit Code !RC!.
  echo Die App bleibt geschlossen - Ausgabe oben pruefen.
  echo.
  pause
  exit /b !RC!
)

rem --- 3. Wieder starten ---
echo [3/3] Starte Qwen Code Desktop ...
start "" /d "%DESKTOP%" "%APP%"
echo.
echo ============================================================
echo  FERTIG - Runtime aktuell, Qwen Code Desktop laeuft wieder.
echo ============================================================
>nul timeout /t 5 /nobreak
exit /b 0