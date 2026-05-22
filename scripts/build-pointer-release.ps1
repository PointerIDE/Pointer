[CmdletBinding()]
param(
	[ValidateSet('x64', 'arm64')]
	[string]$Arch = 'x64',
	[switch]$SkipInstall,
	[switch]$Fresh,
	[switch]$Installer,
	[switch]$Zip,
	[string]$NativeJobs = '1',
	[int]$NativePackageConcurrency = 1,
	[switch]$InVsDevShell
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$ToolsDir = Join-Path $Root '.codex-tools'
$LogDir = Join-Path $ToolsDir 'logs'
$ArtifactsDir = Join-Path $Root '.build\artifacts'
$RunId = '{0}-{1}' -f ([DateTime]::Now.ToString('yyyyMMdd-HHmmss')), $PID
$RunLogDir = Join-Path $LogDir $RunId
$NodeVersion = (Get-Content (Join-Path $Root '.nvmrc') -Raw).Trim().TrimStart('v')
$NodeZipName = "node-v$NodeVersion-win-x64"
$NodeDir = Join-Path $ToolsDir $NodeZipName
$NodeExe = Join-Path $NodeDir 'node.exe'
$NpmCmd = Join-Path $NodeDir 'npm.cmd'
$script:DidAutoRepair = $false

New-Item -ItemType Directory -Force -Path $ToolsDir, $LogDir, $RunLogDir, $ArtifactsDir | Out-Null
Set-Content -Path (Join-Path $LogDir 'latest-run.txt') -Value $RunLogDir

function Get-StepLogPath {
	param([string]$Name)
	return Join-Path $RunLogDir "$Name.log"
}

function Get-DirectoryPath {
	param([string]$RelativeDirectory)

	if ([string]::IsNullOrWhiteSpace($RelativeDirectory)) {
		return $Root
	}

	return Join-Path $Root $RelativeDirectory
}

function Get-HealthCheckPaths {
	param([string]$RelativeDirectory)

	switch ($RelativeDirectory) {
		'' {
			return @(
				'node_modules\gulp\bin\gulp.js',
				'node_modules\@vscode\l10n-dev\dist\main.js',
				'node_modules\xml2js\node_modules\xmlbuilder\lib\XMLStringifier.js'
			)
		}
		'build' {
			return @(
				'build\node_modules\ternary-stream\index.js',
				'build\node_modules\esbuild\lib\main.js'
			)
		}
		'extensions' {
			return @(
				'extensions\node_modules\esbuild\lib\main.js'
			)
		}
		default {
			return @()
		}
	}
}

function Test-DirectoryHealthy {
	param([string]$RelativeDirectory)

	$checks = Get-HealthCheckPaths $RelativeDirectory
	if ($checks.Count -eq 0) {
		return $true
	}

	foreach ($check in $checks) {
		if (-not (Test-Path (Join-Path $Root $check))) {
			return $false
		}
	}

	return $true
}

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

function Write-Step {
	param([string]$Message)
	Write-Host ''
	Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Logged {
	param(
		[Parameter(Mandatory = $true)][string]$Name,
		[Parameter(Mandatory = $true)][scriptblock]$Script,
		[string]$WorkingDirectory = $Root
	)

	$logPath = Get-StepLogPath $Name
	Write-Step $Name
	Write-Host "Log: $logPath"
	Push-Location $WorkingDirectory
	try {
		$global:LASTEXITCODE = 0
		$previousErrorActionPreference = $ErrorActionPreference
		$ErrorActionPreference = 'Continue'
		& $Script 2>&1 | Tee-Object -FilePath $logPath
		$ErrorActionPreference = $previousErrorActionPreference
		$exitCode = $global:LASTEXITCODE
		if ($exitCode -ne 0) {
			throw "Step '$Name' failed with exit code $exitCode. See $logPath"
		}
	} finally {
		if ($previousErrorActionPreference) {
			$ErrorActionPreference = $previousErrorActionPreference
		}
		Pop-Location
	}
}

function Invoke-ProcessLogged {
	param(
		[Parameter(Mandatory = $true)][string]$Name,
		[Parameter(Mandatory = $true)][string]$FilePath,
		[string[]]$Arguments = @(),
		[string]$WorkingDirectory = $Root
	)

	$logPath = Get-StepLogPath $Name
	$runSuffix = ([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))
	$stdoutPath = Join-Path $RunLogDir "$Name.$runSuffix.stdout.tmp"
	$stderrPath = Join-Path $RunLogDir "$Name.$runSuffix.stderr.tmp"
	$combinedPath = Join-Path $RunLogDir "$Name.$runSuffix.log"

	Write-Step $Name
	Write-Host "Log: $logPath"

	Remove-Item -LiteralPath $stdoutPath, $stderrPath, $combinedPath -Force -ErrorAction SilentlyContinue

	$process = Start-Process -FilePath $FilePath `
		-ArgumentList $Arguments `
		-WorkingDirectory $WorkingDirectory `
		-RedirectStandardOutput $stdoutPath `
		-RedirectStandardError $stderrPath `
		-Wait `
		-PassThru `
		-NoNewWindow

	New-Item -ItemType File -Force -Path $combinedPath | Out-Null
	foreach ($path in @($stdoutPath, $stderrPath)) {
		if (Test-Path $path) {
			Get-Content -LiteralPath $path | Tee-Object -FilePath $combinedPath -Append
		}
	}

	Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

	Move-Item -LiteralPath $combinedPath -Destination $logPath -Force

	if ($process.ExitCode -ne 0) {
		throw "Step '$Name' failed with exit code $($process.ExitCode). See $logPath"
	}
}

function Ensure-Node {
	if (Test-Path $NodeExe) {
		return
	}

	$zipPath = Join-Path $ToolsDir "$NodeZipName.zip"
	$url = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName.zip"
	Write-Step "Download Node.js $NodeVersion"
	Write-Host $url
	Invoke-WebRequest -Uri $url -OutFile $zipPath
	Expand-Archive -Path $zipPath -DestinationPath $ToolsDir -Force
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

	throw 'Visual Studio 2022 Build Tools/Community was not found. Install the C++ Desktop workload and rerun build-pointer.bat.'
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
	if ($SkipInstall) { $args += '-SkipInstall' }
	if ($Fresh) { $args += '-Fresh' }
	if ($Installer) { $args += '-Installer' }
	if ($Zip) { $args += '-Zip' }
	$args += '-NativeJobs'
	$args += $NativeJobs
	$args += '-NativePackageConcurrency'
	$args += $NativePackageConcurrency

	$cmd = "call `"$vsDevCmd`" -arch=$Arch -host_arch=x64 && set `"PATH=$NodeDir;%PATH%`" && powershell.exe $($args -join ' ')"
	& cmd.exe /d /s /c $cmd
	exit $LASTEXITCODE
}

function Invoke-Npm {
	param(
		[Parameter(Mandatory = $true)][string]$Name,
		[Parameter(Mandatory = $true)][string[]]$Arguments,
		[string]$WorkingDirectory = $Root
	)

	Invoke-ProcessLogged -Name $Name -FilePath $NpmCmd -Arguments $Arguments -WorkingDirectory $WorkingDirectory
}

function Start-NpmProcessLogged {
	param(
		[Parameter(Mandatory = $true)][string]$Name,
		[Parameter(Mandatory = $true)][string[]]$Arguments,
		[string]$WorkingDirectory = $Root
	)

	$logPath = Get-StepLogPath $Name
	$runSuffix = ([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))
	$stdoutPath = Join-Path $RunLogDir "$Name.$runSuffix.stdout.tmp"
	$stderrPath = Join-Path $RunLogDir "$Name.$runSuffix.stderr.tmp"

	Write-Step $Name
	Write-Host "Log: $logPath"

	Remove-Item -LiteralPath $stdoutPath, $stderrPath, $logPath -Force -ErrorAction SilentlyContinue

	$process = Start-Process -FilePath $NpmCmd `
		-ArgumentList $Arguments `
		-WorkingDirectory $WorkingDirectory `
		-RedirectStandardOutput $stdoutPath `
		-RedirectStandardError $stderrPath `
		-PassThru `
		-NoNewWindow

	return [PSCustomObject]@{
		Name = $Name
		LogPath = $logPath
		StdoutPath = $stdoutPath
		StderrPath = $stderrPath
		Process = $process
	}
}

function Complete-NpmProcessLogged {
	param([Parameter(Mandatory = $true)]$ProcessInfo)

	$ProcessInfo.Process.WaitForExit()

	New-Item -ItemType File -Force -Path $ProcessInfo.LogPath | Out-Null
	foreach ($path in @($ProcessInfo.StdoutPath, $ProcessInfo.StderrPath)) {
		if (Test-Path $path) {
			Get-Content -LiteralPath $path | Tee-Object -FilePath $ProcessInfo.LogPath -Append
		}
	}

	Remove-Item -LiteralPath $ProcessInfo.StdoutPath, $ProcessInfo.StderrPath -Force -ErrorAction SilentlyContinue

	if ($ProcessInfo.Process.ExitCode -ne 0) {
		throw "Step '$($ProcessInfo.Name)' failed with exit code $($ProcessInfo.Process.ExitCode). See $($ProcessInfo.LogPath)"
	}
}

function Repair-NpmDirectory {
	param(
		[string]$RelativeDirectory,
		[switch]$IgnoreScripts
	)

	$fullPath = Get-DirectoryPath $RelativeDirectory
	$safeName = if ($RelativeDirectory) { $RelativeDirectory -replace '[\\/:.]', '_' } else { 'root' }
	$arguments = @('ci', '--prefix', $fullPath, '--foreground-scripts')
	if ($IgnoreScripts) {
		$arguments += '--ignore-scripts'
	}

	Invoke-Npm -Name "npm-repair-$safeName" -Arguments $arguments
}

function Ensure-CriticalDependencies {
	$repairs = @()

	if (-not (Test-DirectoryHealthy '')) {
		$repairs += [pscustomobject]@{ Dir = ''; IgnoreScripts = $true; Label = 'root' }
	}

	if (-not (Test-DirectoryHealthy 'build')) {
		$repairs += [pscustomobject]@{ Dir = 'build'; IgnoreScripts = $false; Label = 'build' }
	}

	if (-not (Test-DirectoryHealthy 'extensions')) {
		$repairs += [pscustomobject]@{ Dir = 'extensions'; IgnoreScripts = $false; Label = 'extensions' }
	}

	if ($repairs.Count -eq 0) {
		Write-Step 'dependency-health'
		Write-Host 'Critical dependency health checks passed.'
		return
	}

	Write-Step 'dependency-repair'
	Write-Host ('Repairing: ' + (($repairs | ForEach-Object { $_.Label }) -join ', '))

	foreach ($repair in $repairs) {
		Repair-NpmDirectory -RelativeDirectory $repair.Dir -IgnoreScripts:$repair.IgnoreScripts
	}
}

function Get-NpmRcHeaderInfo {
	param([string]$Path)

	if (-not (Test-Path $Path)) {
		return $null
	}

	$distUrl = $null
	$target = $null
	foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
		if ($line -match '^\s*disturl\s*=\s*"?([^"]+)"?\s*$') {
			$distUrl = $Matches[1]
		}
		if ($line -match '^\s*target\s*=\s*"?([^"]+)"?\s*$') {
			$target = $Matches[1]
		}
	}

	if ($distUrl -and $target) {
		return [pscustomobject]@{ DistUrl = $distUrl; Target = $target }
	}

	return $null
}

function Test-NodeGypHeaderCache {
	param([string]$Target)

	$cachePath = Join-Path $env:LOCALAPPDATA "node-gyp\Cache\$Target"
	return (Test-Path (Join-Path $cachePath 'include\node')) -or (Test-Path (Join-Path $cachePath 'x64\node.lib'))
}

function Install-NodeGypHeaders {
	param([object]$HeaderInfo)

	if (-not $HeaderInfo -or (Test-NodeGypHeaderCache -Target $HeaderInfo.Target)) {
		return
	}

	$nodeGyp = Join-Path $Root 'build\npm\gyp\node_modules\.bin\node-gyp.cmd'
	if (-not (Test-Path $nodeGyp)) {
		Invoke-Npm -Name 'build-npm-gyp-ci' -Arguments @('ci', '--prefix', (Join-Path $Root 'build\npm\gyp'), '--ignore-scripts', '--foreground-scripts')
	}

	$distUrls = @($HeaderInfo.DistUrl)
	if ($HeaderInfo.DistUrl -eq 'https://electronjs.org/headers') {
		$distUrls = @(
			'https://artifacts.electronjs.org/headers/dist',
			'https://electronjs.org/headers'
		)
	}

	$lastError = $null
	foreach ($distUrl in $distUrls) {
		for ($attempt = 1; $attempt -le 3; $attempt++) {
			try {
				Invoke-ProcessLogged -Name "node-gyp-headers-$($HeaderInfo.Target)-attempt-$attempt" -FilePath $nodeGyp -Arguments @('install', '--dist-url', $distUrl, $HeaderInfo.Target)
				return
			} catch {
				$lastError = $_
				Start-Sleep -Seconds ([Math]::Min(10, $attempt * 2))
			}
		}
	}

	throw $lastError
}

function Ensure-NodeGypHeaders {
	Invoke-Npm -Name 'build-npm-gyp-ci' -Arguments @('ci', '--prefix', (Join-Path $Root 'build\npm\gyp'), '--ignore-scripts', '--foreground-scripts')
	Install-NodeGypHeaders -HeaderInfo (Get-NpmRcHeaderInfo -Path (Join-Path $Root '.npmrc'))
}

function Invoke-Node {
	param(
		[Parameter(Mandatory = $true)][string]$Name,
		[Parameter(Mandatory = $true)][string[]]$Arguments,
		[string]$WorkingDirectory = $Root
	)

	Invoke-ProcessLogged -Name $Name -FilePath $NodeExe -Arguments $Arguments -WorkingDirectory $WorkingDirectory
}

function Remove-SpectreMitigationFlags {
	param([string]$BaseDirectory)

	if (-not (Test-Path $BaseDirectory)) {
		return
	}

	$files = Get-ChildItem -Path $BaseDirectory -Recurse -File -Include '*.gyp', 'binding.gyp' -ErrorAction SilentlyContinue |
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
	param([string]$Prefix, [string]$PackageName)

	$relative = $PackageName -replace '/', [System.IO.Path]::DirectorySeparatorChar
	return Join-Path (Join-Path $Prefix 'node_modules') $relative
}

function Rebuild-NativePackages {
	param([string]$Prefix, [string]$LogPrefix)

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

	$packagesToRebuild = @($nativePackages | Where-Object { Test-Path (Get-PackagePath -Prefix $Prefix -PackageName $_) })
	if ($NativePackageConcurrency -le 1) {
		foreach ($packageName in $packagesToRebuild) {
			$safeName = ($packageName -replace '[@/]', '_').Trim('_')
			Invoke-Npm -Name "$LogPrefix-rebuild-$safeName" -Arguments @('rebuild', '--prefix', $Prefix, $packageName, '--foreground-scripts', "--jobs=$NativeJobs")
		}
		return
	}

	$running = @()
	foreach ($packageName in $packagesToRebuild) {
		if (Test-Path (Get-PackagePath -Prefix $Prefix -PackageName $packageName)) {
			$safeName = ($packageName -replace '[@/]', '_').Trim('_')
			$running += Start-NpmProcessLogged -Name "$LogPrefix-rebuild-$safeName" -Arguments @('rebuild', '--prefix', $Prefix, $packageName, '--foreground-scripts', "--jobs=$NativeJobs")
			if ($running.Count -ge $NativePackageConcurrency) {
				Complete-NpmProcessLogged -ProcessInfo $running[0]
				$running = @($running | Select-Object -Skip 1)
			}
		}
	}

	foreach ($processInfo in $running) {
		Complete-NpmProcessLogged -ProcessInfo $processInfo
	}
}

function Install-NpmDirectory {
	param([string]$RelativeDirectory)

	$fullPath = Get-DirectoryPath $RelativeDirectory
	if (-not (Test-Path (Join-Path $fullPath 'package.json'))) {
		return
	}

	$safeName = if ($RelativeDirectory) { $RelativeDirectory -replace '[\\/:.]', '_' } else { 'root' }
	$nodeModulesPath = Join-Path $fullPath 'node_modules'
	if ((Test-Path $nodeModulesPath) -and -not $Fresh) {
		if (Test-DirectoryHealthy $RelativeDirectory) {
			Write-Step "npm-skip-$safeName"
			Write-Host "Skipped, node_modules exists: $nodeModulesPath"
			return
		}

		Write-Step "npm-repair-needed-$safeName"
		Write-Host "Health check failed, reinstalling dependencies in $fullPath"
	}

	if ($Fresh -and (Test-Path (Join-Path $fullPath 'package-lock.json'))) {
		Invoke-Npm -Name "npm-ci-$safeName" -Arguments @('ci', '--prefix', $fullPath, '--foreground-scripts')
	} elseif ((Test-Path $nodeModulesPath) -or -not (Test-Path (Join-Path $fullPath 'package-lock.json'))) {
		Invoke-Npm -Name "npm-install-$safeName" -Arguments @('install', '--prefix', $fullPath, '--package-lock=false', '--prefer-offline', '--no-audit', '--no-fund', '--foreground-scripts')
	} else {
		Invoke-Npm -Name "npm-ci-$safeName" -Arguments @('ci', '--prefix', $fullPath, '--foreground-scripts')
	}
}

function Install-Dependencies {
	$env:npm_config_arch = $Arch
	$env:npm_config_foreground_scripts = 'true'
	$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

	if ($Fresh -or -not (Test-Path (Join-Path $Root 'node_modules'))) {
		Invoke-Npm -Name 'root-npm-ci-ignore-scripts' -Arguments @('ci', '--ignore-scripts', '--foreground-scripts')
	} elseif (Test-DirectoryHealthy '') {
		Write-Step 'root-npm-skip'
		Write-Host "Skipped, node_modules exists: $(Join-Path $Root 'node_modules')"
	} else {
		Write-Step 'root-npm-repair-needed'
		Write-Host 'Health check failed in root node_modules, repairing installation'
		Repair-NpmDirectory -RelativeDirectory '' -IgnoreScripts
	}

	Ensure-NodeGypHeaders
	Remove-SpectreMitigationFlags -BaseDirectory (Join-Path $Root 'node_modules')

	$nativeMarker = Join-Path $ToolsDir "native-rebuild-$Arch.marker"
	if ($Fresh -or -not (Test-Path $nativeMarker) -or -not (Test-NativeDependenciesHealthy)) {
		Rebuild-NativePackages -Prefix $Root -LogPrefix 'root'
		if (-not (Test-NativeDependenciesHealthy)) {
			throw 'Native rebuild finished, but required native outputs are still missing.'
		}
		Set-Content -Path $nativeMarker -Value (Get-Date).ToString('o')
	} else {
		Write-Step 'root-native-rebuild'
		Write-Host "Skipped, marker exists: $nativeMarker"
	}

	Invoke-Node -Name 'download-electron' -Arguments @('build/lib/electron.ts')

	$dirs = @(
		'build',
		'extensions',
		'extensions/configuration-editing',
		'extensions/copilot',
		'extensions/css-language-features',
		'extensions/css-language-features/server',
		'extensions/debug-auto-launch',
		'extensions/debug-server-ready',
		'extensions/emmet',
		'extensions/extension-editing',
		'extensions/git',
		'extensions/git-base',
		'extensions/github',
		'extensions/github-authentication',
		'extensions/grunt',
		'extensions/gulp',
		'extensions/html-language-features',
		'extensions/html-language-features/server',
		'extensions/ipynb',
		'extensions/jake',
		'extensions/json-language-features',
		'extensions/json-language-features/server',
		'extensions/markdown-language-features',
		'extensions/markdown-math',
		'extensions/media-preview',
		'extensions/merge-conflict',
		'extensions/mermaid-chat-features',
		'extensions/microsoft-authentication',
		'extensions/notebook-renderers',
		'extensions/npm',
		'extensions/php-language-features',
		'extensions/references-view',
		'extensions/search-result',
		'extensions/simple-browser',
		'extensions/tunnel-forwarding',
		'extensions/terminal-suggest',
		'extensions/typescript-language-features'
	)

	foreach ($dir in $dirs) {
		Install-NpmDirectory -RelativeDirectory $dir
	}
}

function Invoke-Gulp {
	param([string]$Task)

	$name = "gulp-$Task"
	$arguments = @(
		'--experimental-strip-types',
		'--max-old-space-size=8192',
		'./node_modules/gulp/bin/gulp.js',
		$Task
	)

	try {
		Invoke-Node -Name $name -Arguments $arguments
	} catch {
		$logPath = Get-StepLogPath $name
		$canRepair = -not $script:DidAutoRepair -and (Test-Path $logPath)
		$isMissingModule = $canRepair -and (Select-String -Path $logPath -Pattern 'MODULE_NOT_FOUND|Cannot find module' -Quiet)
		if (-not $isMissingModule) {
			throw
		}

		$script:DidAutoRepair = $true
		Write-Step 'auto-repair'
		Write-Host "Detected missing module during $Task. Repairing root/build/extensions dependencies and retrying once."
		Repair-NpmDirectory -RelativeDirectory '' -IgnoreScripts
		Repair-NpmDirectory -RelativeDirectory 'build'
		Repair-NpmDirectory -RelativeDirectory 'extensions'
		Invoke-Node -Name $name -Arguments $arguments
	}
}

function Build-App {
	New-Item -ItemType Directory -Force -Path (Join-Path $Root '.build') | Out-Null
	Ensure-CriticalDependencies

	Invoke-Node -Name 'download-builtin-extensions' -Arguments @('build/lib/builtInExtensions.ts')
	Invoke-Npm -Name 'build-copy-policy-dto' -Arguments @('run', 'copy-policy-dto', '--prefix', (Join-Path $Root 'build'))
	Invoke-Node -Name 'generate-win32-policies' -Arguments @('build/lib/policies/policyGenerator.ts', 'build/lib/policies/policyData.jsonc', 'win32')

	Invoke-Gulp -Task "vscode-win32-$Arch"
	Invoke-Gulp -Task "vscode-win32-$Arch-inno-updater"

	$packageDir = Resolve-Path (Join-Path $Root "..\Pointer-win32-$Arch")
	$packageExe = Join-Path $packageDir 'Pointer.exe'
	if (-not (Test-Path $packageExe)) {
		throw "Packaged EXE was not found at $packageExe"
	}

	$version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
	$product = Get-Content (Join-Path $Root 'product.json') -Raw | ConvertFrom-Json
	$pointerAppName = $product.nameShort
	$pointerArtifactDir = Join-Path $ArtifactsDir "Pointer-win32-$Arch"

	$zipPath = Join-Path $ArtifactsDir "Pointer-win32-$Arch.zip"
	$artifactSetup = $null

	if ($Installer) {
		Write-Step 'gulp-pointer-win32-installer'
		Invoke-Gulp -Task "vscode-win32-$Arch-user-setup"
		$setupExe = Join-Path $Root ".build\win32-$Arch\user-setup\PointerSetup.exe"
		if (-not (Test-Path $setupExe)) {
			throw "Installer EXE was not found at $setupExe"
		}
		$artifactSetup = Join-Path $ArtifactsDir "PointerSetup-$Arch-$version.exe"
		Copy-Item -LiteralPath $setupExe -Destination $artifactSetup -Force
		Write-Host "Installer: $artifactSetup"
	}

	Write-Step 'pointer-post-process'
	Write-Host "Copying build to $pointerArtifactDir ..."

	if (Test-Path $pointerArtifactDir) {
		Remove-Item -LiteralPath $pointerArtifactDir -Recurse -Force
	}
	Copy-Item -LiteralPath $packageDir -Destination $pointerArtifactDir -Recurse -Force

	$newExe = Join-Path $pointerArtifactDir "$pointerAppName.exe"

	if ($Zip) {
		Write-Step 'package-zip'
		if (Test-Path $zipPath) {
			Remove-Item -LiteralPath $zipPath -Force
		}
		Compress-Archive -Path (Join-Path $pointerArtifactDir '*') -DestinationPath $zipPath -Force
		Write-Host "ZIP: $zipPath"
	}

	Write-Step 'cleanup'
	Write-Host "Removing temporary package directory: $packageDir"
	Remove-Item -LiteralPath $packageDir -Recurse -Force -ErrorAction SilentlyContinue
	$parentInnoDir = Join-Path $Root ".build\win32-$Arch"
	if (Test-Path $parentInnoDir) {
		Remove-Item -LiteralPath $parentInnoDir -Recurse -Force -ErrorAction SilentlyContinue
	}

	Write-Host ''
	Write-Host '==============================' -ForegroundColor Green
	Write-Host '  Pointer Release Complete!' -ForegroundColor Green
	Write-Host '==============================' -ForegroundColor Green
	Write-Host ''
	Write-Host "  App:      $pointerArtifactDir"
	Write-Host "  Exe:      $newExe"
	if ($Zip) {
		Write-Host "  ZIP:      $zipPath"
	}
	if ($artifactSetup) {
		Write-Host "  Setup:    $artifactSetup"
	}
	Write-Host ''
	Write-Host "  Logs:     $RunLogDir" -ForegroundColor DarkGray
	Write-Host ''
}

Ensure-Node
$env:PATH = "$NodeDir;$env:PATH"

if (-not $InVsDevShell) {
	Restart-InVsDevShell
}

Write-Step 'run-info'
Write-Host "Run ID: $RunId"
Write-Host "Run logs: $RunLogDir"

Invoke-Logged -Name 'tool-versions' -Script {
	& $NodeExe --version
	& $NpmCmd --version
	$cl = Get-Command cl.exe -ErrorAction SilentlyContinue
	if ($cl) { Write-Host $cl.Source } else { Write-Host 'cl.exe was not found on PATH; node-gyp/MSBuild discovery will be used.' }
	$msbuild = Get-Command msbuild.exe -ErrorAction SilentlyContinue
	if ($msbuild) { Write-Host $msbuild.Source } else { Write-Host 'msbuild.exe was not found on PATH; node-gyp Visual Studio discovery will be used.' }
	$global:LASTEXITCODE = 0
}

if (-not $SkipInstall) {
	Install-Dependencies
}

Build-App
