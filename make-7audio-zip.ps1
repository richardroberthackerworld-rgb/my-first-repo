# Builds 7 Audio and packages the deployable site as 7audio-site.zip
#
#   .\make-audiora-zip.ps1                          # default domain
#   .\make-audiora-zip.ps1 https://audio.7by.in     # sitemap/robots point elsewhere
#
# Upload the CONTENTS of the zip to your domain root (public_html/), not the
# folder itself. .htaccess must land next to index.html or deep links 404,
# and workers/ must survive as a folder or the AI and noise tools cannot start.

param([string]$Origin = 'https://7audio.7by.in')

$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'audiora'
$dist = Join-Path $root 'dist'
$zip  = Join-Path $PSScriptRoot '7audio-site.zip'

Write-Host "Generating sitemap for $Origin ..." -ForegroundColor Cyan
& node (Join-Path $root 'scripts/make-sitemap.mjs') $Origin
if ($LASTEXITCODE -ne 0) { throw 'sitemap generation failed' }

# Keep robots.txt pointing at the same origin as the sitemap it advertises.
$robots = Join-Path $root 'public/robots.txt'
$text = [System.IO.File]::ReadAllText($robots)
$text = [regex]::Replace($text, 'Sitemap: \S+', "Sitemap: $Origin/sitemap.xml")
[System.IO.File]::WriteAllText($robots, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host 'Building production bundle ...' -ForegroundColor Cyan
Push-Location $root
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'build failed' }
} finally { Pop-Location }

if (-not (Test-Path $dist)) { throw "no dist/ at $dist" }

# Vite does not copy dotfiles out of public/, so .htaccess is placed by hand.
Copy-Item (Join-Path $root 'public/.htaccess') (Join-Path $dist '.htaccess') -Force

foreach ($f in @('index.html', '.htaccess', 'robots.txt', 'sitemap.xml')) {
    if (-not (Test-Path (Join-Path $dist $f))) { throw "missing from dist: $f" }
}

# The workers are the processing engines. If any is missing the tools that
# depend on it fail at runtime, so fail here instead.
foreach ($w in @('separation-worker.js', 'separation6-worker.js', 'denoise-worker.js', 'stretch-worker.js')) {
    if (-not (Test-Path (Join-Path $dist "workers/$w"))) { throw "missing worker: $w" }
}

# Live pitch preview.
if (-not (Test-Path (Join-Path $dist 'worklets/pitch-processor.js'))) { throw 'missing worklet: pitch-processor.js' }

# The audio encoder. Without these, FLAC / M4A / OGG / AAC export cannot work,
# and the failure only shows up at runtime — so check for them now.
foreach ($f in @('ffmpeg/ffmpeg-core.js', 'ffmpeg/ffmpeg-core.wasm', 'ffmpeg/esm/worker.js')) {
    if (-not (Test-Path (Join-Path $dist $f))) { throw "missing encoder file: $f" }
}
$core = Get-Item (Join-Path $dist 'ffmpeg/ffmpeg-core.wasm')
if ($core.Length -lt 20MB) { throw 'ffmpeg-core.wasm looks truncated' }

# ------------------------------------------------------------------- PWA
# Installability fails silently when one of these is missing, so they are
# checked here rather than discovered by a user.
foreach ($f in @(
        'manifest.webmanifest', 'sw.js', 'connection.html',
        'brand/icon-192.png', 'brand/icon-512.png',
        'brand/maskable-192.png', 'brand/maskable-512.png',
        'brand/apple-touch-180.png')) {
    if (-not (Test-Path (Join-Path $dist $f))) { throw "missing PWA file: $f" }
}

# scripts/make-sw.mjs fills these in after the build. If either survives, the
# worker would throw on its first line and nobody would get a cached app shell.
$swText = [System.IO.File]::ReadAllText((Join-Path $dist 'sw.js'))
if ($swText -match '__BUILD_VERSION__' -or $swText -match '__PRECACHE_URLS__') {
    throw 'sw.js still contains build placeholders - did scripts/make-sw.mjs run?'
}

# ------------------------------------------------------------------- SEO
# Every public route must have been pre-rendered with its own head, or the
# page ships with the wrong title and every shared link previews identically.
# These fail loudly here rather than being noticed weeks later in Search
# Console.
$seoRoutes = @(
    'tools/index.html', 'tools/vocal-remover/index.html', 'tools/stem-splitter/index.html',
    'tools/noise-remover/index.html', 'tools/audio-cutter/index.html', 'tools/song-joiner/index.html',
    'tools/pitch-shifter/index.html', 'tools/audio-converter/index.html',
    'features/index.html', 'pricing/index.html', 'blog/index.html',
    'credits/index.html', 'support/index.html', 'privacy/index.html', 'terms/index.html')
foreach ($f in $seoRoutes) {
    if (-not (Test-Path (Join-Path $dist $f))) { throw "route was not pre-rendered: $f" }
}

# Each tool page carries its landing content as HowTo + FAQPage. Missing
# markup means the page shipped without the content that makes it rank.
foreach ($id in @('vocal-remover', 'stem-splitter', 'noise-remover', 'audio-cutter',
                  'song-joiner', 'pitch-shifter', 'audio-converter')) {
    $page = [System.IO.File]::ReadAllText((Join-Path $dist "tools/$id/index.html"))
    if ($page -notmatch '"@type":"HowTo"')  { throw "no HowTo markup on /tools/$id" }
    if ($page -notmatch '"@type":"FAQPage"') { throw "no FAQPage markup on /tools/$id" }
    if ($page -notmatch '"@type":"SoftwareApplication"') { throw "no SoftwareApplication markup on /tools/$id" }
}
Write-Host '  SEO: all 7 tool pages carry HowTo + FAQ + SoftwareApplication' -ForegroundColor DarkGray

# Every article the sitemap advertises must exist as a page with Article
# markup. A post added to src/data/blog without a rebuild would otherwise
# ship as a 404 in the sitemap.
$sitemapXml = [xml][System.IO.File]::ReadAllText((Join-Path $dist 'sitemap.xml'))
$articleCount = 0
foreach ($u in $sitemapXml.urlset.url) {
    $p = ([uri]$u.loc).AbsolutePath.Trim('/')
    if (-not $p.StartsWith('blog/')) { continue }
    $f = Join-Path $dist (Join-Path $p 'index.html')
    if (-not (Test-Path $f)) { throw "article was not pre-rendered: $p" }
    $h = [System.IO.File]::ReadAllText($f)
    if ($h -notmatch '"@type":"Article"') { throw "no Article markup on $p" }
    $articleCount++
}
if ($articleCount -lt 20) { throw "only $articleCount articles found - expected the full set" }
Write-Host "  SEO: $articleCount articles pre-rendered with Article markup" -ForegroundColor DarkGray

# The contact page must exist — every email advertises it, and the footer
# links to it.
if (-not (Test-Path (Join-Path $dist 'contact/index.html'))) { throw 'contact page was not pre-rendered' }

# Digital Asset Links for the Android app. Without this file the TWA ships
# with a visible browser address bar.
$assetLinksPath = Join-Path $dist '.well-known/assetlinks.json'
if (-not (Test-Path $assetLinksPath)) { throw 'missing .well-known/assetlinks.json' }
$assetLinks = [System.IO.File]::ReadAllText($assetLinksPath)
$assetLinksDoc = $assetLinks | ConvertFrom-Json

# The package name is permanent once published, so a typo here is expensive.
if ($assetLinksDoc[0].target.package_name -ne 'in.sevenby.audio') {
    throw "assetlinks.json names package '$($assetLinksDoc[0].target.package_name)' - expected in.sevenby.audio"
}

$prints = @($assetLinksDoc[0].target.sha256_cert_fingerprints)
if ($prints.Count -eq 0) { throw 'assetlinks.json lists no fingerprints' }

foreach ($fp in $prints) {
    if ($fp -match 'REPLACE_WITH') {
        Write-Host '  NOTE: assetlinks.json still has a placeholder fingerprint - the Android app will show a URL bar until it is set.' -ForegroundColor Yellow
        Write-Host '        Get it from Play Console -> Setup -> App integrity, then:' -ForegroundColor Yellow
        Write-Host '        node audiora/scripts/set-assetlinks.mjs <SHA-256>' -ForegroundColor Yellow
        continue
    }
    # A malformed fingerprint is worse than a placeholder: it looks configured
    # and fails silently. 32 colon-separated uppercase hex pairs, exactly.
    if ($fp -cnotmatch '^([0-9A-F]{2}:){31}[0-9A-F]{2}$') {
        throw "assetlinks.json fingerprint is malformed: '$fp' - expected 32 colon-separated uppercase hex pairs"
    }
    Write-Host "  Android: asset link fingerprint present and well formed" -ForegroundColor DarkGray
}

# ------------------------------------------------------------ backend wiring
# The API base is compiled into the bundle at build time from
# audiora/.env.production.local. If it is missing the site still works, but
# sign-in, credits and checkout are HIDDEN — and nothing about the built files
# says so. That is a silent and expensive mistake, so it is called out here.
#
# Set it with:
#   VITE_AUDIORA_API=https://api.7by.in
#   VITE_GOOGLE_CLIENT_ID=<your client id>
$bundleHasApi = $false
foreach ($js in Get-ChildItem -Path (Join-Path $dist 'assets') -Filter '*.js') {
    if ([System.IO.File]::ReadAllText($js.FullName) -match 'https?://[A-Za-z0-9.-]*api[A-Za-z0-9.-]*\.[A-Za-z]') {
        $bundleHasApi = $true
        break
    }
}
if (-not $bundleHasApi) {
    Write-Host ''
    Write-Host '  WARNING: no backend URL is compiled into this build.' -ForegroundColor Yellow
    Write-Host '           Sign-in, credits and checkout will be HIDDEN on the live site.' -ForegroundColor Yellow
    Write-Host '           Create audiora/.env.production.local with VITE_AUDIORA_API and' -ForegroundColor Yellow
    Write-Host '           VITE_GOOGLE_CLIENT_ID, then run this script again.' -ForegroundColor Yellow
    Write-Host ''
} else {
    Write-Host '  API: backend URL is compiled into the bundle' -ForegroundColor DarkGray
}

# The link preview image the OG tags point at.
if (-not (Test-Path (Join-Path $dist 'brand/og-image.jpg'))) { throw 'missing brand/og-image.jpg' }

# Two pages must not share a title, and none may still carry the template's.
$titles = @{}
foreach ($page in Get-ChildItem -Path $dist -Recurse -Filter 'index.html') {
    $html = [System.IO.File]::ReadAllText($page.FullName)
    $rel = $page.FullName.Substring((Resolve-Path $dist).Path.Length).TrimStart('\').Replace('\', '/')

    if ($html -notmatch '<link rel="canonical"') { throw "no canonical URL in $rel" }
    if (([regex]::Matches($html, '<meta name="description"')).Count -ne 1) {
        throw "expected exactly one meta description in $rel"
    }

    $m = [regex]::Match($html, '<title>(.*?)</title>')
    if (-not $m.Success) { throw "no title in $rel" }
    $title = $m.Groups[1].Value
    if ($titles.ContainsKey($title)) { throw "duplicate title '$title' in $rel and $($titles[$title])" }
    $titles[$title] = $rel
}
Write-Host "  SEO: $($titles.Count) pages, every title unique" -ForegroundColor DarkGray

# The sitemap must not advertise a page that was never built.
$sitemap = [xml][System.IO.File]::ReadAllText((Join-Path $dist 'sitemap.xml'))
foreach ($url in $sitemap.urlset.url) {
    $path = ([uri]$url.loc).AbsolutePath.Trim('/')
    $file = if ($path) { Join-Path $dist (Join-Path $path 'index.html') } else { Join-Path $dist 'index.html' }
    if (-not (Test-Path $file)) { throw "sitemap lists $($url.loc) but no page was built for it" }
}
Write-Host "  SEO: all $($sitemap.urlset.url.Count) sitemap URLs exist" -ForegroundColor DarkGray

# The manifest must be valid JSON and must name icons that actually exist.
$manifest = [System.IO.File]::ReadAllText((Join-Path $dist 'manifest.webmanifest')) | ConvertFrom-Json
foreach ($icon in $manifest.icons) {
    $iconPath = Join-Path $dist $icon.src.TrimStart('/')
    if (-not (Test-Path $iconPath)) { throw "manifest lists a missing icon: $($icon.src)" }
}

if (Test-Path $zip) { Remove-Item $zip -Force }

# Entries are written by hand because BOTH of the obvious options put Windows
# BACKSLASH separators into entry names, which the ZIP spec forbids: PowerShell
# 5.1's Compress-Archive does it, and so does .NET Framework's
# ZipFile::CreateFromDirectory. cPanel and Linux unzip then extract a file
# literally called "assets\index.js" into the root instead of an assets/
# folder, and every script 404s. Forward slashes, set explicitly.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$prefix = (Resolve-Path $dist).Path.TrimEnd('\') + '\'
$stream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -Path $dist -Recurse -Force -File) {
            $name = $file.FullName.Substring($prefix.Length).Replace('\', '/')
            $entry = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
            $out = $entry.Open()
            try { [System.IO.File]::OpenRead($file.FullName).CopyTo($out) } finally { $out.Dispose() }
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }

# Prove it, rather than trusting it.
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
    $bad = @($archive.Entries | Where-Object { $_.FullName -like '*\*' })
    $names = $archive.Entries.FullName
} finally { $archive.Dispose() }
if ($bad.Count) { throw "$($bad.Count) zip entries use backslashes - archive would break on upload" }
foreach ($f in @('index.html', '.htaccess', 'robots.txt', 'sitemap.xml', 'workers/separation-worker.js', 'sw.js', 'manifest.webmanifest')) {
    if ($names -notcontains $f) { throw "missing from zip: $f" }
}

# --------------------------------------------------------------- tar.gz too
# Many shared hosts run ClamAV with the Sanesecurity Foxhole signatures, which
# flag ANY zip containing .js files as malware (Foxhole.JS_Zip_*). It is a
# heuristic aimed at emailed JS droppers, not a detection of anything in this
# build - but the host cancels the upload regardless. A .tar.gz carries the
# identical files past it. Same problem 7xpro and 7hand hit; same fix.
$tar = Join-Path $PSScriptRoot '7audio-site.tar.gz'
if (Test-Path $tar) { Remove-Item $tar -Force }
& tar -czf $tar -C $dist .
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }

$listing = & tar -tzf $tar
foreach ($f in @('./index.html', './.htaccess', './robots.txt', './sitemap.xml', './sw.js', './manifest.webmanifest')) {
    if ($listing -notcontains $f) { throw "missing from tar.gz: $f" }
}

$count   = (Get-ChildItem -Path $dist -Recurse -Force -File).Count
$zipSize = [math]::Round((Get-Item $zip).Length / 1MB, 2)
$tarSize = [math]::Round((Get-Item $tar).Length / 1MB, 2)
Write-Host ''
Write-Host "7audio-site.zip     -  $zipSize MB, $count files" -ForegroundColor Green
Write-Host "7audio-site.tar.gz  -  $tarSize MB, $count files  (use this if the host flags the zip)" -ForegroundColor Green
Write-Host 'Upload the CONTENTS to public_html/ (index.html and .htaccess at the root).'
Write-Host 'Optional: drop the official icon at brand/7audio-icon.png after upload.'
