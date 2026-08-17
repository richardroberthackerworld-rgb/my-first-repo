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

/* Deliberately no detailed mode here.
   An earlier draft had a token-gated block returning incident types, error
   summaries and run history. Even behind a token that is the wrong place
   for it: this endpoint is public, unauthenticated by design, and a token
   in a query string ends up in browser history, proxy logs and referrers.
   Diagnostics belong behind the admin session in slice 4. What is returned
   below is up/down only — no messages, no paths, no config, no user data. */
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

/* Final scrub. Belt and braces against a future edit reintroducing detail:
   only this exact set of keys may ever leave this endpoint, and every value
   must be one of the fixed status words. Anything else is dropped rather
   than leaked. */
const HEALTH_ALLOWED_KEYS   = ['ok', 'time', 'database', 'scheduler', 'email', 'incidents'];
const HEALTH_ALLOWED_VALUES = ['up', 'down', 'stale', 'never_run', 'degraded',
                               'clear', 'attention', 'unknown'];
$safe = [];
foreach (HEALTH_ALLOWED_KEYS as $k) {
    if (!array_key_exists($k, $out)) continue;
    $v = $out[$k];
    if ($k === 'ok')   { $safe[$k] = (bool)$v; continue; }
    if ($k === 'time') { $safe[$k] = $v;       continue; }
    $safe[$k] = in_array($v, HEALTH_ALLOWED_VALUES, true) ? $v : 'unknown';
}
$out = $safe;

http_response_code($out['ok'] ? 200 : 503);
echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
