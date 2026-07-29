[CmdletBinding()]
param(
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$LaunchArgs
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$NodeVersion = (Get-Content (Join-Path $Root '.nvmrc') -Raw).Trim().TrimStart('v')
$NodeDir = Join-Path $Root ".codex-tools\node-v$NodeVersion-win-x64"
$NodeExe = Join-Path $NodeDir 'node.exe'
$CodeBat = Join-Path $Root 'scripts\code.bat'

function Write-Step {
	param([string]$Message)
	Write-Host ''
	Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-Node {
	if (Test-Path $NodeExe) {
		return (Resolve-Path $NodeExe).Path
	}

	$nodeOnPath = Get-Command node.exe -ErrorAction SilentlyContinue
	if ($nodeOnPath) {
		return $nodeOnPath.Source
	}

	throw "Node.js not found. Expected local runtime at $NodeExe or node.exe on PATH."
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

function Stop-StaleWatchers {
	$escapedRoot = [regex]::Escape($Root)
	$resolvedNodeExe = if (Test-Path $NodeExe) { (Resolve-Path $NodeExe).Path } else { $NodeExe }
	$watchers = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
		Where-Object {
			$commandLine = $_.CommandLine
			$commandLine -and
			($commandLine -match $escapedRoot -or $_.ExecutablePath -eq $resolvedNodeExe) -and
			(
				$commandLine -match 'deemon' -or
				$commandLine -match 'watch-client-transpile' -or
				($commandLine -match 'build[\\/]next[\\/]index\.ts' -and $commandLine -match '--watch') -or
				($commandLine -match 'gulp' -and $commandLine -match 'watch') -or
				($commandLine -match 'npm-run-all2' -and $commandLine -match 'watch')
			)
		}

	if (-not $watchers) {
		Write-Host '[Pointer] No stale dev watchers found.' -ForegroundColor DarkGray
		return
	}

	Write-Host '[Pointer] Stopping stale dev watchers from this repo...' -ForegroundColor Yellow
	foreach ($proc in $watchers) {
		$cmdLine = if ($proc.CommandLine.Length -gt 100) { $proc.CommandLine.Substring(0, 100) + '...' } else { $proc.CommandLine }
		Write-Host "  Killing node.exe (PID $($proc.ProcessId)): $cmdLine" -ForegroundColor Gray
		Stop-ProcessTree -ParentId $proc.ProcessId
		Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
	}
}

function Assert-DevOutput {
	param([string]$NodePath)

	Push-Location $Root
	try {
		$appName = (& $NodePath -p "require('./product.json').applicationName")
		if ($LASTEXITCODE -ne 0 -or -not $appName) {
			throw 'Could not read applicationName from product.json.'
		}
	} finally {
		Pop-Location
	}

	$requiredPaths = @(
		(Join-Path $Root ".build\electron\$appName.exe"),
		(Join-Path $Root 'out\vs\code\electron-main\main.js'),
		(Join-Path $Root 'out\vs\code\electron-browser\workbench\workbench-dev.html')
	)

	$missing = @($requiredPaths | Where-Object { -not (Test-Path $_) })
	if ($missing.Count -eq 0) {
		return
	}

	Write-Host ''
	Write-Host '[Pointer] Cannot start without existing dev build output.' -ForegroundColor Red
	Write-Host 'Missing:' -ForegroundColor Red
	foreach ($path in $missing) {
		Write-Host "  $path" -ForegroundColor Gray
	}
	Write-Host ''
	Write-Host 'This safe start path never runs npm install, rebuild, compile, or watchers.' -ForegroundColor Yellow
	Write-Host 'Use run\start-dev.bat for live dev mode, or run the release/dev setup explicitly first.' -ForegroundColor Yellow
	exit 1
}

$NodeExe = Resolve-Node
$NodeDir = Split-Path $NodeExe -Parent
$env:PATH = "$NodeDir;$env:PATH"

if (-not (Test-Path $CodeBat)) {
	throw "Launch script not found: $CodeBat"
}

Write-Step 'safe-start'
Write-Host '[Pointer] Starting app only. No watchers, no npm install, no rebuild, no compile.'

Stop-StaleWatchers
Assert-DevOutput -NodePath $NodeExe

Push-Location $Root
try {
	# Electron must run as Electron even when Pointer is launched from an agent-enabled shell.
	Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
	$env:VSCODE_SKIP_PRELAUNCH = '1'
	& $CodeBat @LaunchArgs
	exit $LASTEXITCODE
} finally {
	Pop-Location
}
