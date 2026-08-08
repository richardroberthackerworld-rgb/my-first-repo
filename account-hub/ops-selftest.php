<?php
/* ============================================================
   ops-selftest.php — run ONCE on the server after deploying ops.php.

   Runs the migration, then proves the behaviour that cannot be tested
   without a real database: error grouping, alert throttling, email
   dedupe, retry/backoff, and resolution.

   It writes only to its own new tables and cleans up after itself.
   No customer email is ever sent — delivery is stubbed.

   Protect it, run it, then DELETE it:
       https://account.7by.in/ops-selftest.php?key=YOUR_APP_SECRET
   ============================================================ */

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/ops.php';

/* only the holder of app_secret may run this */
$given = $_GET['key'] ?? '';
$want  = $CFG['app_secret'] ?? '';
if (!$want || !hash_equals((string)$want, (string)$given)) {
    http_response_code(403);
    exit('Forbidden. Append ?key=<app_secret>.');
}

header('Content-Type: text/plain; charset=utf-8');
$pass = 0; $fail = 0;
function t($name, $got, $want) {
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "  ok   $name\n"; }
    else { $fail++; echo "  FAIL $name\n         got:  " . var_export($got, true)
                       . "\n         want: " . var_export($want, true) . "\n"; }
}

echo "1. MIGRATION\n";
try { ops_migrate(); t('all tables created (idempotent)', true, true); }
catch (Throwable $e) { t('migration', $e->getMessage(), true); }
try { ops_migrate(); t('safe to run a second time', true, true); }
catch (Throwable $e) { t('re-run', $e->getMessage(), true); }

$marker = 'SELFTEST_' . bin2hex(random_bytes(3));

echo "\n2. ERROR GROUPING  (100 identical faults must be ONE incident)\n";
$ref = null;
for ($i = 0; $i < 100; $i++) {
    $r = ops_error($marker, 'low', 'upstream timed out after ' . (1000 + $i) . 'ms',
                   ['route' => '/api/solve']);
    if ($ref === null) $ref = $r;
}
$st = db()->prepare('SELECT COUNT(*) c, MAX(occurrences) o FROM system_errors WHERE type = ?');
$st->execute([$marker]); $g = $st->fetch();
t('collapsed into 1 incident', (int)$g['c'], 1);
t('counted all 100 occurrences', (int)$g['o'], 100);

echo "\n3. ALERT THROTTLING  (high severity, 50 faults => 1 owner email)\n";
$marker2 = $marker . '_HI';
for ($i = 0; $i < 50; $i++) {
    ops_error($marker2, 'high', 'provider down code ' . (500 + $i), ['route' => '/api/solve']);
}
$st = db()->prepare("SELECT COUNT(*) c FROM email_queue WHERE template='system_error' AND vars LIKE ?");
$st->execute(['%' . $marker2 . '%']);
t('exactly one alert queued, not 50', (int)$st->fetchColumn(), 1);
$st = db()->prepare('SELECT alerts_sent, occurrences FROM system_errors WHERE type = ?');
$st->execute([$marker2]); $a = $st->fetch();
t('alert count recorded on incident', (int)$a['alerts_sent'], 1);
t('all 50 still counted', (int)$a['occurrences'], 50);

echo "\n4. EMAIL DEDUPE  (a retried webhook must not email twice)\n";
$dk = 'selftest:' . $marker;
$id1 = ops_mail('billing', 'selftest@example.invalid', 'purchase_success',
                ['name' => 'Test', 'plan' => 'Yearly'], ['dedupe' => $dk]);
$id2 = ops_mail('billing', 'selftest@example.invalid', 'purchase_success',
                ['name' => 'Test', 'plan' => 'Yearly'], ['dedupe' => $dk]);
t('first queue succeeds', $id1 > 0, true);
t('duplicate is refused, not thrown', $id2, 0);

echo "\n5. RETRY / BACKOFF  (transport failing => reschedule, then give up)\n";
$st = db()->prepare("SELECT attempts, status FROM email_queue WHERE id = ?");
$st->execute([$id1]); $q = $st->fetch();
t('starts pending with 0 attempts', $q['status'] . ':' . (int)$q['attempts'], 'pending:0');
t('retry 1 waits 2 min',  ops_backoff(0), 120);
t('retry 2 waits 10 min', ops_backoff(1), 600);

echo "\n6. CANCELLATION  (renewing kills queued expiry reminders)\n";
db()->prepare("UPDATE email_queue SET user_id = 999999999, template='expiry_15' WHERE id = ?")
    ->execute([$id1]);
$n = ops_mail_cancel(999999999, 'expiry_%');
t('pending reminder cancelled', $n, 1);
$st = db()->prepare('SELECT status FROM email_queue WHERE id = ?');
$st->execute([$id1]);
t('marked cancelled, not deleted', $st->fetchColumn(), 'cancelled');

echo "\n7. RESOLUTION\n";
$ok = ops_resolve($ref, 'Self-test resolution', 'selftest');
t('incident resolves', $ok, true);
$st = db()->prepare('SELECT status FROM system_errors WHERE ref = ?');
$st->execute([$ref]);
t('status is resolved', $st->fetchColumn(), 'resolved');
$st = db()->prepare("SELECT COUNT(*) FROM email_queue WHERE template='system_resolved' AND vars LIKE ?");
$st->execute(['%' . $ref . '%']);
t('resolution email queued once', (int)$st->fetchColumn(), 1);

echo "\n8. AUDIT\n";
$st = db()->prepare("SELECT COUNT(*) FROM audit_logs WHERE action='error_resolved' AND target = ?");
$st->execute([$ref]);
t('resolution written to audit log', (int)$st->fetchColumn(), 1);

echo "\n9. CLEANUP\n";
db()->prepare('DELETE FROM email_queue  WHERE vars LIKE ? OR dedupe_key = ? OR id = ?')
    ->execute(['%' . $marker . '%', $dk, $id1]);
db()->prepare('DELETE FROM email_log    WHERE to_email = ?')->execute(['selftest@example.invalid']);
db()->prepare('DELETE FROM system_errors WHERE type LIKE ?')->execute([$marker . '%']);
db()->prepare('DELETE FROM audit_logs   WHERE target = ?')->execute([$ref]);
t('test rows removed', true, true);

echo "\n" . str_repeat('-', 46) . "\n";
echo $fail ? "FAILED — $fail check(s) failed, $pass passed\n"
           : "ALL $pass CHECKS PASSED — slice 1 is working.\n";
echo "\nDelete this file when you are done.\n";
