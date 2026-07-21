# Builds videotools-live.zip — everything needed to publish VidLab / ClipCut
# on 7by.in, with FORWARD-SLASH paths so it extracts correctly on Linux/cPanel.
# Deliberately does NOT include index.html or other existing live pages,
# so extracting it cannot overwrite the current homepage.
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

$base = $PSScriptRoot
if (-not $base) { $base = (Get-Location).Path }
$zipPath = Join-Path $base 'videotools-live.zip'
if (Test-Path -LiteralPath $zipPath) { [System.IO.File]::Delete((Resolve-Path -LiteralPath $zipPath).Path) }

$fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
$arch = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
$dirs = New-Object System.Collections.Generic.HashSet[string]

function Add-Dirs($path) {
  $parts = $path.Split('/'); $acc = ''
  for ($i = 0; $i -lt $parts.Length - 1; $i++) {
    $acc += $parts[$i] + '/'
    if ($dirs.Add($acc)) { $arch.CreateEntry($acc) | Out-Null }
  }
}
function Add-File($fullPath, $name) {
  Add-Dirs $name
  $entry = $arch.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
  $es = $entry.Open(); $bytes = [System.IO.File]::ReadAllBytes($fullPath)
  $es.Write($bytes, 0, $bytes.Length); $es.Dispose()
}

# 1) the whole videotools app (tools, editor, blog)
$vt = Join-Path $base 'videotools'
$vtLen = $vt.Length + 1
Get-ChildItem -LiteralPath $vt -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($vtLen) -replace '\\', '/'
  Add-File $_.FullName ('videotools/' + $rel)
}

# 2) shared assets the tools + pricing need (these are missing on the live site)
@('credits.js', 'layout.js', 'app.js', 'style.css', 'favicon.svg', 'favicon.png', 'apple-touch-icon.png') | ForEach-Object {
  $p = Join-Path $base ('assets\' + $_)
  if (Test-Path -LiteralPath $p) { Add-File $p ('assets/' + $_) }
}

# 3) root files: pricing page (Get Pro target) + SEO/AdSense files
@('pricing.html', 'ads.txt', 'robots.txt', 'sitemap.xml') | ForEach-Object {
  $p = Join-Path $base $_
  if (Test-Path -LiteralPath $p) { Add-File $p $_ }
}

$arch.Dispose(); $fs.Close()
$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Output ("built videotools-live.zip  (" + $size + " KB)")
