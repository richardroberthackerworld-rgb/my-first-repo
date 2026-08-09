<?php
/* ============================================================
   ops-scheduler.php — the background worker.

   Cron entry point. Does four things per tick:
     1. takes an exclusive lock, so overlapping runs cannot double-send
     2. checks its own heartbeat and raises an incident after a gap
     3. schedules subscription lifecycle emails from EXISTING data
     4. flushes the email queue

   It deliberately does NOT introduce a subscription table. The source of
   truth stays where it already is:
       users.plan / users.plan_expires        — hub-wide plan
       tool_credits.plan / .plan_expires      — per-tool plan
   A second store would drift from those within a week.

   RUN (cron, every 5 minutes):
       php /home/USER/account.7by.in/ops-scheduler.php

   Web fallback is intentionally NOT provided — §12 requires this not to
   depend on a page being opened. ops-health.php exposes status instead.
   ============================================================ */

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/ops.php';

if (PHP_SAPI !== 'cli' && empty($GLOBALS['OPS_SCHED_EMBED'])) {
    header('X-Robots-Tag: noindex, nofollow');
    http_response_code(404);
    exit("Not found\n");
}

/* How long before a silent scheduler is treated as an outage. */
const SCHED_INTERVAL_MIN  = 5;
const SCHED_STALE_MIN     = 20;

/* The reminder ladder. Key is the dedupe slug; value is days remaining.
   Order matters only for readability — each is matched independently. */
const SCHED_LADDER = [
    'expiry_30' => 30,
    'expiry_15' => 15,
    'expiry_5'  => 5,
    'expiry_3'  => 3,
    'expiry_1'  => 1,
];

/* ------------------------------------------------------------------
   LOCK — MySQL advisory lock. Chosen over a settings row because it is
   released automatically if the process dies, so a crashed run cannot
   wedge the scheduler until someone clears a flag by hand.
   ------------------------------------------------------------------ */
function sched_lock() {
    $st = db()->prepare("SELECT GET_LOCK('7by_scheduler', 0)");
    $st->execute();
    return (int)$st->fetchColumn() === 1;
}
function sched_unlock() {
    try { db()->query("SELECT RELEASE_LOCK('7by_scheduler')"); } catch (Throwable $e) {}
}

/* ------------------------------------------------------------------
   HEARTBEAT
   A dead scheduler cannot report itself, so detection is two-sided:
     • on each tick, look at the gap since the previous tick and raise an
       incident if it was too long (catches "it stopped, then resumed")
     • ops_sched_watchdog() below is called from ordinary web traffic,
       which catches "it stopped and never came back"
   ------------------------------------------------------------------ */
function sched_heartbeat_check() {
    $last = ops_setting('sched_last_run');
    if ($last) {
        $gap = (time() - strtotime($last)) / 60;
        if ($gap > SCHED_STALE_MIN) {
            ops_error('SCHEDULER_GAP', 'high',
                sprintf('Scheduler did not run for %d minutes (expected every %d).',
                        round($gap), SCHED_INTERVAL_MIN),
                ['route' => 'cron/ops-scheduler']);
        }
    }
}
function sched_heartbeat_write($summary) {
    ops_set_setting('sched_last_run', date('Y-m-d H:i:s'));
    ops_set_setting('sched_last_summary', json_encode($summary));
}

/** Cheap, throttled staleness check safe to call from a web request.
 *  This is what notices a scheduler that stopped and never came back. */
function ops_sched_watchdog() {
    try {
        $checked = ops_setting('sched_watchdog_at');
        if ($checked && strtotime($checked) > time() - 300) return;   // at most once per 5 min
        ops_set_setting('sched_watchdog_at', date('Y-m-d H:i:s'));

        $last = ops_setting('sched_last_run');
        $gap  = $last ? (time() - strtotime($last)) / 60 : null;
        if ($gap !== null && $gap > SCHED_STALE_MIN) {
            ops_error('SCHEDULER_DOWN', 'critical',
                sprintf('No scheduler run for %d minutes. Renewal reminders and queued email are stopped.', round($gap)),
                ['route' => 'watchdog']);
        }
    } catch (Throwable $e) { /* never break a page for monitoring */ }
}

/* ------------------------------------------------------------------
   SUBSCRIPTION LIFECYCLE

   Dedupe key is  rem:{user}:{scope}:{expiry_epoch}:{slug}
   The expiry timestamp is in the key on purpose: renewing moves
   plan_expires, which yields a different key, so the new term gets its
   own fresh ladder while the old term's keys stay burned. That is what
   makes "renewed early" and "cron ran twice" both safe, without needing
   to remember which reminders were already sent.
   ------------------------------------------------------------------ */
function sched_subscriptions(&$log) {
    $sent = 0;

    /* --- hub-wide plans on users --- */
    $rows = db()->query(
        "SELECT id, name, email, plan, plan_expires
           FROM users
          WHERE plan IS NOT NULL AND plan <> 'none'
            AND plan_expires IS NOT NULL
            AND plan_expires > DATE_SUB(NOW(), INTERVAL 3 DAY)
            AND plan_expires < DATE_ADD(NOW(), INTERVAL 31 DAY)")->fetchAll();

    foreach ($rows as $u) {
        $sent += sched_ladder_for($u['id'], 'hub', $u['email'], $u['name'],
                                  $u['plan'], $u['plan_expires']);
    }
    $log['users_in_window'] = count($rows);

    /* --- per-tool plans on tool_credits --- */
    $rows = db()->query(
        "SELECT tc.user_id, tc.tool, tc.plan, tc.plan_expires, u.email, u.name
           FROM tool_credits tc
           JOIN users u ON u.id = tc.user_id
          WHERE tc.plan IS NOT NULL AND tc.plan <> 'none'
            AND tc.plan_expires IS NOT NULL
            AND tc.plan_expires > DATE_SUB(NOW(), INTERVAL 3 DAY)
            AND tc.plan_expires < DATE_ADD(NOW(), INTERVAL 31 DAY)")->fetchAll();

    foreach ($rows as $r) {
        $sent += sched_ladder_for($r['user_id'], 'tool:' . $r['tool'], $r['email'], $r['name'],
                                  $r['plan'], $r['plan_expires']);
    }
    $log['tool_plans_in_window'] = count($rows);
    $log['reminders_queued'] = $sent;
    return $sent;
}

/** Queue whichever rung of the ladder this subscription has reached. */
function sched_ladder_for($userId, $scope, $email, $name, $plan, $expiresAt) {
    if (!$email) return 0;
    $exp   = strtotime($expiresAt);
    $left  = ($exp - time()) / 86400;
    $base  = 'rem:' . $userId . ':' . $scope . ':' . $exp . ':';
    $queued = 0;

    $vars = [
        'name'        => $name ?: 'there',
        'email'       => $email,
        'plan'        => $plan,
        'expiry_date' => date('j M Y', $exp),
        'days_left'   => max(0, (int)ceil($left)),
        'renew_url'   => ops_setting('renew_url',  'https://account.7by.in/#plans'),
        'upgrade_url' => ops_setting('upgrade_url','https://account.7by.in/#plans'),
        'dashboard_url' => ops_setting('dashboard_url', 'https://account.7by.in/'),
    ];

    if ($left > 0) {
        /* Every rung at or below the days remaining has been "crossed".
           In steady state that is just the new one, because the earlier
           ones were sent on earlier ticks and their keys are spent.

           But on the FIRST run against an existing database — or after a
           scheduler outage — a customer sitting at 2 days has crossed 30,
           15, 5 and 3 all at once. Sending all four would put four emails
           in their inbox in the same second, which is how a launch turns
           into a complaint. So: send only the most urgent crossed rung,
           and BURN the ones it overtook — claiming their dedupe keys
           without delivering, so they can never fire later either. */
        $crossed = [];
        foreach (SCHED_LADDER as $slug => $days) {
            if ($left <= $days) $crossed[] = $slug;
        }
        $urgent = array_pop($crossed);          // ladder is ordered 30 → 1
        foreach ($crossed as $slug) {           // overtaken: retire silently
            ops_mail('billing', $email, $slug, $vars,
                     ['dedupe' => $base . $slug, 'user_id' => $userId, 'burn' => true]);
        }
        if ($urgent) {
            $id = ops_mail('billing', $email, $urgent, $vars,
                           ['dedupe' => $base . $urgent, 'user_id' => $userId, 'name' => $name]);
            if ($id) $queued++;
        }
    } else {
        $id = ops_mail('billing', $email, 'expired', $vars,
                       ['dedupe' => $base . 'expired', 'user_id' => $userId, 'name' => $name]);
        if ($id) $queued++;
    }
    return $queued;
}

/* ------------------------------------------------------------------
   RENEWAL / PAYMENT HOOKS — called by the payment code in slice 3.
   Exposed here so the lifecycle lives in one file.
   ------------------------------------------------------------------ */

/** Call after a successful renewal. Kills the old term's pending
 *  reminders so a stale "you expire tomorrow" can never land after the
 *  customer has already paid. */
function ops_on_renewal($userId, $email, $name, $plan, $newExpiry, $orderId = null, $amount = null) {
    $cancelled = ops_mail_cancel($userId, 'expiry_%') + ops_mail_cancel($userId, 'expired');

    ops_mail('billing', $email, 'renewal_success', [
        'name' => $name ?: 'there', 'plan' => $plan,
        'amount' => $amount ?: '', 'order_id' => $orderId ?: '',
        'expiry_date' => date('j M Y', strtotime($newExpiry)),
        'dashboard_url' => ops_setting('dashboard_url', 'https://account.7by.in/'),
    ], ['dedupe' => 'renewal:' . $userId . ':' . strtotime($newExpiry), 'user_id' => $userId]);

    ops_notify('user', $userId, 'renewal', 'Your plan is renewed',
               'Active until ' . date('j M Y', strtotime($newExpiry)));
    ops_audit('system', 'renewal', 'user#' . $userId,
              $plan . ' until ' . $newExpiry . ' (cancelled ' . $cancelled . ' pending reminder(s))');
    return $cancelled;
}

/** Call when a payment attempt fails. */
function ops_on_payment_failed($userId, $email, $name, $plan, $reason, $orderId = null) {
    ops_mail('billing', $email, 'payment_failed', [
        'name' => $name ?: 'there', 'plan' => $plan, 'reason' => $reason,
        'order_id' => $orderId ?: '',
        'renew_url' => ops_setting('renew_url', 'https://account.7by.in/#plans'),
    ], ['dedupe' => 'payfail:' . $userId . ':' . ($orderId ?: date('Ymd')), 'user_id' => $userId]);

    ops_error('PAYMENT_FAILED', 'medium', 'Payment failed for user#' . $userId . ': ' . $reason,
              ['route' => 'payment', 'user_id' => $userId, 'user_email' => $email]);
}

/* ------------------------------------------------------------------
   MAIN TICK
   ------------------------------------------------------------------ */
function sched_run() {
    $t0  = microtime(true);
    $log = [];

    if (!sched_lock()) {
        echo "another run holds the lock — exiting\n";
        return 0;
    }

    try {
        ops_migrate();
        sched_heartbeat_check();

        sched_subscriptions($log);
        $mail = ops_mail_flush(50);
        $log['emails_sent']   = $mail['sent'];
        $log['emails_failed'] = $mail['failed'];
        $log['ms'] = (int)round((microtime(true) - $t0) * 1000);
        $log['ok'] = true;

    } catch (Throwable $e) {
        $log['ok'] = false;
        $log['error'] = $e->getMessage();
        ops_error('SCHEDULER_FAILED', 'critical', 'Scheduler tick threw: ' . $e->getMessage(),
                  ['route' => 'cron/ops-scheduler', 'detail' => $e->getTraceAsString()]);
    } finally {
        // heartbeat is written even on failure — a crashing scheduler is
        // running, and should be reported as broken rather than missing
        sched_heartbeat_write($log);
        db()->prepare('INSERT INTO scheduler_runs (started_at, duration_ms, ok, summary)
                       VALUES (?,?,?,?)')
            ->execute([date('Y-m-d H:i:s', (int)$t0), $log['ms'] ?? 0,
                       !empty($log['ok']) ? 1 : 0, json_encode($log)]);
        sched_unlock();
    }

    echo json_encode($log, JSON_PRETTY_PRINT), "\n";
    return empty($log['ok']) ? 1 : 0;
}

if (PHP_SAPI === 'cli' && empty($GLOBALS['OPS_SCHED_EMBED'])) {
    exit(sched_run());
}
