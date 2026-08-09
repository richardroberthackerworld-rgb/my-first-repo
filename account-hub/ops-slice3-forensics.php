<?php
/* ============================================================
   ops-slice3-forensics.php — TEMPORARY, STRICTLY READ-ONLY.

   Confirms from the database whether the Slice 3 owner rows the
   self-test reported as "0" actually exist in email_queue.

   SELECT only. No lib.php, no db() (db() runs CREATE TABLE/ALTER on
   connect), no mail, no scheduler, no writes of any kind.
   ============================================================ */

if (PHP_SAPI !== 'cli') {
    header('X-Robots-Tag: noindex, nofollow');
    http_response_code(404);
    exit("Not found\n");
}

$CFG = require __DIR__ . '/config.php';
$d = $CFG['db'] ?? null;
if (!is_array($d)) { fwrite(STDERR, "no db config\n"); exit(2); }
try {
    $pdo = new PDO("mysql:host={$d['host']};dbname={$d['name']};charset=utf8mb4",
        $d['user'], $d['pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (Throwable $e) { fwrite(STDERR, "connect failed SQLSTATE " . $e->getCode() . "\n"); exit(3); }

function mask($e) {
    $e = (string)$e; $at = strpos($e, '@');
    if ($at === false) return substr($e, 0, 2) . '••••';
    $u = substr($e, 0, $at); $h = substr($e, $at + 1);
    $dot = strrpos($h, '.'); $tld = $dot !== false ? substr($h, $dot) : '';
    $hn  = $dot !== false ? substr($h, 0, $dot) : $h;
    return substr($u, 0, 1) . str_repeat('•', 4) . '@' . substr($hn, 0, 1) . str_repeat('•', 4) . $tld;
}
function rule($t) { echo "\n$t\n", str_repeat('=', 76), "\n"; }

/* ---- 1. do the owner rows exist at all? ---- */
rule('1. OWNER ROWS IN email_queue (the ones the self-test counted as 0)');

$rows = $pdo->query(
   "SELECT id, template, to_email, user_id, dedupe_key, status, created_at
      FROM email_queue
     WHERE template LIKE 'owner_%'
     ORDER BY id DESC LIMIT 30")->fetchAll();

if (!$rows) {
    echo "  NONE FOUND — owner rows were genuinely never queued.\n";
} else {
    printf("  %-5s %-24s %-18s %-8s %-9s %s\n", 'ID', 'TEMPLATE', 'RECIPIENT', 'USER_ID', 'STATUS', 'DEDUPE KEY');
    echo '  ', str_repeat('-', 74), "\n";
    foreach ($rows as $r) {
        printf("  %-5s %-24s %-18s %-8s %-9s %s\n",
            $r['id'], $r['template'], mask($r['to_email']),
            $r['user_id'] === null ? 'NULL' : $r['user_id'],
            $r['status'], substr((string)$r['dedupe_key'], 0, 34));
    }
    echo "\n  If USER_ID is NULL and RECIPIENT is not the .invalid test address,\n";
    echo "  the self-test's counter cannot match these rows. That is the whole\n";
    echo "  of failures 1, 2, 4 and 5.\n";
}

/* ---- 2. reproduce the counter the self-test uses ---- */
rule('2. THE SELF-TEST COUNTER, REPRODUCED');

$FAKEU = -999;
$st = $pdo->prepare("SELECT to_email FROM email_queue WHERE to_email LIKE '%@selftest.invalid'
                     ORDER BY id DESC LIMIT 1");
$st->execute();
$testEmail = $st->fetchColumn();
echo "  test recipient in use: " . ($testEmail ? mask($testEmail) : '(none found)') . "\n\n";

foreach (['purchase_success','owner_purchase','renewal_success','owner_renewal',
          'payment_failed','owner_payment_failed','support_ticket_created','owner_support_ticket'] as $tpl) {
    // the counter the test uses
    $s1 = $pdo->prepare('SELECT COUNT(*) FROM email_queue WHERE template = ? AND (user_id = ? OR to_email = ?)');
    $s1->execute([$tpl, $FAKEU, $testEmail]);
    $seen = (int)$s1->fetchColumn();
    // what actually exists
    $s2 = $pdo->prepare('SELECT COUNT(*) FROM email_queue WHERE template = ?');
    $s2->execute([$tpl]);
    $real = (int)$s2->fetchColumn();
    printf("  %-24s counter sees %d   actually present %d %s\n",
        $tpl, $seen, $real, ($seen !== $real ? '  <-- counter is blind to these' : ''));
}

/* ---- 3. the two renewal_success rows ---- */
rule('3. WHY renewal_success SHOWS 2');

$rows = $pdo->query(
   "SELECT id, dedupe_key, to_email, user_id, status, created_at
      FROM email_queue WHERE template = 'renewal_success'
     ORDER BY id DESC LIMIT 10")->fetchAll();
if (!$rows) echo "  none\n";
foreach ($rows as $r) {
    printf("  #%-5s %-42s %-9s %s\n", $r['id'], $r['dedupe_key'], $r['status'], $r['created_at']);
}
echo "\n  Two DIFFERENT dedupe keys means two distinct events, not a dedupe\n";
echo "  failure. Section 11 renews with order SELFTEST-ORDER; section 16\n";
echo "  renews with SELFTEST_RENEW_xxx. Both are the same fake user, so the\n";
echo "  counter totals them.\n";

/* ---- 4. keep test rows and real rows separate ---- */
rule('4. TEST ROWS vs REAL ROWS');

$q = $pdo->query(
   "SELECT
      SUM(to_email LIKE '%@selftest.invalid') AS test_rows,
      SUM(to_email NOT LIKE '%@selftest.invalid' AND template LIKE 'owner_%') AS owner_rows,
      SUM(to_email NOT LIKE '%@selftest.invalid' AND template NOT LIKE 'owner_%') AS other_rows,
      COUNT(*) AS total
    FROM email_queue")->fetch();
printf("  self-test rows (.invalid)      : %s\n", $q['test_rows'] ?? 0);
printf("  owner rows (real recipient)    : %s\n", $q['owner_rows'] ?? 0);
printf("  everything else                : %s\n", $q['other_rows'] ?? 0);
printf("  total in email_queue           : %s\n", $q['total'] ?? 0);

$q = $pdo->query("SELECT COUNT(*) FROM email_queue WHERE status = 'pending'")->fetchColumn();
echo "\n  PENDING (would send on the next scheduler tick): $q\n";
if ((int)$q > 0) {
    $rows = $pdo->query("SELECT template, to_email, dedupe_key FROM email_queue
                          WHERE status='pending' ORDER BY id DESC LIMIT 20")->fetchAll();
    foreach ($rows as $r) {
        $isTest = str_ends_with(strtolower((string)$r['to_email']), '.invalid');
        printf("    %-24s %-18s %s\n", $r['template'], mask($r['to_email']),
               $isTest ? '(self-test row)' : '<-- REAL RECIPIENT');
    }
}

echo "\n", str_repeat('=', 76), "\n";
echo "Read-only. No rows were created, changed or deleted.\n";
echo "Delete this file when you are done.\n";
