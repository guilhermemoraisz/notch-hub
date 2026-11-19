# Draws the robot face (same design as the sidebar avatar) and writes
# assets/icon.ico with PNG frames from 16 to 256 px.
# Each size is drawn natively (not downscaled) so small sizes stay crisp.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1 [-EyeColor '#4cc9f0']
param([string]$EyeColor = '#7ed957')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root 'assets'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Min($r * 2, [Math]::Min($w, $h))
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  $p
}

function New-RobotPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)

  # Proportions follow the CSS avatar (34x28 face, 2px border, 6x8 eyes).
  $s = [float]$size
  $border = [Math]::Max(1.0, $s * 0.075)
  $faceW = $s * 0.92
  $faceH = $s * 0.76
  $x = ($s - $faceW) / 2
  $y = ($s - $faceH) / 2
  $radius = $s * 0.24

  # Fill and border share one path, inset by half the pen width so the stroke stays inside.
  $path = New-RoundedRect ($x + $border / 2) ($y + $border / 2) ($faceW - $border) ($faceH - $border) $radius
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#1c1f22'))), $path)
  $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#e8eaed')), $border), $path)

  $eyeW = $s * 0.16
  $eyeH = $s * 0.23
  $gap = $s * 0.16
  $eyeY = $y + ($faceH - $eyeH) / 2
  $eyeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($EyeColor))
  $leftEye = $s / 2 - $gap / 2 - $eyeW
  $rightEye = $s / 2 + $gap / 2
  foreach ($eyeX in @($leftEye, $rightEye)) {
    $g.FillPath($eyeBrush, (New-RoundedRect $eyeX $eyeY $eyeW $eyeH ($eyeW / 2)))
  }

  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($size -eq 256) { $bmp.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
  , $ms.ToArray()
}

# ICO container with embedded PNG frames (supported since Windows Vista).
$sizes = 16, 24, 32, 48, 64, 128, 256
$frames = foreach ($sz in $sizes) { , (New-RobotPng $sz) }

$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }   # 0 means 256
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$frames[$i].Length); $w.Write([uint32]$offset)
  $offset += $frames[$i].Length
}
foreach ($f in $frames) { $w.Write([byte[]]$f) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $outDir 'icon.ico'), $out.ToArray())
"Wrote $(Join-Path $outDir 'icon.ico') and icon.png"
