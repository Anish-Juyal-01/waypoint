<#
.SYNOPSIS
  Builds, tests and publishes Waypoint.

.DESCRIPTION
  1. Installs UI dependencies (if needed) and builds the React UI (ui/dist).
  2. Runs the UI unit tests (Vitest) and the .NET unit tests (xUnit).
  3. Publishes a self-contained, single-file Waypoint.exe for win-x64 to ./dist.

.PARAMETER SkipTests
  Skip both test suites.

.PARAMETER Runtime
  .NET runtime identifier to publish for (default win-x64; win-arm64 is also supported).

.EXAMPLE
  ./scripts/build.ps1
#>
param(
    [switch]$SkipTests,
    [string]$Runtime = "win-x64"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" } }

Step "Building UI"
Push-Location ui
if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund; Check "npm ci" }
npm run build; Check "UI build"
if (-not $SkipTests) { npm test; Check "UI tests" }
Pop-Location

if (-not $SkipTests) {
    Step "Running .NET tests"
    dotnet test tests/Waypoint.Core.Tests -c Release --nologo; Check "dotnet test"
}

Step "Publishing Waypoint ($Runtime)"
$out = Join-Path $root "dist"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
dotnet publish src/Waypoint.App/Waypoint.App.csproj -c Release -r $Runtime --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=none -p:SatelliteResourceLanguages=en -o $out --nologo
Check "dotnet publish"

dotnet publish src/Waypoint.Cli/Waypoint.Cli.csproj -c Release -r $Runtime --self-contained true `
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o (Join-Path $out "tools") --nologo
Check "CLI publish"

# XML IntelliSense docs from NuGet packages are not needed at runtime.
Get-ChildItem $out -Filter *.xml -Recurse | Remove-Item -Force

$exe = Join-Path $out "Waypoint.exe"
Step ("Done: {0} ({1:N1} MB)" -f $exe, ((Get-Item $exe).Length / 1MB))
