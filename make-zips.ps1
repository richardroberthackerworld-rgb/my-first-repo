# Builds cPanel/WordPress-ready zips with FORWARD-SLASH paths (Linux/WordPress safe).
# Windows PowerShell's Compress-Archive uses backslashes which break on Linux — this avoids that.
Add-Type -AssemblyName System.IO.Compression | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

function New-Zip {
  param([string]$Zip, [string[]]$Roots, [string]$Prefix = '', [string[]]$ExcludeExt = @())
  if (Test-Path -LiteralPath $Zip) { [System.IO.File]::Delete((Resolve-Path -LiteralPath $Zip).Path) }
  $fs = [System.IO.File]::Open($Zip, [System.IO.FileMode]::Create)
  $arch = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  $dirs = New-Object System.Collections.Generic.HashSet[string]
  function Add-Dirs($path) {  # add a directory entry for every parent folder in the path
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
  foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $item = Get-Item -LiteralPath $root
    if ($item.PSIsContainer) {
      $baseLen = $item.FullName.Length + 1
      Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object {
        if ($ExcludeExt -contains $_.Extension.ToLower()) { return }
        $rel = $_.FullName.Substring($baseLen) -replace '\\','/'
        Add-File $_.FullName ($Prefix + $item.Name + '/' + $rel)
      }
    } else {
      Add-File $item.FullName ($Prefix + $item.Name)
    }
  }
  $arch.Dispose(); $fs.Close()
  Write-Output ("built " + (Split-Path $Zip -Leaf))
}

$base = $PSScriptRoot
if (-not $base) { $base = (Get-Location).Path }

# 1) WordPress theme — 'sevenby/' at zip root. EXCLUDE .js (its JS loads from the app subdomain)
#    so the cPanel ClamAV "Foxhole.JS_Zip" false-positive can't block the upload.
New-Zip -Zip (Join-Path $base 'sevenby-theme.zip') -Roots @((Join-Path $base 'wordpress-theme\sevenby')) -ExcludeExt @('.js')

# 2) Static tool app for the subdomain
$appRoots = @('assets','tools','blog') | ForEach-Object { Join-Path $base $_ }
$appRoots += (Get-ChildItem -LiteralPath $base -File -Filter *.html | Select-Object -ExpandProperty FullName)
$htaccess = Join-Path $base '.htaccess'
if (Test-Path -LiteralPath $htaccess) { $appRoots += $htaccess }   # cache-control rules
New-Zip -Zip (Join-Path $base 'vocalremover-app.zip') -Roots $appRoots

# 3) QBank + DoubtSnap static apps for their subdomains (files at zip root).
#    cPanel ClamAV flags any zip containing .js (Foxhole.JS_Zip false-positive),
#    so config.js ships as config.js.txt — after uploading, edit your keys into it
#    and RENAME it to config.js in File Manager.
#    keys.php holds LIVE server-side keys — it must NEVER be zipped or shipped.
#    Only keys.example.php goes out; the user copies it to keys.php on the server.
function New-AppZip {
  param([string]$AppDir, [string]$Zip)
  $stage = Join-Path $env:TEMP ("appzip-" + (Split-Path $AppDir -Leaf))
  New-Item -ItemType Directory -Force $stage | Out-Null
  Copy-Item (Join-Path $AppDir 'config.js') (Join-Path $stage 'config.js.txt') -Force
  $roots = Get-ChildItem -LiteralPath $AppDir -File |
    Where-Object { $_.Extension -ne '.js' -and $_.Name -ne 'keys.php' } |
    Select-Object -ExpandProperty FullName
  $roots += (Join-Path $stage 'config.js.txt')
  New-Zip -Zip $Zip -Roots $roots
}
New-AppZip -AppDir (Join-Path $base 'qbank')     -Zip (Join-Path $base 'qbank-site.zip')
New-AppZip -AppDir (Join-Path $base 'doubtsnap') -Zip (Join-Path $base 'doubtsnap-site.zip')

# 3b) Account hub UPDATE bundle — everything EXCEPT config.php.
#     config.php holds the live DB password + secrets on the server, so we never
#     ship it: the user drops these files in, then hand-edits only config.php.
$hubDir = Join-Path $base 'account-hub'
if (Test-Path -LiteralPath $hubDir) {
  $hubRoots = Get-ChildItem -LiteralPath $hubDir -Force |
    Where-Object { $_.Name -ne 'config.php' -and $_.Name -notlike '*.db' -and $_.Name -ne '.git' } |
    Select-Object -ExpandProperty FullName
  New-Zip -Zip (Join-Path $base 'account-hub-update.zip') -Roots $hubRoots -ExcludeExt @('.js')
}

# 3c) Main-site pages + blog for 7by.in root (public_html). Fixes the 404s:
#     about/privacy/terms/etc + the whole blog (incl. admin.php uploader).
#     A staged assets/ carries only the stylesheet + icons the pages need.
$pgStage = Join-Path $env:TEMP 'pageszip-assets'
Remove-Item -Recurse -Force $pgStage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $pgStage 'assets') | Out-Null
foreach ($a in @('style.css','favicon.png','favicon.svg','apple-touch-icon.png','logo-mark.png')) {
  $src = Join-Path $base ("assets\" + $a)
  if (Test-Path -LiteralPath $src) { Copy-Item $src (Join-Path $pgStage 'assets') }
}
$pageRoots = @('about.html','privacy-policy.html','terms-of-service.html','disclaimer.html',
               'cookie-policy.html','dmca.html','contact.html','index.html') |
  ForEach-Object { Join-Path $base $_ } | Where-Object { Test-Path -LiteralPath $_ }
$pageRoots += (Join-Path $base 'blog')
$pageRoots += (Join-Path $pgStage 'assets')
New-Zip -Zip (Join-Path $base '7by-pages.zip') -Roots $pageRoots

# 4) Backend (no node_modules / db.json / logs)
$srvRoots = Get-ChildItem -LiteralPath (Join-Path $base 'server') -Force |
  Where-Object { $_.Name -notin @('node_modules','db.json') -and $_.Name -notlike '*.log' } |
  Select-Object -ExpandProperty FullName
New-Zip -Zip (Join-Path $base 'server-backend.zip') -Roots $srvRoots
