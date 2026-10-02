param(
  [string]$Src = ".\Doraemon Flying Over Town.png",
  [string]$Res = ".\android\app\src\main\res"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile((Resolve-Path $Src).Path)
$BG = [System.Drawing.ColorTranslator]::FromHtml("#0A0E26")

function New-Bmp([int]$size) {
  $b = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($b, $g)
}

function Add-RoundRect($g, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Save-Bmp($b, $g, [string]$path) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $g.Flush()
  $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $b.Dispose()
}

# density -> legacy launcher px, foreground px (108dp)
$dpi = @{ mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }

foreach ($d in $dpi.Keys) {
  $n = $dpi[$d]

  # legacy square icon: dark plate + rounded art
  $b, $g = New-Bmp $n
  $g.Clear($BG)
  $pad = $n * 0.04
  $path = Add-RoundRect $g $pad $pad ($n - 2 * $pad) ($n - 2 * $pad) ($n * 0.18)
  $g.FillPath((New-Object System.Drawing.SolidBrush $BG), $path)
  $g.SetClip($path)
  $g.DrawImage($img, $pad, $pad, $n - 2 * $pad, $n - 2 * $pad)
  $g.ResetClip()
  Save-Bmp $b $g (Join-Path $Res "mipmap-$d\ic_launcher.png")

  # round icon: circular art
  $b, $g = New-Bmp $n
  $g.Clear([System.Drawing.Color]::Transparent)
  $circle = New-Object System.Drawing.Drawing2D.GraphicsPath
  $circle.AddEllipse(0, 0, $n, $n)
  $g.FillPath((New-Object System.Drawing.SolidBrush $BG), $circle)
  $g.SetClip($circle)
  $g.DrawImage($img, 0, 0, $n, $n)
  $g.ResetClip()
  Save-Bmp $b $g (Join-Path $Res "mipmap-$d\ic_launcher_round.png")

  # adaptive foreground: art inside the 66/108 safe zone
  $f = [int]($n * 108 / 48)
  $b, $g = New-Bmp $f
  $sz = [float]($f * 0.6)
  $off = ($f - $sz) / 2
  $path = Add-RoundRect $g $off $off $sz $sz ($sz * 0.16)
  $g.SetClip($path)
  $g.DrawImage($img, $off, $off, $sz, $sz)
  $g.ResetClip()
  Save-Bmp $b $g (Join-Path $Res "mipmap-$d\ic_launcher_foreground.png")
}

# splash logo
$b, $g = New-Bmp 512
$pad = 8
$path = Add-RoundRect $g $pad $pad (512 - 2 * $pad) (512 - 2 * $pad) 64
$g.FillPath((New-Object System.Drawing.SolidBrush $BG), $path)
$g.SetClip($path)
$g.DrawImage($img, $pad, $pad, 512 - 2 * $pad, 512 - 2 * $pad)
$g.ResetClip()
Save-Bmp $b $g (Join-Path $Res "drawable\splash_logo.png")

$img.Dispose()
Remove-Item (Join-Path $Res "drawable-v24\ic_launcher_foreground.xml") -Force -ErrorAction SilentlyContinue
"icons + splash logo generated"
