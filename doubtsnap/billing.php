<?php
/* ============================================================
   7By BILLING  —  free tier, credits, subscriptions.
   ------------------------------------------------------------
   Enforced SERVER-SIDE (from api.php). The browser can never
   grant itself credits: it only holds an opaque pass token, and
   every balance decision is made here on the server.

   MODEL
     - Free      : a few credits per DAY per device (resets daily)
     - Subscribed: ₹99/month → a monthly credit allowance
     - Top-up    : one-time credit packs
   Credits are used (not "unlimited") so a single heavy user can
   never drain your whole API quota.

   7Solve and 7Q bill SEPARATELY — a pass is tied to one app.

   Data lives in a JSON file per pass. No database needed.
   ============================================================ */
declare(strict_types=1);

/* ---------- plans (prices in paise: 9900 = ₹99) ---------- */
function bill_plans(array $CFG): array {
    return $CFG['plans'] ?? [
        'monthly'  => ['label' => 'Monthly',      'amount' => 9900, 'credits' => 500, 'days' => 30],
        'pack_50'  => ['label' => '50 credits',   'amount' => 2000, 'credits' => 50,  'days' => 365],
        'pack_150' => ['label' => '150 credits',  'amount' => 4900, 'credits' => 150, 'days' => 365],
    ];
}
function bill_apps(): array { return ['7q', '7solve']; }

function bill_dir(array $CFG): ?string {
    $dir = $CFG['billing_dir'] ?? (sys_get_temp_dir() . '/7by-billing');
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return is_dir($dir) ? $dir : null;
}
function bill_pass_file(array $CFG, string $token): ?string {
    $dir = bill_dir($CFG);
    if (!$dir || !preg_match('/^[a-f0-9]{32,64}$/', $token)) return null;
    return $dir . '/pass_' . $token . '.json';
}
function bill_read_pass(array $CFG, string $token): ?array {
    $f = bill_pass_file($CFG, $token);
    if (!$f || !is_file($f)) return null;
    $d = json_decode((string)@file_get_contents($f), true);
    return is_array($d) ? $d : null;
}
function bill_write_pass(array $CFG, string $token, array $data): void {
    $f = bill_pass_file($CFG, $token);
    if ($f) @file_put_contents($f, json_encode($data), LOCK_EX);
}

/* ---------- free tier: N credits per device per day ---------- */
function bill_device_id(): string {
    $ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '0';
    return hash('sha256', $ip);
}
function bill_free_file(array $CFG, string $app): ?string {
    $dir = bill_dir($CFG);
    return $dir ? $dir . '/free_' . $app . '_' . bill_device_id() . '_' . date('Ymd') . '.txt' : null;
}
function bill_free_used(array $CFG, string $app): int {
    $f = bill_free_file($CFG, $app);
    return ($f && is_file($f)) ? (int)@file_get_contents($f) : 0;
}
function bill_free_limit(array $CFG, string $app): int {
    $per = $CFG['free_per_day'] ?? [];
    return (int)($per[$app] ?? $CFG['free_per_day_default'] ?? 5);
}

/* ---------- what does this visitor currently have? ---------- */
function bill_status(array $CFG, string $app, string $token): array {
    $limit = bill_free_limit($CFG, $app);
    $used  = bill_free_used($CFG, $app);
    $free  = max(0, $limit - $used);

    $pass = $token ? bill_read_pass($CFG, $token) : null;
    if ($pass && ($pass['app'] ?? '') === $app) {
        $expired = !empty($pass['expires']) && $pass['expires'] < time();
        $credits = max(0, (int)($pass['credits'] ?? 0));
        return [
            'plan'       => $expired ? 'expired' : ($pass['plan'] ?? 'paid'),
            'credits'    => $expired ? 0 : $credits,
            'expires'    => (int)($pass['expires'] ?? 0),
            'free_left'  => $free,
            'free_limit' => $limit,
            'paid'       => !$expired && $credits > 0,
        ];
    }
    return ['plan' => 'free', 'credits' => 0, 'expires' => 0,
            'free_left' => $free, 'free_limit' => $limit, 'paid' => false];
}

/* ---------- spend one credit. Returns [ok, status] ----------
   Paid credits are used first; otherwise the daily free allowance. */
function bill_charge(array $CFG, string $app, string $token): array {
    if (!empty($CFG['billing_off'])) return [true, ['plan' => 'off', 'credits' => 0, 'free_left' => 999, 'free_limit' => 999, 'paid' => true]];

    $pass = $token ? bill_read_pass($CFG, $token) : null;
    if ($pass && ($pass['app'] ?? '') === $app) {
        $live = empty($pass['expires']) || $pass['expires'] >= time();
        if ($live && (int)($pass['credits'] ?? 0) > 0) {
            $pass['credits'] = (int)$pass['credits'] - 1;
            $pass['used']    = (int)($pass['used'] ?? 0) + 1;
            bill_write_pass($CFG, $token, $pass);
            return [true, bill_status($CFG, $app, $token)];
        }
    }
    // fall back to the free daily allowance
    $limit = bill_free_limit($CFG, $app);
    $used  = bill_free_used($CFG, $app);
    if ($used >= $limit) return [false, bill_status($CFG, $app, $token)];
    $f = bill_free_file($CFG, $app);
    if ($f) @file_put_contents($f, (string)($used + 1), LOCK_EX);
    if (mt_rand(1, 50) === 1) {   // sweep yesterday's counters
        foreach ((array)@glob(bill_dir($CFG) . '/free_*.txt') as $g) if (@filemtime($g) < time() - 172800) @unlink($g);
    }
    return [true, bill_status($CFG, $app, $token)];
}

/* ---------- give the credit back when the AI failed (never charge for an error) ---------- */
function bill_refund(array $CFG, string $app, string $token): void {
    if (!empty($CFG['billing_off'])) return;
    $pass = $token ? bill_read_pass($CFG, $token) : null;
    if ($pass && ($pass['app'] ?? '') === $app && (int)($pass['used'] ?? 0) > 0) {
        $pass['credits'] = (int)($pass['credits'] ?? 0) + 1;
        $pass['used']    = (int)$pass['used'] - 1;
        bill_write_pass($CFG, $token, $pass);
        return;
    }
    $f = bill_free_file($CFG, $app);
    $used = bill_free_used($CFG, $app);
    if ($f && $used > 0) @file_put_contents($f, (string)($used - 1), LOCK_EX);
}

/* ---------- called by your 7Pay webhook after a real payment ----------
   POST api.php?action=activate
     { secret, order_id, app, plan, email }
   → { token }  (7Pay then redirects the buyer back with ?paid=order_id) */
function bill_activate(array $CFG, array $req): array {
    $secret = (string)($CFG['billing_secret'] ?? '');
    if ($secret === '' || !hash_equals($secret, (string)($req['secret'] ?? ''))) return ['error' => 'Bad secret', 'code' => 403];

    $app  = (string)($req['app'] ?? '');
    $plan = (string)($req['plan'] ?? '');
    $order = preg_replace('/[^A-Za-z0-9_\-]/', '', (string)($req['order_id'] ?? ''));
    $plans = bill_plans($CFG);
    if (!in_array($app, bill_apps(), true)) return ['error' => 'Bad app', 'code' => 400];
    if (!isset($plans[$plan]))              return ['error' => 'Bad plan', 'code' => 400];
    if ($order === '')                      return ['error' => 'Bad order', 'code' => 400];

    $dir = bill_dir($CFG);
    if (!$dir) return ['error' => 'Storage unavailable', 'code' => 500];

    // same order twice (webhook retry) → return the same token, never double-credit
    $orderFile = $dir . '/order_' . hash('sha256', $order) . '.txt';
    if (is_file($orderFile)) {
        $tok = trim((string)@file_get_contents($orderFile));
        return ['token' => $tok, 'reused' => true];
    }

    $token = bin2hex(random_bytes(24));
    $p = $plans[$plan];
    bill_write_pass($CFG, $token, [
        'app'     => $app,
        'plan'    => $plan,
        'credits' => (int)$p['credits'],
        'expires' => time() + ((int)$p['days'] * 86400),
        'email'   => substr((string)($req['email'] ?? ''), 0, 120),
        'order'   => $order,
        'created' => time(),
    ]);
    @file_put_contents($orderFile, $token, LOCK_EX);
    return ['token' => $token];
}

/* ---------- buyer returns from 7Pay: swap order id for their token ---------- */
function bill_claim(array $CFG, string $order): array {
    $order = preg_replace('/[^A-Za-z0-9_\-]/', '', $order);
    $dir = bill_dir($CFG);
    if (!$dir || $order === '') return ['error' => 'Bad order', 'code' => 400];
    $f = $dir . '/order_' . hash('sha256', $order) . '.txt';
    if (!is_file($f)) return ['error' => 'Payment not confirmed yet', 'code' => 404];
    return ['token' => trim((string)@file_get_contents($f))];
}
