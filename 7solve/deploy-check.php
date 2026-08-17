<?php
/* ============================================================
   7SOLVE — DEPLOY CHECK  (temporary diagnostic, delete after use)
   ------------------------------------------------------------
   Upload ONLY this file, then open:
       https://7solve.7by.in/deploy-check.php

   If you get a 404, the folder you uploaded into is NOT the one
   the live site is served from — that is the whole problem, and
   the path printed below is where the files actually need to go.

   It reads nothing secret: it prints the folder it is sitting in,
   the file names already there with their sizes and dates, and
   the build stamp inside index.html. Delete it when you are done.
   ============================================================ */

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

$here = __DIR__;

echo "7SOLVE DEPLOY CHECK\n";
echo str_repeat('=', 62), "\n\n";

echo "This file is running from:\n";
echo "    ", $here, "\n\n";
echo "The web server's document root for this request:\n";
echo "    ", ($_SERVER['DOCUMENT_ROOT'] ?? 'unknown'), "\n\n";
echo "Reached via:  ", ($_SERVER['HTTP_HOST'] ?? '?'), ($_SERVER['REQUEST_URI'] ?? ''), "\n";
echo "Server time:  ", date('Y-m-d H:i:s T'), "\n\n";

echo str_repeat('-', 62), "\n";
echo "IS THE NEW BUILD HERE?\n";
echo str_repeat('-', 62), "\n\n";

$idx = @file_get_contents($here . '/index.html');
if ($idx === false) {
    echo "  index.html  ->  NOT IN THIS FOLDER.\n";
    echo "  So this is not the folder the site is served from.\n";
} else {
    $bytes = strlen($idx);
    if (preg_match('/7solve-build" content="([^"]*)"/', $idx, $m)) {
        echo "  Build stamp : ", $m[1], "\n";
        echo "  Size        : ", number_format($bytes), " bytes\n";
        echo "  Modified    : ", date('Y-m-d H:i:s', filemtime($here . '/index.html')), "\n\n";
        echo "  >> NEW BUILD IS LIVE. You can delete this file.\n";
    } else {
        echo "  Build stamp : NONE — this is the OLD build.\n";
        echo "  Size        : ", number_format($bytes), " bytes  (the new one is ~523,000)\n";
        echo "  Modified    : ", date('Y-m-d H:i:s', filemtime($here . '/index.html')), "\n\n";
        echo "  >> The old index.html is still here. Extract the zip INTO\n";
        echo "     this exact folder and choose 'overwrite existing files':\n";
        echo "     ", $here, "\n";
    }
}

/* assets/logo.svg only exists in the new build — a quick second opinion */
echo "\n  assets/logo.svg (new build only): ",
     (is_file($here . '/assets/logo.svg') ? "present" : "missing"), "\n";

echo "\n", str_repeat('-', 62), "\n";
echo "WHAT IS ACTUALLY IN THIS FOLDER\n";
echo str_repeat('-', 62), "\n\n";

$items = @scandir($here);
if (!$items) {
    echo "  (could not read the folder)\n";
} else {
    foreach ($items as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = $here . '/' . $f;
        printf("  %-30s %12s   %s\n",
            $f,
            is_dir($p) ? '<folder>' : number_format(@filesize($p)),
            date('Y-m-d H:i', @filemtime($p)));
    }
}

echo "\n", str_repeat('=', 62), "\n";
echo "Delete deploy-check.php once the build stamp above reads 2026-08-12.1\n";
