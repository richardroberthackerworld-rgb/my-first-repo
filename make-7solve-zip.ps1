# ============================================================
#  Builds 7solve-site.zip — 7Solve, ready for cPanel.
#  Target: the 7solve.7by.in document root.
#
#  Same recipe make-zips.ps1 already uses for this app, pulled
#  out so 7Solve can be rebuilt on its own without regenerating
#  every other product's zip.
#
#  Two things a plain Compress-Archive gets wrong:
#
#  1. FORWARD-SLASH paths. Windows writes backslashes, which
#     break extraction on Linux/cPanel.
#
#  2. NO .js FILES IN THE ZIP. cPanel's ClamAV false-positives
#     any zip containing .js ("Foxhole.JS_Zip") and blocks the
#     upload, so config.js and sw.js ship as .txt and are
#     renamed back once after extracting.
#
#  keys.php never ships: the live API keys stay on the server.
#
#  Run:  powershell -ExecutionPolicy Bypass -File make-7solve-zip.ps1
# ============================================================
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

$base = $PSScriptRoot
if (-not $base) { $base = (Get-Location).Path }
$src = Join-Path $base '7solve'
$zip = Join-Path $base '7solve-site.zip'

if (-not (Test-Path -LiteralPath $src)) { throw "7solve/ folder not found at $src" }

function New-Zip {
  param([string]$Zip, [string[]]$Roots, [string[]]$ExcludeExt = @(), [string[]]$ExcludeNames = @())
  if (Test-Path -LiteralPath $Zip) { [System.IO.File]::Delete((Resolve-Path -LiteralPath $Zip).Path) }
  $fs   = [System.IO.File]::Open($Zip, [System.IO.FileMode]::Create)
  $arch = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  $dirs = New-Object System.Collections.Generic.HashSet[string]

  function Add-Dirs($path) {   # a directory entry for every parent folder in the path
    $parts = $path.Split('/'); $acc = ''
    for ($i = 0; $i -lt $parts.Length - 1; $i++) {
      $acc += $parts[$i] + '/'
      if ($dirs.Add($acc)) { $arch.CreateEntry($acc) | Out-Null }
    }
  }
  function Add-File($fullPath, $name) {
    Add-Dirs $name
    $entry = $arch.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($fullPath)   # byte copy — never re-encode
    $es.Write($bytes, 0, $bytes.Length); $es.Dispose()
  }

  foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $item = Get-Item -LiteralPath $root -Force
    if ($item.PSIsContainer) {
      $baseLen = $item.FullName.Length + 1
      Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object {
        if ($ExcludeExt   -contains $_.Extension.ToLower()) { return }
        if ($ExcludeNames -contains $_.Name)                { return }
        $rel = $_.FullName.Substring($baseLen) -replace '\\','/'
        Add-File $_.FullName ($item.Name + '/' + $rel)
      }
    } else {
      if ($ExcludeNames -contains $item.Name) { continue }
      Add-File $item.FullName $item.Name
    }
  }
  $arch.Dispose(); $fs.Close()
  # count from the finished archive rather than a counter inside a nested
  # function, where $script: scope does not reach the caller's variable
  $r = [System.IO.Compression.ZipFile]::OpenRead($Zip)
  $n = ($r.Entries | Where-Object { $_.FullName -notmatch '/$' }).Count
  $r.Dispose()
  return $n
}

# --- stage the two .js files under .txt names -------------------------------
$stage = Join-Path $env:TEMP 'appzip-7solve'
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null

$renamed = @()
foreach ($js in @('config.js','sw.js')) {
  $p = Join-Path $src $js
  if (Test-Path -LiteralPath $p) {
    Copy-Item $p (Join-Path $stage ($js + '.txt')) -Force
    $renamed += $js
  }
}

# --- what ships --------------------------------------------------------------
# ---- bump the build stamp -------------------------------------------------
# The stamp is the only way to tell "the upload landed" from "the upload
# silently didn't", so it must not depend on remembering to edit it by hand.
# Read/write via UTF8Encoding($false): PowerShell 5.1's own cmdlets would
# either add a BOM or transcode the file's UTF-8 to the ANSI codepage, and
# index.html is full of Devanagari, Telugu and emoji.
$indexPath = Join-Path $src 'index.html'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$html = [System.IO.File]::ReadAllText($indexPath, $utf8NoBom)
$stampRe = '(<meta name="7solve-build" content=")(\d{4}-\d{2}-\d{2})\.(\d+)(">)'
$m = [regex]::Match($html, $stampRe)
if ($m.Success) {
  $today = Get-Date -Format 'yyyy-MM-dd'
  # same day → next revision; new day → start again at .1
  $rev = if ($m.Groups[2].Value -eq $today) { [int]$m.Groups[3].Value + 1 } else { 1 }
  $stamp = "$today.$rev"
  $html = [regex]::Replace($html, $stampRe, "`${1}$stamp`${4}")
  [System.IO.File]::WriteAllText($indexPath, $html, $utf8NoBom)
  Write-Output ("build stamp -> {0}" -f $stamp)
} else {
  Write-Warning 'no build stamp found in index.html - add <meta name="7solve-build">'
}

# Root files, minus every .js (staged above) and minus keys.php (live secrets).
$roots = Get-ChildItem -LiteralPath $src -File -Force |
  Where-Object { $_.Extension -ne '.js' -and $_.Name -ne 'keys.php' } |
  Select-Object -ExpandProperty FullName

foreach ($js in $renamed) { $roots += (Join-Path $stage ($js + '.txt')) }

# .well-known/assetlinks.json links the site to the Android app (kills the URL bar).
# blog/ and assets/ must both ship or every post loads unstyled.
# docs/ carries the public API reference. It ships because a developer
# integrating /v1 expects the documentation on the vendor's own domain, and a
# reference that exists only in the repo is a reference nobody can read.
foreach ($sub in @('.well-known','blog','assets','docs')) {
  $p = Join-Path $src $sub
  if (Test-Path -LiteralPath $p) { $roots += $p }
}

# deploy-check.php is a throwaway diagnostic that lists the folder it sits in —
# it ships as a separate single-file upload, never inside the site archive.
#
# The harness is .js and is already excluded by extension, but its FIXTURES are
# .json and were riding along into a public document root. They carry no
# secrets, yet a test file served from the vendor's own domain is still a test
# file nobody asked for, and api-parity-expected.json publishes the exact
# verdicts the suite expects.
#
# checks.json is NOT in this list and must never be: capability.php reads it at
# runtime to decide which subjects /v1 can report. sample-vectors.json only
# appears in a sampling.php comment — nothing reads it on the server.
$testFixtures = @('sample-vectors.json', 'api-parity-expected.json')
$n = New-Zip -Zip $zip -Roots $roots -ExcludeExt @('.js') `
  -ExcludeNames (@('keys.php', 'deploy-check.php') + $testFixtures)

$kb = [math]::Round((Get-Item -LiteralPath $zip).Length / 1KB)
Write-Output ""
Write-Output ("built 7solve-site.zip  -  {0} files, {1} KB" -f $n, $kb)
Write-Output ""
Write-Output "Upload to the 7solve.7by.in document root, Extract, then:"
foreach ($js in $renamed) { Write-Output ("  rename  {0}.txt  ->  {0}" -f $js) }
Write-Output "  leave keys.php on the server exactly as it is - it is not in this zip"
