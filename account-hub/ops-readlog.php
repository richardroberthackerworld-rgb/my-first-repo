<?php
/* ============================================================
   ops-readlog.php — TEMPORARY read-only diagnostic. DELETE AFTER USE.

   Step 1 inspects the schema via INFORMATION_SCHEMA, step 2 selects from
   email_log using the columns that actually exist.

   The first version of this script hard-coded `sent_at`, which lives on
   email_queue, not email_log — email_log records when the attempt was
   logged, in `created_at`. That produced SQLSTATE 42S22. Rather than
   swapping one guessed name for another, the query is now built from the
   real column list, so a schema difference reports itself instead of
   failing.

   Why it does NOT use lib.php / db():
     db() runs CREATE TABLE IF NOT EXISTS and ALTER TABLE on connect.
     That is DDL — a write. This script must not write anything, so it
     loads config.php (a pure array return, no side effects) and opens
     its own connection instead.

   Guarantees:
     • CLI only — refuses to run under any web SAPI
     • SELECT statements only, against INFORMATION_SCHEMA and email_log
     • never prints the database user, password, host or name
     • email addresses masked before display
     • does not touch ops.php, ops-events.php or ops-scheduler.php, so no
       migration, no queue flush, no scheduler tick, no mail
   ============================================================ */

if (PHP_SAPI !== 'cli') {
    header('X-Robots-Tag: noindex, nofollow');
    http_response_code(404);
    exit("Not found\n");
}

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) { fwrite(STDERR, "config.php not found next to this script\n"); exit(2); }

$CFG = require $cfgFile;
$d   = $CFG['db'] ?? null;
if (!is_array($d)) { fwrite(STDERR, "no 'db' section in config.php\n"); exit(2); }

try {
    $pdo = new PDO(
        "mysql:host={$d['host']};dbname={$d['name']};charset=utf8mb4",
        $d['user'], $d['pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
         PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (Throwable $e) {
    // Never echo $e->getMessage() — a PDO connect error quotes the DSN,
    // which carries the database name and user.
    fwrite(STDERR, "Could not connect using the credentials in config.php.\n");
    fwrite(STDERR, "SQLSTATE: " . $e->getCode() . "\n");
    exit(3);
}

/** a@b.com -> a•••@b•••.com — enough to recognise, not enough to harvest */
function mask_email($e) {
    $e = (string)$e;
    $at = strpos($e, '@');
    if ($at === false) return substr($e, 0, 2) . str_repeat('•', 6);
    $user = substr($e, 0, $at);
    $host = substr($e, $at + 1);
    $dot  = strrpos($host, '.');
    $tld  = $dot !== false ? substr($host, $dot) : '';
    $hostName = $dot !== false ? substr($host, 0, $dot) : $host;
    return substr($user, 0, 1) . str_repeat('•', max(2, min(6, strlen($user) - 1)))
         . '@' . substr($hostName, 0, 1) . str_repeat('•', max(2, min(6, strlen($hostName) - 1)))
         . $tld;
}

/* ---------- STEP 1: metadata, read-only ----------
   DATABASE() is used instead of naming the schema, so the database name
   is never written into this file nor printed. */
echo "STEP 1 — SCHEMA INSPECTION\n";
echo str_repeat('=', 74), "\n";

$tables = $pdo->query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('email_log','email_queue')
      ORDER BY TABLE_NAME")->fetchAll(PDO::FETCH_COLUMN);

echo "email_log exists  : "   . (in_array('email_log', $tables, true)   ? 'yes' : 'NO') . "\n";
echo "email_queue exists: "   . (in_array('email_queue', $tables, true) ? 'yes' : 'NO') . "\n\n";

if (!in_array('email_log', $tables, true)) {
    echo "email_log is not present. Nothing was ever recorded as sent or failed.\n";
    echo "\nDelete this file when you are done.\n";
    exit(0);
}

$cols = $pdo->query(
    "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_log'
      ORDER BY ORDINAL_POSITION")->fetchAll();

echo "email_log columns:\n";
foreach ($cols as $c) printf("  %-20s %s\n", $c['COLUMN_NAME'], $c['DATA_TYPE']);

$have = array_column($cols, 'COLUMN_NAME');
$check = ['to_email', 'template', 'sent_at'];
echo "\nthe three columns originally queried:\n";
foreach ($check as $c) {
    printf("  %-12s %s\n", $c, in_array($c, $have, true) ? 'present' : 'MISSING  <-- cause of 42S22');
}

/* ---------- STEP 2: the corrected SELECT ---------- */
echo "\n\nSTEP 2 — LAST 20 EMAIL_LOG ROWS (addresses masked)\n";
echo str_repeat('=', 74), "\n";

// pick whichever timestamp this table actually carries
$tsCol = in_array('sent_at', $have, true) ? 'sent_at'
       : (in_array('created_at', $have, true) ? 'created_at' : null);

$want = array_values(array_filter(
    ['to_email', 'template', 'status', $tsCol],
    fn($c) => $c !== null && in_array($c, $have, true)));

if (!$want) { echo "none of the expected columns exist — schema is unrecognised\n"; exit(4); }

$orderBy = in_array('id', $have, true) ? 'id' : $want[count($want) - 1];
$sql = 'SELECT ' . implode(', ', $want) . ' FROM email_log ORDER BY ' . $orderBy . ' DESC LIMIT 20';
echo "query: $sql\n\n";

$rows = $pdo->query($sql)->fetchAll();

if (!$rows) {
    echo "(no rows — nothing has been recorded as sent or failed)\n";
} else {
    printf("%-30s  %-24s  %-7s  %s\n", 'RECIPIENT', 'TEMPLATE', 'STATUS', 'WHEN');
    echo str_repeat('-', 74), "\n";
    foreach ($rows as $r) {
        printf("%-30s  %-24s  %-7s  %s\n",
            mask_email($r['to_email'] ?? ''),
            substr((string)($r['template'] ?? ''), 0, 24),
            substr((string)($r['status'] ?? '-'), 0, 7),
            (string)($r[$tsCol] ?? ''));
    }
}

/* Did a real person receive anything? .invalid addresses are the
   self-test's own; anything else is a live recipient. */
echo "\nby template (last 20):\n";
$tally = []; $real = 0;
foreach ($rows as $r) {
    $t = ($r['template'] ?? '') ?: '(none)';
    $tally[$t] = ($tally[$t] ?? 0) + 1;
    if (!str_ends_with(strtolower((string)($r['to_email'] ?? '')), '.invalid')) $real++;
}
arsort($tally);
foreach ($tally as $t => $n) printf("  %-30s %d\n", $t, $n);

echo "\nrows shown        : " . count($rows) . "\n";
echo "to real addresses : $real   (the rest are .invalid self-test rows)\n";
echo "\nDelete this file when you are done.\n";
