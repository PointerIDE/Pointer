# Pointer Build & Setup Scripts

Umfassende Build- und Setup-Skripte mit erweiterten Fehlerbehandlung, Debugging und automatischer Problemlösung.

## 📋 Verfügbare Scripts

### Windows
- **`build.bat`** - Batch-Script für Windows (cmd.exe)
- **`build.ps1`** - PowerShell-Script für Windows (PowerShell 5.0+)

### macOS & Linux
- **`build.sh`** - Bash-Script für macOS und Linux

## 🚀 Quick Start

### Windows (Command Prompt)
```bash
build.bat
```

### Windows (PowerShell)
```powershell
.\build.ps1
```

### macOS / Linux
```bash
chmod +x build.sh
./build.sh
```

## 📝 Optionen

Alle Scripts unterstützen die gleichen Optionen:

| Option | Kurz | Beschreibung |
|--------|------|-------------|
| `--skip-checks` | `-s` | Überspringe Voraussetzungsprüfung (schneller) |
| `--debug` | `-d` | Aktiviere Debug-Modus (verbose Output) |
| `--background` | `-b` | Starte Komponenten im Hintergrund |
| `--clean` | `-c` | Saubere Installation (lösche node_modules) |
| `--help` | `-h` | Zeige Hilfe an |

## 💡 Beispiele

### Schnelle Installation ohne Checks
```bash
# Windows (CMD)
build.bat --skip-checks

# Windows (PowerShell)
.\build.ps1 -SkipChecks

# macOS/Linux
./build.sh --skip-checks
```

### Saubere Installation mit Debug
```bash
# Windows (CMD)
build.bat --clean --debug

# Windows (PowerShell)
.\build.ps1 -CleanInstall -Debug

# macOS/Linux
./build.sh --clean --debug
```

### Installation mit allen Checks
```bash
# Windows (CMD)
build.bat

# macOS/Linux
./build.sh
```

## ✨ Features

### 🔍 Automatische Voraussetzungsprüfung
- ✓ Node.js Verfügbarkeit prüfen
- ✓ Yarn/npm Verfügbarkeit prüfen
- ✓ Python Verfügbarkeit prüfen
- ✓ Git (optional) prüfen
- ✓ Port-Konflikte erkennen

### 🛡️ Fehlerbehandlung
- ✓ Automatische Alternativen bei Fehlern
- ✓ Detaillierte Error-Messages
- ✓ Exit-Codes für Scripting
- ✓ Graceful Degradation

### 🐛 Debug & Logging
- ✓ Farbcodierte Output
- ✓ Timestamps bei allen Logs
- ✓ Debug-Modus mit `-d`/`--debug`
- ✓ Schritt-für-Schritt Fortschritt

### 🔧 Plattformspezifische Unterstützung
- ✓ Windows-spezifische Requirements
- ✓ macOS-spezifische Requirements
- ✓ Linux-spezifische Requirements
- ✓ Automatische OS-Erkennung

### 📦 Intelligente Installation
- ✓ Prüfung auf existierende Installation
- ✓ Yarn-Fallback zu npm
- ✓ Python3/Python Fallback
- ✓ Saubere Installation mit `--clean`

## 🔄 Was wird installiert?

### Frontend
```
Frontend-Abhängigkeiten (via yarn/npm)
├─ React & TypeScript
├─ Vite Build-Tool
├─ Monaco Editor
├─ Electron
└─ Weitere UI-Komponenten
```

### Backend
```
Backend-Abhängigkeiten (via pip)
├─ FastAPI
├─ Python Dependencies (OS-spezifisch)
├─ spaCy NLP Models
└─ Weitere Backend-Tools
```

### Umgebung
```
Konfiguration
├─ .env File (falls nicht vorhanden)
└─ Environment Variables
```

## 📊 Script-Ablauf

```
1. Parse Arguments
2. Check Prerequisites
3. Check Ports
4. Setup Frontend (yarn/npm install)
5. Setup Backend (pip install)
6. Setup Environment (.env)
7. Summary & Troubleshooting
8. Optional: Starte Anwendung
```

## 🆘 Troubleshooting

### Problem: "Node.js nicht gefunden"
```bash
# Installiere Node.js von https://nodejs.org/
# Dann versuche erneut:
build.bat
```

### Problem: "Port 23816 bereits in Verwendung"
```bash
# Windows: Finde Prozess und beende ihn
netstat -an | findstr :23816
taskkill /PID <PID> /F

# macOS/Linux: 
lsof -i :23816
kill -9 <PID>
```

### Problem: "Python-Abhängigkeiten fehlgeschlagen"
```bash
# Erstelle virtuelle Umgebung
python -m venv venv

# Aktiviere sie
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Versuche Installation erneut
build.bat --clean
```

### Problem: "yarn: command not found"
Das Script fällt automatisch zu npm zurück. Alternativ installiere Yarn:
```bash
npm install -g yarn
```

## 🎯 Start nach Installation

Nach erfolgreicher Installation hast du mehrere Optionen:

### Option 1: Entwicklungsmodus (empfohlen)
```bash
yarn dev
```
Startet Frontend, Backend und optional Electron zusammen.

### Option 2: Produktionsmodus
```bash
node start-pointer.js
```

### Option 3: Komponenten separat
```bash
# Terminal 1: Backend
cd backend
python run.py

# Terminal 2: Frontend
yarn start

# Terminal 3: Electron (optional)
yarn electron:dev
```

## 🔐 Environment Variablen

Das Script erstellt eine `.env` Datei mit Standard-Konfiguration:

```env
# Backend API URL
VITE_API_URL=http://localhost:23816

# Development Server Port
VITE_DEV_SERVER_PORT=3000

# Debug Mode
DEBUG=false

# Optional: OpenAI API Key
# OPENAI_API_KEY=your_key_here
```

Passe diese nach Bedarf an.

## 📈 Performance-Tipps

- **`--skip-checks`** für schnellere Startups wenn alles okay ist
- Verwende **`--clean`** nur bei ernsthaften Problemen
- Aktiviere **`--debug`** zur Fehlersuche
- Nutze separate Terminals für jede Komponente beim Debugging

## 🆓 Kostenlos & Open Source

Diese Scripts sind Teil des Pointer Projekts und unter MIT License verfügbar.

## 📞 Support

Bei Problemen:
1. Versuche `./build.sh --clean --debug`
2. Prüfe die Troubleshooting-Sektion
3. Öffne einen Issue im Repository

---

**Viel Spaß mit Pointer! 🚀**
