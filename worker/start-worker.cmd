@echo off
setlocal EnableExtensions
rem ------------------------------------------------------------------
rem KaramsVids Worker starten (Doppelklick oder Aufgabenplanung).
rem   start-worker.cmd            Endlosschleife, startet sich nach Absturz neu
rem   start-worker.cmd --once     einen Auftrag, dann Ende
rem   start-worker.cmd --local video.mp4 --clips 3
rem ------------------------------------------------------------------
cd /d "%~dp0"

rem PATH-Refresh: frisch installiertes ffmpeg (winget) ist in einer schon offenen
rem Konsole sonst nicht sichtbar. Maschinen- und Benutzer-PATH aus der Registry holen.
set "SYS_PATH="
set "USR_PATH="
for /f "tokens=2,*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul ^| find /i "Path"') do call set "SYS_PATH=%%b"
for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul ^| find /i "Path"') do call set "USR_PATH=%%b"
if defined SYS_PATH set "PATH=%SYS_PATH%;%PATH%"
if defined USR_PATH set "PATH=%USR_PATH%;%PATH%"

rem Virtuelle Umgebung aktivieren, falls vorhanden
if exist ".venv\Scripts\activate.bat" (
  call ".venv\Scripts\activate.bat"
) else (
  echo [Hinweis] Keine .venv gefunden. Einrichtung: python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
)

if not exist ".env" (
  echo [Hinweis] Keine .env gefunden. Vorlage: .env.example
)

rem Whisper-Cache von HuggingFace: Symlink-Warnung unter Windows abschalten
set "HF_HUB_DISABLE_SYMLINKS_WARNING=1"

rem Mit Argumenten genau einmal laufen lassen (z. B. --once oder --local)
if not "%~1"=="" (
  python -m karam_worker %*
  exit /b %errorlevel%
)

:loop
python -m karam_worker
set "RC=%errorlevel%"
if "%RC%"=="130" (
  echo Worker beendet.
  exit /b 0
)
if "%RC%"=="2" (
  echo Konfigurationsfehler, kein Neustart. Siehe Meldung oben.
  pause
  exit /b 2
)
echo Worker hat sich beendet ^(Code %RC%^). Neustart in 10 Sekunden ...
timeout /t 10 /nobreak >nul
goto loop
