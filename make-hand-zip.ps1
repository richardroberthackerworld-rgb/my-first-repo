# =============================================================
#  7Hand — build a deployable zip.
#
#  Follows the same pattern as make-cad-zip.ps1 and
#  make-writer-zip.ps1: zip the folder, upload, extract on the
#  host. No build step, no bundler, no node_modules.
#
#  Deliberately EXCLUDED from the zip:
#    api/config.php   real API keys
#    api/.state/      rate-limit scratch files
#    test.html        the test harness is not for users
#    samples/         committed example output
#
#  NOTE ON THE NAME. This must not deploy over writer.7by.in,
#  which is the existing 7By Writer product. Different folder,
#  different subdomain, different zip.
# =============================================================

param(
    # -Local builds a zip for trying it on your own machine: keeps the test
    # harness, the sample output and start.bat. The default build is for
    # deployment and strips all three.
    [switch]$Local
)

$ErrorActionPreference = 'Stop'

$src = Join-Path $PSScriptRoot 'hand'
$out = Join-Path $PSScriptRoot $(if ($Local) { 'hand-try-it.zip' } else { 'hand-site.zip' })
$stage = Join-Path $env:TEMP ('hand-stage-' + [guid]::NewGuid().ToString('N'))

if (-not (Test-Path $src)) { throw "Source folder not found: $src" }

Write-Host 'Staging...' -ForegroundColor Cyan
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $stage -Recurse -Force

# api/config.php and the rate-limit state must NEVER leave this machine,
# whichever build this is. The rest is only stripped for deployment.
$drops = @('api\config.php', 'api\.state', '.gitignore')
if (-not $Local) { $drops += @('test.html', 'samples', 'start.bat', 'START-HERE.html', 'START-HERE.md') }

foreach ($drop in $drops) {
    $p = Join-Path $stage $drop
    if (Test-Path $p) {
        Remove-Item -Path $p -Recurse -Force
        Write-Host "  excluded $drop" -ForegroundColor DarkGray
    }
}

# A leaked key is the one mistake here that cannot be undone, so fail loudly
# rather than shipping it.
$leak = Get-ChildItem -Path $stage -Recurse -File | Where-Object { $_.Name -eq 'config.php' }
if ($leak) { throw "api/config.php reached the staging folder. Refusing to build." }

$keyish = Get-ChildItem -Path $stage -Recurse -File -Include *.js, *.php, *.html |
    Select-String -Pattern 'AIza[0-9A-Za-z_\-]{20,}|ghp_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}' -List
if ($keyish) {
    $keyish | ForEach-Object { Write-Host "  KEY-LIKE STRING in $($_.Path)" -ForegroundColor Red }
    throw 'Something that looks like an API key is in the build. Refusing to build.'
}

Write-Host 'Zipping...' -ForegroundColor Cyan
if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $out -CompressionLevel Optimal

Remove-Item -Path $stage -Recurse -Force

$size = [math]::Round((Get-Item $out).Length / 1KB)
Write-Host ''
Write-Host "Built $out ($size KB)" -ForegroundColor Green
Write-Host ''

if ($Local) {
    Write-Host 'To try it:' -ForegroundColor Yellow
    Write-Host '  1. unzip anywhere'
    Write-Host '  2. double-click start.bat'
    Write-Host '  3. follow the page that opens'
    Write-Host ''
    Write-Host '  Nothing needs configuring to test it.' -ForegroundColor DarkGray
} else {
    Write-Host 'On the host:' -ForegroundColor Yellow
    Write-Host '  1. upload and extract into the subdomain root'
    Write-Host '  2. cp api/config.example.php api/config.php and add one free key'
    Write-Host '  3. chmod 700 api/.state   (PHP must be able to write there)'
    Write-Host '  4. open api/config.php in a browser: it must NOT display'
}
Write-Host ''
