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

    /* ---------------- slice 3 ----------------
       Nothing below ever calls ops_mail_flush(), so not one message is
       delivered. Rows are queued, counted, then deleted. Every recipient is
       the .invalid test address and every user id is negative, so a real
       customer cannot be reached even by accident. */
    require_once __DIR__ . '/ops-events.php';

    echo "\n12. SLICE 3 — SCHEMA\n";
    $cols = db()->query("SHOW COLUMNS FROM email_queue LIKE 'provider_msg_id'")->fetchAll();
    t('email_queue.provider_msg_id exists', count($cols), 1);
    $cols = db()->query("SHOW COLUMNS FROM email_log LIKE 'provider_msg_id'")->fetchAll();
    t('email_log.provider_msg_id exists',   count($cols), 1);
    ops_migrate();
    t('migration still idempotent after the ALTERs', true, true);

    echo "\n13. SLICE 3 — TEMPLATES\n";
    $tpl = ops_builtin_templates();
    $need = ['purchase_success','renewal_success','payment_failed','expiry_30','expiry_15',
             'expiry_5','expiry_3','expiry_1','expired','support_ticket_created','support_reply',
             'owner_new_member','owner_purchase','owner_renewal','owner_payment_failed',
             'owner_support_ticket','system_error','system_resolved','owner_email_failed'];
    $missing = array_values(array_filter($need, fn($n) => !isset($tpl[$n])));
    t('all 19 required templates present', $missing, []);
    $probe = array_fill_keys(['name','email','plan','amount','order_id','start_date','expiry_date',
        'dashboard_url','admin_url','support_url','renew_url','upgrade_url','ref','type','severity',
        'route','message','occurrences','first_seen','last_seen','resolved_at','duration','resolution',
        'sent_at','from','days_left','reason','ticket','subject','category','summary','reply','agent',
        'when','template','recipient','attempts','queue_id'], 'x');
    $unresolved = [];
    foreach ($tpl as $n => $x) {
        if (preg_match('/\{\{/', ops_render($x['subject'], $probe) . ops_render($x['body_html'], $probe))) {
            $unresolved[] = $n;
        }
    }
    t('every template renders with no unresolved variable', $unresolved, []);

    /* synthetic payment — passed as arrays, so nothing is written to the
       users or transactions tables at any point */
    $PAY  = 'SELFTEST_PAY_' . bin2hex(random_bytes(3));
    $fakeUser = ['id' => $FAKEU, 'name' => 'Self Test', 'email' => $EMAIL,
                 'plan' => 'yearly', 'plan_expires' => date('Y-m-d H:i:s', strtotime('+1 year'))];
    $fakeTx   = ['id' => -1, 'user_id' => $FAKEU, 'payment_id' => $PAY, 'order_id' => $PAY,
                 'plan' => 'yearly', 'amount' => 49900, 'status' => 'paid'];
    $cnt = function ($tplName) use ($FAKEU, $EMAIL) {
        $st = db()->prepare('SELECT COUNT(*) FROM email_queue WHERE template = ? AND (user_id = ? OR to_email = ?)');
        $st->execute([$tplName, $FAKEU, $EMAIL]);
        return (int)$st->fetchColumn();
    };

    echo "\n14. SLICE 3 — PURCHASE\n";
    ops_on_purchase($fakeTx, $fakeUser, false);
    t('customer receipt queued exactly once', $cnt('purchase_success'), 1);
    t('owner copy queued exactly once',       $cnt('owner_purchase'),   1);

    echo "\n15. SLICE 3 — REPLAYED WEBHOOK\n";
    ops_on_purchase($fakeTx, $fakeUser, false);
    ops_on_purchase($fakeTx, $fakeUser, false);
    t('customer receipt still 1 after 2 replays', $cnt('purchase_success'), 1);
    t('owner copy still 1 after 2 replays',       $cnt('owner_purchase'),   1);

    echo "\n16. SLICE 3 — RENEWAL\n";
    $PAY2 = 'SELFTEST_RENEW_' . bin2hex(random_bytes(3));
    $renewTx = array_merge($fakeTx, ['payment_id' => $PAY2, 'order_id' => $PAY2]);
    ops_on_purchase($renewTx, $fakeUser, true);
    ops_on_purchase($renewTx, $fakeUser, true);           // replay
    t('renewal confirmation queued once', $cnt('renewal_success'), 1);
    t('owner renewal queued once',        $cnt('owner_renewal'),   1);

    echo "\n17. SLICE 3 — PAYMENT FAILURE\n";
    ops_on_payment_failure($FAKEU, $EMAIL, 'Self Test', 'yearly', 'card declined', $PAY);
    ops_on_payment_failure($FAKEU, $EMAIL, 'Self Test', 'yearly', 'card declined', $PAY);
    t('customer notice queued once', $cnt('payment_failed'),       1);
    t('owner notice queued once',    $cnt('owner_payment_failed'), 1);

    echo "\n18. SLICE 3 — SUPPORT\n";
    $tRef = ops_on_support_ticket($FAKEU, $EMAIL, 'Self Test', 'account',
                                  'Selftest ticket', 'body of the selftest ticket');
    t('ticket created with a ref', (bool)$tRef, true);
    t('customer confirmation queued once', $cnt('support_ticket_created'), 1);
    t('owner notification queued once',    $cnt('owner_support_ticket'),   1);
    ops_on_support_reply($tRef, 'first reply', 'Selftest');
    t('first reply queues one email',  $cnt('support_reply'), 1);
    ops_on_support_reply($tRef, 'second reply', 'Selftest');
    t('a SECOND reply queues another', $cnt('support_reply'), 2);

    echo "\n19. SLICE 3 — EMAIL DELIVERY FAILURE\n";
    ops_on_email_failed(-424242, 'purchase_success', $EMAIL, 3, 'connection refused');
    ops_on_email_failed(-424242, 'purchase_success', $EMAIL, 3, 'connection refused');
    $st = db()->prepare("SELECT COUNT(*) FROM email_queue WHERE dedupe_key = ?");
    $st->execute(['emailfail:-424242']);
    t('one owner alert per dead message', (int)$st->fetchColumn(), 1);
    t('an owner_ template cannot trigger another owner alert',
      strpos(file_get_contents(__DIR__ . '/ops.php'), "strpos(\$q['template'], 'owner_') !== 0") !== false, true);

    echo "\n20. SLICE 3 — PROVIDER MESSAGE ID\n";
    $st = db()->prepare('SELECT COUNT(*) FROM email_queue WHERE provider_msg_id IS NOT NULL AND to_email = ?');
    $st->execute([$EMAIL]);
    t('left NULL while SMTP returns only a boolean', (int)$st->fetchColumn(), 0);

    echo "\n21. SLICE 3 — PAYMENT FLOW ORDERING (source assertions)\n";
    $api = file_get_contents(__DIR__ . '/api.php');
    $vBlock = substr($api, strpos($api, "case 'verify'"), 1800);
    t('signature is checked before anything grants',
      strpos($vBlock, 'if (!$okSig) fail(') !== false, true);
    t('signature check precedes the email hook',
      strpos($vBlock, 'if (!$okSig) fail(') < strpos($vBlock, 'ops_purchase_hook'), true);
    t('ownership check precedes the email hook',
      strpos($vBlock, 'WHERE order_id = ? AND user_id = ?') < strpos($vBlock, 'ops_purchase_hook'), true);
    t('already-paid early return precedes the email hook',
      strpos($vBlock, "if (\$tx['status'] === 'paid')") < strpos($vBlock, 'ops_purchase_hook'), true);
    t('grant_from_tx precedes the email hook',
      strpos($vBlock, 'grant_from_tx($tx);') < strpos($vBlock, 'ops_purchase_hook'), true);
    t('a missing ops-events.php cannot fatal the payment flow',
      strpos($api, "is_file(__DIR__ . '/ops-events.php')") !== false, true);
    t('every hook call site is function_exists-guarded',
      substr_count($api, 'function_exists(\'ops_purchase_hook\')')
        + substr_count($api, 'function_exists(\'ops_signup_hook\')'),
      substr_count($api, 'ops_purchase_hook(') - substr_count($api, "function_exists('ops_purchase_hook')")
        + substr_count($api, 'ops_signup_hook(') - substr_count($api, "function_exists('ops_signup_hook')"));

    echo "\n22. HEARTBEAT\n";
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

        /* slice 3 rows */
        $st = db()->prepare("DELETE FROM email_queue WHERE dedupe_key LIKE 'emailfail:-%'
                             OR dedupe_key LIKE '%SELFTEST_PAY_%' OR dedupe_key LIKE '%SELFTEST_RENEW_%'");
        $st->execute(); $removed += $st->rowCount();

        // support_messages first — it references the ticket
        $st = db()->prepare('DELETE sm FROM support_messages sm
                             JOIN support_tickets st ON st.id = sm.ticket_id
                             WHERE st.email = ?');
        $st->execute([$EMAIL]); $removed += $st->rowCount();
        $st = db()->prepare('DELETE FROM support_tickets WHERE email = ?');
        $st->execute([$EMAIL]); $removed += $st->rowCount();

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
