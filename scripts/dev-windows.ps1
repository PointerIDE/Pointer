[CmdletBinding()]
param(
	[ValidateSet('x64', 'arm64')]
	[string]$Arch = 'x64',
	[switch]$NoRestartWatch,
	[switch]$NoDetach,
	[switch]$SetupOnly,
	[switch]$InVsDevShell
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$NodeVersion = (Get-Content (Join-Path $Root '.nvmrc') -Raw).Trim().TrimStart('v')
$NodeZipName = "node-v$NodeVersion-win-x64"
$ToolsDir = Join-Path $Root '.codex-tools'
$NodeDir = Join-Path $ToolsDir $NodeZipName
$CodeBat = Join-Path $Root 'scripts\code.bat'
$NodeExe = Join-Path $NodeDir 'node.exe'
$NpmCmd = Join-Path $NodeDir 'npm.cmd'

function Get-NativeHealthCheckPaths {
	return @(
		'node_modules\@vscode\deviceid\build\Release\windows.node',
		'node_modules\@vscode\policy-watcher\build\Release\vscode-policy-watcher.node',
		'node_modules\@vscode\ripgrep\bin\rg.exe',
		'node_modules\@vscode\spdlog\build\Release\spdlog.node',
		'node_modules\@vscode\sqlite3\build\Release\vscode-sqlite3.node',
		'node_modules\@vscode\windows-mutex\build\Release\CreateMutex.node',
		'node_modules\native-keymap\build\Release\keymapping.node'
	)
}

function Test-NativeDependenciesHealthy {
	foreach ($relativePath in Get-NativeHealthCheckPaths) {
		if (-not (Test-Path (Join-Path $Root $relativePath))) {
			return $false
		}
	}

	return $true
}

function Test-ExtensionCompileDependenciesHealthy {
	& $NodeExe --experimental-strip-types (Join-Path $Root 'build\npm\postinstall.ts') --check-extension-compile-dependencies 2>$null | Out-Null
	return $LASTEXITCODE -eq 0
}

function Test-CopilotBundleFresh {
	$copilotRoot = Join-Path $Root 'extensions\copilot'
	$bundle = Join-Path $copilotRoot 'dist\extension.js'
	if (-not (Test-Path $bundle)) {
		return $false
	}

	$bundleTime = (Get-Item $bundle).LastWriteTimeUtc
	$sourceRoot = Join-Path $copilotRoot 'src'
	$sourceFiles = Get-ChildItem -Path $sourceRoot -Recurse -File -Include '*.ts', '*.tsx' -ErrorAction SilentlyContinue
	foreach ($sourceFile in $sourceFiles) {
		if ($sourceFile.LastWriteTimeUtc -gt $bundleTime) {
			return $false
		}
	}

	$packageJson = Join-Path $copilotRoot 'package.json'
	if ((Test-Path $packageJson) -and (Get-Item $packageJson).LastWriteTimeUtc -gt $bundleTime) {
		return $false
	}

	return $true
}

function Ensure-CopilotBundle {
	Write-Step 'compile-copilot'

	if (Test-CopilotBundleFresh) {
		Write-Host 'Copilot bundle OK.'
		return
	}

	$copilotRoot = Join-Path $Root 'extensions\copilot'
	Write-Host '[Pointer] Copilot bundle is stale, rebuilding dist\extension.js...' -ForegroundColor Yellow
	& $NpmCmd --prefix $copilotRoot run compile
	if ($LASTEXITCODE -ne 0) {
		throw "Copilot compile failed with exit code $LASTEXITCODE"
	}
}

function Write-Step {
	param([string]$Message)
	Write-Host ''
	Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-DevProcesses {
	$killed = $false

	Write-Host ''
	Write-Host '[Pointer] Stopping all dev processes...' -ForegroundColor Yellow
	Write-Host ''

	$electronExe = Join-Path $Root '.build\electron\Pointer.exe'
	$pointerProcs = Get-Process -Name 'Pointer' -ErrorAction SilentlyContinue |
		Where-Object { $_.Path -eq $electronExe }
	if ($pointerProcs) {
		foreach ($proc in $pointerProcs) {
			Write-Host "  Killing Pointer.exe (PID $($proc.Id))" -ForegroundColor Gray
			Stop-ProcessTree -ParentId $proc.Id
			Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
			$killed = $true
		}
	}

	$killScripts = @(
		'kill-watch-client-transpiled',
		'kill-watch-clientd',
		'kill-watch-extensionsd',
		'kill-watch-copilotd',
		'kill-watchd'
	)

	foreach ($script in $killScripts) {
		& $NpmCmd run $script 2>$null | Out-Null
	}

	$escapedRoot = [regex]::Escape($Root)
	$resolvedNodeExe = if (Test-Path $NodeExe) { (Resolve-Path $NodeExe).Path } else { $NodeExe }
	$nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
		Where-Object {
			$_.CommandLine -and
			($_.CommandLine -match $escapedRoot -or $_.ExecutablePath -eq $resolvedNodeExe) -and
			($_.CommandLine -match 'deemon' -or $_.CommandLine -match 'watch-client-transpile' -or ($_.CommandLine -match 'build[\\/]next[\\/]index\.ts' -and $_.CommandLine -match '--watch') -or $_.CommandLine -match 'gulp.*watch')
		}

	if ($nodeProcs) {
		foreach ($proc in $nodeProcs) {
			$cmdLine = if ($proc.CommandLine.Length -gt 100) { $proc.CommandLine.Substring(0, 100) + '...' } else { $proc.CommandLine }
			Write-Host "  Killing orphaned node.exe (PID $($proc.ProcessId)): $cmdLine" -ForegroundColor Gray
			Stop-ProcessTree -ParentId $proc.ProcessId
			Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
			$killed = $true
		}
	}

	Start-Sleep -Seconds 1

	$finalCheck = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
		Where-Object {
			$_.CommandLine -match $escapedRoot -and $_.CommandLine -match 'deemon'
		}
	if ($finalCheck) {
		foreach ($proc in $finalCheck) {
			Write-Host "  Force-killing remaining deemon (PID $($proc.ProcessId))" -ForegroundColor Gray
			Stop-ProcessTree -ParentId $proc.ProcessId
			Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
			$killed = $true
		}
	}

	Write-Host ''
	if ($killed) {
		Write-Host '[Pointer] All dev processes stopped.' -ForegroundColor Green
	} else {
		Write-Host '[Pointer] No running dev processes found.' -ForegroundColor DarkGray
	}
}

function Stop-ProcessTree {
	param([int]$ParentId)
	$children = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
		Where-Object { $_.ParentProcessId -eq $ParentId }
	foreach ($child in $children) {
		Stop-ProcessTree -ParentId $child.ProcessId
		Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
	}
}

function Ensure-Node {
	if ((Test-Path $NodeExe) -and (Test-Path $NpmCmd)) {
		return
	}

	$nodeOnPath = Get-Command node.exe -ErrorAction SilentlyContinue
	$npmOnPath = Get-Command npm.cmd -ErrorAction SilentlyContinue
	if ($nodeOnPath -and $npmOnPath) {
		$script:NodeExe = $nodeOnPath.Source
		$script:NpmCmd = $npmOnPath.Source
		return
	}

	$zipPath = Join-Path $ToolsDir "$NodeZipName.zip"
	$url = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName.zip"
	Write-Step "Download Node.js $NodeVersion"
	Write-Host $url
	New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
	Invoke-WebRequest -Uri $url -OutFile $zipPath
	Expand-Archive -Path $zipPath -DestinationPath $ToolsDir -Force
	Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
}

function Find-VsDevCmd {
	$candidates = @(
		"${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
		"${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
		"${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat",
		"${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
	)

	foreach ($candidate in $candidates) {
		if ($candidate -and (Test-Path $candidate)) {
			return $candidate
		}
	}

	throw 'Visual Studio 2022 Build Tools/Community was not found. Install the C++ Desktop workload and rerun run\start.bat.'
}

function Restart-InVsDevShell {
	$vsDevCmd = Find-VsDevCmd
	$args = @(
		'-NoProfile',
		'-ExecutionPolicy', 'Bypass',
		'-File', "`"$PSCommandPath`"",
		'-Arch', $Arch,
		'-InVsDevShell'
	)
	if ($NoRestartWatch) { $args += '-NoRestartWatch' }
	if ($NoDetach) { $args += '-NoDetach' }
	if ($SetupOnly) { $args += '-SetupOnly' }

	$cmd = "call `"$vsDevCmd`" -arch=$Arch -host_arch=x64 && set `"PATH=$nodeBinDir;%PATH%`" && powershell.exe $($args -join ' ')"
	& cmd.exe /d /s /c $cmd
	exit $LASTEXITCODE
}

function Ensure-NodeGypHeaders {
	$gypDir = Join-Path $Root 'build\npm\gyp'
	if (-not (Test-Path (Join-Path $gypDir 'package.json'))) {
		return
	}

	Write-Step 'build-npm-gyp-ci'
	& $NpmCmd ci --prefix $gypDir --foreground-scripts
	if ($LASTEXITCODE -ne 0) { throw "npm ci (build/npm/gyp) failed with exit code $LASTEXITCODE" }
}

function Remove-SpectreMitigationFlags {
	$files = Get-ChildItem -Path (Join-Path $Root 'node_modules') -Recurse -File -Include '*.gyp', 'binding.gyp' -ErrorAction SilentlyContinue |
		Where-Object {
			Select-String -Path $_.FullName -Pattern 'SpectreMitigation' -Quiet
		}

	foreach ($file in $files) {
		$lines = [System.IO.File]::ReadAllLines($file.FullName)
		$filtered = $lines | Where-Object { $_ -notmatch 'SpectreMitigation' }
		$text = [string]::Join([Environment]::NewLine, $filtered)
		if ($text.Length -gt 0) {
			$text += [Environment]::NewLine
		}
		$encoding = New-Object System.Text.UTF8Encoding($false)
		[System.IO.File]::WriteAllText($file.FullName, $text, $encoding)
		Write-Host "Patched $($file.FullName)"
	}
}

function Get-PackagePath {
	param([string]$PackageName)

	$relative = $PackageName -replace '/', [System.IO.Path]::DirectorySeparatorChar
	return Join-Path (Join-Path $Root 'node_modules') $relative
}

function Rebuild-NativePackages {
	$nativePackages = @(
		'@vscode/deviceid',
		'@vscode/windows-registry',
		'@vscode/windows-mutex',
		'@vscode/windows-ca-certs',
		'@vscode/native-watchdog',
		'@vscode/policy-watcher',
		'@vscode/spdlog',
		'@vscode/windows-process-tree',
		'@vscode/sqlite3',
		'native-is-elevated',
		'native-keymap',
		'windows-foreground-love',
		'kerberos',
		'node-pty',
		'@parcel/watcher',
		'@vscode/ripgrep'
	)

	foreach ($packageName in $nativePackages) {
		if (Test-Path (Get-PackagePath -PackageName $packageName)) {
			Write-Step "rebuild-$packageName"
			& $NpmCmd rebuild --prefix $Root $packageName --foreground-scripts --jobs=1
			if ($LASTEXITCODE -ne 0) { throw "npm rebuild $packageName failed with exit code $LASTEXITCODE" }
		}
	}
}

function Ensure-NativeDependencies {
	$nativeMarker = Join-Path $ToolsDir "native-rebuild-$Arch.marker"
	if ((Test-Path $nativeMarker) -and (Test-NativeDependenciesHealthy)) {
		Write-Step 'native-deps-check'
		Write-Host 'Native dependencies OK.'
		return
	}

	Write-Step 'native-deps-check'
	Write-Host 'Native dependencies are missing or stale; rebuilding root native packages...' -ForegroundColor Yellow

	if (-not $InVsDevShell) {
		Restart-InVsDevShell
	}

	$env:npm_config_arch = $Arch
	$env:npm_config_foreground_scripts = 'true'
	$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

	Ensure-NodeGypHeaders
	Remove-SpectreMitigationFlags
	Rebuild-NativePackages

	if (-not (Test-NativeDependenciesHealthy)) {
		throw 'Native rebuild finished, but required native outputs are still missing.'
	}

	Set-Content -Path $nativeMarker -Value (Get-Date).ToString('o')
}

function Ensure-Dependencies {
	$rootModules = Join-Path $Root 'node_modules'
	$buildModules = Join-Path $Root 'build\node_modules'
	$extModules = Join-Path $Root 'extensions\node_modules'
	$electronDir = Join-Path $Root '.build\electron'

	$rootOk = Test-Path (Join-Path $rootModules 'gulp\bin\gulp.js')
	$buildOk = (Test-Path $buildModules) -or (-not (Test-Path (Join-Path $Root 'build\package.json')))
	$extOk = (Test-Path $extModules) -or (-not (Test-Path (Join-Path $Root 'extensions\package.json')))
	$extensionCompileDependenciesOk = Test-ExtensionCompileDependenciesHealthy
	$electronOk = Test-Path $electronDir

	if ($rootOk -and $buildOk -and $extOk -and $extensionCompileDependenciesOk -and $electronOk) {
		Write-Step 'deps-check'
		Write-Host 'Dependencies OK.'
		return
	}

	Write-Host ''
	Write-Host '[Pointer] First-time setup: installing dependencies...' -ForegroundColor Yellow

	if (-not $rootOk) {
		Write-Step 'npm-ci-root'
		& $NpmCmd ci --ignore-scripts --foreground-scripts
		if ($LASTEXITCODE -ne 0) { throw "npm ci (root) failed with exit code $LASTEXITCODE" }
	}

	$buildPkg = Join-Path $Root 'build\package.json'
	if ((Test-Path $buildPkg) -and (-not $buildOk)) {
		Write-Step 'npm-ci-build'
		& $NpmCmd ci --prefix (Join-Path $Root 'build') --ignore-scripts
		if ($LASTEXITCODE -ne 0) { throw "npm ci (build) failed with exit code $LASTEXITCODE" }
	}

	$extPkg = Join-Path $Root 'extensions\package.json'
	if ((Test-Path $extPkg) -and (-not $extOk)) {
		Write-Step 'npm-ci-extensions'
		& $NpmCmd ci --prefix (Join-Path $Root 'extensions') --ignore-scripts
		if ($LASTEXITCODE -ne 0) { throw "npm ci (extensions) failed with exit code $LASTEXITCODE" }
	}

	if (-not $extensionCompileDependenciesOk) {
		Write-Step 'npm-ci-extension-compile-dependencies'
		$previousNpmCommand = $env:npm_command
		try {
			$env:npm_command = 'ci --ignore-scripts --no-audit --no-fund'
			& $NodeExe --experimental-strip-types (Join-Path $Root 'build\npm\postinstall.ts') --install-extension-compile-dependencies
			if ($LASTEXITCODE -ne 0) { throw "npm ci (extension compile dependencies) failed with exit code $LASTEXITCODE" }
		} finally {
			if ($null -eq $previousNpmCommand) {
				Remove-Item Env:npm_command -ErrorAction SilentlyContinue
			} else {
				$env:npm_command = $previousNpmCommand
			}
		}
		if (-not (Test-ExtensionCompileDependenciesHealthy)) { throw 'npm ci (extension compile dependencies) completed, but required packages are missing or stale' }
	}

	if (-not $electronOk) {
		Write-Step 'download-electron'
		& $NodeExe build/lib/electron.ts
		if ($LASTEXITCODE -ne 0) { throw "Electron download failed with exit code $LASTEXITCODE" }
	}

	Write-Host ''
	Write-Host '[Pointer] Setup complete.' -ForegroundColor Green
	Write-Host ''
}

Ensure-Node

$nodeBinDir = Split-Path (Resolve-Path $NodeExe) -Parent
$env:PATH = "$nodeBinDir;$env:PATH"

Ensure-Dependencies
Ensure-NativeDependencies

if ($SetupOnly) {
	Write-Step 'setup-only'
	Write-Host 'Dependencies are ready.'
	exit 0
}

if (-not (Test-Path $CodeBat)) {
	throw "Launch script not found: $CodeBat"
}

Push-Location $Root
try {
	Ensure-CopilotBundle

	if (-not $NoRestartWatch) {
		Write-Step 'restart-watch-client-transpiled'
		$readyMarker = Join-Path $Root '.build\watch-client-transpile-ready'
		Remove-Item $readyMarker -Force -ErrorAction SilentlyContinue
		& $NpmCmd run kill-watch-client-transpiled
		if ($NoDetach) {
			& $NpmCmd exec -- deemon npm run watch-client-transpile
		} else {
			& $NpmCmd exec -- deemon --detach npm run watch-client-transpile
		}
		if ($LASTEXITCODE -ne 0) {
			throw "watch-client-transpiled failed with exit code $LASTEXITCODE"
		}

		Write-Step 'restart-watch-copilot'
		& $NpmCmd run kill-watch-copilotd
		if ($NoDetach) {
			Write-Host '[Pointer] Skipping detached Copilot watcher because -NoDetach was requested.' -ForegroundColor DarkGray
		} else {
			& $NpmCmd exec -- deemon --detach npm run watch-copilot
			if ($LASTEXITCODE -ne 0) {
				throw "watch-copilot failed with exit code $LASTEXITCODE"
			}
		}
	}

	$mainJs = Join-Path $Root 'out\vs\code\electron-main\main.js'
	$workbenchHtml = Join-Path $Root 'out\vs\code\electron-browser\workbench\workbench-dev.html'
	$readyMarker = Join-Path $Root '.build\watch-client-transpile-ready'
	$requireReadyMarker = -not $NoRestartWatch

	Write-Host ''
	Write-Host '[Pointer] Waiting for watcher to finish initial transpile...' -ForegroundColor Yellow
	Write-Host '[Pointer] First run can take 30-60 seconds while out/ is rebuilt.' -ForegroundColor DarkGray

	$timeout = 300
	$elapsed = 0
	while ($elapsed -lt $timeout) {
		if ((-not $requireReadyMarker -or (Test-Path $readyMarker)) -and (Test-Path $mainJs) -and (Test-Path $workbenchHtml)) {
			Write-Host '[Pointer] Transpile complete, launching...' -ForegroundColor Green
			Write-Host ''
			break
		}
		Start-Sleep -Seconds 2
		$elapsed += 2
	}

	if (($requireReadyMarker -and -not (Test-Path $readyMarker)) -or -not (Test-Path $mainJs) -or -not (Test-Path $workbenchHtml)) {
		throw "Timed out waiting for transpile after ${timeout}s. Check watcher output."
	}

	Write-Step 'launch-pointer'
	$env:VSCODE_SKIP_PRELAUNCH = '1'
	& $CodeBat
	$exitCode = $LASTEXITCODE

	if (-not $NoRestartWatch) {
		Stop-DevProcesses
	}

	exit $exitCode
} finally {
	Pop-Location
}
