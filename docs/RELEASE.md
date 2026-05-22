# Pointer Release Build

## Was ist ein Release-Build?

Ein Release-Build ist die fertige Version von Pointer, die an andere Nutzer weitergegeben werden kann.

### Unterschied zum Dev-Modus

| | Dev-Modus | Release-Build |
|---|---|---|
| Starter | `run\start-dev.bat` | `run\build-pointer.bat` |
| Kompilierung | Watcher (esbuild, live) | Gulp (vollständiger Build) |
| Minifizierung | Nein | Ja (JS + CSS) |
| ASAR-Paketierung | Nein (läd aus `out/`) | Ja (`app.asar`) |
| Native Module | System-Version | Neu-kompiliert für Electron |
| Icon | Standard | `resources/win32/code.ico` |
| Zweck | Entwicklung | Tester / Nutzer |
| Output | Kein finales App-Verzeichnis | `.build/artifacts/` |

---

## Wichtig: Pointer ist Pointer

Pointer wird als eigenständige App gebaut und ausgeliefert.

Pointer ist:
- ein **eigener Build** aus dem Code-OSS-Upstream
- ein **eigener Rebrand** (Name, Icons, App-IDs)
- **kein** offizielles Microsoft-Produkt
- **nicht** Microsoft-signiert
- aktuell **nicht code-signiert**
- **nicht** automatisch identisch mit irgendeinem anderen Editor-Download
- **ohne** Zugang zum offiziellen Microsoft Marketplace (Open VSX wird empfohlen)

---

## Voraussetzungen

| Komponente | Version | Zweck |
|---|---|---|
| Node.js | 22.22.1 | Wird automatisch heruntergeladen falls nötig |
| npm | 10.x | Paketmanager (im Node.js-Paket enthalten) |
| Visual Studio 2022 | C++ Desktop Workload | Native Module Kompilierung (node-gyp) |
| Python | 3.x | node-gyp Abhängigkeit |
| Inno Setup | 6.x (optional) | Installer-Erstellung |

Node.js 22.22.1 wird automatisch vom Build-Skript nach `.codex-tools/node-v22.22.1-win-x64/` heruntergeladen,
falls nicht vorhanden. Es muss **nicht** manuell installiert werden.

Die VS DevShell wird automatisch erkannt und gestartet falls nötig.

---

## Release bauen

### Einfacher Build (portable App)

```bat
run\build-pointer.bat
```

### Build mit ZIP

```bat
run\build-pointer.bat --Zip
```

### Build mit Installer (Inno Setup)

```bat
run\build-pointer.bat --Installer
```

### Build mit Installer + ZIP

```bat
run\build-pointer.bat --Installer --Zip
```

Vor einem öffentlichen Release siehe zusätzlich `docs/LAUNCH_CHECKLIST.md`.

### Alle Flags

| Flag | Beschreibung |
|---|---|
| `--Arch x64` | Architektur (Standard: x64, Alternativ: arm64) |
| `--SkipInstall` | npm-Installation überspringen (schneller wenn up-to-date) |
| `--Fresh` | Komplett-Neuinstallation aller Dependencies |
| `--Installer` | Inno Setup Installer erstellen |
| `--Zip` | ZIP-Archiv der portablen App erstellen |
| `--NativeJobs max` | Native Rebuilds parallelisieren (für CI empfohlen; lokal konservativ lassen) |

### Beispiel: Frischer Build mit Installer und ZIP

```bat
run\build-pointer.bat --Fresh --Installer --Zip
```

---

## Build-Ablauf im Detail

### Schritt 1: VS DevShell sicherstellen

Das Skript prüft ob es in einer Visual Studio Developer Command Prompt läuft.
Falls nicht, wird es sich automatisch in einer neuen starten:

1. Sucht `VsDevCmd.bat` in diesen Pfaden:
   - `C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat`
   - `C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat`
   - `C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat`
   - `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat`
2. Startet PowerShell neu mit `-arch=x64 -host_arch=x64`
3. Fügt die lokale Node.js Runtime zum PATH hinzu

### Schritt 2: Node.js sicherstellen

Prüft ob `.codex-tools/node-v22.22.1-win-x64/node.exe` existiert.
Falls nicht, wird Node.js von `https://nodejs.org/dist/v22.22.1/` heruntergeladen
und nach `.codex-tools/` entpackt.

### Schritt 3: npm Dependencies installieren

1. **Root** (`npm ci --ignore-scripts`):
   - Installiert alle Hauptabhängigkeiten
   - Ohne Build-Scripts (werden später ausgeführt)
   - Speed-up: Wird übersprungen wenn `node_modules/` bereits gesund ist

2. **Node-Gyp Headers**:
   - Installiert die C++ Headers für die Electron-Version (39.8.8)
   - Wird benötigt für native Module Kompilierung
   - Versucht mehrere Mirror-URLs bei Download-Fehlern

3. **SpectreMitigation Patching**:
   - Entfernt `/Qspectre` Compiler-Flags aus allen `.gyp` Dateien
   - Verhindert Build-Fehler mit Standard-Windows-SDKs

4. **Native Module Rebuild**:
   - Neu-kompiliert alle nativen Module mit MSVC
   - Wird nur ausgeführt wenn kein Marker-File existiert
   - Marker: `.codex-tools/native-rebuild-x64.marker`
   - Module: `@vscode/spdlog`, `@vscode/sqlite3`, `@vscode/ripgrep`, `node-pty`, `kerberos`, etc.

5. **Electron Download**:
   - Lädt Electron 39.8.8 nach `.build/electron/`
   - Die Binary wird auf den Namen aus `product.json.nameShort` umbenannt (`Pointer.exe`)

6. **Sub-Projekte**:
   - Installiert Dependencies in `build/`, `extensions/`
   - Und in ca. 30 Extension-Unterordnern

### Schritt 4: Built-In Extensions herunterladen

Lädt die in `product.json` definierten Extensions herunter:
- `ms-vscode.js-debug-companion`
- `ms-vscode.js-debug`
- `ms-vscode.vscode-js-profile-table`

Landen in `.build/builtInExtensions/`.

### Schritt 5: Policies generieren

Generiert Windows Group Policy Dateien für Enterprise-Deployment nach `.build/policies/`.

### Schritt 6: Gulp Build (vscode-win32-x64)

Der Haupt-Paketierungs-Task in `build/gulpfile.vscode.ts`:

1. TypeScript kompilieren nach `out-build/`
2. JS/CSS minifizieren
3. Electron Pack (`@vscode/gulp-electron`)
4. `product.json` mit Commit-Hash und Versionsinfo anreichern
5. ASAR-Archiv erstellen (`app.asar`)
6. Ressourcen kopieren (Icons, HTML, NLS)
7. Native `.node` Module kopieren
8. Built-In Extensions kopieren
9. EXE-Icon setzen (`rcedit` auf `resources/win32/code.ico`)
10. Output: `../Pointer-win32-x64/` (ein Ordner über dem Repo-Root)

### Schritt 7: Inno Updater kopieren

Kopiert `build/win32/inno_updater.exe` und `vcruntime140.dll` in den Build
und setzt das Icon. Dies wird für Auto-Updates benötigt.

### Schritt 8: Post-Processing (Pointer-spezifisch)

1. Ordner `../Pointer-win32-x64/` wird nach `.build/artifacts/Pointer-win32-x64/` kopiert
2. Die EXE heißt `Pointer.exe`
3. Der temporäre Ordner wird aufgeräumt

### Schritt 9: ZIP (optional)

Erstellt `.build/artifacts/Pointer-win32-x64.zip` aus dem portablen Ordner.

### Schritt 10: Installer (optional)

Führt Gulp-Task `vscode-win32-x64-user-setup` aus:
1. Generiert Inno Setup Definitions aus `product.json`
2. Ruft ISCC.exe mit `build/win32/code.iss` auf
3. Erstellt `.build/artifacts/PointerSetup-x64-<version>.exe`

---

## Output-Struktur

Nach einem erfolgreichen Build mit `--Installer --Zip`:

```
.build/artifacts/
├── Pointer-win32-x64/              # Portable App
│   ├── Pointer.exe                 # Haupt-Executable
│   ├── resources/
│   │   └── app/
│   │       ├── app.asar            # Komprimierter App-Code
│   │       ├── product.json        # Versionsinfo
│   │       └── extensions/         # Built-In Extensions
│   ├── tools/
│   │   └── inno_updater.exe        # Update-Helper
│   └── ...
├── Pointer-win32-x64.zip           # ZIP der portablen Version
└── PointerSetup-x64-<version>.exe  # Windows Installer
```

---

## Temporäre Dateien

Diese Dateien werden während des Builds erstellt und danach bereinigt:

| Pfad | Beschreibung |
|---|---|
| `../Pointer-win32-x64/` | Temporärer Gulp-Package-Output |
| `.build/win32-x64/user-setup/` | Temporärer Inno Setup Output |
| `.codex-tools/logs/` | Build-Logs (bleiben erhalten) |

---

## Build-Logs

Jeder Build erzeugt detaillierte Logs unter:

```
.codex-tools/logs/<YYYYMMDD-HHMMSS>-<PID>/
├── root-npm-ci-ignore-scripts.log
├── node-gyp-headers-...-attempt-1.log
├── root-rebuild-@vscode_sqlite3.log
├── download-electron.log
├── download-builtin-extensions.log
├── generate-win32-policies.log
├── gulp-vscode-win32-x64.log
├── gulp-vscode-win32-x64-inno-updater.log
└── ...
```

Der Pfad zum letzten Build steht in:
```
.codex-tools/logs/latest-run.txt
```

---

## Fehlerbehebung

### "Visual Studio Build Tools not found"

Installiere Visual Studio 2022 mit der **C++ Desktop Workload**:
- [Visual Studio 2022 Community](https://visualstudio.microsoft.com/downloads/)
- Bei der Installation: "Desktopentwicklung mit C++" auswählen

### "node-gyp Fehler / MSB8020"

Die VS DevShell wird automatisch gestartet. Falls das nicht funktioniert:
1. Öffne "Developer Command Prompt for VS 2022"
2. Navigiere zum Projektordner
3. Führe `run\build-pointer.bat` aus

### "Cannot find module 'electron'"

```bat
node build/lib/electron.ts
```
Das wird normalerweise automatisch vom Build-Skript ausgeführt.

### "MODULE_NOT_FOUND" während Gulp-Task

Das Build-Skript hat ein Auto-Repair-System:
- Erkennt fehlende Module im Gulp-Log
- Führt `npm ci` in root, build, und extensions aus
- Wiederholt den fehlgeschlagenen Task einmal

Manuell beheben:
```bat
npm ci --ignore-scripts
cd build && npm ci
cd ../extensions && npm ci
```

### Watcher funktionieren nicht nach einem Build

```bat
run\dev-stop.bat
run\start-dev.bat
```

---

## Weiterführende Dokumentation

- `AGENTS.md` - Vollständige Projekt-Dokumentation für Agenten
- `docs/LAUNCH_CHECKLIST.md` - Release-Checkliste, Smoke-Test und Signatur-Hinweis
- `build/gulpfile.vscode.ts` - Paketierungs-Task (Quellcode)
- `build/gulpfile.vscode.win32.ts` - Windows-spezifische Tasks
- `build/win32/code.iss` - Inno Setup Installer-Skript
- `product.json` - Branding-Konfiguration
- `package.json` - Dependencies und NPM-Scripts
