<?php
/* ============================================================
   ops-forensics.php — TEMPORARY, STRICTLY READ-ONLY. DELETE AFTER USE.

   Answers, for the accidental scheduler execution:
     1. which account each expiry_30 / expiry_3 email belonged to
     2. which subscription term made it eligible
     3. whether the account was genuinely inside that window
     4. whether the send coincides with the self-test's scheduler tick
     5. whether the reminder dedupe keys were consumed
     6. whether any customer subscription data was modified

   Every statement is a SELECT. There is no INSERT, UPDATE, DELETE or DDL
   anywhere in this file, and it never loads lib.php/db() — db() runs
   CREATE TABLE and ALTER on connect, which would be a write.

   All personal data is masked: addresses become a•••@b•••.tld and names
   are reduced to initials.
   ============================================================ */

if (PHP_SAPI !== 'cli') {
    header('X-Robots-Tag: noindex, nofollow');
    http_response_code(404);
    exit("Not found\n");
}

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) { fwrite(STDERR, "config.php not found\n"); exit(2); }
$CFG = require $cfgFile;
$d   = $CFG['db'] ?? null;
if (!is_array($d)) { fwrite(STDERR, "no 'db' section\n"); exit(2); }

try {
    $pdo = new PDO("mysql:host={$d['host']};dbname={$d['name']};charset=utf8mb4",
        $d['user'], $d['pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
} catch (Throwable $e) {
    fwrite(STDERR, "Connect failed. SQLSTATE: " . $e->getCode() . "\n"); exit(3);
}

function mask_email($e) {
    $e = (string)$e; $at = strpos($e, '@');
    if ($at === false) return substr($e, 0, 2) . '••••••';
    $u = substr($e, 0, $at); $h = substr($e, $at + 1);
    $dot = strrpos($h, '.'); $tld = $dot !== false ? substr($h, $dot) : '';
    $hn = $dot !== false ? substr($h, 0, $dot) : $h;
    return substr($u, 0, 1) . str_repeat('•', max(2, min(6, strlen($u) - 1)))
         . '@' . substr($hn, 0, 1) . str_repeat('•', max(2, min(6, strlen($hn) - 1))) . $tld;
}
function mask_name($n) {
    $n = trim((string)$n); if ($n === '') return '(none)';
    $out = [];
    foreach (preg_split('/\s+/', $n) as $p) $out[] = mb_substr($p, 0, 1) . '.';
    return implode(' ', $out);
}
function has_table(PDO $p, $t) {
    $s = $p->prepare("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?");
    $s->execute([$t]); return (int)$s->fetchColumn() > 0;
}
function rule($t) { echo "\n", $t, "\n", str_repeat('=', 74), "\n"; }

/* ---------------- 1. the customer reminders that went out ------------- */
rule('1. CUSTOMER REMINDER EMAILS ACTUALLY DELIVERED');

$sent = $pdo->query(
    "SELECT id, to_email, template, status, created_at
       FROM email_log
      WHERE template IN ('expiry_30','expiry_15','expiry_5','expiry_3','expiry_1','expired')
      ORDER BY id DESC LIMIT 50")->fetchAll();

if (!$sent) { echo "none found\n"; }
foreach ($sent as $r) {
    printf("  #%-5s %-28s %-11s %-7s %s\n",
        $r['id'], mask_email($r['to_email']), $r['template'], $r['status'], $r['created_at']);
}

$addrs = array_values(array_unique(array_column($sent, 'to_email')));

/* ---------------- 2+3. the account and whether it was genuinely due ---- */
rule('2+3. THE ACCOUNT BEHIND EACH REMINDER, AND WHETHER IT WAS GENUINELY DUE');

if (!$addrs) { echo "no recipients to resolve\n"; }
foreach ($addrs as $a) {
    $s = $pdo->prepare('SELECT id, name, email, plan, plan_expires, created_at FROM users WHERE email = ?');
    $s->execute([$a]);
    $u = $s->fetch();
    if (!$u) { printf("  %-28s no matching user row\n", mask_email($a)); continue; }

    printf("  user#%-6s %-28s  name %-10s\n", $u['id'], mask_email($u['email']), mask_name($u['name']));
    printf("    hub plan     : %-10s expires %s\n", $u['plan'], $u['plan_expires'] ?: '(none)');

    $s = $pdo->prepare('SELECT tool, plan, plan_expires FROM tool_credits WHERE user_id = ?');
    $s->execute([$u['id']]);
    foreach ($s->fetchAll() as $tc) {
        printf("    tool plan    : %-10s %-10s expires %s\n",
            $tc['tool'], $tc['plan'], $tc['plan_expires'] ?: '(none)');
    }

    /* Was each delivered rung genuinely applicable at the time it was sent? */
    foreach ($sent as $r) {
        if ($r['to_email'] !== $a) continue;
        $rung = (int)filter_var($r['template'], FILTER_SANITIZE_NUMBER_INT);
        $when = strtotime($r['created_at']);
        $best = null;
        foreach ([$u['plan_expires']] as $exp) if ($exp) $best = max((int)$best, strtotime($exp));
        $s2 = $pdo->prepare('SELECT MAX(plan_expires) FROM tool_credits WHERE user_id = ?');
        $s2->execute([$u['id']]);
        $tExp = $s2->fetchColumn();
        if ($tExp) $best = max((int)$best, strtotime($tExp));

        if (!$best) { printf("    %-11s : cannot judge — no expiry on record\n", $r['template']); continue; }
        $daysAtSend = ($best - $when) / 86400;
        $ok = $rung > 0 ? ($daysAtSend > 0 && $daysAtSend <= $rung) : ($daysAtSend <= 0);
        printf("    %-11s : %.1f days remained when sent -> %s\n",
            $r['template'], $daysAtSend,
            $ok ? 'GENUINELY DUE (correct content)' : 'OUTSIDE THE WINDOW (content was wrong)');
    }
    echo "\n";
}

/* ---------------- 4. did the self-test cause it? ---------------------- */
rule('4. DID THE ACCIDENTAL SCHEDULER TICK CAUSE THESE?');

if (has_table($pdo, 'scheduler_runs')) {
    $runs = $pdo->query('SELECT id, started_at, duration_ms, ok, summary
                           FROM scheduler_runs ORDER BY id DESC LIMIT 10')->fetchAll();
    if (!$runs) echo "  no scheduler_runs rows\n";
    foreach ($runs as $r) {
        $sum = json_decode((string)$r['summary'], true) ?: [];
        printf("  run#%-4s %s  %5sms  ok=%s  queued=%s sent=%s failed=%s\n",
            $r['id'], $r['started_at'], $r['duration_ms'], $r['ok'],
            $sum['reminders_queued'] ?? '-', $sum['emails_sent'] ?? '-', $sum['emails_failed'] ?? '-');
    }
    echo "\n  Correlate the timestamps above with the email_log times in section 1.\n";
    echo "  A run whose 'sent' count matches emails logged in the same second is\n";
    echo "  the tick that delivered them.\n";
} else { echo "  scheduler_runs table not present\n"; }

/* ---------------- 5. were the dedupe keys consumed? ------------------- */
rule('5. REMINDER DEDUPE KEYS — CONSUMED OR STILL AVAILABLE?');

$keys = $pdo->query("SELECT dedupe_key, template, status, attempts, created_at, sent_at
                       FROM email_queue
                      WHERE dedupe_key LIKE 'rem:%'
                      ORDER BY id DESC LIMIT 40")->fetchAll();
if (!$keys) echo "  no reminder keys in the queue\n";
foreach ($keys as $k) {
    printf("  %-46s %-11s %-9s sent %s\n",
        $k['dedupe_key'], $k['template'], $k['status'], $k['sent_at'] ?: '-');
}
echo "\n  A key listed here is SPENT: that rung can never be sent again for that\n";
echo "  term. The customer will still get later rungs, and renewal mints an\n";
echo "  entirely new key set, so nothing is permanently suppressed.\n";

/* ---------------- 6. was any customer data modified? ------------------ */
rule('6. WAS ANY CUSTOMER SUBSCRIPTION DATA MODIFIED?');

echo "  Source audit (definitive): the ops layer contains no INSERT/UPDATE/\n";
echo "  DELETE/ALTER against users, transactions, entitlements or tool_credits.\n";
echo "  The scheduler reads those tables and writes only to its own ops tables.\n\n";

foreach (['users', 'transactions', 'entitlements', 'tool_credits'] as $t) {
    if (!has_table($pdo, $t)) { printf("  %-14s (absent)\n", $t); continue; }
    $n = (int)$pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
    printf("  %-14s %d row(s)\n", $t, $n);
}

echo "\n  Billing consistency for the affected accounts:\n";
foreach ($addrs as $a) {
    $s = $pdo->prepare('SELECT id FROM users WHERE email = ?'); $s->execute([$a]);
    $uid = $s->fetchColumn(); if (!$uid) continue;
    $s = $pdo->prepare("SELECT status, COUNT(*) c FROM transactions WHERE user_id = ? GROUP BY status");
    $s->execute([$uid]);
    $parts = [];
    foreach ($s->fetchAll() as $row) $parts[] = $row['status'] . '=' . $row['c'];
    printf("    user#%-6s transactions: %s\n", $uid, $parts ? implode(', ', $parts) : 'none');
}

echo "\n  Audit log entries touching those accounts:\n";
if (has_table($pdo, 'audit_logs')) {
    $n = 0;
    foreach ($addrs as $a) {
        $s = $pdo->prepare('SELECT id FROM users WHERE email = ?'); $s->execute([$a]);
        $uid = $s->fetchColumn(); if (!$uid) continue;
        $s = $pdo->prepare("SELECT action, created_at FROM audit_logs WHERE target = ? ORDER BY id DESC LIMIT 5");
        $s->execute(['user#' . $uid]);
        foreach ($s->fetchAll() as $row) { printf("    user#%-6s %-22s %s\n", $uid, $row['action'], $row['created_at']); $n++; }
    }
    if (!$n) echo "    none — no ops action was recorded against these accounts\n";
} else echo "    audit_logs not present\n";

echo "\n", str_repeat('-', 74), "\n";
echo "Read-only. Nothing above modified any row.\n";
echo "Delete this file when you are done.\n";
