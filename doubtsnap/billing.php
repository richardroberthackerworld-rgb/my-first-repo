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
    // NOTE: ?? does not catch an EMPTY string, and an unusable dir would silently
    // disable credit tracking (= free unlimited AI for everyone). Always fall back.
    $dir = trim((string)($CFG['billing_dir'] ?? ''));
    if ($dir === '') $dir = sys_get_temp_dir() . '/7by-billing';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    if (is_dir($dir) && is_writable($dir)) return $dir;
    $fb = sys_get_temp_dir() . '/7by-billing';        // configured dir is broken → use temp
    if (!is_dir($fb)) @mkdir($fb, 0700, true);
    return (is_dir($fb) && is_writable($fb)) ? $fb : null;
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
// free CREDITS per device per day (50 by default). credits, not calls.
function bill_free_limit(array $CFG, string $app): int {
    $per = $CFG['free_per_day'] ?? [];
    return (int)($per[$app] ?? $CFG['free_per_day_default'] ?? 50);
}
// credits one AI action costs (10 by default) — same for solve, paper, hint, each follow-up.
function bill_cost(array $CFG): int {
    return max(1, (int)($CFG['credits_per_call'] ?? 10));
}
/* The "big" models are expensive and have small free quotas. Free-tier users can only
   use the cheap/basic models; a hard question that routes to a big model needs Premium. */
function bill_is_premium_model(string $model): bool {
    return (bool)preg_match(
        '/gemini-2\.5-pro|deepseek|phi-4|nemotron-3-ultra|nemotron-3-super|tencent\/hy3|gpt-oss-120b|gpt-4o|llama-3\.3-70b-instruct/i',
        $model
    );
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

/* ============================================================
   ACCOUNT HUB (account.7by.in) — signed-in students
   ------------------------------------------------------------
   Credits then live on the ACCOUNT, not the device: pay on your
   phone, keep your credits on the laptop. The tool's server calls
   the hub with the student's API token, so the browser cannot
   fake a balance.
   ============================================================ */
function hub_url(array $CFG): string { return rtrim((string)($CFG['hub_base'] ?? ''), '/'); }
function hub_on(array $CFG): bool { return hub_url($CFG) !== ''; }

function hub_call(array $CFG, string $action, string $userToken, array $body = [], string $method = 'POST') {
    $base = hub_url($CFG);
    if ($base === '' || $userToken === '') return null;
    $url = $base . '/api.php?action=' . rawurlencode($action);
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Authorization: Bearer ' . $userToken],
    ];
    if ($method === 'POST') { $opts[CURLOPT_POST] = true; $opts[CURLOPT_POSTFIELDS] = json_encode($body); }
    curl_setopt_array($ch, $opts);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $j = json_decode((string)$resp, true);
    return is_array($j) ? ['code' => $code, 'body' => $j] : null;
}

/* Who is this student, per the hub? null when signed out / hub off. */
function hub_me(array $CFG, string $userToken): ?array {
    $r = hub_call($CFG, 'me', $userToken, [], 'GET');
    if (!$r || empty($r['body']['authed'])) return null;
    return $r['body']['user'] ?? null;
}

/* Spend 1 hub credit — called ONLY after the AI actually answered, so a failed
   call never costs the student anything and no refund path is needed (the hub's
   consume clamps count to >= 1, so a "negative refund" would charge again). */
function hub_spend(array $CFG, string $app, string $userToken): array {
    $r = hub_call($CFG, 'consume', $userToken, ['count' => bill_cost($CFG), 'product' => $app]);
    if (!$r) return [false, 'hub_unreachable'];
    if (!empty($r['body']['ok'])) return [true, (int)($r['body']['credits'] ?? 0)];
    return [false, (string)($r['body']['error'] ?? 'hub_error')];
}

/* ---------- spend credits for one action. Returns [ok, status_or_reason] ----------
   $premium = this request routes to a big/expensive model.
   Paid credits are used first; otherwise the daily free allowance — but the free
   allowance may only buy BASIC calls, so a premium call by a free user is refused. */
function bill_charge(array $CFG, string $app, string $token, bool $premium = false): array {
    if (!empty($CFG['billing_off'])) return [true, ['plan' => 'off', 'credits' => 0, 'free_left' => 999, 'free_limit' => 999, 'paid' => true]];
    $cost = bill_cost($CFG);

    $pass = $token ? bill_read_pass($CFG, $token) : null;
    if ($pass && ($pass['app'] ?? '') === $app) {
        $live = empty($pass['expires']) || $pass['expires'] >= time();
        if ($live && (int)($pass['credits'] ?? 0) >= $cost) {
            $pass['credits'] = (int)$pass['credits'] - $cost;   // paid credits work for basic AND premium
            $pass['used']    = (int)($pass['used'] ?? 0) + $cost;
            bill_write_pass($CFG, $token, $pass);
            return [true, bill_status($CFG, $app, $token)];
        }
    }
    // free daily allowance — cheap models only
    if ($premium) return [false, ['reason' => 'premium'] + bill_status($CFG, $app, $token)];
    $limit = bill_free_limit($CFG, $app);
    $used  = bill_free_used($CFG, $app);
    if ($used + $cost > $limit) return [false, ['reason' => 'no_credits'] + bill_status($CFG, $app, $token)];
    $f = bill_free_file($CFG, $app);
    if ($f) @file_put_contents($f, (string)($used + $cost), LOCK_EX);
    if (mt_rand(1, 50) === 1) {   // sweep yesterday's counters
        foreach ((array)@glob(bill_dir($CFG) . '/free_*.txt') as $g) if (@filemtime($g) < time() - 172800) @unlink($g);
    }
    return [true, bill_status($CFG, $app, $token)];
}

/* ---------- can this visitor afford ONE action? (no spend) ----------
   Used to GATE the AI call. The real spend happens in bill_charge only AFTER the
   browser confirms a good answer, so failed / retried AI calls never charge. */
function bill_check(array $CFG, string $app, string $token, bool $premium = false): array {
    if (!empty($CFG['billing_off'])) return [true, ['plan' => 'off', 'credits' => 0, 'free_left' => 999, 'free_limit' => 999, 'paid' => true]];
    $cost = bill_cost($CFG);
    $pass = $token ? bill_read_pass($CFG, $token) : null;
    if ($pass && ($pass['app'] ?? '') === $app) {
        $live = empty($pass['expires']) || $pass['expires'] >= time();
        if ($live && (int)($pass['credits'] ?? 0) >= $cost) return [true, bill_status($CFG, $app, $token)];
    }
    if ($premium) return [false, ['reason' => 'premium'] + bill_status($CFG, $app, $token)];
    $limit = bill_free_limit($CFG, $app);
    $used  = bill_free_used($CFG, $app);
    if ($used + $cost > $limit) return [false, ['reason' => 'no_credits'] + bill_status($CFG, $app, $token)];
    return [true, bill_status($CFG, $app, $token)];
}

/* ---------- give the credits back when the AI failed (never charge for an error) ---------- */
function bill_refund(array $CFG, string $app, string $token): void {
    if (!empty($CFG['billing_off'])) return;
    $cost = bill_cost($CFG);
    $pass = $token ? bill_read_pass($CFG, $token) : null;
    if ($pass && ($pass['app'] ?? '') === $app && (int)($pass['used'] ?? 0) >= $cost) {
        $pass['credits'] = (int)($pass['credits'] ?? 0) + $cost;
        $pass['used']    = (int)$pass['used'] - $cost;
        bill_write_pass($CFG, $token, $pass);
        return;
    }
    $f = bill_free_file($CFG, $app);
    $used = bill_free_used($CFG, $app);
    if ($f && $used >= $cost) @file_put_contents($f, (string)($used - $cost), LOCK_EX);
}

/* ============================================================
   7PAY WIRING
   ------------------------------------------------------------
   1. Buyer clicks a plan → api.php?action=checkout
      → we create a 7Pay order SERVER-SIDE (key_secret never
        touches the browser) and remember order → {app, plan}
      → buyer is sent to 7Pay's hosted checkout
   2. Buyer pays → 7Pay POSTs payment.captured to
      api.php?action=webhook (HMAC-signed) → we issue the pass
   3. 7Pay redirects the buyer to  <site>?paid=<order_id>
      → the page swaps that for the pass token (action=claim)
   ============================================================ */

/* remember what an order was for, so the webhook can't be lied to about the plan */
function bill_pending_file(array $CFG, string $orderId): ?string {
    $dir = bill_dir($CFG);
    return $dir ? $dir . '/pending_' . hash('sha256', $orderId) . '.json' : null;
}

/* Step 1 — create the order on 7Pay and return its checkout URL. */
function bill_checkout(array $CFG, string $app, string $plan, string $returnUrl): array {
    $plans = bill_plans($CFG);
    if (!isset($plans[$plan]))              return ['error' => 'Unknown plan', 'code' => 400];
    if (!in_array($app, bill_apps(), true)) return ['error' => 'Unknown app', 'code' => 400];

    $base   = rtrim((string)($CFG['pay_base'] ?? ''), '/');     // e.g. https://pay.7by.in
    $keyId  = (string)($CFG['pay_key_id'] ?? '');
    $secret = (string)($CFG['pay_key_secret'] ?? '');
    if ($base === '' || $keyId === '' || $secret === '') return ['error' => 'Payments are not configured yet', 'code' => 503];

    $p = $plans[$plan];
    // 7Pay redirects here on success and appends ?sevenpay_order_id=..&sevenpay_payment_id=..&sevenpay_signature=..
    $back = $returnUrl;

    $body = json_encode([
        'action'       => 'order.create',
        'amount'       => (int)$p['amount'],
        'currency'     => 'INR',
        'receipt'      => $app . '-' . $plan . '-' . time(),
        'notes'        => ['app' => $app, 'plan' => $plan],
        'callback_url' => $back,
    ]);
    $ch = curl_init($base . '/api.php?action=order.create');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_USERPWD        => $keyId . ':' . $secret,   // 7Pay uses HTTP Basic
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
    ]);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $j = json_decode((string)$resp, true);
    if ($code !== 200 || empty($j['id'])) {
        return ['error' => 'Could not start checkout: ' . (($j['error'] ?? '') ?: ('HTTP ' . $code)), 'code' => 502];
    }
    $orderId = (string)$j['id'];

    // Remember the plan for THIS order. The webhook trusts this, not its own input,
    // so nobody can pay ₹20 and claim the ₹99 plan.
    $pf = bill_pending_file($CFG, $orderId);
    if ($pf) @file_put_contents($pf, json_encode(['app' => $app, 'plan' => $plan, 'amount' => (int)$p['amount'], 'created' => time()]), LOCK_EX);

    return [
        'order_id'     => $orderId,
        'checkout_url' => $base . '/checkout.php?order_id=' . rawurlencode($orderId) . '&key_id=' . rawurlencode($keyId)
                        . '&description=' . rawurlencode(($CFG['app_label'] ?? '7By') . ' — ' . $p['label']),
    ];
}

/* Step 2 — 7Pay calls this when a payment is captured. Signature-verified. */
function bill_webhook(array $CFG, string $raw, string $sigHeader): array {
    $wsecret = (string)($CFG['pay_webhook_secret'] ?? '');
    if ($wsecret === '') return ['error' => 'Webhook secret not set', 'code' => 503];
    // 7Pay signs the whole body with the merchant's webhook_secret
    $expect = hash_hmac('sha256', $raw, $wsecret);
    if (!hash_equals($expect, $sigHeader)) return ['error' => 'Bad signature', 'code' => 403];

    $e = json_decode($raw, true);
    if (!is_array($e)) return ['error' => 'Bad JSON', 'code' => 400];
    if (($e['event'] ?? '') !== 'payment.captured') return ['ok' => true, 'ignored' => $e['event'] ?? ''];

    $pay = $e['payload']['payment']['entity'] ?? [];
    $orderId = (string)($pay['order_id'] ?? '');
    if ($orderId === '') return ['error' => 'No order_id', 'code' => 400];

    // what was this order for? (our own record — not attacker-supplied)
    $pf = bill_pending_file($CFG, $orderId);
    $pending = ($pf && is_file($pf)) ? json_decode((string)@file_get_contents($pf), true) : null;
    if (!is_array($pending)) return ['error' => 'Unknown order', 'code' => 404];

    // amount actually paid must match the plan's price
    if ((int)($pay['amount'] ?? 0) < (int)($pending['amount'] ?? 0)) return ['error' => 'Amount mismatch', 'code' => 400];

    $r = bill_issue($CFG, (string)$pending['app'], (string)$pending['plan'], $orderId, (string)($pay['email'] ?? ''));
    return isset($r['error']) ? $r : ['ok' => true, 'token' => $r['token']];
}

/* shared by the webhook and the manual activate hook */
function bill_issue(array $CFG, string $app, string $plan, string $order, string $email = ''): array {
    $plans = bill_plans($CFG);
    $order = preg_replace('/[^A-Za-z0-9_\-]/', '', $order);
    if (!in_array($app, bill_apps(), true)) return ['error' => 'Bad app', 'code' => 400];
    if (!isset($plans[$plan]))              return ['error' => 'Bad plan', 'code' => 400];
    if ($order === '')                      return ['error' => 'Bad order', 'code' => 400];
    $dir = bill_dir($CFG);
    if (!$dir) return ['error' => 'Storage unavailable', 'code' => 500];

    // same order twice (webhook retry) → same token, never double-credit
    $orderFile = $dir . '/order_' . hash('sha256', $order) . '.txt';
    if (is_file($orderFile)) return ['token' => trim((string)@file_get_contents($orderFile)), 'reused' => true];

    $token = bin2hex(random_bytes(24));
    $p = $plans[$plan];
    bill_write_pass($CFG, $token, [
        'app' => $app, 'plan' => $plan,
        'credits' => (int)$p['credits'],
        'expires' => time() + ((int)$p['days'] * 86400),
        'email' => substr($email, 0, 120), 'order' => $order, 'created' => time(),
    ]);
    @file_put_contents($orderFile, $token, LOCK_EX);
    return ['token' => $token];
}

/* ---------- manual/legacy hook: POST api.php?action=activate ----------
     { secret, order_id, app, plan, email }
   → { token }  (use only if you are NOT using the 7Pay webhook) */
function bill_activate(array $CFG, array $req): array {
    $secret = (string)($CFG['billing_secret'] ?? '');
    if ($secret === '' || !hash_equals($secret, (string)($req['secret'] ?? ''))) return ['error' => 'Bad secret', 'code' => 403];
    return bill_issue($CFG, (string)($req['app'] ?? ''), (string)($req['plan'] ?? ''),
                      (string)($req['order_id'] ?? ''), (string)($req['email'] ?? ''));
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
