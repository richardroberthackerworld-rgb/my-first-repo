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

/* ------------------------------------------------------------------
   A fatal here used to be invisible.

   keys.php is hand-edited on the server, and a single missing bracket in
   it makes PHP stop before this file runs a line — no output, no message,
   just HTTP 500 on EVERY action. The browser then can't parse the reply,
   the app decides nobody is signed in, and the site looks broken with
   nothing anywhere saying why.

   A parse error in an included file cannot be caught with try/catch, but
   it does reach a shutdown handler, so this turns it into JSON naming the
   file and line. Registered BEFORE keys.php is loaded, which is the whole
   point. The message is only echoed for structural errors (parse/compile);
   other fatals report location only, so a value from a config line can
   never be printed to the browser.
   ------------------------------------------------------------------ */
register_shutdown_function(function (): void {
    $e = error_get_last();
    if (!$e) return;
    $fatal = E_ERROR | E_PARSE | E_COMPILE_ERROR | E_CORE_ERROR | E_USER_ERROR;
    if (!($e['type'] & $fatal)) return;
    if (headers_sent()) return;                 // a real response already went out
    $structural = (bool)($e['type'] & (E_PARSE | E_COMPILE_ERROR));
    $where = basename((string)$e['file']) . ' line ' . (int)$e['line'];
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => ['message' => $structural
        ? ('Server config error in ' . $where . ': ' . $e['message'])
        : ('Server error in ' . $where . '. Check the PHP error log for details.'),
        'where' => $where, 'fix' => 'This is a PHP file on your server, not a browser problem.']]);
});

$cfgFile = __DIR__ . '/keys.php';
if (!is_file($cfgFile)) out(500, ['error' => ['message' => 'Proxy not configured: copy keys.example.php to keys.php and add your keys.']]);
$CFG = require $cfgFile;
if (!is_array($CFG)) out(500, ['error' => ['message' =>
    'keys.php did not return a settings array. It must start with "<?php return [" and end with "];".']]);
require_once __DIR__ . '/billing.php';

/* which app is billing this request (7Solve and 7Marks bill separately) */
$APP = $CFG['app'] ?? '7solve';

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

/* ---------- per-IP hourly cap, for ANONYMOUS visitors only ----------
   This exists for one job: stop a passer-by with no account draining the API
   quota. It must never be what stops a student who is signed in.

   A signed-in student is already limited by something real and exact — their
   credits, enforced server-side on every call. Adding an IP cap on top of that
   does not make anything safer, and it breaks the case that matters most: a
   school, a college lab and a hostel all share ONE public IP, so a per-IP cap
   is a cap on the whole building rather than on a person.

   Nor does skipping it open a hole. A forged token does not reach the hub, so
   billing falls through to the per-device daily allowance — a tighter limit
   than this one, not a looser one. Credits are the wall; this is a doormat.

   Signed-in requests are therefore uncapped by default. 'rate_per_hour_signed'
   remains as a knob for an owner who wants a ceiling anyway; 0 = none. */
function rate_ok(array $CFG, bool $signedIn = false): bool {
    $limit = $signedIn
        ? (int)($CFG['rate_per_hour_signed'] ?? 0)   // 0 = no cap; credits decide
        : (int)($CFG['rate_per_hour'] ?? 60);
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

/* ---------- observability (§43) and the quality record (§44/§45) ------------
   Two separate logs, because they answer different questions and carry very
   different data.

   ops.jsonl   — one line per AI request: which model, how long, what code,
                 cache hit or miss, was the caller signed in. NO question text,
                 NO answer text, no token, no key, no IP. It exists to answer
                 "is the service healthy and what is it costing", and none of
                 that needs to know what a student asked.

   quality.jsonl — what students said about answers, plus what the browser's
                 own checker found. A thumbs-up carries no content. A REPORT
                 carries the question, because the student chose to send it and
                 a report you cannot reproduce is not worth storing.

   Both are capped and both fail silently: logging must never be able to break
   an answer a student has paid for.                                          */
function log_dir(array $CFG): ?string {
    $dir = trim((string)($CFG['log_dir'] ?? ''));
    if ($dir === '') $dir = rtrim((string)($CFG['contact_dir'] ?? __DIR__ . '/data'), '/\\');
    if ($dir === '') return null;
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return (is_dir($dir) && is_writable($dir)) ? $dir : null;
}
function log_line(array $CFG, string $file, array $row): void {
    if (empty($CFG['log_on'] ?? true)) return;
    $dir = log_dir($CFG);
    if (!$dir) return;
    $path = $dir . '/' . $file;
    /* Roll at ~8MB so a busy month cannot fill the account's disk quota and
       take the whole site down with it. One generation back is kept. */
    if (@filesize($path) > 8 * 1024 * 1024) { @rename($path, $path . '.1'); }
    @file_put_contents($path, json_encode($row, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
}
/* A per-request id the browser also sees, so a student's screenshot of an
   error can be found in the log without searching by time. */
function request_id(): string {
    static $rid = null;
    if ($rid === null) $rid = bin2hex(random_bytes(6));
    return $rid;
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
/* ---------- sync: the student's study data lives on the account ----------
   Both actions require a hub token and resolve the user id SERVER-SIDE from
   it. A client-supplied user id is never read, so one student can never
   address another's records however the request is crafted. */
if ($action === 'sync.pull' || $action === 'sync.push') {
    require_once __DIR__ . '/sync.php';

    if (!hub_on($CFG)) out(503, ['error' => ['message' => 'Sync is not configured on this server.']]);
    $uid = sync_identify($CFG, $hubTok);
    if ($uid === null) out(401, ['error' => ['message' => 'Sign in to sync your work.'], 'signedOut' => true]);

    if ($action === 'sync.pull') {
        $since = (int)($_GET['since'] ?? 0);
        list($records, $rev) = sync_since($CFG, $uid, $since);
        out(200, ['ok' => true, 'records' => $records, 'rev' => $rev,
                  'now' => (int)(microtime(true) * 1000), 'count' => count($records)]);
    }

    if (!rate_ok($CFG)) out(429, ['error' => ['message' => 'Syncing too fast — try again shortly.']]);
    $raw = file_get_contents('php://input') ?: '[]';
    if (strlen($raw) > 4 * 1024 * 1024) out(413, ['error' => ['message' => 'That sync batch is too large.']]);
    $req = json_decode($raw, true) ?: [];
    $records = (array)($req['records'] ?? []);
    if (count($records) > 500) out(413, ['error' => ['message' => 'Too many records in one batch.']]);

    list($applied, $conflicts, $rev) = sync_merge($CFG, $uid, $records);
    out(200, ['ok' => true, 'applied' => $applied, 'conflicts' => $conflicts,
              'rev' => $rev, 'now' => (int)(microtime(true) * 1000)]);
}

/* ---------- POST ?action=contact → a message from the contact form ----------
   Stored on disk first, then emailed. Storage is what makes it reliable: if
   mail() is disabled or the MTA drops it, the message is still on the server
   rather than silently lost, and the browser is told honestly which happened. */
if ($action === 'contact') {
    if (!rate_ok($CFG)) out(429, ['error' => ['message' => 'Too many messages just now — try again shortly.']]);

    $req  = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
    $name = trim((string)($req['name'] ?? ''));
    $mail = trim((string)($req['email'] ?? ''));
    $subj = trim((string)($req['subject'] ?? 'General'));
    $msg  = trim((string)($req['message'] ?? ''));
    $hp   = trim((string)($req['website'] ?? ''));      // honeypot: humans never fill this

    if ($hp !== '') out(200, ['ok' => true]);           // a bot — accept and discard
    if ($name === '' || mb_strlen($name) > 80)  out(400, ['error' => ['message' => 'Please give your name.']]);
    if (!filter_var($mail, FILTER_VALIDATE_EMAIL))      out(400, ['error' => ['message' => 'That email address does not look right.']]);
    if (mb_strlen($msg) < 10)  out(400, ['error' => ['message' => 'Please say a little more — at least 10 characters.']]);
    if (mb_strlen($msg) > 4000) out(400, ['error' => ['message' => 'That message is too long. Keep it under 4000 characters.']]);
    $allowed = ['General', 'Billing & credits', 'A wrong answer', 'Bug report', 'Partnership'];
    if (!in_array($subj, $allowed, true)) $subj = 'General';

    $row = [
        't'  => gmdate('c'),
        'ip' => substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . ($CFG['app'] ?? '')), 0, 16),
        'name' => $name, 'email' => $mail, 'subject' => $subj, 'message' => $msg,
        'ua' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
    ];
    $stored = false;
    $dir = trim((string)($CFG['contact_dir'] ?? __DIR__ . '/data'));
    if ($dir !== '') {
        if (!is_dir($dir)) @mkdir($dir, 0700, true);
        if (is_dir($dir)) {
            $stored = (bool)@file_put_contents(
                rtrim($dir, '/\\') . '/contact.jsonl',
                json_encode($row, JSON_UNESCAPED_UNICODE) . "\n",
                FILE_APPEND | LOCK_EX
            );
        }
    }

    $sent = false;
    $to = trim((string)($CFG['contact_to'] ?? ''));
    if ($to !== '' && function_exists('mail')) {
        $host = preg_replace('/[^a-z0-9.\-]/i', '', (string)($_SERVER['HTTP_HOST'] ?? '7solve.7by.in'));
        $body = "From: $name <$mail>\nSubject: $subj\nHost: $host\nTime: {$row['t']}\n\n$msg\n";
        $sent = @mail(
            $to,
            '[7Solve] ' . $subj . ' — ' . $name,
            $body,
            "From: 7Solve <no-reply@$host>\r\nReply-To: " . $mail . "\r\n" .
            "Content-Type: text/plain; charset=utf-8\r\nMIME-Version: 1.0"
        );
    }

    if (!$stored && !$sent) {
        out(500, ['error' => ['message' => 'We could not record your message. Please email us directly.']]);
    }
    out(200, ['ok' => true, 'stored' => $stored, 'emailed' => $sent]);
}

/* ---------- POST ?action=quality → what a student thought of an answer ------
   §45: every answer can be rated, and a disputed one becomes the improvement
   dataset. Deliberately NOT treated as ground truth — a thumbs-down is stored
   as an opinion next to what the deterministic checker found, and the two
   disagreeing is itself the interesting signal. */
if ($action === 'quality') {
    if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
    if (!rate_ok($CFG, $hubTok !== '')) out(429, ['error' => ['message' => 'Too much feedback too fast.']]);
    $req = json_decode((string)file_get_contents('php://input'), true) ?: [];

    $vote = (string)($req['vote'] ?? '');
    if (!in_array($vote, ['up', 'down', 'report'], true)) {
        out(400, ['error' => ['message' => 'Unknown vote']]);
    }
    $row = [
        't'      => gmdate('c'),
        'app'    => $APP,
        'vote'   => $vote,
        'rid'    => preg_replace('/[^a-f0-9]/', '', (string)($req['rid'] ?? '')),
        'model'  => substr(preg_replace('/[^A-Za-z0-9.\/\-:]/', '', (string)($req['model'] ?? '')), 0, 80),
        'subject'=> substr((string)($req['subject'] ?? ''), 0, 60),
        'course' => substr((string)($req['course'] ?? ''), 0, 60),
        /* what the browser's own checker concluded — 'checked', 'disputed',
           'worked', 'plain'. A 'disputed' answer that the student then rated
           UP is as worth reading as the reverse. */
        'verify' => substr(preg_replace('/[^a-z]/', '', (string)($req['verify'] ?? '')), 0, 16),
        'failed' => min(20, max(0, (int)($req['failed'] ?? 0))),
        'signed' => $hubTok !== '',
    ];
    /* Only an explicit report carries content, and only what is needed to
       reproduce it. A thumbs-down stores no text at all. */
    if ($vote === 'report') {
        $row['q']      = mb_substr(trim((string)($req['q'] ?? '')), 0, 1200);
        $row['answer'] = mb_substr(trim((string)($req['answer'] ?? '')), 0, 4000);
        $row['note']   = mb_substr(trim((string)($req['note'] ?? '')), 0, 500);
    }
    log_line($CFG, 'quality.jsonl', $row);
    out(200, ['ok' => true]);
}

/* ---------- POST ?action=research → live sources for time-sensitive questions
   ------------------------------------------------------------------------
   §13/§14. A model's training data cannot know this year's exam dates, the
   current holder of an office, or a scheme announced last month, and the worst
   possible behaviour is to answer anyway. This fetches real sources so the
   answer can be built on something, and scores them so the student can see
   WHAT it was built on.

   Two things this deliberately does not do:

     · It never invents a citation. Every source returned here was actually
       fetched, with the HTTP status and the retrieval time recorded. If no
       backend is reachable the reply says so and the app falls back to
       answering from training data WITH that stated — never a fake link.

     · It never fetches a URL the caller chose. The query is user text; the
       URLs come from a search backend, and every one is then put through
       url_safe() before a request is made. Without that this endpoint would be
       an open proxy into the hosting account's private network — the classic
       SSRF, and a real risk on shared hosting where the metadata service and
       the neighbours are one hop away.
   ------------------------------------------------------------------------ */

/* Authority tiers (§14). Primary sources outrank commentary; the tier is shown
   to the student rather than being used to silently pick a winner. */
function source_tier(string $host): array {
    $h = strtolower($host);
    $is = function (string ...$sfx) use ($h): bool {
        foreach ($sfx as $s) {
            if ($h === $s || substr($h, -strlen('.' . $s)) === '.' . $s) return true;
        }
        return false;
    };
    if ($is('gov.in', 'nic.in', 'gov', 'gov.uk', 'europa.eu') || preg_match('/\.gov\./', $h))
        return [1, 'Government'];
    if ($is('ac.in', 'edu', 'ac.uk', 'edu.in') || preg_match('/\.(ac|edu)\./', $h))
        return [2, 'University'];
    if ($is('who.int', 'un.org', 'worldbank.org', 'imf.org', 'oecd.org', 'unesco.org',
            'rbi.org.in', 'sebi.gov.in', 'icai.org', 'icsi.edu', 'nta.ac.in', 'cbse.gov.in',
            'ncert.nic.in', 'upsc.gov.in', 'ssc.gov.in', 'aicte-india.org', 'ugc.gov.in'))
        return [1, 'Official body'];
    if ($is('nature.com', 'science.org', 'nih.gov', 'arxiv.org', 'pubmed.ncbi.nlm.nih.gov', 'doi.org'))
        return [2, 'Research'];
    if ($is('wikipedia.org', 'britannica.com'))
        return [4, 'Encyclopaedia'];
    if ($is('thehindu.com', 'indianexpress.com', 'reuters.com', 'bbc.co.uk', 'bbc.com',
            'pib.gov.in', 'livemint.com', 'business-standard.com', 'timesofindia.indiatimes.com'))
        return [3, 'News'];
    return [5, 'Other'];
}

/* Refuse anything that is not a plain public https URL. Blocks private and
   link-local ranges by resolving the host first, which is what stops a search
   result (or a redirect) from reaching 127.0.0.1 or 169.254.169.254. */
function url_safe(string $url): bool {
    $p = parse_url($url);
    if (!$p || ($p['scheme'] ?? '') !== 'https') return false;
    if (isset($p['port']) && !in_array((int)$p['port'], [443], true)) return false;
    $host = $p['host'] ?? '';
    if ($host === '' || strlen($host) > 190) return false;
    if (!preg_match('/^[a-z0-9.\-]+$/i', $host)) return false;      // no userinfo, no IPv6 literals

    $ips = @gethostbynamel($host);
    if ($ips === false) {
        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : [];
    }
    if (!$ips) return false;
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return false;                                            // private, loopback, link-local
        }
    }
    return true;
}

function research_get(string $url, int $timeout = 8, int $maxBytes = 400000): array {
    if (!url_safe($url)) return ['ok' => false, 'code' => 0, 'body' => '', 'why' => 'blocked'];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 5,
        /* Redirects are NOT followed automatically: a 302 to an internal
           address would walk straight past url_safe(). One hop is handled
           manually below, re-checked. */
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
        CURLOPT_USERAGENT      => '7Solve/1.0 (+https://7solve.7by.in)',
        CURLOPT_HTTPHEADER     => ['Accept: text/html,application/json;q=0.9'],
        CURLOPT_BUFFERSIZE     => 16384,
        CURLOPT_NOPROGRESS     => false,
        CURLOPT_PROGRESSFUNCTION => function ($ch, $dlTotal, $dlNow) use ($maxBytes) {
            return $dlNow > $maxBytes ? 1 : 0;                       // abort an oversized body
        },
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $loc  = (string)curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    curl_close($ch);
    if (in_array($code, [301, 302, 303, 307, 308], true) && $loc !== '' && url_safe($loc)) {
        return research_get($loc, $timeout, $maxBytes);              // one hop, re-validated
    }
    return ['ok' => $code === 200 && is_string($body), 'code' => $code,
            'body' => is_string($body) ? $body : '', 'why' => ''];
}

if ($action === 'research') {
    if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
    if (!rate_ok($CFG, $hubTok !== '')) out(429, ['error' => ['message' => 'Too many searches just now.']]);
    if (empty($CFG['research_on'] ?? true)) out(200, ['ok' => false, 'off' => true, 'sources' => [],
        'note' => 'Live sources are switched off on this server.']);

    $req = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $q = trim((string)($req['q'] ?? ''));
    if ($q === '' || mb_strlen($q) > 300) out(400, ['error' => ['message' => 'Bad query']]);

    $sources = [];
    $backend = 'none';

    /* 1 — a real search API if the owner configured one. Nothing here depends
       on it, but results are far better when it exists. */
    $braveKey = trim((string)($CFG['brave_key'] ?? ''));
    if ($braveKey !== '') {
        $u = 'https://api.search.brave.com/res/v1/web/search?count=6&q=' . rawurlencode($q);
        $ch = curl_init($u);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'X-Subscription-Token: ' . $braveKey]]);
        $r = curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($c === 200 && is_string($r)) {
            $j = json_decode($r, true);
            foreach (($j['web']['results'] ?? []) as $it) {
                $sources[] = ['title' => (string)($it['title'] ?? ''),
                              'url' => (string)($it['url'] ?? ''),
                              'snippet' => strip_tags((string)($it['description'] ?? '')),
                              'date' => (string)($it['page_age'] ?? '')];
            }
            if ($sources) $backend = 'brave';
        }
    }

    /* 2 — Wikipedia. No key, no quota, and for a study product it is a
       legitimate starting point as long as it is LABELLED as an encyclopaedia
       rather than a primary source, which the tier does. */
    if (!$sources) {
        $u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts|info'
           . '&inprop=url&exintro=1&explaintext=1&redirects=1&generator=search&gsrlimit=4'
           . '&gsrsearch=' . rawurlencode($q);
        $r = research_get($u, 8);
        if ($r['ok']) {
            $j = json_decode($r['body'], true);
            foreach (($j['query']['pages'] ?? []) as $pg) {
                $sources[] = ['title' => (string)($pg['title'] ?? ''),
                              'url' => (string)($pg['fullurl'] ?? ''),
                              'snippet' => mb_substr(trim((string)($pg['extract'] ?? '')), 0, 700),
                              'date' => (string)($pg['touched'] ?? '')];
            }
            if ($sources) $backend = 'wikipedia';
        }
    }

    /* Score and sort. The tier is reported, never used to drop a source
       silently — a student should see that the only thing found was a blog. */
    $now = gmdate('c');
    $clean = [];
    foreach ($sources as $s) {
        $url = (string)$s['url'];
        if ($url === '' || !url_safe($url)) continue;                // never surface what we could not verify
        $host = parse_url($url, PHP_URL_HOST) ?: '';
        list($tier, $label) = source_tier($host);
        $clean[] = [
            'title'   => mb_substr((string)$s['title'], 0, 180),
            'url'     => $url,
            'host'    => $host,
            'snippet' => mb_substr((string)$s['snippet'], 0, 700),
            'tier'    => $tier,
            'kind'    => $label,
            'published' => (string)$s['date'],
            'retrieved' => $now,
        ];
    }
    usort($clean, function ($a, $b) { return $a['tier'] <=> $b['tier']; });
    $clean = array_slice($clean, 0, 6);

    log_line($CFG, 'ops.jsonl', ['t' => $now, 'rid' => request_id(), 'app' => $APP,
        'provider' => 'research', 'model' => $backend, 'cache' => 'miss',
        'code' => $clean ? 200 : 204, 'ms' => 0, 'ok' => (bool)$clean,
        'signed' => $hubTok !== '', 'bytes' => 0]);

    out(200, ['ok' => (bool)$clean, 'backend' => $backend, 'sources' => $clean,
              'retrieved' => $now,
              'note' => $clean ? '' : 'No live source could be reached for this question.']);
}

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
        $me = hub_me($CFG, $hubTok, $APP);
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

    /* ---- idempotency (§54) ----
       The browser mints one id per delivered answer and sends it here. Without
       it, a charge POST that is retried — a lost reply on a phone, a tapped
       retry — spends a second lot of credits for an answer the student was only
       shown once. The id is scoped to the caller's own token, so replaying
       somebody else's id cannot suppress their charge.

       Three outcomes: a known id replays its stored result and spends nothing;
       a brand-new id is claimed and does the work; an id claimed but not yet
       finished (two duplicates in flight at once) is told the charge is already
       happening rather than being charged again. */
    $idem  = preg_replace('/[^A-Za-z0-9_\-]/', '', (string)($_SERVER['HTTP_X_7BY_IDEM'] ?? ''));
    $scope = hash('sha256', ($hubTok !== '' ? 'h:' . $hubTok : 'p:' . $passTok) . '|' . $APP);
    $mine  = true;
    if ($idem !== '') {
        $prev = bill_idem_get($CFG, $scope, $idem);
        if (is_array($prev) && empty($prev['pending'])) {
            $prev['idempotent'] = true;                 // already paid for; say so, charge nothing
            out(200, $prev);
        }
        if ($prev === null) {
            $mine = bill_idem_claim($CFG, $scope, $idem);
        } else {
            $mine = false;                              // a duplicate is mid-flight
        }
        if (!$mine) out(200, ['ok' => true, 'idempotent' => true, 'pending' => true]);
    }

    /* Record the outcome under the id before returning it, so the retry that
       prompted all this gets the same answer instead of a second charge. */
    $finish = function (array $body) use ($CFG, $scope, $idem) {
        if ($idem !== '') bill_idem_put($CFG, $scope, $idem, $body);
        return $body;
    };

    if (hub_on($CFG) && $hubTok !== '') {
        list($ok, $left) = hub_spend($CFG, $APP, $hubTok);   // signed-in: spend account credits
        if ($ok) out(200, $finish(['ok' => true, 'credits' => is_int($left) ? $left : 0]));
        // Hub unreachable or token rejected. Do NOT hand out free answers and do
        // NOT fail silently — fall back to the device allowance and say so, so a
        // broken hub link shows up instead of looking like credits never move.
        list($ok2, $st2) = bill_charge($CFG, $APP, $passTok, false);
        out(200, $finish(['ok' => (bool)$ok2, 'hub_error' => is_string($left) ? $left : 'hub_spend_failed',
                  'billing' => is_array($st2) ? $st2 : null]));
    }
    list($ok, $st) = bill_charge($CFG, $APP, $passTok, false);   // guest: spend the daily free allowance
    /* A refusal is deliberately NOT stored: "you had no credits a moment ago"
       must not be replayed to a student who has since topped up. */
    $body = ['ok' => (bool)$ok, 'billing' => is_array($st) ? $st : null];
    if ($ok) $finish($body);
    elseif ($idem !== '') { $f = bill_idem_file($CFG, $scope, $idem); if ($f && is_file($f)) @unlink($f); }
    out($ok ? 200 : 402, $body);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') out(405, ['error' => ['message' => 'POST only']]);
if (!origin_allowed($CFG)) out(403, ['error' => ['message' => 'Origin not allowed']]);
if (!rate_ok($CFG, $hubTok !== '')) {
    /* Say what this actually is. It was reported to the student as a
       connection problem, which sent them to check their wifi over something
       happening entirely on our side. The reset is the top of the clock hour,
       so we can tell them exactly how long. */
    $mins = 60 - (int)date('i');
    out(429, ['error' => ['message' => 'Hourly limit reached on this connection. ' .
              'It resets in about ' . $mins . ' minute' . ($mins === 1 ? '' : 's') . '.'],
              'rateLimited' => true, 'retryInMinutes' => $mins]);
}

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
$hubUser = (hub_on($CFG) && $hubTok !== '') ? hub_me($CFG, $hubTok, $APP) : null;
$useHub  = $hubUser !== null;
$billStatus = null;

if (!empty($CFG['billing_off'])) {
    // paywall disabled — everything free
} elseif ($useHub) {
    /* Does this plan include AI at all? Spark buys the practice tools, not the
       model, so having credits is not the same as being allowed to spend them
       here. The browser checks this too, but a plan name in the browser can be
       edited — this is the check that actually holds. The hub reports 'ai';
       when it doesn't (older hub), fall back to our own plan table so the rule
       still applies rather than silently defaulting to "allowed". */
    $planName = (string)($hubUser['plan'] ?? '');
    $aiOk = array_key_exists('ai', $hubUser)
        ? (bool)$hubUser['ai']
        : bill_plan_ai($CFG, $planName);
    if (!$aiOk) {
        out(402, ['error' => ['message' => 'Your plan does not include AI'],
                  'needsPlan' => true, 'needsAI' => true,
                  'billing' => ['signed_in' => true, 'plan' => $planName,
                                'credits' => (int)($hubUser['credits'] ?? 0), 'ai' => false]]);
    }
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
    // Entitlement before balance: telling a Spark holder they are "out of
    // credits" would be a lie — they have credits, this just isn't what those
    // credits buy. The free tier keeps its AI, so this only ever stops a plan
    // that genuinely excludes the model.
    if (is_array($billStatus) && array_key_exists('ai', $billStatus) && !$billStatus['ai']) {
        out(402, ['error' => ['message' => 'Your plan does not include AI'],
                  'needsPlan' => true, 'needsAI' => true, 'billing' => $billStatus]);
    }
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
$t0 = microtime(true);
if ($cacheable) {
    $hit = cache_get($cDir, $cKey, $cacheHours);
    if ($hit !== null) {
        header('X-7By-Cache: HIT');
        header('X-7By-Request-Id: ' . request_id());
        log_line($CFG, 'ops.jsonl', ['t' => gmdate('c'), 'rid' => request_id(), 'app' => $APP,
            'provider' => $provider, 'model' => $model, 'cache' => 'hit', 'code' => 200,
            'ms' => (int)round((microtime(true) - $t0) * 1000), 'premium' => $premium,
            'signed' => $useHub, 'bytes' => strlen($hit)]);
        echo $hit;
        exit;
    }
}

/* ---------- call the provider; rotate keys when one is rate-limited ---------- */
$url  = str_replace('{model}', rawurlencode($model), $ENDPOINTS[$provider]);
$body = json_encode($payload);
$last = ['code' => 502, 'text' => '{"error":{"message":"Upstream failed"}}'];

// Wall-clock budget for this whole request, retries included. Without it a
// worker can be held for per-call-timeout x number-of-keys.
$perCall  = (int)($CFG['timeout'] ?? 45);
$budget   = (int)($CFG['total_budget'] ?? max($perCall + 15, 60));
$deadline = microtime(true) + $budget;

$tried = 0;
foreach ($keys as $k) {
    // no time left for a meaningful attempt — stop rather than hold the worker
    $left = (int)floor($deadline - microtime(true));
    if ($left < 8) break;
    $tried++;
    $headers = ['Content-Type: application/json'];
    if ($provider === 'gemini') {
        $headers[] = 'x-goog-api-key: ' . $k;
    } else {
        $headers[] = 'Authorization: Bearer ' . $k;
        if ($provider === 'openrouter') $headers[] = 'X-Title: 7Solve';
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => max(8, min($perCall, $left)),
        CURLOPT_CONNECTTIMEOUT => 10,
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

/* One line per delivered request. Metadata only — see the note by log_line():
   the student's question is never written here, on purpose. 'keys' records how
   many API keys had to be burned through, which is the early warning that a
   provider's free quota is exhausted. */
log_line($CFG, 'ops.jsonl', ['t' => gmdate('c'), 'rid' => request_id(), 'app' => $APP,
    'provider' => $provider, 'model' => $model, 'cache' => 'miss',
    'code' => (int)$last['code'], 'ms' => (int)round((microtime(true) - $t0) * 1000),
    'ok' => $gotAnswer, 'premium' => $premium, 'signed' => $useHub,
    'bytes' => strlen($last['text']), 'keys' => $tried,
    'err' => $gotAnswer ? null : mb_substr((string)(json_decode($last['text'], true)['error']['message'] ?? ''), 0, 160)]);

header('X-7By-Cache: MISS');
header('X-7By-Request-Id: ' . request_id());
http_response_code($last['code']);
echo $last['text'];
