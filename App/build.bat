@echo off
REM Pointer Build and Setup Script for Windows
REM Umfassendes Setup-Script mit Error-Handling und Debugging

setlocal enabledelayedexpansion

REM ============================================================================
REM Konfiguration
REM ============================================================================
set SCRIPT_VERSION=1.0
set SKIP_CHECKS=0
set DEBUG=0
set BACKGROUND=0
set CLEAN_INSTALL=0

REM ============================================================================
REM Argument Parser
REM ============================================================================
:parse_args
if "%1"=="" goto end_parse
if "%1"=="--skip-checks" set SKIP_CHECKS=1 & shift & goto parse_args
if "%1"=="-s" set SKIP_CHECKS=1 & shift & goto parse_args
if "%1"=="--debug" set DEBUG=1 & shift & goto parse_args
if "%1"=="-d" set DEBUG=1 & shift & goto parse_args
if "%1"=="--background" set BACKGROUND=1 & shift & goto parse_args
if "%1"=="-b" set BACKGROUND=1 & shift & goto parse_args
if "%1"=="--clean" set CLEAN_INSTALL=1 & shift & goto parse_args
if "%1"=="-c" set CLEAN_INSTALL=1 & shift & goto parse_args
if "%1"=="--help" goto show_help
if "%1"=="-h" goto show_help
shift
goto parse_args

:end_parse

REM ============================================================================
REM Hilfsfunktionen
REM ============================================================================

:write_log
setlocal
set message=%1
set type=%2
if "%type%"=="" set type=Info

for /f "tokens=2-4 delims=/:." %%a in ('echo prompt $H ^| cmd') do (set "BS=%%a")
for /F "tokens=1-4 delims=/: " %%A in ('powershell get-date -format "HH:mm:ss"') do set TIMESTAMP=%%A:%%B:%%C

if "%type%"=="Success" (
    echo [%TIMESTAMP%] [✓ %type%] %message%
) else if "%type%"=="Error" (
    echo [%TIMESTAMP%] [✗ %type%] %message%
) else if "%type%"=="Warning" (
    echo [%TIMESTAMP%] [⚠ %type%] %message%
) else if "%type%"=="Debug" (
    if %DEBUG% equ 1 echo [%TIMESTAMP%] [DEBUG] %message%
) else (
    echo [%TIMESTAMP%] [%type%] %message%
)
endlocal
goto :eof

:test_command
setlocal
set cmd=%1
where %cmd% >nul 2>&1
if %errorlevel% equ 0 (
    endlocal & exit /b 0
) else (
    endlocal & exit /b 1
)

:run_command
setlocal enabledelayedexpansion
set command=%1
set description=%2
set critical=%3
if "%critical%"=="" set critical=1

call :write_log "Starte: %description%" "Info"
call :write_log "Befehl: %command%" "Debug"

%command%
if %errorlevel% equ 0 (
    call :write_log "✓ %description% erfolgreich" "Success"
    endlocal & exit /b 0
) else (
    set exitcode=!errorlevel!
    call :write_log "✗ %description% fehlgeschlagen (Exit Code: !exitcode!)" "Error"
    if %critical% equ 1 (
        endlocal & exit /b 1
    )
    endlocal & exit /b 1
)

REM ============================================================================
REM Voraussetzungen prüfen
REM ============================================================================

:check_prerequisites
cls
echo.
echo ╔════════════════════════════════════════════════════════════════════════════╗
echo ║                    Pointer Build ^& Setup Script v%SCRIPT_VERSION%                 ║
echo ║               Umfassendes Setup mit Error-Handling ^& Debugging              ║
echo ╚════════════════════════════════════════════════════════════════════════════╝
echo.

call :write_log "=== Prüfe Voraussetzungen ===" "Info"

call :test_command node
if %errorlevel% neq 0 (
    call :write_log "✗ Node.js nicht gefunden" "Error"
    exit /b 1
)
for /f "tokens=*" %%A in ('node --version') do set NODE_VERSION=%%A
call :write_log "✓ Node.js %NODE_VERSION%" "Success"

call :test_command yarn
if %errorlevel% equ 0 (
    for /f "tokens=*" %%A in ('yarn --version') do set YARN_VERSION=%%A
    call :write_log "✓ Yarn %YARN_VERSION%" "Success"
    set PACKAGE_MANAGER=yarn
) else (
    call :test_command npm
    if %errorlevel% neq 0 (
        call :write_log "✗ Weder Yarn noch npm gefunden" "Error"
        exit /b 1
    )
    call :write_log "⚠ Yarn nicht gefunden, verwende npm" "Warning"
    set PACKAGE_MANAGER=npm
)

call :test_command python
if %errorlevel% neq 0 (
    call :write_log "✗ Python nicht gefunden" "Error"
    exit /b 1
)
for /f "tokens=*" %%A in ('python --version') do set PYTHON_VERSION=%%A
call :write_log "✓ %PYTHON_VERSION%" "Success"

call :test_command git
if %errorlevel% neq 0 (
    call :write_log "⚠ Git nicht gefunden (optional)" "Warning"
) else (
    for /f "tokens=*" %%A in ('git --version') do set GIT_VERSION=%%A
    call :write_log "✓ %GIT_VERSION%" "Success"
)

call :write_log "✓ Alle Voraussetzungen erfüllt" "Success"
goto :eof

REM ============================================================================
REM Frontend Setup
REM ============================================================================

:setup_frontend
call :write_log "=== Frontend Setup ===" "Info"

if %CLEAN_INSTALL% equ 1 (
    call :write_log "Lösche alte node_modules und Lock-Dateien..." "Warning"
    if exist "node_modules" rmdir /s /q "node_modules"
    if exist "yarn.lock" del /f /q "yarn.lock"
    if exist "package-lock.json" del /f /q "package-lock.json"
)

if "%PACKAGE_MANAGER%"=="yarn" (
    call :write_log "Frontend-Abhängigkeiten installieren (yarn)..." "Info"
    call yarn install
    if %errorlevel% neq 0 (
        call :write_log "✗ Yarn install fehlgeschlagen, versuche npm..." "Error"
        call npm install
        if %errorlevel% neq 0 (
            call :write_log "✗ Frontend-Abhängigkeiten konnten nicht installiert werden" "Error"
            exit /b 1
        )
    )
) else (
    call :write_log "Frontend-Abhängigkeiten installieren (npm)..." "Info"
    call npm install
    if %errorlevel% neq 0 (
        call :write_log "✗ Frontend-Abhängigkeiten konnten nicht installiert werden" "Error"
        exit /b 1
    )
)

call :write_log "✓ Frontend Setup abgeschlossen" "Success"
goto :eof

REM ============================================================================
REM Backend Setup
REM ============================================================================

:setup_backend
call :write_log "=== Backend Setup ===" "Info"

cd backend

call :write_log "Verwende: requirements_windows.txt" "Debug"

call :write_log "Backend-Abhängigkeiten installieren..." "Info"
call python -m pip install -r requirements_windows.txt
if %errorlevel% neq 0 (
    call :write_log "✗ Backend-Abhängigkeiten konnten nicht installiert werden" "Error"
    cd ..
    exit /b 1
)

call :write_log "spaCy English Modell herunterladen..." "Info"
call python -m spacy download en_core_web_sm
if %errorlevel% neq 0 (
    call :write_log "⚠ spaCy Modell konnte nicht heruntergeladen werden (nicht kritisch)" "Warning"
)

cd ..
call :write_log "✓ Backend Setup abgeschlossen" "Success"
goto :eof

REM ============================================================================
REM Umgebung konfigurieren
REM ============================================================================

:setup_environment
call :write_log "=== Umgebung konfigurieren ===" "Info"

if not exist ".env" (
    call :write_log "Erstelle .env Datei" "Info"
    (
        echo # Backend API URL
        echo VITE_API_URL=http://localhost:23816
        echo.
        echo # Development Server Port
        echo VITE_DEV_SERVER_PORT=3000
        echo.
        echo # Debug Mode
        echo DEBUG=false
        echo.
        echo # Optional: OpenAI API Key für erweiterte AI Features
        echo # OPENAI_API_KEY=your_key_here
    ) > .env
    call :write_log "✓ .env Datei erstellt" "Success"
) else (
    call :write_log "⚠ .env Datei existiert bereits, überspringe" "Warning"
)
goto :eof

REM ============================================================================
REM Build und Start
REM ============================================================================

:start_application
call :write_log "=== Starte Anwendung ===" "Info"
call :write_log "Backend und Frontend werden gestartet..." "Info"

if "%PACKAGE_MANAGER%"=="yarn" (
    call yarn dev
) else (
    call npm run dev
)
goto :eof

:show_troubleshooting
echo.
echo === Troubleshooting-Tipps ===
echo.
echo Falls Probleme auftreten:
echo.
echo 1. Backend-Verbindungsfehler:
echo    curl http://localhost:23816/health
echo.
echo 2. Port-Konflikte prüfen:
echo    netstat -an | findstr :23816
echo    netstat -an | findstr :3000
echo.
echo 3. Frontend-Build-Fehler:
echo    Lösche node_modules: rmdir /s node_modules
echo    Neuinstallation: yarn install
echo.
echo 4. Python-Abhängigkeiten:
echo    Virtuelle Umgebung: python -m venv venv
echo    Aktiviere: venv\Scripts\activate
echo    Installiere: pip install -r backend/requirements_windows.txt
echo.
echo 5. Electron-Fehler:
echo    yarn postinstall
echo    yarn electron:dev --dev-tools
echo.
echo 6. Debug-Modus:
echo    set DEBUG=true
echo    yarn dev
echo.
goto :eof

:show_help
echo Pointer Build ^& Setup Script
echo.
echo Verwendung: build.bat [OPTIONEN]
echo.
echo Optionen:
echo   -s, --skip-checks    Überspringe Voraussetzungsprüfung
echo   -d, --debug          Aktiviere Debug-Modus
echo   -b, --background     Starte im Hintergrund
echo   -c, --clean          Saubere Installation (lösche node_modules)
echo   -h, --help          Zeige diese Hilfe
echo.
echo Beispiele:
echo   build.bat
echo   build.bat --clean --debug
echo   build.bat --skip-checks
goto :eof

REM ============================================================================
REM Hauptfunktion
REM ============================================================================

if %SKIP_CHECKS% equ 0 (
    call :check_prerequisites
    if %errorlevel% neq 0 exit /b 1
)

call :setup_frontend
if %errorlevel% neq 0 exit /b 1

call :setup_backend
if %errorlevel% neq 0 exit /b 1

call :setup_environment

echo.
echo ================================================================================
call :write_log "✓ Setup erfolgreich abgeschlossen!" "Success"
echo ================================================================================
echo.

call :write_log "Start-Optionen:" "Info"
call :write_log "  1. Entwicklungsmodus (Frontend + Backend):" "Info"
call :write_log "     yarn dev" "Debug"
call :write_log "  2. Produktionsstart:" "Info"
call :write_log "     node start-pointer.js" "Debug"
call :write_log "  3. Komponenten separat:" "Info"
call :write_log "     Terminal 1: cd backend ^&^& python run.py" "Debug"
call :write_log "     Terminal 2: yarn start" "Debug"
call :write_log "     Terminal 3: yarn electron:dev" "Debug"

call :show_troubleshooting

set /p START_APP="Anwendung jetzt starten? (j/n) "
if /i "%START_APP%"=="j" (
    call :start_application
) else (
    call :write_log "Zum Starten führe aus: yarn dev" "Info"
)

endlocal
