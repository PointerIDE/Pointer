# Pointer Local-AI-first Baseline

Stand: 2026-07-16, Europe/Berlin

Dieser Bericht ist die verpflichtende Ausgangslage vor der Local-AI-first-, Settings-, Popup-, Theme- und Packaging-Arbeit. Er dokumentiert auch nicht ausführbare Prüfungen, damit fehlende Ergebnisse nicht als erfolgreiche Messungen erscheinen.

## Arbeitsbaum und Schutz bestehender Änderungen

Der Arbeitsbaum war bereits vor dieser Arbeit ungewöhnlich und umfangreich verändert:

- 14.448 vorgemerkte Löschungen
- 14.360 ungetrackte Wiederanlagen
- Branch `main`

Dieser Zustand wird als absichtlicher Nutzerzustand behandelt. Es wurden keine vorhandenen Änderungen zurückgesetzt, gelöscht oder überschrieben. Generierte Dependencies und Messdaten liegen unter `node_modules/`, `.build/` und `.codex-tools/`.

## Laufzeit- und Build-Baseline

| Metrik | Ausgangswert | Nachweis / Einschränkung |
|---|---:|---|
| Node.js | 22.22.1 | Durch das vorgesehene Dev-Skript nach `.codex-tools/node-v22.22.1-win-x64/` geladen. |
| Workbench-Contribution-Registrierungen | 289 | Statische Zählung von `registerWorkbenchContribution2(...)`. |
| Contribution-Phasenreferenzen | BlockStartup 52, Starting 11, Ready 17, Restored 113, Eventually 120 | Statische Referenzzählung; dies ist keine dynamische Aktivierungszahl. |
| Extension-Manifeste | 118 | Lokale `extensions/**/package.json`. |
| Explizite eager Extension-Aktivierungen | `*`: 3, `onStartupFinished`: 5 | Statische Manifestzählung. |
| Cold Start | nicht messbar | Der Main-Prozess beendet sich vor der Workbench wegen fehlender nativer Module. |
| Warm Start | nicht messbar | Kein erfolgreicher Cold Start. |
| stabiler Speicherverbrauch | nicht messbar | Kein stabiler Renderer-Prozess. |
| verpackter Release-Build | nicht vorhanden | `.build/artifacts/Pointer-win32-x64/` und ZIP fehlen. |
| Release-Größe | nicht messbar | Kein vorhandenes oder in dieser Umgebung baubares Baseline-Artefakt. |
| Screenshots | nicht verfügbar | Die Workbench wurde vor dem Prozessabbruch nicht erzeugt. |

### Reproduzierbare Blocker

1. `scripts/dev-windows.ps1 -SetupOnly` installiert Root-, Build- und Extension-Dependencies, scheitert aber beim regulären Electron-Schritt. `@vscode/gulp-electron` verlangt `C:\Program Files (x86)\Windows Kits\10\bin\`; Windows SDK und Visual Studio 2022 C++ Build Tools fehlen.
2. Eine ausschließlich für die UI-Baseline manuell geladene Electron-39.8.8-Runtime wurde gegen den Repository-Hash `657d5dc5a71b6aaa506bf83f311cd95a3f5221fcd2c258c108bcdf2043214c86` geprüft. Sie ersetzt keinen Release-Build.
3. `npm run transpile-client` ist erfolgreich: 5.810 TypeScript-Dateien und 1.303 Ressourcen wurden nach `out/` geschrieben.
4. Der Main-Prozess startet den CDP-Port, fällt dann aber wegen fehlender nativer Outputs aus. Belegt sind mindestens `@vscode/deviceid`, `@vscode/windows-registry` und `@vscode/spdlog`; `@vscode/policy-watcher` fällt kontrolliert auf No-op zurück.
5. `npm run compile` scheitert unabhängig davon in `extensions/mermaid-chat-features`, weil `mermaid` und `@vscode/codicons/dist/codicon.css` im Extension-Unterprojekt fehlen.

Mess- und Fehlerlogs liegen im timestamped Ordner `.codex-tools/baseline-20260716-225642/`.

## Priorisierte Bestandsaufnahme

### Kaputt oder unvollständig

- Der dokumentierte First-Time-Dev-Setup kann auf der aktuellen Maschine ohne Windows SDK/C++ Toolchain keine startbare App herstellen.
- Der vollständige Compile-Pfad stellt nicht alle Subprojekt-Dependencies für `mermaid-chat-features` bereit.
- Accountfreies Local AI ist logisch blockiert: Die BYOK-Beiträge einschließlich Ollama und LM Studio werden im Copilot-Conversation-Feature erst mit vorhandenem Copilot-Token konstruiert.
- Neue Provider-Profile speichern als `secret` deklarierte Werte derzeit im Klartext in `chatLanguageModels.json`; vorhandene Tests bestätigen dieses Verhalten ausdrücklich.
- Ollama wird ohne gespeicherte Konfiguration trotz Default-URL nicht erkannt.
- Verbindungstests besitzen nur `{ success, models, error? }`; konkrete Fehlerklassen, abbrechbare kurze Timeouts und sichere Detailbehandlung fehlen.

### Doppelt

- `ProviderSetupEditor`, `languageModelsDialog.ts`, `ModelsManagementEditor` und der JSON-Konfigurationsweg bilden mehrere Modell-/Provider-Oberflächen.
- Provider-Kataloge und Formschemas sind in UI-Code und Extension-Deskriptoren parallel definiert und bereits bei Azure inkonsistent.
- Das normale Settings UI und prominente Settings-/Language-Models-JSON-Befehle stehen gleichrangig nebeneinander.

### Aufdringlich

- `workbench.welcomePage.experimentalOnboarding` ist standardmäßig aktiv und kann den Sign-in-Zweig vor Dismiss-/Completed-Prüfungen öffnen.
- Haupt-App-Defaults aktivieren Welcome Page, Walkthrough-Auto-Open, Watermark-Tipps, Chat-Tipps und Release Notes.
- Provider-Listen sortieren Cloud vor Local; Speichern/Refresh kann alle Provider statt nur den bearbeiteten Vendor anfragen.
- Der BYOK-Beitrag lädt bei Konstruktion eine externe Copilot-Metadaten-URL, bevor Provider registriert werden.

### Inkonsistent

- Pointer Dark und Pointer Light ebnen Error/Warning/Info sowie Git Added/Modified/Deleted weitgehend auf dieselben Grautöne ein.
- Nachweisbare Kontraste liegen teils nur zwischen 1,34:1 und 2,08:1.
- Settings blendet unter 700 px die Navigation vollständig aus; ein Drawer oder Picker fehlt, feste 320/420-px-Controls können abschneiden.
- Die aktuelle Settings-Top-Level-Struktur entspricht nicht der Pointer-Zielstruktur und enthält keinen integrierten Bereich `AI & Models`.

### Optional oder experimentell

- Notebooks, Simple Browser, Tunnel Forwarding, Terminal Suggestions, Mermaid Chat Rendering und Remote-Agent-Tunnel bleiben zunächst erhalten und werden nur anhand realer Aktivierungs- und Paketmessungen beurteilt.
- Experimentelle/debug-orientierte Copilot-Kommandos und Menübeiträge sollen zuerst aus normalen Oberflächen entfernt werden; Command-IDs bleiben kompatibel.

### Entwicklung/Test

- `vscode-api-tests`, `vscode-colorize-tests`, `vscode-colorize-perf-tests` und `vscode-test-resolver` sind bereits aus normalem Release-Packaging ausgeschlossen.
- Sie werden nicht physisch gelöscht. Eine Packaging-Assertion soll den Ausschluss absichern.

### Essenzieller Core

- Editor, Explorer, Suche, Dateien, Settings, Terminal, Git/SCM, grundlegendes Debugging, Extension-System, Theme Defaults und grundlegende Sprachen bleiben erhalten.
- Die Copilot-Extension bleibt als Träger der vorhandenen Local-/BYOK-Provider erhalten; Cloud- und Promotion-Flows werden darin opt-in und ruhig gemacht.

## Betroffene Einstiegspunkte

| Bereich | Primäre Dateien / Services |
|---|---|
| Provider-/Modell-Core | `src/vs/workbench/contrib/chat/common/languageModels.ts`, `languageModelsConfiguration.ts`, `browser/languageModelsConfigurationService.ts` |
| Provider-UI | `src/vs/workbench/contrib/chat/browser/chatManagement/providerSetupEditor.ts`, `chatManagement.contribution.ts`, `languageModelsDialog.ts`, `chatManagementEditor.ts` |
| Extension-Bridge | `src/vs/workbench/api/common/extHostLanguageModels.ts`, `api/browser/mainThreadLanguageModels.ts` |
| BYOK und Local Provider | `extensions/copilot/src/extension/byok/vscode-node/byokContribution.ts`, `abstractLanguageModelChatProvider.ts`, `ollamaProvider.ts`, `lmStudioProvider.ts`, `customOAIProvider.ts` |
| Settings | `src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts`, `settingsLayout.ts`, `media/settingsEditor2.css`, `preferences.contribution.ts` |
| Startup/Popups | `src/vs/workbench/contrib/welcomeGettingStarted/browser/startupPage.ts`, `gettingStarted.contribution.ts`, Chat-Setup-/Tip-Beiträge, Update-Contribution |
| Themes | `extensions/theme-defaults/themes/pointer-dark.json`, `pointer-light.json`, `src/vs/workbench/services/themes/common/workbenchThemeService.ts` |
| Packaging | `build/lib/extensions.ts`, `build/lib/copilot.ts`, `build/gulpfile.vscode.ts`, `.moduleignore`, `product.json` |

## Cleanup-Matrix

| Kandidat | Gruppe | Entscheidung vor Änderung | Risiko | belegte Größenwirkung | Nachweis nach Änderung |
|---|---|---|---|---:|---|
| Interne Copilot Debug/Test/Trace Commands und Menüs | Experimentell/Dev | Aus normalen Menüs/Palette verbergen, IDs behalten | Niedrig bis mittel | keine Paketwirkung | Menüinventar, Chat-/Agent-Smoke |
| `terminal-suggest` eager Verhalten | Optional/Experimentell | Default zunächst deaktivieren, Aktivierung messen | Mittel | Quellinput ca. 2,10 MiB, Paketwirkung offen | Terminal-Suggest- und Shell-Integration-Tests |
| `@github/copilot/mxc-bin` Fremdplattformen | Packaging-Bloat | Nur zielplattform-/zielarchitekturfremde Binaries beim Packaging filtern | Mittel | mindestens 18,02 MiB theoretisch auf win32-x64 | Paketliste/-größe, Copilot CLI/AgentHost-Smoke |
| JS Debug Companion / Profile Table | Optional | Behalten, bis Download-Manifeste und Debug-Abhängigkeiten geprüft sind | Hoch | offen | JS-Debug und Profiling mit Paket-Diff |
| Notebooks | Optional | Behalten; Auto-Angebote ruhig halten | Mittel | erwartbar gering | Notebook-Serializer/Renderer-Smokes |
| Simple Browser | Optional | Behalten; geringe Wirkung | Niedrig | Quellbaum ca. 0,04 MiB | External-URI-/Webview-Smoke |
| Tunnel Forwarding / AgentHost-Tunnel | Optional | UI opt-in; keine Entfernung ohne Remote-Produktentscheidung | Hoch | Extension klein, Root-Tunnelpakete ca. 2,47 MiB | Tunnel-, SSH- und Local-Session-Smokes |
| Browser View / `playwright-core` | Optional | Lazy/opt-in behalten | Hoch | lokal ca. 8,27 MiB ohne Maps/TS | Browser-Tool-/Agent-/Offline-Smokes |
| 1DS/TAS-Pakete | Experimentell/Telemetry | Erst Netzwerk-Inaktivität ohne Product-Endpunkt beweisen | Mittel bis hoch | 1DS lokal ca. 2,36 MiB | Offline-Netzwerk- und Telemetry-Service-Tests |
| Testextensions | Entwicklung/Test | bestehenden Ausschluss beibehalten | Niedrig | bereits ausgeschlossen | Release-Packaging-Assertion |
| Sprachgrammatiken | Core/Optional | bewusst erhalten | Niedrig | geringe Einzelerträge | Syntax-/Language-Smokes |

## Erste Implementierungsreihenfolge

1. SecretStorage-Verhalten testgetrieben korrigieren und Klartextmigration ergänzen.
2. Local-Provider von Account-/Token-Gating entkoppeln; externe Metadaten und Cloud-Provider lazy machen.
3. Ollama/LM Studio lokal-first, kurz, abbrechbar und ohne Popup erkennen.
4. Einen autoritativen Provider-Katalog verwenden und Provider-Management in das visuelle Settings Center leiten.
5. Startup-/Popup-Defaults beruhigen, kritische Warnungen unverändert erhalten.
6. Dark/Light-Semantik und Settings-Responsive-Verhalten mit Kontrast-/A11y-Tests überarbeiten.
7. Erst nach baubarem Release `mxc-bin` und weitere Kandidaten anhand echter Paket-Diffs filtern.

## Offene Baseline-Risiken

- Visuelle Zustände, Terminal, Git/SCM, Extensions und AI-Flows konnten wegen der fehlenden nativen Toolchain nicht in der laufenden App geprüft werden.
- Der fehlende Baseline-Release verhindert eine ehrliche Vorher-/Nachher-Größenangabe. Theoretische Einsparungen werden bis zu einem echten Paket-Build ausdrücklich nicht als realisiert bezeichnet.
- Die ungewöhnliche Git-Indexlage erschwert normale Diff-Auswertung. Geänderte Dateien werden deshalb zusätzlich explizit protokolliert.
