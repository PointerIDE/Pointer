# Milestone 1 Audit Report: Core Rebranding & Installer Pipeline

## Executive Summary

An in-depth, read-only investigation was conducted into **Milestone 1 (Installer and Core Rebranding)** across the Pointer workspace. The objective was to audit all configuration values, packaging names, executable rename steps, and app identifiers to verify that release builds produce `PointerSetup-x64.exe` and `Pointer-win32-x64` with 100% Pointer branding and no fallback to Code OSS or VS Code naming.

### Overall Assessment
The codebase has undergone substantial rebranding for Pointer:
- `product.json` correctly sets short/long app names to `"Pointer"`, internal binary to `"pointer"`, data folders to `".pointer"`, and app user model ID to `"Pointer.Pointer"`.
- Gulp packaging in `build/gulpfile.vscode.ts` targets `..\Pointer-win32-x64` and names the primary binary `Pointer.exe`.
- Inno Setup config in `build/win32/code.iss` uses `OutputBaseFilename=PointerSetup` and publisher `Pointer Team`.
- Release launcher `run/build-pointer.bat` delegates to `scripts/build-pointer-release.ps1`.

However, **5 specific issues and discrepancies** were identified that could cause branding fallbacks, incomplete executable metadata, or missing installer artifact filenames during release generation and test validation.

---

## Detailed Audit Findings by Component

### Component 1: `product.json` Configuration
- **File**: `c:\Users\User\Documents\Pointer\product.json`
- **Audit Findings**:
  - `nameShort`: `"Pointer"` ✅
  - `nameLong`: `"Pointer"` ✅
  - `applicationName`: `"pointer"` ✅
  - `dataFolderName`: `".pointer"` ✅
  - `sharedDataFolderName`: `".pointer-shared"` ✅
  - `win32MutexName`: `"pointer"` ✅
  - `win32DirName`: `"Pointer"` ✅
  - `win32NameVersion`: `"Pointer"` ✅
  - `win32RegValueName`: `"Pointer"` ✅
  - `win32AppUserModelId`: `"Pointer.Pointer"` ✅
  - `win32ShellNameShort`: `"&Pointer"` ✅
  - `darwinBundleIdentifier`: `"com.pointer.app"` ✅
  - `linuxIconName`: `"pointer"` ✅
  - `urlProtocol`: `"pointer"` ✅
  - `serverApplicationName`: `"pointer-server"` ✅
  - `serverDataFolderName`: `".pointer-server"` ✅
  - `tunnelApplicationName`: `"pointer-tunnel"` ✅
- **Identified Caveat / Residual Reference**:
  - Line 36: `"webviewContentExternalBaseUrlTemplate": "https://{{uuid}}.vscode-cdn.net/..."` contains a reference to `vscode-cdn.net`. While functional for remote webview isolation when online, offline or airgapped environments require local static assets.

---

### Component 2: Gulp Packaging Scripts & Build Helper Libraries
- **Files**:
  - `c:\Users\User\Documents\Pointer\build\gulpfile.vscode.ts`
  - `c:\Users\User\Documents\Pointer\build\gulpfile.vscode.win32.ts`
  - `c:\Users\User\Documents\Pointer\build\lib\electron.ts`

- **Audit Findings**:
  - `build/gulpfile.vscode.ts` line 660 constructs `destinationFolderName = Pointer-win32-x64` for Windows x64.
  - `build/gulpfile.vscode.ts` lines 289-290 patch `package.json` inside the build output with `name: "Pointer"`.
  - `build/gulpfile.vscode.win32.ts` lines 84-113 construct Inno Setup definitions passing `NameLong: "Pointer"`, `NameShort: "Pointer"`, `DirName: "Pointer"`, `ExeBasename: "Pointer"`, `RegValueName: "Pointer"`, `AppMutex: "pointer"`, `AppUserId: "Pointer.Pointer"`.
  - `build/gulpfile.vscode.win32.ts` line 165 updates `inno_updater.exe` icon using `resources/win32/code.ico`.

- **CRITICAL FINDING (Issue #1)**:
  - `build/lib/electron.ts` lines 110-111 specify hardcoded Microsoft metadata:
    ```ts
    110: companyName: 'Microsoft Corporation',
    111: copyright: 'Copyright (C) 2026 Microsoft. All rights reserved',
    ```
  - **Impact**: `@vscode/gulp-electron` uses `config.companyName` and `config.copyright` to stamp Windows executable properties into `Pointer.exe`. Unless modified, `Pointer.exe` retains `CompanyName = "Microsoft Corporation"` in Windows file properties (Details tab in Explorer).

---

### Component 3: Release Launchers & Build Scripts
- **Files**:
  - `c:\Users\User\Documents\Pointer\run\build-pointer.bat`
  - `c:\Users\User\Documents\Pointer\scripts\build-pointer-release.ps1`
  - `c:\Users\User\Documents\Pointer\scripts\build-windows.ps1`

- **Audit Findings**:
  - `run/build-pointer.bat` invokes `scripts/build-pointer-release.ps1`.
  - `scripts/build-pointer-release.ps1` line 686 runs `vscode-win32-x64`, line 687 runs `vscode-win32-x64-inno-updater`, line 705 runs `vscode-win32-x64-user-setup`.
  - Line 690 validates `$packageExe = Join-Path $packageDir 'Pointer.exe'`.
  - Line 706 checks for `$setupExe = Join-Path $Root ".build\win32-$Arch\user-setup\PointerSetup.exe"`.

- **CRITICAL FINDING (Issue #2)**:
  - `scripts/build-pointer-release.ps1` line 710 copies the installer as:
    ```powershell
    $artifactSetup = Join-Path $ArtifactsDir "PointerSetup-$Arch-$version.exe"
    ```
  - **Impact**: The script outputs `.build\artifacts\PointerSetup-x64-1.119.0.exe`. Requirement R1 in `PROJECT.md` and task specifications require release builds to output `PointerSetup-x64.exe` (without version string). Tooling or downstream CI looking specifically for `.build\artifacts\PointerSetup-x64.exe` will fail unless `PointerSetup-x64.exe` is also created.

- **FINDING (Issue #3)**:
  - `scripts/build-windows.ps1` line 672 contains legacy Code-OSS naming:
    ```powershell
    $artifactSetup = Join-Path $ArtifactsDir "CodeOSSUserSetup-$Arch-$version.exe"
    ```
  - **Impact**: Invoking the legacy PowerShell script `scripts/build-windows.ps1` directly outputs `CodeOSSUserSetup-x64-1.119.0.exe`.

---

### Component 4: Inno Setup & Installer Customization
- **Files**:
  - `c:\Users\User\Documents\Pointer\build\win32\code.iss`
  - `c:\Users\User\Documents\Pointer\build\win32\i18n\messages.en.isl`
  - `c:\Users\User\Documents\Pointer\resources\win32\*`

- **Audit Findings**:
  - `build/win32/code.iss`:
    - `AppName={#NameLong}` -> `"Pointer"`
    - `AppPublisher=Pointer Team`
    - `AppPublisherURL=https://github.com/PointerIDE/Pointer`
    - `OutputBaseFilename=PointerSetup`
    - `SetupIconFile={#RepoDir}\resources\win32\code.ico`
    - `WizardImageFile` points to `resources\win32\inno-big-*.bmp`
    - `WizardSmallImageFile` points to `resources\win32\inno-small-*.bmp`
  - `build/win32/i18n/messages.en.isl`:
    - Line 17: `UpdatingVisualStudioCode=Updating Pointer...`
  - `resources/win32/code.ico`: Exists on disk (48 KB) containing the Pointer icon.

---

### Component 5: Test Infrastructure Hardcoded Binary Expectations
- **File**: `c:\Users\User\Documents\Pointer\test\sanity\src\context.ts`
- **Audit Findings**:
  - Lines 769 and 971 hardcode executable names during test setup:
    ```ts
    769: entryPoint = path.join(appDir, 'Code.exe');
    971: exeName = 'Code.exe';
    ```
- **FINDING (Issue #4)**:
  - Sanity test automation looks for `Code.exe` instead of `Pointer.exe` (`product.nameShort + '.exe'`), which will cause E2E/sanity validation tests on packaged builds to fail.

---

## Actionable Fix Strategies

| # | File Path | Field / Line | Current Behavior | Recommended Fix Strategy |
|---|-----------|--------------|------------------|--------------------------|
| 1 | `build/lib/electron.ts` | Lines 110-111 | `companyName: 'Microsoft Corporation'`, `copyright: 'Copyright (C) 2026 Microsoft...'` | Change `companyName` to `'Pointer Team'` and `copyright` to `'Copyright (C) 2026 Pointer Team'`. |
| 2 | `scripts/build-pointer-release.ps1` | Line 710 | `$artifactSetup = Join-Path $ArtifactsDir "PointerSetup-$Arch-$version.exe"` | Copy `$setupExe` to BOTH `PointerSetup-$Arch-$version.exe` AND `PointerSetup-$Arch.exe` (e.g. `PointerSetup-x64.exe`) in `$ArtifactsDir`. |
| 3 | `scripts/build-windows.ps1` | Line 672 | `"CodeOSSUserSetup-$Arch-$version.exe"` | Update to output `"PointerSetup-$Arch-$version.exe"` and `"PointerSetup-$Arch.exe"`. |
| 4 | `test/sanity/src/context.ts` | Lines 769, 971 | `entryPoint = path.join(appDir, 'Code.exe')`, `exeName = 'Code.exe'` | Replace `'Code.exe'` with `product.nameShort + '.exe'` (`Pointer.exe`). |
| 5 | `product.json` | Line 36 | `webviewContentExternalBaseUrlTemplate` references `vscode-cdn.net` | Note reference for offline asset bundling support in future milestones. |

---

## Summary of Release Artifacts After Recommended Fixes

Upon applying the fix strategies, running `run\build-pointer.bat --Zip --Installer` will output under `.build\artifacts\`:
1. `Pointer-win32-x64\` — Extracted portable release containing `Pointer.exe` with `CompanyName = "Pointer Team"`.
2. `Pointer-win32-x64.zip` — Compressed portable distribution.
3. `PointerSetup-x64.exe` — Windows User Installer (Inno Setup) matching R1 spec.
4. `PointerSetup-x64-1.119.0.exe` — Version-tagged Windows User Installer.
