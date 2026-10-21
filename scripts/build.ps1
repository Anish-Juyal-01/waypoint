<#
.SYNOPSIS
  Builds, tests and packages Waypoint.

.DESCRIPTION
  1. Installs UI dependencies (if needed), runs the UI unit tests (Vitest).
  2. Runs the Rust unit tests (engine, persistence, startup task).
  3. Builds the UI and the release exe through the Tauri CLI (no installer).
  4. Copies Waypoint.exe to ./dist and zips it into ./dist/release for GitHub releases.

  The exe uses the WebView2 runtime that ships with Windows 11 (and is on nearly every Windows 10 PC); it needs no
  .NET and no installer.

.PARAMETER SkipTests
  Skip both test suites.

.EXAMPLE
  ./scripts/build.ps1
#>
param(
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

Push-Location ui
if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund; Check "npm ci" }
if (-not $SkipTests) {
    Step "Running UI tests"
    npm test; Check "UI tests"
}
Pop-Location

if (-not $SkipTests) {
    Step "Running Rust tests"
    cargo test --manifest-path src-tauri/Cargo.toml; Check "cargo test"
}

Step "Building Waypoint (Tauri)"
# The CLI runs the UI build (beforeBuildCommand) and compiles with the bundled-UI feature.
& (Join-Path $root "ui/node_modules/.bin/tauri.cmd") build --no-bundle; Check "tauri build"

$out = Join-Path $root "dist"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null
$exe = Join-Path $out "Waypoint.exe"
Copy-Item (Join-Path $root "src-tauri/target/release/Waypoint.exe") $exe

$version = (Get-Content (Join-Path $root "src-tauri/tauri.conf.json") -Raw | ConvertFrom-Json).version
$release = Join-Path $out "release"
New-Item -ItemType Directory $release | Out-Null
$zip = Join-Path $release "Waypoint-$version-win-x64.zip"
Compress-Archive -Path $exe -DestinationPath $zip -CompressionLevel Optimal

Step "Done"
foreach ($file in @($exe, $zip)) {
    Write-Host ("  {0,-50} {1,7:N1} MB" -f $file.Substring($root.Length + 1), ((Get-Item $file).Length / 1MB))
}
