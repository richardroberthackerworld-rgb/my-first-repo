<?php
/* ============================================================
   ops-patch-api.php — TEMPORARY. Controlled patch for api.php.
                       DELETE AFTER USE.

   Applies the five Slice 3 hook sites to api.php in place, rather than
   replacing a live application file. Nothing else in api.php is touched:
   authentication, signature verification, ownership checks, the
   already-paid guard and grant_from_tx() are all left exactly as they
   are, and every hook is inserted AFTER them.

   Safety properties:
     • backs up api.php with a timestamp before writing
     • idempotent — a hunk already present is skipped, so running twice
       cannot double-insert
     • FAIL CLOSED — if any anchor is missing or ambiguous, nothing is
       written at all, and it tells you which
     • syntax-checks the result and AUTOMATICALLY ROLLS BACK if the file
       would not parse
     • never connects to the database, never sends mail, never touches
       config.php or any business table

   Run:    php ops-patch-api.php            (dry run — shows the plan)
           php ops-patch-api.php --apply    (writes, after backing up)
   ============================================================ */

if (PHP_SAPI !== 'cli') {
    header('X-Robots-Tag: noindex, nofollow');
    http_response_code(404);
    exit("Not found\n");
}

$apply = in_array('--apply', $argv ?? [], true);
$file  = __DIR__ . '/api.php';
if (!is_file($file)) { fwrite(STDERR, "api.php not found next to this script\n"); exit(2); }

$src = file_get_contents($file);
$nl  = strpos($src, "\r\n") !== false ? "\r\n" : "\n";   // match the file's own line endings

/* Each hunk: a marker proving it is already applied, an anchor that must
   appear EXACTLY once, and the replacement for that anchor. */
$T = "\t";   // api.php is tab-indented
$hunks = [

['name'   => '1. guarded require of ops-events.php',
 'marker' => "is_file(__DIR__ . '/ops-events.php')",
 'anchor' => "require __DIR__ . '/lib.php';",
 'become' => "require __DIR__ . '/lib.php';\n"
           . "// Operational layer: incidents, email queue, lifecycle emails. Guarded so a\n"
           . "// part-finished deploy leaves the hub working rather than fataling.\n"
           . "if (is_file(__DIR__ . '/ops-events.php')) { require_once __DIR__ . '/ops-events.php'; }"],

['name'   => '2. signup hook (after OTP verification)',
 'marker' => 'ops_signup_hook((int)$_SESSION',
 'anchor' => "\t\tclear_otp(\$email, 'signup');\n\t\t\$_SESSION['uid'] = db()->lastInsertId();",
 'become' => "\t\tclear_otp(\$email, 'signup');\n\t\t\$_SESSION['uid'] = db()->lastInsertId();\n"
           . "\t\t// Owner notification only. The member just completed an OTP round-trip,\n"
           . "\t\t// so they know the account exists; a \"welcome\" with nothing actionable\n"
           . "\t\t// in it would be marketing dressed as a transactional email.\n"
           . "\t\tif (function_exists('ops_signup_hook')) {\n"
           . "\t\t\tops_signup_hook((int)\$_SESSION['uid'], \$email, \$data['name']);\n"
           . "\t\t}"],

['name'   => '3. purchase hook in verify (after grant_from_tx)',
 'marker' => "\$tx['payment_id'] = \$payId;",
 'anchor' => "\t\t// Grant exactly what this order promised — a tool unlock or a credit plan.\n\t\tgrant_from_tx(\$tx);",
 'become' => "\t\t// Grant exactly what this order promised — a tool unlock or a credit plan.\n"
           . "\t\tgrant_from_tx(\$tx);\n"
           . "\t\t// Receipt + owner copy. Only reachable past the signature check and the\n"
           . "\t\t// already-paid guard above, so it cannot fire on an unverified claim or\n"
           . "\t\t// on a replay. \$tx still holds the pre-update row, so pass the payment\n"
           . "\t\t// id that was just confirmed.\n"
           . "\t\tif (function_exists('ops_purchase_hook')) {\n"
           . "\t\t\t\$tx['payment_id'] = \$payId;\n"
           . "\t\t\t\$tx['status'] = 'paid';\n"
           . "\t\t\tops_purchase_hook(\$tx);\n"
           . "\t\t}"],

['name'   => '4. purchase hook in the 7Pay webhook',
 'marker' => "\$tx['payment_id'] = \$p['id'] ?? '';",
 'anchor' => "\t\t\t\t\tdb()->prepare('UPDATE transactions SET status = \"paid\", payment_id = ? WHERE id = ?')\n"
           . "\t\t\t\t\t\t->execute(array(\$p['id'] ?? '', \$tx['id']));\n"
           . "\t\t\t\t\tgrant_from_tx(\$tx);",
 'become' => "\t\t\t\t\tdb()->prepare('UPDATE transactions SET status = \"paid\", payment_id = ? WHERE id = ?')\n"
           . "\t\t\t\t\t\t->execute(array(\$p['id'] ?? '', \$tx['id']));\n"
           . "\t\t\t\t\tgrant_from_tx(\$tx);\n"
           . "\t\t\t\t\t// Webhooks are retried by the provider, so this WILL run more\n"
           . "\t\t\t\t\t// than once for the same payment. The dedupe key is the\n"
           . "\t\t\t\t\t// payment id, so only the first delivery queues an email.\n"
           . "\t\t\t\t\tif (function_exists('ops_purchase_hook')) {\n"
           . "\t\t\t\t\t\t\$tx['payment_id'] = \$p['id'] ?? '';\n"
           . "\t\t\t\t\t\tops_purchase_hook(\$tx);\n"
           . "\t\t\t\t\t}"],

['name'   => '5. purchase hook in the Razorpay webhook',
 'marker' => "\$tx['payment_id'] = \$pid;",
 'anchor' => "\t\t\t\tdb()->prepare('UPDATE transactions SET status = \"paid\", payment_id = ? WHERE id = ?')\n"
           . "\t\t\t\t\t->execute(array(\$evt['payload']['payment']['entity']['id'] ?? '', \$tx['id']));\n"
           . "\t\t\t\tgrant_from_tx(\$tx);",
 'become' => "\t\t\t\t\$pid = \$evt['payload']['payment']['entity']['id'] ?? '';\n"
           . "\t\t\t\tdb()->prepare('UPDATE transactions SET status = \"paid\", payment_id = ? WHERE id = ?')\n"
           . "\t\t\t\t\t->execute(array(\$pid, \$tx['id']));\n"
           . "\t\t\t\tgrant_from_tx(\$tx);\n"
           . "\t\t\t\t// Same as above: Razorpay retries webhooks, the payment id\n"
           . "\t\t\t\t// dedupes, so a replay cannot send a second receipt.\n"
           . "\t\t\t\tif (function_exists('ops_purchase_hook')) {\n"
           . "\t\t\t\t\t\$tx['payment_id'] = \$pid;\n"
           . "\t\t\t\t\tops_purchase_hook(\$tx);\n"
           . "\t\t\t\t}"],
];

/* normalise to \n for matching, convert back on write */
$work = str_replace("\r\n", "\n", $src);

echo "api.php patch — " . ($apply ? "APPLY" : "DRY RUN (add --apply to write)") . "\n";
echo str_repeat('=', 70), "\n";
printf("file: %d bytes, line endings: %s\n\n", strlen($src), $nl === "\r\n" ? 'CRLF' : 'LF');

$todo = 0; $done = 0; $blocked = [];
foreach ($hunks as $h) {
    if (strpos($work, $h['marker']) !== false) {
        printf("  [already] %s\n", $h['name']); $done++; continue;
    }
    $n = substr_count($work, $h['anchor']);
    if ($n === 1) { printf("  [ready  ] %s\n", $h['name']); $todo++; }
    else {
        printf("  [BLOCKED] %s — anchor found %d times, expected 1\n", $h['name'], $n);
        $blocked[] = $h['name'];
    }
}

echo "\n";
if ($blocked) {
    echo "ABORTED — " . count($blocked) . " anchor(s) did not match this file exactly.\n";
    echo "Nothing was written. Your api.php differs from the expected baseline;\n";
    echo "send me the mismatching section rather than forcing it.\n";
    exit(3);
}
if (!$todo) { echo "Nothing to do — all five hooks are already present.\n"; exit(0); }
if (!$apply) { echo "Dry run only. Re-run with --apply to write.\n"; exit(0); }

/* ---- backup, patch, verify, roll back on failure ---- */
$backup = $file . '.bak-' . date('Ymd-His');
if (!copy($file, $backup)) { fwrite(STDERR, "could not create backup — aborting\n"); exit(4); }
echo "backup: " . basename($backup) . "\n";

foreach ($hunks as $h) {
    if (strpos($work, $h['marker']) !== false) continue;
    $work = str_replace($h['anchor'], $h['become'], $work);
}
$out = $nl === "\r\n" ? str_replace("\n", "\r\n", $work) : $work;

$tmp = $file . '.tmp-patch';
file_put_contents($tmp, $out);

/* syntax gate — never leave a live endpoint unparseable */
$lintOut = []; $lintCode = 1;
@exec(PHP_BINARY . ' -l ' . escapeshellarg($tmp) . ' 2>&1', $lintOut, $lintCode);
if ($lintCode !== 0) {
    @unlink($tmp);
    echo "\nSYNTAX CHECK FAILED — nothing was changed:\n  " . implode("\n  ", $lintOut) . "\n";
    echo "api.php is untouched. Backup left at " . basename($backup) . "\n";
    exit(5);
}

if (!rename($tmp, $file)) {
    @unlink($tmp);
    fwrite(STDERR, "could not replace api.php — original intact\n"); exit(6);
}

echo "patched $todo hunk(s), syntax OK\n";
echo "\nrollback if needed:\n  cp " . basename($backup) . " api.php\n";
echo "\nNow run: php ops-deploycheck.php\n";
echo "Delete this file when you are done.\n";
