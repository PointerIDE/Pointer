#!/bin/bash

# Pointer Build and Setup Script
# Umfassendes Setup-Script mit Error-Handling und Debugging

set -o pipefail

# ============================================================================
# Konfiguration
# ============================================================================
SCRIPT_VERSION="1.0"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SKIP_CHECKS=false
DEBUG=false
BACKGROUND=false
CLEAN_INSTALL=false

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

# ============================================================================
# Hilfsfunktionen
# ============================================================================

write_log() {
    local message="$1"
    local type="${2:-Info}"
    local timestamp=$(date "+%H:%M:%S")
    
    case $type in
        Success)
            echo -e "${timestamp} ${GREEN}[✓ $type]${NC} $message"
            ;;
        Error)
            echo -e "${timestamp} ${RED}[✗ $type]${NC} $message" >&2
            ;;
        Warning)
            echo -e "${timestamp} ${YELLOW}[⚠ $type]${NC} $message"
            ;;
        Debug)
            if [ "$DEBUG" = true ]; then
                echo -e "${timestamp} ${GRAY}[DEBUG]${NC} $message"
            fi
            ;;
        *)
            echo -e "${timestamp} ${BLUE}[$type]${NC} $message"
            ;;
    esac
}

test_command() {
    command -v "$1" >/dev/null 2>&1
}

test_port() {
    local port=$1
    nc -z localhost "$port" >/dev/null 2>&1
}

run_command() {
    local command="$1"
    local description="$2"
    local critical="${4:-true}"
    local -a alternatives=("${@:3}")
    
    write_log "Starte: $description" "Info"
    write_log "Befehl: $command" "Debug"
    
    if eval "$command"; then
        write_log "✓ $description erfolgreich" "Success"
        return 0
    else
        local exit_code=$?
        write_log "✗ $description fehlgeschlagen (Exit Code: $exit_code)" "Error"
        
        # Versuche Alternativen
        if [ ${#alternatives[@]} -gt 0 ]; then
            write_log "Versuche Alternativen..." "Warning"
            for alt in "${alternatives[@]}"; do
                write_log "Alternative: $alt" "Debug"
                if eval "$alt"; then
                    write_log "✓ Alternative erfolgreich" "Success"
                    return 0
                fi
            done
        fi
        
        if [ "$critical" = true ]; then
            write_log "Kritischer Fehler bei: $description" "Error"
            exit 1
        fi
        return 1
    fi
}

# ============================================================================
# Voraussetzungen prüfen
# ============================================================================

check_prerequisites() {
    write_log "=== Prüfe Voraussetzungen ===" "Info"
    
    local missing=()
    
    # Node.js prüfen
    if ! test_command "node"; then
        write_log "✗ Node.js nicht gefunden" "Error"
        missing+=("Node.js (v18+)")
    else
        local node_version=$(node --version)
        write_log "✓ Node.js $node_version" "Success"
    fi
    
    # Yarn/npm prüfen
    if ! test_command "yarn"; then
        if test_command "npm"; then
            write_log "⚠ Yarn nicht gefunden, verwende npm" "Warning"
            PACKAGE_MANAGER="npm"
        else
            write_log "✗ Weder Yarn noch npm gefunden" "Error"
            missing+=("Yarn oder npm")
        fi
    else
        local yarn_version=$(yarn --version)
        write_log "✓ Yarn $yarn_version" "Success"
        PACKAGE_MANAGER="yarn"
    fi
    
    # Python prüfen
    if ! test_command "python3" && ! test_command "python"; then
        write_log "✗ Python nicht gefunden" "Error"
        missing+=("Python (v3.8+)")
    else
        local python_version
        if test_command "python3"; then
            python_version=$(python3 --version)
        else
            python_version=$(python --version)
        fi
        write_log "✓ $python_version" "Success"
    fi
    
    # Git prüfen (optional)
    if ! test_command "git"; then
        write_log "⚠ Git nicht gefunden (optional)" "Warning"
    else
        local git_version=$(git --version)
        write_log "✓ $git_version" "Success"
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        write_log "Fehlende Voraussetzungen:" "Error"
        for tool in "${missing[@]}"; do
            write_log "  - $tool" "Error"
        done
        exit 1
    fi
    
    write_log "✓ Alle Voraussetzungen erfüllt" "Success"
}

check_ports() {
    write_log "=== Prüfe Ports ===" "Info"
    
    if test_port 23816; then
        write_log "⚠ Backend Port (23816) ist bereits in Verwendung" "Warning"
    else
        write_log "✓ Backend Port (23816) ist verfügbar" "Success"
    fi
    
    if test_port 3000; then
        write_log "⚠ Frontend Port (3000) ist bereits in Verwendung" "Warning"
    else
        write_log "✓ Frontend Port (3000) ist verfügbar" "Success"
    fi
}

# ============================================================================
# Frontend Setup
# ============================================================================

setup_frontend() {
    write_log "=== Frontend Setup ===" "Info"
    
    # node_modules löschen bei CleanInstall
    if [ "$CLEAN_INSTALL" = true ]; then
        write_log "Lösche alte node_modules und Lock-Dateien..." "Warning"
        rm -rf node_modules yarn.lock package-lock.json
    fi
    
    # Abhängigkeiten installieren
    if [ "$PACKAGE_MANAGER" = "yarn" ]; then
        run_command "yarn install" "Frontend-Abhängigkeiten installieren (yarn)" "npm install" true
    else
        run_command "npm install" "Frontend-Abhängigkeiten installieren (npm)" "npm ci" true
    fi
    
    write_log "✓ Frontend Setup abgeschlossen" "Success"
}

# ============================================================================
# Backend Setup
# ============================================================================

setup_backend() {
    write_log "=== Backend Setup ===" "Info"
    
    cd "$SCRIPT_DIR/backend" || exit 1
    
    # Bestimme requirements.txt basierend auf OS
    local requirements_file="requirements.txt"
    local uname_out=$(uname -s)
    
    case "$uname_out" in
        Darwin*)
            requirements_file="requirements_macos.txt"
            ;;
        Linux*)
            requirements_file="requirements_linux.txt"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            requirements_file="requirements_windows.txt"
            ;;
    esac
    
    write_log "Verwende: $requirements_file" "Debug"
    
    # Python-Abhängigkeiten installieren
    local python_cmd="python3"
    if ! test_command "python3"; then
        python_cmd="python"
    fi
    
    run_command "$python_cmd -m pip install -r $requirements_file" \
        "Backend-Abhängigkeiten installieren" \
        "$python_cmd -m pip install -r requirements.txt" \
        true
    
    # spaCy Modell herunterladen
    run_command "$python_cmd -m spacy download en_core_web_sm" \
        "spaCy English Modell herunterladen" \
        "" \
        false
    
    cd - >/dev/null || exit 1
    
    write_log "✓ Backend Setup abgeschlossen" "Success"
}

# ============================================================================
# Umgebung konfigurieren
# ============================================================================

setup_environment() {
    write_log "=== Umgebung konfigurieren ===" "Info"
    
    local env_file=".env"
    
    if [ ! -f "$env_file" ]; then
        write_log "Erstelle .env Datei" "Info"
        cat > "$env_file" << 'EOF'
# Backend API URL
VITE_API_URL=http://localhost:23816

# Development Server Port
VITE_DEV_SERVER_PORT=3000

# Debug Mode
DEBUG=false

# Optional: OpenAI API Key für erweiterte AI Features
# OPENAI_API_KEY=your_key_here
EOF
        write_log "✓ .env Datei erstellt" "Success"
    else
        write_log "⚠ .env Datei existiert bereits, überspringe" "Warning"
    fi
}

# ============================================================================
# Build und Start
# ============================================================================

build_application() {
    write_log "=== Baue Anwendung ===" "Info"
    
    if [ "$PACKAGE_MANAGER" = "yarn" ]; then
        run_command "yarn build" "Frontend bauen (yarn)" "npm run build" false
    else
        run_command "npm run build" "Frontend bauen (npm)" "" false
    fi
}

start_application() {
    local dev_mode="${1:-false}"
    
    if [ "$dev_mode" = true ]; then
        write_log "=== Starte Entwicklungsumgebung ===" "Info"
        write_log "Backend und Frontend werden gestartet..." "Info"
        
        if [ "$PACKAGE_MANAGER" = "yarn" ]; then
            yarn dev
        else
            npm run dev
        fi
    else
        write_log "=== Starte Anwendung ===" "Info"
        local args=""
        [ "$BACKGROUND" = true ] && args="$args --background"
        [ "$SKIP_CHECKS" = true ] && args="$args --skip-checks"
        node start-pointer.js $args
    fi
}

# ============================================================================
# Troubleshooting
# ============================================================================

show_troubleshooting() {
    write_log "=== Troubleshooting-Tipps ===" "Info"
    
    cat << 'EOF'

Falls Probleme auftreten:

1. Backend-Verbindungsfehler:
   curl http://localhost:23816/health
   
2. Port-Konflikte prüfen:
   lsof -i :23816
   lsof -i :3000
   
3. Frontend-Build-Fehler:
   Lösche node_modules: rm -rf node_modules package-lock.json yarn.lock
   Neuinstallation: yarn install
   
4. Python-Abhängigkeiten:
   Virtuelle Umgebung: python3 -m venv venv
   Aktiviere: source venv/bin/activate
   Installiere: pip install -r backend/requirements.txt
   
5. Electron-Fehler:
   yarn postinstall
   yarn electron:dev --dev-tools
   
6. Debug-Modus:
   export DEBUG=true; yarn dev

EOF
}

# ============================================================================
# Argument Parser
# ============================================================================

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-checks|-s)
                SKIP_CHECKS=true
                shift
                ;;
            --debug|-d)
                DEBUG=true
                shift
                ;;
            --background|-b)
                BACKGROUND=true
                shift
                ;;
            --clean|-c)
                CLEAN_INSTALL=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                write_log "Unbekannte Option: $1" "Error"
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    cat << 'EOF'
Pointer Build & Setup Script

Verwendung: ./build.sh [OPTIONEN]

Optionen:
  -s, --skip-checks    Überspringe Voraussetzungsprüfung
  -d, --debug          Aktiviere Debug-Modus
  -b, --background     Starte im Hintergrund
  -c, --clean          Saubere Installation (lösche node_modules)
  -h, --help          Zeige diese Hilfe

Beispiele:
  ./build.sh
  ./build.sh --clean --debug
  ./build.sh --skip-checks --background

EOF
}

# ============================================================================
# Hauptfunktion
# ============================================================================

main() {
    cat << "EOF"
╔════════════════════════════════════════════════════════════════════════════╗
║                    Pointer Build & Setup Script v1.0                      ║
║               Umfassendes Setup mit Error-Handling & Debugging             ║
╚════════════════════════════════════════════════════════════════════════════╝

EOF
    
    write_log "Script-Optionen:" "Info"
    write_log "  Debug: $DEBUG" "Debug"
    write_log "  Skip Checks: $SKIP_CHECKS" "Debug"
    write_log "  Background: $BACKGROUND" "Debug"
    write_log "  Clean Install: $CLEAN_INSTALL" "Debug"
    
    # Phase 1: Voraussetzungen
    if [ "$SKIP_CHECKS" != true ]; then
        check_prerequisites
        check_ports
    fi
    
    # Phase 2: Setup
    setup_frontend
    setup_backend
    setup_environment
    
    # Phase 3: Zusammenfassung
    echo ""
    echo "================================================================================"
    write_log "✓ Setup erfolgreich abgeschlossen!" "Success"
    echo "================================================================================"
    
    # Phase 4: Start-Optionen anzeigen
    write_log "" "Info"
    write_log "Start-Optionen:" "Info"
    write_log "  1. Entwicklungsmodus (Frontend + Backend):" "Info"
    write_log "     yarn dev" "Debug"
    write_log "  2. Produktionsstart:" "Info"
    write_log "     node start-pointer.js" "Debug"
    write_log "  3. Komponenten separat:" "Info"
    write_log "     Terminal 1: cd backend && python run.py" "Debug"
    write_log "     Terminal 2: yarn start" "Debug"
    write_log "     Terminal 3: yarn electron:dev" "Debug"
    
    show_troubleshooting
    
    # Frage nach automatischem Start
    read -p "Anwendung jetzt starten? (j/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Jj]$ ]]; then
        start_application true
    else
        write_log "Zum Starten führe aus: yarn dev" "Info"
    fi
}

# ============================================================================
# Script Ausführung
# ============================================================================

# Prüfe ob script ausführbar gemacht werden muss
if [ ! -x "$0" ]; then
    chmod +x "$0"
fi

parse_arguments "$@"
main
