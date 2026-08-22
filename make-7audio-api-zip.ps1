# Packages the 7By backend as 7audio-api.zip for cPanel's "Setup Node.js App".
#
#   .\make-7audio-api-zip.ps1
#
# The API is what the email system, credits and payments actually run on.
# Deploying the site without deploying this leaves sign-in, credits, checkout
# and every email broken, so the two go out together.
#
# DELIBERATELY NOT PACKAGED:
#   .env         real secrets — set them in cPanel's environment variables UI
#   db.json      live customer data; shipping it would overwrite production
#   node_modules built on the server by "Run NPM Install", not carried up
#   *.log        noise

$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'server'
$zip  = Join-Path $PSScriptRoot '7audio-api.zip'
$tar  = Join-Path $PSScriptRoot '7audio-api.tar.gz'

if (-not (Test-Path $root)) { throw "no server/ at $root" }

# Everything the API needs to run, and nothing else.
$include = @(
    'server.js',
    'audio-mail.js',
    'audio-plans.js',
    'cashfree.js',
    'guests.js',
    'package.json',
    'package-lock.json',
    '.env.example',
    'README.md',
    'EMAIL-SETUP.md',
    'check-email-dns.mjs'
)

foreach ($f in $include) {
    if (-not (Test-Path (Join-Path $root $f))) { throw "missing from server/: $f" }
}

# Refuse to ship a file that would leak a secret or clobber live data.
foreach ($f in @('.env', 'db.json')) {
    if ($include -contains $f) { throw "$f must never be packaged" }
}

# Every module server.js requires must be in the list, or the app crashes on
# boot with a module-not-found that is confusing to diagnose over FTP.
$serverText = [System.IO.File]::ReadAllText((Join-Path $root 'server.js'))
foreach ($m in [regex]::Matches($serverText, "require\('\./([A-Za-z0-9_-]+)'\)")) {
    $needed = $m.Groups[1].Value + '.js'
    if ($include -notcontains $needed) { throw "server.js requires ./$needed but it is not packaged" }
}

# A syntax error here becomes a 503 on the live site, so check before shipping.
foreach ($f in @('server.js', 'audio-mail.js', 'audio-plans.js', 'cashfree.js', 'guests.js')) {
    & node --check (Join-Path $root $f)
    if ($LASTEXITCODE -ne 0) { throw "syntax error in $f" }
}

# The four sender identities must be exactly as specified.
$mailText = [System.IO.File]::ReadAllText((Join-Path $root 'audio-mail.js'))
foreach ($box in @('noreply@', 'welcome@', 'thankyou@', 'contact@')) {
    if ($mailText -notmatch [regex]::Escape($box)) { throw "audio-mail.js is missing the $box sender" }
}
if ($mailText -match 'AUDIO_SMTP_PASS\s*=\s*["'']') { throw 'audio-mail.js appears to contain a hard-coded password' }

Write-Host '  API: all modules present, syntax clean, four senders configured' -ForegroundColor DarkGray

if (Test-Path $zip) { Remove-Item $zip -Force }

# Entries are written by hand: PowerShell 5.1's Compress-Archive and .NET's
# ZipFile both write BACKSLASH separators into entry names, which the ZIP spec
# forbids and which cPanel then extracts as literal "a\b.js" filenames.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$stream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in $include) {
            $entry = $archive.CreateEntry($f, [System.IO.Compression.CompressionLevel]::Optimal)
            $out = $entry.Open()
            try { [System.IO.File]::OpenRead((Join-Path $root $f)).CopyTo($out) } finally { $out.Dispose() }
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }

# Prove it, rather than trusting it.
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
    $names = $archive.Entries.FullName
    $bad = @($archive.Entries | Where-Object { $_.FullName -like '*\*' })
} finally { $archive.Dispose() }
if ($bad.Count) { throw "$($bad.Count) zip entries use backslashes" }
foreach ($f in @('server.js', 'audio-mail.js', 'package.json')) {
    if ($names -notcontains $f) { throw "missing from zip: $f" }
}
foreach ($f in @('.env', 'db.json')) {
    if ($names -contains $f) { throw "$f ended up in the zip - stop and remove it" }
}

# Same files as a tarball: some hosts' ClamAV flags any zip containing .js.
if (Test-Path $tar) { Remove-Item $tar -Force }
Push-Location $root
try {
    & tar -czf $tar $include
    if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
} finally { Pop-Location }

$zipSize = [math]::Round((Get-Item $zip).Length / 1KB, 1)
$tarSize = [math]::Round((Get-Item $tar).Length / 1KB, 1)
Write-Host ''
Write-Host "7audio-api.zip     -  $zipSize KB, $($include.Count) files" -ForegroundColor Green
Write-Host "7audio-api.tar.gz  -  $tarSize KB, $($include.Count) files  (use this if the host flags the zip)" -ForegroundColor Green
Write-Host 'Extract into the Node app root, then Run NPM Install and Restart.'
Write-Host 'Set the environment variables in cPanel - .env is deliberately NOT included.'
