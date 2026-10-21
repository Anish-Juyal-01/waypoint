<#
.SYNOPSIS
  Renders the Waypoint pixel-art app icon (multi-resolution .ico with PNG frames) using GDI+.
  The mark is a 16×16 pixel grid (lime tile, ink "source + echo arcs" glyph), drawn with
  nearest-neighbour fills so it stays crisp in the 16 px notification area.
  Output: src-tauri/icons/icon.ico and ui/public/icon.png
#>
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

# Must match ui/src/components/Pixel.tsx (LOGO) and BootSplash.tsx (MARK).
$grid = @(
    "..LLLLLLLLLLLL..",
    ".LLLLLLLLLLLLLL.",
    "LLLLLLLLLLLLLLLL",
    "LLLLLLLLL#LLLLLL",
    "LLLLLLLLLL#LLLLL",
    "LLLLLLL#LLL#LLLL",
    "LLLLLLLL#LL#LLLL",
    "LLL##LLL#LL#LLLL",
    "LLL##LLL#LL#LLLL",
    "LLLLLLLL#LL#LLLL",
    "LLLLLLL#LLL#LLLL",
    "LLLLLLLLLL#LLLLL",
    "LLLLLLLLL#LLLLLL",
    "LLLLLLLLLLLLLLLL",
    ".LLLLLLLLLLLLLL.",
    "..LLLLLLLLLLLL.."
)
$lime = [System.Drawing.Color]::FromArgb(255, 255, 79, 154)   # riso pink
$ink = [System.Drawing.Color]::FromArgb(255, 31, 42, 120)   # riso blue ink

function Render-Icon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'None'
    $g.InterpolationMode = 'NearestNeighbor'
    $g.PixelOffsetMode = 'Half'
    $g.Clear([System.Drawing.Color]::Transparent)
    $limeBrush = New-Object System.Drawing.SolidBrush $lime
    $inkBrush = New-Object System.Drawing.SolidBrush $ink

    for ($y = 0; $y -lt 16; $y++) {
        for ($x = 0; $x -lt 16; $x++) {
            $ch = $grid[$y][$x]
            if ($ch -eq '.') { continue }
            # Integer pixel edges so cells never blur into each other.
            $x0 = [math]::Round($x * $size / 16); $x1 = [math]::Round(($x + 1) * $size / 16)
            $y0 = [math]::Round($y * $size / 16); $y1 = [math]::Round(($y + 1) * $size / 16)
            $brush = if ($ch -eq '#') { $inkBrush } else { $limeBrush }
            $g.FillRectangle($brush, [int]$x0, [int]$y0, [int]($x1 - $x0), [int]($y1 - $y0))
        }
    }

    $g.Dispose()
    return $bmp
}

$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$frames = foreach ($sz in $sizes) {
    $bmp = Render-Icon $sz
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($sz -eq 256) {
        $uiPublic = Join-Path $Root 'ui/public'
        New-Item -ItemType Directory -Force $uiPublic | Out-Null
        $bmp.Save((Join-Path $uiPublic 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $bmp.Dispose()
    [pscustomobject]@{ Size = $sz; Bytes = $ms.ToArray() }
}

# ICO container: ICONDIR + ICONDIRENTRY[] + PNG payloads.
$out = Join-Path $Root 'src-tauri/icons/icon.ico'
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$fs = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
    $dim = if ($f.Size -ge 256) { 0 } else { $f.Size }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$f.Bytes.Length); $w.Write([UInt32]$offset)
    $offset += $f.Bytes.Length
}
foreach ($f in $frames) { $w.Write($f.Bytes) }
$w.Dispose()
Write-Host "Wrote $out"
