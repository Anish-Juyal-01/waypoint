<#
.SYNOPSIS
  Builds, tests and publishes Waypoint.

.DESCRIPTION
  1. Installs UI dependencies (if needed) and builds the React UI (ui/dist).
  2. Runs the UI unit tests (Vitest) and the .NET unit tests (xUnit).
  3. Publishes Waypoint.exe for win-x64 to ./dist (self-contained) and ./dist/lite (needs the .NET 10
     Desktop Runtime), and zips each into ./dist/release for GitHub releases.

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
$common = @("-c", "Release", "-r", $Runtime, "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true",
            "-p:DebugType=none", "-p:SatelliteResourceLanguages=en", "--nologo")

# Full build: carries its own .NET, runs on any Windows 10/11 PC. Not compressed inside the exe: that would make
# every launch unpack ~150 MB into memory. The release zip compresses it instead.
dotnet publish src/Waypoint.App/Waypoint.App.csproj --self-contained true @common -o $out
Check "dotnet publish"

# Lite build: a few MB, uses the .NET Desktop Runtime installed on the PC (Windows offers to install it if missing).
$lite = Join-Path $out "lite"
dotnet publish src/Waypoint.App/Waypoint.App.csproj --self-contained false @common -o $lite
Check "lite publish"

dotnet publish src/Waypoint.Cli/Waypoint.Cli.csproj -c Release -r $Runtime --self-contained true `
    -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o (Join-Path $out "tools") --nologo
Check "CLI publish"

# XML IntelliSense docs from NuGet packages are not needed at runtime.
Get-ChildItem $out -Filter *.xml -Recurse | Remove-Item -Force

# Release downloads: each zip holds a single Waypoint.exe.
$version = ([xml](Get-Content (Join-Path $root "Directory.Build.props"))).Project.PropertyGroup.Version
$release = Join-Path $out "release"
New-Item -ItemType Directory $release | Out-Null
$zips = [ordered]@{
    "Waypoint-$version-$Runtime.zip"      = Join-Path $out "Waypoint.exe"
    "Waypoint-$version-$Runtime-lite.zip" = Join-Path $lite "Waypoint.exe"
}
foreach ($name in $zips.Keys) {
    Compress-Archive -Path $zips[$name] -DestinationPath (Join-Path $release $name) -CompressionLevel Optimal
}

Step "Done"
foreach ($file in @((Join-Path $out "Waypoint.exe"), (Join-Path $lite "Waypoint.exe")) + (Get-ChildItem $release).FullName) {
    Write-Host ("  {0,-60} {1,7:N1} MB" -f $file.Substring($root.Length + 1), ((Get-Item $file).Length / 1MB))
}
