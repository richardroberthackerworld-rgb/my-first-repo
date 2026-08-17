<?php
/* ============================================================
   ops-deploycheck.php — TEMPORARY. Read-only deployment audit.

   Answers "what is actually on this server, and does it match the
   intended build" without touching the database, the scheduler, the
   queue, or any application behaviour.

   It only ever:
     • checks whether files exist
     • reads them to look for marker strings
     • prints a content fingerprint

   It never connects to MySQL, never loads lib.php/config.php, never
   sends mail, and never writes anything.

   Fingerprints are SHA-256 of the file with line endings normalised to
   LF, so an FTP client that rewrote CRLF does not produce a false
   mismatch.
   ============================================================ */

if (PHP_SAPI !== 'cli') {
    header('X-Robots-Tag: noindex, nofollow');
    http_response_code(404);
    exit("Not found\n");
}

$dir = __DIR__;

/* marker => a string that must be present if that change is deployed */
$expect = [
    'ops.php' => [
        'kind' => 'existing (ops layer)',
        'markers' => [
            'slice 1 — email queue'        => 'CREATE TABLE IF NOT EXISTS email_queue',
            'slice 2 — scheduler_runs'     => 'CREATE TABLE IF NOT EXISTS scheduler_runs',
            'slice 2 — fingerprint fix'    => "preg_replace(\n            ['/\\d+/'",
            'slice 3 — provider_msg_id'    => 'provider_msg_id VARCHAR(191) NULL',
            'slice 3 — ALTER for old rows' => 'ALTER TABLE email_queue ADD COLUMN provider_msg_id',
            'slice 3 — burn option'        => "!empty(\$opt['burn'])",
            'slice 3 — support templates'  => "'support_ticket_created' => [",
            'slice 3 — owner templates'    => "'owner_email_failed' => [",
            'slice 3 — no owner recursion' => "strpos(\$q['template'], 'owner_') !== 0",
        ],
    ],
    'ops-scheduler.php' => [
        'kind' => 'existing (ops layer)',
        'markers' => [
            'slice 2 — ladder'             => 'const SCHED_LADDER',
            'slice 2 — eligibility gate'   => 'function sched_ineligible',
            'slice 2 — exit codes'         => 'SCHED_EXIT_NO_DB',
            'FIX — entry-point detection'  => 'function ops_sched_is_entry_point',
        ],
    ],
    'ops-events.php' => [
        'kind' => 'NEW (slice 3)',
        'markers' => [
            'purchase event'   => 'function ops_on_purchase',
            'purchase hook'    => 'function ops_purchase_hook',
            'signup hook'      => 'function ops_signup_hook',
            'support ticket'   => 'function ops_on_support_ticket',
            'support reply'    => 'function ops_on_support_reply',
            'email failure'    => 'function ops_on_email_failed',
            'payment failure'  => 'function ops_on_payment_failure',
        ],
    ],
    'api.php' => [
        'kind' => 'EXISTING LIVE FILE — patch, do not overwrite blindly',
        'markers' => [
            'guarded require'          => "is_file(__DIR__ . '/ops-events.php')",
            'hook 1 — verify'          => "\$tx['payment_id'] = \$payId;",
            'hook 2 — sevenpay webhook'=> "\$tx['payment_id'] = \$p['id'] ?? '';",
            'hook 3 — razorpay webhook'=> "\$tx['payment_id'] = \$pid;",
            'hook 4 — signup'          => 'ops_signup_hook((int)$_SESSION',
        ],
    ],
    'ops-health.php'   => ['kind' => 'NEW (slice 2)', 'markers' => ['health allow-list' => 'HEALTH_ALLOWED_KEYS']],
    'ops-selftest.php' => ['kind' => 'existing (test)', 'markers' => [
        'slice 3 sections' => '12. SLICE 3 — SCHEMA',
        'pre-flight purge' => 'pre-flight: removed',
    ]],
];

function fp($path) {
    $s = file_get_contents($path);
    if ($s === false) return null;
    return substr(hash('sha256', str_replace("\r\n", "\n", $s)), 0, 16);
}

$missingFiles = []; $stale = [];

echo "DEPLOYMENT AUDIT  —  " . $dir . "\n";
echo str_repeat('=', 74), "\n\n";

foreach ($expect as $file => $spec) {
    $path = $dir . '/' . $file;
    $exists = is_file($path);
    printf("%-22s %-46s %s\n", $file, $spec['kind'], $exists ? 'PRESENT' : '*** MISSING ***');

    if (!$exists) { $missingFiles[] = $file; echo "\n"; continue; }

    printf("  fingerprint: %s   size: %d bytes   modified: %s\n",
        fp($path), filesize($path), date('Y-m-d H:i', filemtime($path)));

    $src = file_get_contents($path);
    foreach ($spec['markers'] as $label => $needle) {
        $ok = strpos($src, $needle) !== false;
        printf("    %-32s %s\n", $label, $ok ? 'yes' : 'NO  <-- not deployed');
        if (!$ok) $stale[] = "$file :: $label";
    }
    echo "\n";
}

/* files that must NOT be on a production server */
echo "TEMPORARY FILES THAT SHOULD BE REMOVED WHEN DONE\n";
echo str_repeat('-', 74), "\n";
foreach (['ops-selftest.php', 'ops-readlog.php', 'ops-forensics.php', 'ops-deploycheck.php'] as $t) {
    printf("  %-24s %s\n", $t, is_file($dir . '/' . $t) ? 'present' : 'absent');
}

echo "\n", str_repeat('=', 74), "\n";
if (!$missingFiles && !$stale) {
    echo "COMPLETE — every expected file and change is deployed.\n";
} else {
    if ($missingFiles) {
        echo "MISSING FILES (" . count($missingFiles) . "):\n";
        foreach ($missingFiles as $f) echo "  - $f\n";
    }
    if ($stale) {
        echo "\nFILES PRESENT BUT OUT OF DATE (" . count($stale) . " change(s) absent):\n";
        foreach ($stale as $s) echo "  - $s\n";
    }
}
echo "\nRead-only. No database, no mail, no writes.\n";
echo "Delete this file when you are done.\n";
