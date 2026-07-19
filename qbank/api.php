<?php
/* ============================================================
   7By AI PROXY  —  keeps your API keys on the SERVER.
   ------------------------------------------------------------
   The browser calls THIS file; this file calls the AI provider
   using keys from keys.php. Keys are never sent to the browser
   and never appear in page source.

   SETUP (2 minutes):
     1. Copy keys.example.php  →  keys.php
     2. Paste your API keys into keys.php
     3. In config.js set:  proxy: "api.php"
     4. Blank out the keys in config.js — they're not needed there any more.

   Requires PHP 7.0+ with cURL (standard on every cPanel host).
   ============================================================ */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function out(int $code, array $body): void { http_response_code($code); echo json_encode($body); exit; }

$cfgFile = __DIR__ . '/keys.php';
if (!is_file($cfgFile)) out(500, ['error' => ['message' => 'Proxy not configured: copy keys.example.php to keys.php and add your keys.']]);
$CFG = require $cfgFile;
require_once __DIR__ . '/billing.php';

/* which app is billing this request (7Solve and 7Q bill separately) */
$APP = $CFG['app'] ?? '7q';

/* ---------- where each provider lives (fixed — never built from user input) ---------- */
$ENDPOINTS = [
    'gemini'     => 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    'groq'       => 'https://api.groq.com/openai/v1/chat/completions',
    'cerebras'   => 'https://api.cerebras.ai/v1/chat/completions',
    'openrouter' => 'https://openrouter.ai/api/v1/chat/completions',
    'mistral'    => 'https://api.mistral.ai/v1/chat/completions',
    'github'     => 'https://models.github.ai/inference/chat/completions',
];
/* model names must match these — stops anyone injecting a URL or calling a paid model */
$MODEL_OK = [
    'gemini'     => '/^gemini-[a-z0-9.\-]+$/i',
    'groq'       => '/^[a-z0-9.\-]+$/i',
    'cerebras'   => '/^[a-z0-9.\-]+$/i',
    'openrouter' => '/^[a-z0-9.\-]+\/[a-z0-9.\-]+(:free)?$/i',
    'mistral'    => '/^[a-z0-9.\-]+$/i',
    'github'     => '/^[a-z0-9.\-]+\/[a-z0-9.\-]+$/i',
];

/* ---------- normalise configured keys: one string, "a,b", or ['a','b'] ---------- */
function keys_for(array $CFG, string $provider): array {
    $raw = $CFG['keys'][$provider] ?? '';
    $list = is_array($raw) ? $raw : preg_split('/[,\n]/', (string)$raw);
    return array_values(array_filter(array_map('trim', $list), fn($k) => $k !== ''));
}

/* ---------- only our own pages may use this proxy ---------- */
function origin_allowed(array $CFG): bool {
    $allow = $CFG['allow_origins'] ?? [];
    if (in_array('*', $allow, true)) return true;
    $src = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';
    if ($src === '') return (bool)($CFG['allow_missing_origin'] ?? false); // some in-app browsers omit it
    $host = parse_url($src, PHP_URL_HOST) ?: '';
    foreach ($allow as $a) {
        $ah = parse_url((strpos($a, '//') === false ? 'https://' . $a : $a), PHP_URL_HOST) ?: $a;
        if (strcasecmp($host, $ah) === 0) return true;
    }
    return false;
}

/* ---------- answer cache ----------------------------------------------------
   Hundreds of students ask the same topics ("plant cell", "quadratic equations").
   Caching the AI's reply means the 2nd..500th student is served instantly and
   costs ZERO quota. Keyed by the exact request, so a different subject/topic/
   language/settings never collides. Photo requests are never cached (each photo
   is unique, and it keeps students' uploads off the disk).                     */
function cache_dir(array $CFG): ?string {
    if (!($CFG['cache_hours'] ?? 168)) return null;
    // ?? misses an empty string; a broken dir would just disable caching (costly, not unsafe)
    $dir = trim((string)($CFG['cache_dir'] ?? ''));
    if ($dir === '') $dir = sys_get_temp_dir() . '/7by-cache';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return (is_dir($dir) && is_writable($dir)) ? $dir : null;
}
function has_image(array $payload): bool {
    $j = json_encode($payload);
    return strpos($j, 'inline_data') !== false || strpos($j, 'image_url') !== false;
}
function cache_get(?string $dir, string $k, int $hours): ?string {
    if (!$dir) return null;
    $f = $dir . '/' . $k . '.json';
    if (!is_file($f) || @filemtime($f) < time() - $hours * 3600) return null;
    $v = @file_get_contents($f);
    return ($v === false || $v === '') ? null : $v;
}
function cache_put(?string $dir, string $k, string $body): void {
    if (!$dir) return;
    @file_put_contents($dir . '/' . $k . '.json', $body, LOCK_EX);
    if (mt_rand(1, 100) === 1) {   // occasional sweep of expired entries
        foreach ((array)@glob($dir . '/*.json') as $f) if (@filemtime($f) < time() - 30 * 86400) @unlink($f);
    }
}

/* ---------- simple per-IP hourly cap so nobody drains your quota ---------- */
function rate_ok(array $CFG): bool {
    $limit = (int)($CFG['rate_per_hour'] ?? 60);
    if ($limit <= 0) return true;
    $dir = trim((string)($CFG['rate_dir'] ?? ''));      // ?? misses an empty string
    if ($dir === '') $dir = sys_get_temp_dir() . '/7by-rl';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    if (!is_dir($dir) || !is_writable($dir)) return true; // can't track → don't block real users
    $ip   = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? '0';
    $file = $dir . '/' . hash('sha256', $ip . date('YmdH')) . '.txt';
    $n = (int)@file_get_contents($file);
    if ($n >= $limit) return false;
    @file_put_contents($file, (string)($n + 1), LOCK_EX);
    if (mt_rand(1, 50) === 1) { // occasional sweep of old counters
        foreach ((array)@glob($dir . '/*.txt') as $f) if (@filemtime($f) < time() - 7200) @unlink($f);
    }
    return true;
}

$action = $_GET['action'] ?? '';
$passTok = preg_replace('/[^a-f0-9]/', '', (string)($_SERVER['HTTP_X_7BY_PASS'] ?? $_GET['pass'] ?? ''));
// signed-in student: account.7by.in API token (credits live on the ACCOUNT, any device)
$hubTok  = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($_SERVER['HTTP_X_7BY_HUB'] ?? ''));

/* ---------- GET ?action=providers → which engines the site may offer ---------- */
if ($action === 'providers') {
    if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
    $on = [];
    foreach (array_keys($ENDPOINTS) as $p) if (keys_for($CFG, $p)) $on[] = $p;
    out(200, ['providers' => $on]);
}

/* ---------- GET ?action=me → this visitor's plan / credits / free left ---------- */
if ($action === 'me') {
    if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
    $st = bill_status($CFG, $APP, $passTok);
    $st['plans'] = bill_plans($CFG);
    $st['app']   = $APP;
    $st['pay_ready'] = !empty($CFG['pay_base']) && !empty($CFG['pay_key_id']) && !empty($CFG['pay_key_secret']);
    $st['hub']       = hub_url($CFG);          // '' = accounts switched off
    $st['hub_google']= $CFG['hub_google_client_id'] ?? '';
    // signed in? then the account's credits are what count
    if (hub_on($CFG) && $hubTok !== '') {
        $me = hub_me($CFG, $hubTok);
        if ($me) {
            $st['signed_in'] = true;
            $st['user']      = ['name' => $me['name'] ?? '', 'email' => $me['email'] ?? ''];
            $st['credits']   = (int)($me['credits'] ?? 0);
            $st['plan']      = $me['plan'] ?? 'none';
            $st['paid']      = (int)($me['credits'] ?? 0) > 0;
        } else {
            $st['signed_in'] = false;          // token expired/invalid → treat as guest
            $st['stale_token'] = true;
        }
    } else {
        $st['signed_in'] = false;
    }
    out(200, $st);
}

/* ---------- POST ?action=checkout → create a 7Pay order, return its checkout URL ---------- */
if ($action === 'checkout') {
    if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
    $req = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $ret = (string)($req['return'] ?? '');
    // only ever send buyers back to our own site
    $retHost = parse_url($ret, PHP_URL_HOST) ?: '';
    $okHost = false;
    foreach (($CFG['allow_origins'] ?? []) as $a) {
        $ah = parse_url((strpos($a, '//') === false ? 'https://' . $a : $a), PHP_URL_HOST) ?: $a;
        if (strcasecmp($retHost, $ah) === 0) { $okHost = true; break; }
    }
    if (!$okHost) out(400, ['error' => ['message' => 'Bad return url']]);
    $r = bill_checkout($CFG, $APP, (string)($req['plan'] ?? ''), $ret);
    if (isset($r['error'])) out((int)$r['code'], ['error' => ['message' => $r['error']]]);
    out(200, $r);
}

/* ---------- POST ?action=webhook → 7Pay tells us a payment was captured ---------- */
if ($action === 'webhook') {
    $raw = (string)file_get_contents('php://input');
    $sig = (string)($_SERVER['HTTP_X_7PAY_SIGNATURE'] ?? '');
    $r = bill_webhook($CFG, $raw, $sig);
    if (isset($r['error'])) out((int)$r['code'], ['error' => ['message' => $r['error']]]);
    out(200, $r);
}

/* ---------- POST ?action=activate → manual hook (only if not using the webhook) ---------- */
if ($action === 'activate') {
    $req = json_decode((string)file_get_contents('php://input'), true) ?: $_POST;
    $r = bill_activate($CFG, is_array($req) ? $req : []);
    if (isset($r['error'])) out((int)$r['code'], ['error' => ['message' => $r['error']]]);
    out(200, $r);
}

/* ---------- GET ?action=claim&order=... → buyer returns from 7Pay, gets their pass ---------- */
if ($action === 'claim') {
    if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
    $r = bill_claim($CFG, (string)($_GET['order'] ?? ''));
    if (isset($r['error'])) out((int)$r['code'], ['error' => ['message' => $r['error']]]);
    out(200, $r);
}

/* ---------- POST ?action=charge → spend for ONE delivered answer ----------
   The browser calls this ONCE, only after it has a validated answer on screen.
   The AI requests themselves no longer charge, so a failed or retried question
   never costs the student a credit (fixes "charged but got no answer"). */
if ($action === 'charge') {
    if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
    if (!empty($CFG['billing_off'])) out(200, ['ok' => true, 'credits' => 0]);
    if (hub_on($CFG) && $hubTok !== '') {
        list($ok, $left) = hub_spend($CFG, $APP, $hubTok);   // signed-in: spend account credits
        out(200, ['ok' => (bool)$ok, 'credits' => is_int($left) ? $left : 0]);
    }
    list($ok, $st) = bill_charge($CFG, $APP, $passTok, false);   // guest: spend the daily free allowance
    out($ok ? 200 : 402, ['ok' => (bool)$ok, 'billing' => is_array($st) ? $st : null]);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(405, ['error' => ['message' => 'POST only']]);
if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
if (!rate_ok($CFG))        out(429, ['error' => ['message' => 'Too many requests from this device — please wait a while and try again.']]);

$rawBody = file_get_contents('php://input') ?: '';
$maxMb = (int)($CFG['max_body_mb'] ?? 12);           // photos are big; 12MB covers 5 images
if (strlen($rawBody) > $maxMb * 1024 * 1024) out(413, ['error' => ['message' => 'Request too large']]);

$req = json_decode($rawBody, true);
if (!is_array($req)) out(400, ['error' => ['message' => 'Bad JSON']]);

$provider = (string)($req['provider'] ?? '');
$model    = (string)($req['model'] ?? '');
$payload  = $req['payload'] ?? null;

if (!isset($ENDPOINTS[$provider]))                    out(400, ['error' => ['message' => 'Unknown provider']]);
if (!is_array($payload))                              out(400, ['error' => ['message' => 'Missing payload']]);
if ($model === '' || strlen($model) > 100 ||
    !preg_match($MODEL_OK[$provider], $model))        out(400, ['error' => ['message' => 'Model not allowed']]);

$keys = keys_for($CFG, $provider);
if (!$keys) out(503, ['error' => ['message' => 'No key configured for ' . $provider]]);

/* ---------- cache key (has this same question been answered before?) ---------- */
$cacheHours = (int)($CFG['cache_hours'] ?? 168);              // 168h = 7 days; 0 disables
$cDir  = cache_dir($CFG);
$cKey  = hash('sha256', $provider . '|' . $model . '|' . json_encode($payload));
$cacheable = $cDir && !has_image($payload);                    // never cache photo questions

/* ---------- billing gate: EVERY answer costs credits (fresh OR cached) --------
   Signed-in student → their ACCOUNT's credits. Guest → the per-device daily
   free allowance. A "premium" request (big/expensive model) is PAID-only.
   A repeat question is served instantly from cache and STILL costs the student
   credits — it just costs US no AI quota (that saving is ours to keep).        */
$premium = bill_is_premium_model($model);
$cost    = bill_cost($CFG);
$hubUser = (hub_on($CFG) && $hubTok !== '') ? hub_me($CFG, $hubTok) : null;
$useHub  = $hubUser !== null;
$billStatus = null;

if (!empty($CFG['billing_off'])) {
    // paywall disabled — everything free
} elseif ($useHub) {
    $bal = (int)($hubUser['credits'] ?? 0);
    if ($bal < $cost) {
        out(402, ['error' => ['message' => 'Out of credits'], 'needsPlan' => true,
                  'billing' => ['signed_in' => true, 'credits' => $bal, 'paid' => false]]);
    }
    header('X-7By-Credits: ' . $bal);
} else {
    // CHECK ONLY — do not spend here. The browser spends once (?action=charge)
    // after it has a good answer, so retries/failures never cost a credit.
    list($okToSpend, $billStatus) = bill_check($CFG, $APP, $passTok, $premium);
    if (!$okToSpend) {
        $isPremium = ($billStatus['reason'] ?? '') === 'premium';
        out(402, [
            'error'       => ['message' => $isPremium ? 'Premium required' : 'Free limit reached'],
            'needsPlan'   => true,
            'needsPremium'=> $isPremium,
            'billing'     => $billStatus,
        ]);
    }
    header('X-7By-Credits: ' . (int)($billStatus['credits'] ?? 0));
    header('X-7By-Free-Left: ' . (int)($billStatus['free_left'] ?? 0));
}

/* ---------- same question already answered? serve it instantly ----------
   No charge here — the browser charges once for the delivered answer, and a
   cache hit costs US no AI quota. */
if ($cacheable) {
    $hit = cache_get($cDir, $cKey, $cacheHours);
    if ($hit !== null) { header('X-7By-Cache: HIT'); echo $hit; exit; }
}

/* ---------- call the provider; rotate keys when one is rate-limited ---------- */
$url  = str_replace('{model}', rawurlencode($model), $ENDPOINTS[$provider]);
$body = json_encode($payload);
$last = ['code' => 502, 'text' => '{"error":{"message":"Upstream failed"}}'];

foreach ($keys as $k) {
    $headers = ['Content-Type: application/json'];
    if ($provider === 'gemini') {
        $headers[] = 'x-goog-api-key: ' . $k;
    } else {
        $headers[] = 'Authorization: Bearer ' . $k;
        if ($provider === 'openrouter') $headers[] = 'X-Title: 7Q';
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => (int)($CFG['timeout'] ?? 120),
        CURLOPT_CONNECTTIMEOUT => 15,
    ]);
    $text = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($text === false) { $last = ['code' => 502, 'text' => json_encode(['error' => ['message' => 'Network error: ' . $cerr]])]; continue; }
    $last = ['code' => $code ?: 502, 'text' => $text];
    if ($code === 429 || $code === 402 || $code === 403) continue;  // key spent → next key
    break;                                                          // success or a real error → return it
}

// did we actually get an answer? (used for caching AND for refunding)
$gotAnswer = false;
if ($last['code'] === 200 && strlen($last['text']) > 40) {
    $probe = json_decode($last['text'], true);
    $text  = ($probe['candidates'][0]['content']['parts'][0]['text'] ?? '')
           . ($probe['choices'][0]['message']['content'] ?? '');
    $gotAnswer = trim($text) !== '';
}
// only cache a genuinely good answer — never an error or an empty reply
if ($cacheable && $gotAnswer) cache_put($cDir, $cKey, $last['text']);

// NOTE: no charge here. The browser calls ?action=charge exactly once after it
// has a validated answer on screen, so failed/retried AI calls cost nothing.

header('X-7By-Cache: MISS');
http_response_code($last['code']);
echo $last['text'];
