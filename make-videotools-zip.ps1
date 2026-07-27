# Builds the upload packages for publishing VidLab / ClipCut on a SUBDOMAIN.
#
# cPanel's ClamAV (Sanesecurity) flags ANY .zip containing .js files as
# "Foxhole.JS_Zip" — a well-known false positive. So this builds .tar.gz as the
# primary format (the signature is zip-specific) plus a .js-free .zip fallback.
#
#   dist\subdomain\   exact file tree for the subdomain document root
#   dist\mainsite\    exact file tree for public_html
#   video-subdomain.tar.gz / main-site-addons.tar.gz        <- upload these
#   video-subdomain-nojs.zip / main-site-addons-nojs.zip    <- fallback
#
# Usage:  .\make-videotools-zip.ps1
#         .\make-videotools-zip.ps1 -Subdomain clip.7by.in
param(
  [string]$Subdomain = 'video.7by.in',
  [string]$MainDomain = '7by.in'
)

Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

$base = $PSScriptRoot
if (-not $base) { $base = (Get-Location).Path }
$utf8 = New-Object System.Text.UTF8Encoding($false)   # no BOM
$today = (Get-Date).ToString('yyyy-MM-dd')

$dist = Join-Path $base 'dist'
if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
$sub = Join-Path $dist 'subdomain'
$main = Join-Path $dist 'mainsite'
New-Item -ItemType Directory -Force -Path $sub, $main | Out-Null

function Put-Text($text, $path) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($path, $text, $utf8)
}
function Put-File($src, $path) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Copy-Item -LiteralPath $src -Destination $path -Force
}

# ============ 1) SUBDOMAIN TREE ============
# the app itself becomes the site root (index.html, tools, editor/, blog/, .htaccess)
$vt = Join-Path $base 'videotools'
$vtLen = $vt.Length + 1
Get-ChildItem -LiteralPath $vt -Recurse -File -Force | ForEach-Object {
  Put-File $_.FullName (Join-Path $sub $_.FullName.Substring($vtLen))
}

$sharedAssets = @('credits.js', 'layout.js', 'app.js', 'style.css', 'favicon.svg', 'favicon.png', 'apple-touch-icon.png', 'logo-mark.png')
$sharedAssets | ForEach-Object {
  $p = Join-Path $base ('assets\' + $_)
  if (Test-Path -LiteralPath $p) { Put-File $p (Join-Path $sub ('assets\' + $_)) }
}

# pricing page retargeted for the subdomain (source file left untouched:
# the main site keeps using it as-is)
$pricing = [System.IO.File]::ReadAllText((Join-Path $base 'pricing.html'), $utf8)
$pricing = $pricing.Replace("injectLayout('')", "injectLayout('https://$MainDomain/')")
$pricing = $pricing.Replace('href="tools/audio-cutter"', "href=""https://$MainDomain/tools/audio-cutter""")
$pricing = $pricing.Replace("https://$MainDomain/pricing", "https://$Subdomain/pricing")
Put-Text $pricing (Join-Path $sub 'pricing.html')

Put-Text "google.com, pub-8250159057339426, DIRECT, f08c47fec0942fa0`n" (Join-Path $sub 'ads.txt')
Put-Text "User-agent: *`nAllow: /`n`nSitemap: https://$Subdomain/sitemap.xml`n" (Join-Path $sub 'robots.txt')

$paths = @('', 'watermark-remover', 'compressor', 'bg-remover', 'image-watermark', 'toolkit', 'pricing',
           'editor/', 'blog/', 'blog/how-to-remove-watermark-from-video',
           'blog/compress-video-for-whatsapp-instagram',
           'blog/remove-video-background-without-green-screen',
           'blog/free-online-video-editor-clipcut')
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
[void]$sb.AppendLine('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
foreach ($p in $paths) { [void]$sb.AppendLine("  <url><loc>https://$Subdomain/$p</loc><lastmod>$today</lastmod></url>") }
[void]$sb.AppendLine('</urlset>')
Put-Text $sb.ToString() (Join-Path $sub 'sitemap.xml')

# ============ 2) MAIN-SITE TREE ============
# ads.txt must exist on the ROOT domain for AdSense to validate subdomain
# traffic; pricing.html fixes the currently-404 /pricing page.
Put-Text "google.com, pub-8250159057339426, DIRECT, f08c47fec0942fa0`n" (Join-Path $main 'ads.txt')
Put-File (Join-Path $base 'pricing.html') (Join-Path $main 'pricing.html')
@('credits.js', 'layout.js', 'app.js') | ForEach-Object {
  $p = Join-Path $base ('assets\' + $_)
  if (Test-Path -LiteralPath $p) { Put-File $p (Join-Path $main ('assets\' + $_)) }
}

# ============ 3) ARCHIVES ============
$tarExe = "$env:SystemRoot\System32\tar.exe"

function New-Tar($srcDir, $outFile) {
  if (Test-Path -LiteralPath $outFile) { Remove-Item -LiteralPath $outFile -Force }
  & $tarExe -czf $outFile -C $srcDir .
  if ($LASTEXITCODE -ne 0) { Write-Output ("  tar failed for " + $outFile) }
}

# .js-free zip fallback (Foxhole.JS_Zip only fires on zips containing .js)
function New-ZipNoJs($srcDir, $outFile) {
  if (Test-Path -LiteralPath $outFile) { [System.IO.File]::Delete((Resolve-Path -LiteralPath $outFile).Path) }
  $fs = [System.IO.File]::Open($outFile, [System.IO.FileMode]::Create)
  $arch = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  $dirs = New-Object System.Collections.Generic.HashSet[string]
  $srcLen = $srcDir.Length + 1
  Get-ChildItem -LiteralPath $srcDir -Recurse -File -Force | Where-Object { $_.Extension -ne '.js' } | ForEach-Object {
    $name = $_.FullName.Substring($srcLen) -replace '\\', '/'
    $parts = $name.Split('/'); $acc = ''
    for ($i = 0; $i -lt $parts.Length - 1; $i++) {
      $acc += $parts[$i] + '/'
      if ($dirs.Add($acc)) { $arch.CreateEntry($acc) | Out-Null }
    }
    $entry = $arch.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open(); $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $es.Write($bytes, 0, $bytes.Length); $es.Dispose()
  }
  $arch.Dispose(); $fs.Close()
}

New-Tar $sub  (Join-Path $base 'video-subdomain.tar.gz')
New-Tar $main (Join-Path $base 'main-site-addons.tar.gz')
New-ZipNoJs $sub  (Join-Path $base 'video-subdomain-nojs.zip')
New-ZipNoJs $main (Join-Path $base 'main-site-addons-nojs.zip')

# old zips would be flagged by the scanner — don't leave them lying around
@('video-subdomain.zip', 'main-site-addons.zip', 'videotools-live.zip') | ForEach-Object {
  $p = Join-Path $base $_
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
}

function Show($f) {
  $p = Join-Path $base $f
  if (Test-Path -LiteralPath $p) { Write-Output ("  {0,-32} {1,8} KB" -f $f, [math]::Round((Get-Item $p).Length / 1KB, 1)) }
}
Write-Output ""
Write-Output "UPLOAD THESE (virus-scanner safe):"
Show 'video-subdomain.tar.gz'
Show 'main-site-addons.tar.gz'
Write-Output ""
Write-Output "Fallback if .tar.gz is refused (then upload the .js files by hand from dist\):"
Show 'video-subdomain-nojs.zip'
Show 'main-site-addons-nojs.zip'
Write-Output ""
Write-Output ("Loose .js files needing manual upload with the fallback: " +
  ((Get-ChildItem -LiteralPath $sub -Recurse -File -Force | Where-Object { $_.Extension -eq '.js' }).Count + 3))
Write-Output ("Exact file trees are in: " + $dist)
