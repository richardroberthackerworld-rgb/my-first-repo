<?php
/* ============================================================
   ops-readlog.php — TEMPORARY read-only diagnostic. DELETE AFTER USE.

   Shows the last 20 rows of email_log so you can see exactly what the
   self-test bug caused to be sent, with every address masked.

   Why it does NOT use lib.php / db():
     db() runs CREATE TABLE IF NOT EXISTS and ALTER TABLE on connect.
     That is DDL — a write. This script must not write anything, so it
     loads config.php (a pure array return, no side effects) and opens
     its own connection instead.

   Guarantees:
     • CLI only — refuses to run under any web SAPI
     • one SELECT, nothing else; the statement is a literal below
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

echo "email_log — last 20 rows (addresses masked)\n";
echo str_repeat('=', 74), "\n";

try {
    $rows = $pdo->query(
        'SELECT to_email, template, sent_at FROM email_log ORDER BY id DESC LIMIT 20'
    )->fetchAll();
} catch (Throwable $e) {
    fwrite(STDERR, "Query failed. Does email_log exist yet? SQLSTATE: " . $e->getCode() . "\n");
    exit(4);
}

if (!$rows) {
    echo "(no rows — nothing has been recorded as sent or failed)\n";
} else {
    printf("%-30s  %-26s  %s\n", 'RECIPIENT', 'TEMPLATE', 'SENT AT');
    echo str_repeat('-', 74), "\n";
    foreach ($rows as $r) {
        printf("%-30s  %-26s  %s\n",
            mask_email($r['to_email']),
            substr((string)$r['template'], 0, 26),
            (string)$r['sent_at']);
    }
}

/* A count of the templates that actually reached a customer, so the
   question "did a real person get mail" is answered directly. */
echo "\nby template (last 20):\n";
$tally = [];
foreach ($rows as $r) { $t = $r['template'] ?: '(none)'; $tally[$t] = ($tally[$t] ?? 0) + 1; }
arsort($tally);
foreach ($tally as $t => $n) printf("  %-30s %d\n", $t, $n);

echo "\nrows shown: " . count($rows) . "\n";
echo "\nDelete this file when you are done.\n";
