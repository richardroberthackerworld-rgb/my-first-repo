# Builds the two upload packages for publishing VidLab / ClipCut on a SUBDOMAIN.
#
#   video-subdomain.zip   -> extract into the SUBDOMAIN document root
#   main-site-addons.zip  -> extract into public_html of the MAIN domain
#
# Usage:  .\make-videotools-zip.ps1                     (uses video.7by.in)
#         .\make-videotools-zip.ps1 -Subdomain clip.7by.in
#
# Uses forward-slash paths so the archives extract correctly on Linux/cPanel.
param(
  [string]$Subdomain = 'video.7by.in',
  [string]$MainDomain = '7by.in'
)

Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

$base = $PSScriptRoot
if (-not $base) { $base = (Get-Location).Path }
$utf8 = New-Object System.Text.UTF8Encoding($false)   # no BOM — Apache/browsers prefer it

function New-Archive($zipPath) {
  if (Test-Path -LiteralPath $zipPath) { [System.IO.File]::Delete((Resolve-Path -LiteralPath $zipPath).Path) }
  $fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
  $arch = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  return [PSCustomObject]@{ Fs = $fs; Arch = $arch; Dirs = (New-Object System.Collections.Generic.HashSet[string]) }
}
function Add-Dirs($z, $path) {
  $parts = $path.Split('/'); $acc = ''
  for ($i = 0; $i -lt $parts.Length - 1; $i++) {
    $acc += $parts[$i] + '/'
    if ($z.Dirs.Add($acc)) { $z.Arch.CreateEntry($acc) | Out-Null }
  }
}
function Add-Bytes($z, $bytes, $name) {
  Add-Dirs $z $name
  $entry = $z.Arch.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
  $es = $entry.Open(); $es.Write($bytes, 0, $bytes.Length); $es.Dispose()
}
function Add-File($z, $fullPath, $name) { Add-Bytes $z ([System.IO.File]::ReadAllBytes($fullPath)) $name }
function Add-Text($z, $text, $name) { Add-Bytes $z ($utf8.GetBytes($text)) $name }
function Close-Archive($z) { $z.Arch.Dispose(); $z.Fs.Close() }

$today = (Get-Date).ToString('yyyy-MM-dd')

# ============ 1) SUBDOMAIN PACKAGE ============
$subZip = Join-Path $base 'video-subdomain.zip'
$z = New-Archive $subZip

# the app itself becomes the site root (index.html, tools, editor/, blog/, .htaccess)
$vt = Join-Path $base 'videotools'
$vtLen = $vt.Length + 1
Get-ChildItem -LiteralPath $vt -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($vtLen) -replace '\\', '/'
  Add-File $z $_.FullName $rel
}

# shared assets the tools + pricing need
@('credits.js', 'layout.js', 'app.js', 'style.css', 'favicon.svg', 'favicon.png', 'apple-touch-icon.png', 'logo-mark.png') | ForEach-Object {
  $p = Join-Path $base ('assets\' + $_)
  if (Test-Path -LiteralPath $p) { Add-File $z $p ('assets/' + $_) }
}

# pricing page, retargeted for the subdomain:
#  - the shared 7By nav/footer links point back to the main site
#  - canonical points at this subdomain (the main-site copy keeps its own)
$pricing = [System.IO.File]::ReadAllText((Join-Path $base 'pricing.html'), $utf8)
$pricing = $pricing.Replace("injectLayout('')", "injectLayout('https://$MainDomain/')")
$pricing = $pricing.Replace('href="tools/audio-cutter"', "href=""https://$MainDomain/tools/audio-cutter""")
$pricing = $pricing.Replace("https://$MainDomain/pricing", "https://$Subdomain/pricing")
Add-Text $z $pricing 'pricing.html'

# SEO / AdSense files for the subdomain
Add-Text $z "google.com, pub-8250159057339426, DIRECT, f08c47fec0942fa0`n" 'ads.txt'
Add-Text $z "User-agent: *`nAllow: /`n`nSitemap: https://$Subdomain/sitemap.xml`n" 'robots.txt'

$paths = @('', 'watermark-remover', 'compressor', 'bg-remover', 'image-watermark', 'toolkit', 'pricing',
           'editor/', 'blog/', 'blog/how-to-remove-watermark-from-video',
           'blog/compress-video-for-whatsapp-instagram',
           'blog/remove-video-background-without-green-screen',
           'blog/free-online-video-editor-clipcut')
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
[void]$sb.AppendLine('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
foreach ($p in $paths) {
  [void]$sb.AppendLine("  <url><loc>https://$Subdomain/$p</loc><lastmod>$today</lastmod></url>")
}
[void]$sb.AppendLine('</urlset>')
Add-Text $z $sb.ToString() 'sitemap.xml'

Close-Archive $z

# ============ 2) MAIN-SITE PACKAGE ============
# ads.txt must exist on the ROOT domain for AdSense to validate subdomain traffic,
# and pricing.html fixes the currently-404 https://MAINDOMAIN/pricing page.
$mainZip = Join-Path $base 'main-site-addons.zip'
$z2 = New-Archive $mainZip
Add-Text $z2 "google.com, pub-8250159057339426, DIRECT, f08c47fec0942fa0`n" 'ads.txt'
Add-File $z2 (Join-Path $base 'pricing.html') 'pricing.html'
@('credits.js', 'layout.js', 'app.js') | ForEach-Object {
  $p = Join-Path $base ('assets\' + $_)
  if (Test-Path -LiteralPath $p) { Add-File $z2 $p ('assets/' + $_) }
}
Close-Archive $z2

$s1 = [math]::Round((Get-Item $subZip).Length / 1KB, 1)
$s2 = [math]::Round((Get-Item $mainZip).Length / 1KB, 1)
Write-Output ("built video-subdomain.zip   (" + $s1 + " KB)  -> subdomain document root  [" + $Subdomain + "]")
Write-Output ("built main-site-addons.zip  (" + $s2 + " KB)  -> public_html of " + $MainDomain)
