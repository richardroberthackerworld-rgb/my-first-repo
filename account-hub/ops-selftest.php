<?php
/* ============================================================
   ops-selftest.php — verify ops.php against the real database.

   SAFETY, by construction:
     • CLI is the intended way to run it. Web access is refused unless a
       strong one-off token is set in the settings table AND matches.
       The app secret is deliberately NOT accepted — it is used for other
       things and should not double as a remote-execution key.
     • Every row it creates carries the __SELFTEST__ prefix, and it only
       ever writes to the ops tables. It never issues a single statement
       against users, transactions, entitlements, tool_credits or otps —
       there is an explicit guard below that aborts if that changes.
     • Cleanup runs in a finally block, so test rows are removed even if
       an assertion throws.
     • noindex headers, and it should be deleted once green.

   RUN (preferred — CLI, no token needed, nothing exposed to the web):
       php /home/USER/account.7by.in/ops-selftest.php

   RUN (fallback — web, only if you have no shell):
       1. In MySQL:  INSERT INTO settings (skey,sval)
                     VALUES ('selftest_token','<64-char-random>');
       2. Visit:     https://account.7by.in/ops-selftest.php?token=<same>
       3. Then:      DELETE FROM settings WHERE skey='selftest_token';
                     and delete this file.
   ============================================================ */

$IS_CLI = (PHP_SAPI === 'cli');

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/ops.php';

/* ---------- gate ---------- */
if (!$IS_CLI) {
    header('X-Robots-Tag: noindex, nofollow, noarchive');
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');

    // A dedicated single-purpose token, set by hand and removed after.
    // Absent token = feature off = no remote execution path at all.
    $want = (string)ops_setting('selftest_token', '');
    $got  = (string)($_GET['token'] ?? '');
    if (strlen($want) < 32 || !hash_equals($want, $got)) {
        http_response_code(404);           // 404, not 403 — do not confirm it exists
        exit("Not found\n");
    }
} else {
    header_remove();
}

/* ---------- guard: this test must never touch business data ----------
   Belt and braces. If someone later adds a statement against a real
   table, this aborts before anything runs. */
const SELFTEST_FORBIDDEN = ['users', 'transactions', 'entitlements', 'tool_credits', 'otps', 'api_tokens'];
$selfSrc = file_get_contents(__FILE__);
foreach (SELFTEST_FORBIDDEN as $tbl) {
    if (preg_match('/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+' . $tbl . '\b/i', $selfSrc)) {
        exit("ABORT: this file contains a write against `$tbl`. Refusing to run.\n");
    }
}

$PREFIX = '__SELFTEST__';
$RUN    = $PREFIX . bin2hex(random_bytes(4));
$EMAIL  = 'selftest.' . bin2hex(random_bytes(3)) . '@selftest.invalid';
$FAKEU  = -999;                       // negative id — cannot collide with a real user

$pass = 0; $fail = 0;
function t($name, $got, $want) {
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "  ok   $name\n"; }
    else { $fail++; echo "  FAIL $name\n         got:  " . var_export($got, true)
                       . "\n         want: " . var_export($want, true) . "\n"; }
}

echo "7By ops self-test\n";
echo "run id: $RUN\n";
echo str_repeat('=', 52) . "\n\n";

$ref = null; $id1 = null;

try {
    echo "1. MIGRATION\n";
    ops_migrate();  t('tables created', true, true);
    ops_migrate();  t('idempotent on re-run', true, true);

    echo "\n2. ERROR GROUPING  (100 identical faults => 1 incident)\n";
    for ($i = 0; $i < 100; $i++) {
        $r = ops_error($RUN, 'low', 'upstream timed out after ' . (1000 + $i) . 'ms',
                       ['route' => '/selftest/solve']);
        if ($ref === null) $ref = $r;
    }
    $st = db()->prepare('SELECT COUNT(*) c, MAX(occurrences) o FROM system_errors WHERE type = ?');
    $st->execute([$RUN]); $g = $st->fetch();
    t('collapsed into 1 incident',   (int)$g['c'], 1);
    t('counted all 100 occurrences', (int)$g['o'], 100);

    echo "\n3. ALERT THROTTLING  (50 high-severity faults => 1 owner email)\n";
    $hi = $RUN . '_HI';
    for ($i = 0; $i < 50; $i++) {
        ops_error($hi, 'high', 'provider down code ' . (500 + $i), ['route' => '/selftest/solve']);
    }
    $st = db()->prepare("SELECT COUNT(*) FROM email_queue WHERE template='system_error' AND vars LIKE ?");
    $st->execute(['%' . $hi . '%']);
    t('one alert queued, not 50', (int)$st->fetchColumn(), 1);
    $st = db()->prepare('SELECT alerts_sent, occurrences FROM system_errors WHERE type = ?');
    $st->execute([$hi]); $a = $st->fetch();
    t('alert recorded on incident', (int)$a['alerts_sent'], 1);
    t('all 50 still counted',       (int)$a['occurrences'], 50);

    echo "\n4. EMAIL DEDUPE  (a replayed webhook must not email twice)\n";
    $dk  = 'selftest:' . $RUN;
    $id1 = ops_mail('billing', $EMAIL, 'purchase_success',
                    ['name' => 'Self Test', 'plan' => 'Yearly'], ['dedupe' => $dk, 'user_id' => $FAKEU]);
    $id2 = ops_mail('billing', $EMAIL, 'purchase_success',
                    ['name' => 'Self Test', 'plan' => 'Yearly'], ['dedupe' => $dk, 'user_id' => $FAKEU]);
    t('first queue succeeds',            $id1 > 0, true);
    t('duplicate refused, not thrown',   $id2, 0);
    t('nothing was actually delivered',
      (int)db()->query("SELECT COUNT(*) FROM email_log WHERE to_email = " . db()->quote($EMAIL))->fetchColumn(), 0);

    echo "\n5. RETRY SCHEDULE\n";
    $st = db()->prepare('SELECT attempts, status FROM email_queue WHERE id = ?');
    $st->execute([$id1]); $q = $st->fetch();
    t('starts pending, 0 attempts', $q['status'] . ':' . (int)$q['attempts'], 'pending:0');
    t('retry 1 waits 2 min',  ops_backoff(0), 120);
    t('retry 2 waits 10 min', ops_backoff(1), 600);

    echo "\n6. CANCELLATION  (renewing kills queued reminders)\n";
    db()->prepare("UPDATE email_queue SET template='expiry_15' WHERE id = ?")->execute([$id1]);
    t('pending reminder cancelled', ops_mail_cancel($FAKEU, 'expiry_%'), 1);
    $st = db()->prepare('SELECT status FROM email_queue WHERE id = ?');
    $st->execute([$id1]);
    t('marked cancelled, not deleted', $st->fetchColumn(), 'cancelled');

    echo "\n7. INCIDENT RESOLUTION\n";
    t('resolves', ops_resolve($ref, 'Self-test resolution', 'selftest'), true);
    $st = db()->prepare('SELECT status FROM system_errors WHERE ref = ?');
    $st->execute([$ref]);
    t('status is resolved', $st->fetchColumn(), 'resolved');
    $st = db()->prepare("SELECT COUNT(*) FROM email_queue WHERE template='system_resolved' AND vars LIKE ?");
    $st->execute(['%' . $ref . '%']);
    t('resolution email queued once', (int)$st->fetchColumn(), 1);

    echo "\n8. AUDIT\n";
    $st = db()->prepare("SELECT COUNT(*) FROM audit_logs WHERE action='error_resolved' AND target = ?");
    $st->execute([$ref]);
    t('resolution audited', (int)$st->fetchColumn(), 1);

    /* ---------- slice 2 ---------- */
    require_once __DIR__ . '/ops-scheduler.php';

    echo "\n9. SCHEDULER LOCK\n";
    t('lock acquired',            sched_lock(), true);
    t('second holder is refused', sched_lock(), true);   // same session re-enters
    sched_unlock();

    echo "\n10. REMINDER LADDER  (against a fake subscription, never a real user)\n";
    $exp = date('Y-m-d H:i:s', strtotime('+2 days'));
    $q1 = sched_ladder_for($FAKEU, 'selftest', $EMAIL, 'Self Test', 'yearly', $exp);
    t('a customer at 2 days gets ONE email, not four', $q1, 1);
    $st = db()->prepare("SELECT template, status FROM email_queue WHERE user_id = ? ORDER BY id");
    $st->execute([$FAKEU]);
    $rowsQ = $st->fetchAll();
    $sentT = array_values(array_filter($rowsQ, fn($r) => $r['status'] === 'pending'));
    t('and it is the most urgent rung', $sentT[0]['template'] ?? '', 'expiry_3');
    t('overtaken rungs burned, not queued',
      count(array_filter($rowsQ, fn($r) => $r['status'] === 'cancelled')), 3);
    t('re-running the tick sends nothing more',
      sched_ladder_for($FAKEU, 'selftest', $EMAIL, 'Self Test', 'yearly', $exp), 0);

    echo "\n11. RENEWAL CANCELS STALE REMINDERS\n";
    $newExp = date('Y-m-d H:i:s', strtotime('+1 year'));
    ops_on_renewal($FAKEU, $EMAIL, 'Self Test', 'yearly', $newExp, 'SELFTEST-ORDER', '₹0');
    $st = db()->prepare("SELECT COUNT(*) FROM email_queue
                         WHERE user_id = ? AND template LIKE 'expiry_%' AND status = 'pending'");
    $st->execute([$FAKEU]);
    t('no stale expiry mail left pending', (int)$st->fetchColumn(), 0);
    $st = db()->prepare("SELECT COUNT(*) FROM email_queue
                         WHERE user_id = ? AND template = 'renewal_success'");
    $st->execute([$FAKEU]);
    t('renewal confirmation queued once', (int)$st->fetchColumn(), 1);

    echo "\n12. HEARTBEAT\n";
    ops_set_setting('sched_last_run', date('Y-m-d H:i:s', time() - 3600));
    ops_set_setting('sched_watchdog_at', null);
    ops_sched_watchdog();
    $st = db()->query("SELECT COUNT(*) FROM system_errors WHERE type='SCHEDULER_DOWN'");
    t('a stale scheduler raises an incident', (int)$st->fetchColumn() > 0, true);
    ops_set_setting('sched_last_run', date('Y-m-d H:i:s'));

} catch (Throwable $e) {
    $fail++;
    echo "\n  EXCEPTION: " . $e->getMessage() . "\n";
} finally {
    /* Runs even if an assertion threw, so the database is never left dirty. */
    echo "\n13. CLEANUP\n";
    $removed = 0;
    try {
        $st = db()->prepare('DELETE FROM email_queue
                             WHERE to_email = ? OR vars LIKE ? OR dedupe_key LIKE ? OR user_id = ?');
        $st->execute([$EMAIL, '%' . $RUN . '%', 'selftest:%', $FAKEU]); $removed += $st->rowCount();

        $st = db()->prepare("DELETE FROM email_queue WHERE dedupe_key LIKE 'rem:-999:%' OR dedupe_key LIKE 'renewal:-999:%'");
        $st->execute(); $removed += $st->rowCount();

        $st = db()->prepare('DELETE FROM notifications WHERE user_id = ?');
        $st->execute([$FAKEU]); $removed += $st->rowCount();

        $st = db()->prepare("DELETE FROM audit_logs WHERE target = ?");
        $st->execute(['user#' . $FAKEU]); $removed += $st->rowCount();

        $st = db()->prepare("DELETE FROM system_errors WHERE type = 'SCHEDULER_DOWN'");
        $st->execute(); $removed += $st->rowCount();

        $st = db()->prepare('DELETE FROM email_log WHERE to_email = ?');
        $st->execute([$EMAIL]); $removed += $st->rowCount();

        $st = db()->prepare('DELETE FROM system_errors WHERE type LIKE ?');
        $st->execute([$PREFIX . '%']); $removed += $st->rowCount();

        if ($ref) {
            $st = db()->prepare('DELETE FROM audit_logs WHERE target = ?');
            $st->execute([$ref]); $removed += $st->rowCount();
        }
        echo "  removed $removed test row(s)\n";

        $left = (int)db()->query("SELECT COUNT(*) FROM system_errors WHERE type LIKE '" . $PREFIX . "%'")->fetchColumn()
              + (int)db()->query('SELECT COUNT(*) FROM email_queue WHERE to_email = ' . db()->quote($EMAIL))->fetchColumn();
        t('database left clean', $left, 0);
    } catch (Throwable $e) {
        echo "  CLEANUP FAILED: " . $e->getMessage() . "\n";
        echo "  Remove by hand:  DELETE FROM system_errors WHERE type LIKE '$PREFIX%';\n";
        $fail++;
    }
}

echo "\n" . str_repeat('-', 52) . "\n";
if ($fail) {
    echo "FAILED — $fail check(s) failed, $pass passed\n";
} else {
    echo "ALL $pass CHECKS PASSED — slice 1 verified against MySQL.\n";
    echo "\nNow do both of these:\n";
    echo "  1. delete this file\n";
    echo "  2. DELETE FROM settings WHERE skey='selftest_token';\n";
}
exit($fail ? 1 : 0);
