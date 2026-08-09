<?php
/* ============================================================
   ops-health.php — system status (§33) and the scheduler watchdog.

   Two jobs:
     • answers a JSON status probe for the admin panel and any external
       uptime monitor
     • every hit runs ops_sched_watchdog(), so ordinary traffic to this
       endpoint is what notices a scheduler that stopped and never came
       back. A dead cron cannot report itself.

   Public shape is deliberately thin — up/down only, no versions, no
   error text, nothing that helps someone probe the stack. Pass the
   admin token for the detailed view.
   ============================================================ */

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/ops.php';
require_once __DIR__ . '/ops-scheduler.php';   // for ops_sched_watchdog()

header('Content-Type: application/json; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

/* Ordinary traffic doubles as the watchdog. Throttled internally to once
   every five minutes, so this stays cheap even under load. */
ops_sched_watchdog();

$detailed = false;
$tok = (string)ops_setting('health_token', '');
if ($tok !== '' && hash_equals($tok, (string)($_GET['token'] ?? ''))) $detailed = true;

$out = ['ok' => true, 'time' => gmdate('c')];

/* ---- database ---- */
try {
    db()->query('SELECT 1');
    $out['database'] = 'up';
} catch (Throwable $e) {
    $out['database'] = 'down';
    $out['ok'] = false;
}

/* ---- scheduler ---- */
$last = ops_setting('sched_last_run');
$gapMin = $last ? (int)round((time() - strtotime($last)) / 60) : null;
if ($gapMin === null)              $sched = 'never_run';
elseif ($gapMin > SCHED_STALE_MIN) $sched = 'stale';
else                               $sched = 'up';
$out['scheduler'] = $sched;
if ($sched !== 'up') $out['ok'] = false;

/* ---- email queue ---- */
try {
    $q = db()->query("SELECT
            SUM(status='pending')  pending,
            SUM(status='failed')   failed
          FROM email_queue")->fetch();
    $out['email'] = ((int)$q['failed'] > 0) ? 'degraded' : 'up';
} catch (Throwable $e) { $out['email'] = 'unknown'; }

/* ---- open incidents ---- */
try {
    $n = (int)db()->query("SELECT COUNT(*) FROM system_errors
                           WHERE status NOT IN ('resolved','ignored')
                             AND severity IN ('high','critical')")->fetchColumn();
    $out['incidents'] = $n ? 'attention' : 'clear';
    if ($n) $out['ok'] = false;
} catch (Throwable $e) { $out['incidents'] = 'unknown'; }

/* ---- detail, for admins only ---- */
if ($detailed) {
    $out['detail'] = [
        'scheduler_last_run' => $last,
        'scheduler_gap_min'  => $gapMin,
        'scheduler_summary'  => json_decode((string)ops_setting('sched_last_summary', '{}'), true),
        'email_pending'      => (int)($q['pending'] ?? 0),
        'email_failed'       => (int)($q['failed'] ?? 0),
    ];
    try {
        $out['detail']['open_incidents'] = db()->query(
            "SELECT ref, type, severity, occurrences, last_seen
               FROM system_errors
              WHERE status NOT IN ('resolved','ignored')
              ORDER BY last_seen DESC LIMIT 20")->fetchAll(PDO::FETCH_ASSOC);
        $out['detail']['recent_runs'] = db()->query(
            "SELECT started_at, duration_ms, ok FROM scheduler_runs
              ORDER BY id DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {}
}

http_response_code($out['ok'] ? 200 : 503);
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
