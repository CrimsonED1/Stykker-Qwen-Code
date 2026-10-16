@echo off
rem Windows fuer die Werkzeug-Sandbox (MXC) vorbereiten - einmalig pro Rechner.
rem Fordert Administratorrechte per UAC an. Details: mxc-host-prep.ps1
rem Parameter werden durchgereicht, z. B. -Undo oder -Drives C,D
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0mxc-host-prep.ps1" %*
