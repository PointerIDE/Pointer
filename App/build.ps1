# Pointer Build and Setup Script
# Umfassendes Setup-Script mit Error-Handling und Debugging

param(
    [switch]$SkipChecks = $false,
    [switch]$Debug = $false,
    [switch]$Background = $false,
    [switch]$CleanInstall = $false
)

# ============================================================================
# Konfiguration
# ============================================================================
$ErrorActionPreference = "Continue"
$ScriptVersion = "1.0"
$COLORS = @{
    'Info'    = 'Cyan'
    'Success' = 'Green'
    'Warning' = 'Yellow'
    'Error'   = 'Red'
    'Debug'   = 'Gray'
}

# ============================================================================
# Hilfsfunktionen
# ============================================================================

function Write-Log {
    param(
        [string]$Message,
        [string]$Type = 'Info'
    )
    $timestamp = Get-Date -Format "HH:mm:ss"
    $color = $COLORS[$Type]
    Write-Host "[$timestamp] [$Type] $Message" -ForegroundColor $color
}

function Test-Command {
    param([string]$Command)
    try {
        $result = & cmd /c "where $Command" 2>$null
        return $result -ne $null
    }
    catch {
        return $false
    }
}

function Test-Port {
    param([int]$Port)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $false  # Port ist frei
    }
    catch {
        return $true   # Port ist belegt
    }
}

function Run-Command {
    param(
        [string]$Command,
        [string]$Description,
        [string[]]$Alternatives = @(),
        [bool]$Critical = $true
    )
    
    Write-Log "Starte: $Description" 'Info'
    Write-Log "Befehl: $Command" 'Debug'
    
    try {
        $result = Invoke-Expression $Command 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log "✓ $Description erfolgreich" 'Success'
            return $true
        }
        else {
            Write-Log "✗ $Description fehlgeschlagen (Exit Code: $LASTEXITCODE)" 'Error'
            
            if ($Alternatives.Count -gt 0) {
                Write-Log "Versuche Alternativen..." 'Warning'
                foreach ($alt in $Alternatives) {
                    Write-Log "Alternative: $alt" 'Debug'
                    try {
                        $altResult = Invoke-Expression $alt 2>&1
                        if ($LASTEXITCODE -eq 0) {
                            Write-Log "✓ Alternative erfolgreich" 'Success'
                            return $true
                        }
                    }
                    catch {
                        Write-Log "Alternative fehlgeschlagen: $_" 'Debug'
                    }
                }
            }
            
            if ($Critical) {
                throw "Kritischer Fehler bei: $Description"
            }
            return $false
        }
    }
    catch {
        Write-Log "Fehler: $_" 'Error'
        if ($Critical) {
            throw $_
        }
        return $false
    }
}

# ============================================================================
# Voraussetzungen prüfen
# ============================================================================

function Check-Prerequisites {
    Write-Log "=== Prüfe Voraussetzungen ===" 'Info'
    
    $missingTools = @()
    
    # Node.js prüfen
    if (-not (Test-Command "node")) {
        Write-Log "✗ Node.js nicht gefunden" 'Error'
        $missingTools += "Node.js (v18+)"
    }
    else {
        $nodeVersion = & node --version
        Write-Log "✓ Node.js $nodeVersion" 'Success'
    }
    
    # Yarn prüfen
    if (-not (Test-Command "yarn")) {
        Write-Log "⚠ Yarn nicht gefunden, verwende npm" 'Warning'
        $script:PackageManager = "npm"
    }
    else {
        $yarnVersion = & yarn --version
        Write-Log "✓ Yarn $yarnVersion" 'Success'
        $script:PackageManager = "yarn"
    }
    
    # Python prüfen
    if (-not (Test-Command "python")) {
        Write-Log "✗ Python nicht gefunden" 'Error'
        $missingTools += "Python (v3.8+)"
    }
    else {
        $pythonVersion = & python --version
        Write-Log "✓ $pythonVersion" 'Success'
    }
    
    # Git prüfen
    if (-not (Test-Command "git")) {
        Write-Log "⚠ Git nicht gefunden (optional)" 'Warning'
    }
    else {
        $gitVersion = & git --version
        Write-Log "✓ $gitVersion" 'Success'
    }
    
    if ($missingTools.Count -gt 0) {
        Write-Log "Fehlende Voraussetzungen:" 'Error'
        foreach ($tool in $missingTools) {
            Write-Log "  - $tool" 'Error'
        }
        throw "Bitte installiere alle erforderlichen Tools"
    }
    
    Write-Log "✓ Alle Voraussetzungen erfüllt" 'Success'
}

# ============================================================================
# Frontend Setup
# ============================================================================

function Setup-Frontend {
    Write-Log "=== Frontend Setup ===" 'Info'
    
    # node_modules löschen bei CleanInstall
    if ($CleanInstall) {
        Write-Log "Lösche alte node_modules und Lock-Dateien..." 'Warning'
        if (Test-Path "node_modules") {
            Remove-Item -Path "node_modules" -Recurse -Force
        }
        if (Test-Path "yarn.lock") {
            Remove-Item -Path "yarn.lock" -Force
        }
        if (Test-Path "package-lock.json") {
            Remove-Item -Path "package-lock.json" -Force
        }
    }
    
    # Abhängigkeiten installieren
    if ($script:PackageManager -eq "yarn") {
        Run-Command `
            "yarn install" `
            "Frontend-Abhängigkeiten installieren (yarn)" `
            @("npm install") `
            $true
    }
    else {
        Run-Command `
            "npm install" `
            "Frontend-Abhängigkeiten installieren (npm)" `
            @("npm ci") `
            $true
    }
    
    Write-Log "✓ Frontend Setup abgeschlossen" 'Success'
}

# ============================================================================
# Backend Setup
# ============================================================================

function Setup-Backend {
    Write-Log "=== Backend Setup ===" 'Info'
    
    Push-Location "backend"
    
    try {
        # Bestimme requirements.txt basierend auf OS
        $osType = [System.Environment]::OSVersion.Platform
        $requirementsFile = "requirements_windows.txt"
        
        if ($osType -eq "Unix") {
            if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::OSX)) {
                $requirementsFile = "requirements_macos.txt"
            }
            else {
                $requirementsFile = "requirements_linux.txt"
            }
        }
        
        Write-Log "Verwende: $requirementsFile" 'Debug'
        
        # Python-Abhängigkeiten installieren
        Run-Command `
            "pip install -r $requirementsFile" `
            "Backend-Abhängigkeiten installieren" `
            @("pip install -r requirements.txt") `
            $true
        
        # spaCy Modell herunterladen
        Run-Command `
            "python -m spacy download en_core_web_sm" `
            "spaCy English Modell herunterladen" `
            @() `
            $false  # Nicht kritisch
        
        Write-Log "✓ Backend Setup abgeschlossen" 'Success'
    }
    finally {
        Pop-Location
    }
}

# ============================================================================
# Umgebung konfigurieren
# ============================================================================

function Setup-Environment {
    Write-Log "=== Umgebung konfigurieren ===" 'Info'
    
    $envFile = ".env"
    $envContent = @"
# Backend API URL
VITE_API_URL=http://localhost:23816

# Development Server Port
VITE_DEV_SERVER_PORT=3000

# Debug Mode
DEBUG=$($Debug.ToString().ToLower())

# Optional: OpenAI API Key für erweiterte AI Features
# OPENAI_API_KEY=your_key_here
"@
    
    if (-not (Test-Path $envFile)) {
        Write-Log "Erstelle .env Datei" 'Info'
        Set-Content -Path $envFile -Value $envContent
        Write-Log "✓ .env Datei erstellt" 'Success'
    }
    else {
        Write-Log "⚠ .env Datei existiert bereits, überspringe" 'Warning'
    }
}

# ============================================================================
# Port-Konflikte prüfen
# ============================================================================

function Check-Ports {
    Write-Log "=== Prüfe Ports ===" 'Info'
    
    $ports = @{
        'Backend (23816)' = 23816
        'Frontend (3000)' = 3000
    }
    
    foreach ($portName in $ports.Keys) {
        $port = $ports[$portName]
        if (Test-Port $port) {
            Write-Log "⚠ $portName ist bereits in Verwendung" 'Warning'
        }
        else {
            Write-Log "✓ $portName ist verfügbar" 'Success'
        }
    }
}

# ============================================================================
# Build und Start
# ============================================================================

function Build-Application {
    Write-Log "=== Baue Anwendung ===" 'Info'
    
    if ($script:PackageManager -eq "yarn") {
        Run-Command `
            "yarn build" `
            "Frontend bauen (yarn)" `
            @("npm run build") `
            $false
    }
    else {
        Run-Command `
            "npm run build" `
            "Frontend bauen (npm)" `
            @() `
            $false
    }
}

function Start-Application {
    param([bool]$DevMode = $false)
    
    if ($DevMode) {
        Write-Log "=== Starte Entwicklungsumgebung ===" 'Info'
        Write-Log "Backend und Frontend werden gestartet..." 'Info'
        
        if ($script:PackageManager -eq "yarn") {
            & yarn dev
        }
        else {
            & npm run dev
        }
    }
    else {
        Write-Log "=== Starte Anwendung ===" 'Info'
        & node start-pointer.js $(if ($Background) { '--background' }) $(if ($SkipChecks) { '--skip-checks' })
    }
}

# ============================================================================
# Troubleshooting
# ============================================================================

function Show-Troubleshooting {
    Write-Log "=== Troubleshooting-Tipps ===" 'Info'
    
    @"
Falls Probleme auftreten:

1. Backend-Verbindungsfehler:
   curl http://localhost:23816/health
   
2. Port-Konflikte prüfen:
   netstat -an | findstr :23816
   netstat -an | findstr :3000
   
3. Frontend-Build-Fehler:
   Lösche node_modules: rm -r node_modules package-lock.json
   Neuinstallation: yarn install
   
4. Python-Abhängigkeiten:
   Virtuelle Umgebung: python -m venv venv
   Aktiviere: venv\Scripts\activate
   Installiere: pip install -r backend/requirements_windows.txt
   
5. Electron-Fehler:
   yarn postinstall
   yarn electron:dev --dev-tools
   
6. Debug-Modus:
   `$env:DEBUG='true'; yarn dev
"@
}

# ============================================================================
# Hauptfunktion
# ============================================================================

function Main {
    Write-Host @"
╔════════════════════════════════════════════════════════════════════════════╗
║                    Pointer Build & Setup Script v$ScriptVersion                 ║
║               Umfassendes Setup mit Error-Handling & Debugging              ║
╚════════════════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan
    
    Write-Log "Script-Optionen:" 'Info'
    Write-Log "  Debug: $Debug" 'Debug'
    Write-Log "  Skip Checks: $SkipChecks" 'Debug'
    Write-Log "  Background: $Background" 'Debug'
    Write-Log "  Clean Install: $CleanInstall" 'Debug'
    
    try {
        # Phase 1: Voraussetzungen
        if (-not $SkipChecks) {
            Check-Prerequisites
            Check-Ports
        }
        
        # Phase 2: Setup
        Setup-Frontend
        Setup-Backend
        Setup-Environment
        
        # Phase 3: Zusammenfassung
        Write-Host "`n" + ("="*80) -ForegroundColor Cyan
        Write-Log "✓ Setup erfolgreich abgeschlossen!" 'Success'
        Write-Host ("="*80) -ForegroundColor Cyan
        
        # Phase 4: Start
        Write-Log "`nStartoptionen:" 'Info'
        Write-Log "  1. Entwicklungsmodus (Frontend + Backend):" 'Info'
        Write-Log "     yarn dev" 'Debug'
        Write-Log "  2. Produktionsstart:" 'Info'
        Write-Log "     node start-pointer.js" 'Debug'
        Write-Log "  3. Komponenten separat:" 'Info'
        Write-Log "     Terminal 1: cd backend && python run.py" 'Debug'
        Write-Log "     Terminal 2: yarn start" 'Debug'
        Write-Log "     Terminal 3: yarn electron:dev" 'Debug'
        
        Write-Log "`nTroubleshooting?" 'Info'
        Show-Troubleshooting
        
        # Frage nach automatischem Start
        $startApp = Read-Host "`nAnwendung jetzt starten? (j/n)"
        if ($startApp -eq 'j' -or $startApp -eq 'J') {
            Start-Application -DevMode $true
        }
    }
    catch {
        Write-Log "FEHLER: $_" 'Error'
        Write-Log "Script beendet mit Fehler" 'Error'
        exit 1
    }
}

# ============================================================================
# Script Ausführung
# ============================================================================

Main
