<?php
/* ============================================================
   7Solve — PUBLIC API v1
   ------------------------------------------------------------
   Routes (via .htaccess, /v1/<name> lands here):

     GET  /v1/health              no key — liveness + engine status
     POST /v1/verify              KEY — question + answer -> verdict
     GET  /v1/usage               KEY — this key's own counters

     POST /v1/keys                ADMIN — issue a key
     GET  /v1/keys                ADMIN — list keys (prefixes only)
     DELETE /v1/keys/<id>         ADMIN — revoke a key

   WHY /v1/verify AND NOT /v1/solve FIRST
   --------------------------------------
   Solving is the commodity: every provider on earth sells it,
   it costs money per call, and it inherits whatever quota
   trouble the upstream is having that day. Verification is the
   part nobody else sells, it needs no AI provider, and its
   marginal cost is a few milliseconds of CPU. Leading with the
   moat is deliberate. /v1/solve comes after, and will reuse the
   provider layer already in api.php.

   STORAGE
   -------
   Flat files under log_dir, same as the rest of this app. No
   database, because there isn't one on this host and inventing
   a dependency to store a few hundred rows would be a worse
   trade than the flock() below.

   THE KEY IS NEVER STORED
   -----------------------
   Only a SHA-256 of it, exactly as a password would be. A
   stolen key file is then worth nothing on its own, and the
   plaintext exists in precisely one place: the response to the
   call that created it. Say so at issue time, because it cannot
   be recovered afterwards.
   ============================================================ */
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');

/* A public API is meant to be called from other people's pages. */
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/verify.php';

const API_VERSION   = 'v1';
const MAX_BODY      = 262144;      // 256 KB — a question and an answer, not a file
const DEFAULT_LIMIT = 600;         // requests per hour per key

$cfgFile = __DIR__ . '/keys.php';
$CFG = is_file($cfgFile) ? (require $cfgFile) : [];
if (!is_array($CFG)) $CFG = [];

/* ---------- envelopes ----------
   One shape for every success and one for every failure, including the ones
   thrown by the framework itself. A client that has handled one error has
   handled all of them. */
function ok_out(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode(['success' => true, 'api_version' => API_VERSION] + $data,
                     JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function err_out(string $status, string $message, int $code): void
{
    http_response_code($code);
    echo json_encode([
        'success'     => false,
        'api_version' => API_VERSION,
        'status'      => $status,
        'message'     => $message,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function store_dir(array $CFG): string
{
    $dir = trim((string)($CFG['log_dir'] ?? ''));
    if ($dir === '') $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    return rtrim($dir, '/\\');
}

/* Read-modify-write under an exclusive lock. Two keys issued in the same
   second on a shared host is not hypothetical, and a lost write here loses
   somebody's API key. */
function with_store(array $CFG, string $name, callable $fn)
{
    $path = store_dir($CFG) . '/' . $name;
    $h = @fopen($path, 'c+');
    if (!$h) err_out('FAILED', 'Storage is not writable.', 500);
    try {
        if (!flock($h, LOCK_EX)) err_out('FAILED', 'Storage is busy.', 503);
        $raw  = stream_get_contents($h);
        $data = $raw === '' ? [] : (json_decode($raw, true) ?: []);
        $res  = $fn($data);
        if ($res['write'] ?? false) {
            ftruncate($h, 0);
            rewind($h);
            fwrite($h, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            fflush($h);
        }
        return $res['value'] ?? null;
    } finally {
        flock($h, LOCK_UN);
        fclose($h);
    }
}

function bearer(): string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) { $h = $v; break; }
        }
    }
    return preg_match('/^Bearer\s+(\S+)/i', (string)$h, $m) ? $m[1] : '';
}

function admin_ok(array $CFG): bool
{
    $want = trim((string)($CFG['admin_token'] ?? ''));
    if ($want === '' || strlen($want) < 16) return false;
    $got = bearer() !== '' ? bearer() : (string)($_GET['t'] ?? '');
    return $got !== '' && hash_equals($want, $got);
}

function body_json(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false) $raw = '';
    if (strlen($raw) > MAX_BODY) {
        err_out('FAILED', 'Request body is larger than ' . (MAX_BODY / 1024) . ' KB.', 413);
    }
    if (trim($raw) === '') return [];
    $j = json_decode($raw, true);
    if (!is_array($j)) err_out('FAILED', 'Body must be a JSON object.', 400);
    return $j;
}

/* ---------- keys ----------
   7solve_live_<32 hex>. The prefix is kept in the clear so a key found in a
   log is recognisable as ours and can be revoked; the secret half never is. */
function key_hash(string $plain): string
{
    return hash('sha256', $plain);
}

function auth_key(array $CFG): array
{
    $plain = bearer();
    if ($plain === '') {
        err_out('UNAUTHORIZED', 'Send your key as: Authorization: Bearer 7solve_live_…', 401);
    }
    $hash = key_hash($plain);
    $rec = with_store($CFG, 'apikeys.json', static function (array &$db) use ($hash) {
        foreach ($db as $id => $k) {
            if (hash_equals((string)$k['hash'], $hash)) {
                return ['value' => ['id' => $id] + $k, 'write' => false];
            }
        }
        return ['value' => null, 'write' => false];
    });
    if ($rec === null)              err_out('UNAUTHORIZED', 'That key is not recognised.', 401);
    if (!empty($rec['revoked_at'])) err_out('UNAUTHORIZED', 'That key has been revoked.', 401);
    return $rec;
}

/* Fixed-window counter, one file per key per hour. A sliding window would be
   more elegant and would also mean keeping every timestamp; this cannot drift
   and cannot grow. */
function rate_check(array $CFG, string $keyId, int $limit): array
{
    $window = gmdate('YmdH');
    $file = 'rate-' . preg_replace('/[^a-z0-9]/i', '', $keyId) . '-' . $window . '.json';
    return with_store($CFG, $file, static function (array &$db) use ($limit) {
        $n = (int)($db['n'] ?? 0) + 1;
        $db['n'] = $n;
        return ['value' => ['used' => $n, 'limit' => $limit, 'over' => $n > $limit], 'write' => true];
    });
}

function bump_usage(array $CFG, string $keyId, string $route, bool $good): void
{
    with_store($CFG, 'apiusage.json', static function (array &$db) use ($keyId, $route, $good) {
        $day = gmdate('Y-m-d');
        $db[$keyId][$day]['total']  = (int)($db[$keyId][$day]['total'] ?? 0) + 1;
        $db[$keyId][$day][$route]   = (int)($db[$keyId][$day][$route] ?? 0) + 1;
        if (!$good) $db[$keyId][$day]['errors'] = (int)($db[$keyId][$day]['errors'] ?? 0) + 1;
        return ['write' => true];
    });
}

/* ---------- routing ---------- */
$route  = strtolower(trim((string)($_GET['route'] ?? ''), '/'));
$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

/* ---- GET /v1/health — no key, so a monitor can watch it ---- */
if ($route === 'health') {
    $engine = 'ok';
    $detail = null;
    try {
        $r = Checks::run('Solve x^2-4=0', "## ✅ Answer\nx = 2 and x = -2");
        if ($r['state'] !== 'checked' || $r['passed'] < 2) {
            $engine = 'degraded';
            $detail = 'self-check returned ' . $r['state'] . ' with ' . $r['passed'] . ' passes';
        }
    } catch (Throwable $e) {
        $engine = 'down';
        $detail = 'verification engine threw';
    }
    ok_out([
        'status'   => $engine === 'ok' ? 'HEALTHY' : strtoupper($engine),
        'engine'   => $engine,
        'detail'   => $detail,
        'store'    => is_writable(store_dir($CFG)) ? 'writable' : 'READ-ONLY',
        'time'     => gmdate('c'),
    ], $engine === 'down' ? 503 : 200);
}

/* ---- key administration ---- */
if ($route === 'keys' || strpos($route, 'keys/') === 0) {
    if (!admin_ok($CFG)) {
        err_out('UNAUTHORIZED',
            'Key administration needs the admin token. Set admin_token in keys.php.', 401);
    }

    if ($method === 'POST') {
        $in    = body_json();
        $label = trim((string)($in['label'] ?? ''));
        if ($label === '') err_out('FAILED', 'A label is required, so you can tell keys apart.', 400);
        $limit = (int)($in['rate_per_hour'] ?? DEFAULT_LIMIT);
        if ($limit < 1) $limit = DEFAULT_LIMIT;

        $plain = '7solve_live_' . bin2hex(random_bytes(16));
        $id    = 'k_' . bin2hex(random_bytes(6));

        with_store($CFG, 'apikeys.json', static function (array &$db) use ($id, $plain, $label, $limit) {
            $db[$id] = [
                'hash'          => key_hash($plain),
                'prefix'        => substr($plain, 0, 20),
                'label'         => $label,
                'rate_per_hour' => $limit,
                'created_at'    => gmdate('c'),
                'revoked_at'    => null,
            ];
            return ['write' => true];
        });

        ok_out([
            'id'            => $id,
            'key'           => $plain,
            'label'         => $label,
            'rate_per_hour' => $limit,
            'warning'       => 'This is the only time the key is shown. It is stored hashed and cannot be recovered.',
        ], 201);
    }

    if ($method === 'GET') {
        $list = with_store($CFG, 'apikeys.json', static function (array &$db) {
            $out = [];
            foreach ($db as $id => $k) {
                $out[] = [
                    'id'            => $id,
                    'prefix'        => $k['prefix'] . '…',
                    'label'         => $k['label'],
                    'rate_per_hour' => $k['rate_per_hour'],
                    'created_at'    => $k['created_at'],
                    'revoked_at'    => $k['revoked_at'],
                ];
            }
            return ['value' => $out, 'write' => false];
        });
        ok_out(['keys' => $list, 'count' => count($list)]);
    }

    if ($method === 'DELETE') {
        $id = substr($route, 5);
        if ($id === '') err_out('FAILED', 'Which key? Use DELETE /v1/keys/<id>.', 400);
        $done = with_store($CFG, 'apikeys.json', static function (array &$db) use ($id) {
            if (!isset($db[$id])) return ['value' => false, 'write' => false];
            /* Revoked, not deleted: the usage history stays attributable, and a
               key id in an old log can still be explained. */
            $db[$id]['revoked_at'] = gmdate('c');
            return ['value' => true, 'write' => true];
        });
        if (!$done) err_out('FAILED', 'No key with that id.', 404);
        ok_out(['id' => $id, 'revoked' => true]);
    }

    err_out('FAILED', 'Use POST, GET or DELETE on /v1/keys.', 405);
}

/* ---- everything below needs a customer key ---- */
$key   = auth_key($CFG);
$limit = (int)($key['rate_per_hour'] ?? DEFAULT_LIMIT);
$rate  = rate_check($CFG, $key['id'], $limit);

header('X-RateLimit-Limit: ' . $limit);
header('X-RateLimit-Remaining: ' . max(0, $limit - (int)$rate['used']));

if ($rate['over']) {
    bump_usage($CFG, $key['id'], $route, false);
    header('Retry-After: ' . (3600 - (int)gmdate('i') * 60 - (int)gmdate('s')));
    err_out('RATE_LIMITED', 'This key has used its ' . $limit . ' requests for this hour.', 429);
}

/* ---- GET /v1/usage ---- */
if ($route === 'usage') {
    $u = with_store($CFG, 'apiusage.json', static function (array &$db) {
        return ['value' => $db, 'write' => false];
    });
    bump_usage($CFG, $key['id'], 'usage', true);
    ok_out([
        'key_id'    => $key['id'],
        'label'     => $key['label'],
        'this_hour' => ['used' => (int)$rate['used'], 'limit' => $limit],
        'by_day'    => $u[$key['id']] ?? new stdClass(),
    ]);
}

/* ---- POST /v1/verify — the one nobody else sells ---- */
if ($route === 'verify') {
    if ($method !== 'POST') err_out('FAILED', 'Use POST for /v1/verify.', 405);

    $in       = body_json();
    $question = trim((string)($in['question'] ?? ''));
    $answer   = trim((string)($in['answer'] ?? ''));

    if ($question === '' || $answer === '') {
        bump_usage($CFG, $key['id'], 'verify', false);
        err_out('NEEDS_CLARIFICATION',
                'Send both "question" and "answer". Verification compares one against the other.', 400);
    }

    try {
        $r = Checks::run($question, $answer);
    } catch (Throwable $e) {
        bump_usage($CFG, $key['id'], 'verify', false);
        err_out('FAILED', 'The verification engine could not process that input.', 500);
    }

    /* The four states are honest about their own limits. "unverified" is NOT a
       pass — it means nothing here was mechanically checkable, and a caller
       that treats it as approval has misread the contract. It is spelled out
       in the response rather than left to the docs. */
    $meaning = [
        'checked'    => 'Every check that could run agreed with the answer.',
        'stepfail'   => 'The answer stands, but a step in the working does not hold.',
        'disputed'   => 'The answer contradicts the question. Do not show it to a student as correct.',
        'unverified' => 'Nothing here could be checked mechanically. This is NOT a pass.',
    ];

    bump_usage($CFG, $key['id'], 'verify', true);
    ok_out([
        'status'       => strtoupper($r['state']),
        'verified'     => $r['state'] === 'checked',
        'means'        => $meaning[$r['state']] ?? '',
        'checks_run'   => $r['checked'],
        'checks_passed'=> $r['passed'],
        'checks_failed'=> $r['failed'],
        'checks'       => $r['checks'],
    ]);
}

/* ---- POST /v1/answer/check — mark a STUDENT's answer ----
   A different question from /v1/verify, and a different buyer. That endpoint
   asks whether an AI got it right; this one asks whether a student did.
   Deterministic throughout: the true roots come from the solver, the claimed
   ones from the same reader the verifier uses, and the mark is set comparison
   with a proof attached. */
if ($route === 'answer/check') {
    if ($method !== 'POST') err_out('FAILED', 'Use POST for /v1/answer/check.', 405);
    require_once __DIR__ . '/grader.php';

    $in       = body_json();
    $question = trim((string)($in['question'] ?? ''));
    $answer   = trim((string)($in['student_answer'] ?? $in['answer'] ?? ''));
    if ($question === '' || $answer === '') {
        bump_usage($CFG, $key['id'], 'answer/check', false);
        err_out('NEEDS_CLARIFICATION',
                'Send both "question" and "student_answer".', 400);
    }
    if (mb_strlen($question) > 4000 || mb_strlen($answer) > 4000) {
        bump_usage($CFG, $key['id'], 'answer/check', false);
        err_out('FAILED', 'Question and answer are limited to 4000 characters each.', 413);
    }

    $marks = (float)($in['max_marks'] ?? 1);
    if (!is_finite($marks) || $marks <= 0 || $marks > 1000) $marks = 1.0;
    /* Clamped rather than rejected: a nonsensical penalty should not fail a
       whole batch of marking, and 0 is the safe reading of "not specified". */
    $penalty = (float)($in['penalty_per_wrong'] ?? 0);
    if (!is_finite($penalty) || $penalty < 0) $penalty = 0.0;
    if ($penalty > 1) $penalty = 1.0;

    try {
        $r = Grader::check($question, $answer, $marks, $penalty);
    } catch (Throwable $e) {
        bump_usage($CFG, $key['id'], 'answer/check', false);
        err_out('FAILED', 'The grader could not process that input.', 500);
    }

    bump_usage($CFG, $key['id'], 'answer/check', true);
    ok_out($r);
}

/* ---- POST /v1/math/solve — deterministic, no model involved ----
   Same economics as /v1/verify: no provider, no quota, no per-call cost. It
   answers what it can prove it can answer and returns UNSUPPORTED for the
   rest, because a solver that guesses is indistinguishable from one that
   knows, and the caller has no way to tell which they got. */
if ($route === 'math/solve') {
    if ($method !== 'POST') err_out('FAILED', 'Use POST for /v1/math/solve.', 405);
    require_once __DIR__ . '/solver.php';

    $in = body_json();
    $q  = trim((string)($in['expression'] ?? $in['equation'] ?? $in['question'] ?? ''));
    if ($q === '') {
        bump_usage($CFG, $key['id'], 'math/solve', false);
        err_out('NEEDS_CLARIFICATION', 'Send an "equation" (or "expression").', 400);
    }
    if (mb_strlen($q) > 2000) {
        bump_usage($CFG, $key['id'], 'math/solve', false);
        err_out('FAILED', 'Expression is longer than 2000 characters.', 413);
    }

    try {
        $r = Solver::solve($q);
    } catch (Throwable $e) {
        bump_usage($CFG, $key['id'], 'math/solve', false);
        err_out('FAILED', 'The solver could not process that input.', 500);
    }

    bump_usage($CFG, $key['id'], 'math/solve', true);
    ok_out(['input' => $q, 'deterministic' => true] + $r);
}

/* ---- POST /v1/solve — solve, then verify, then retry if the verdict is bad ----
   The retry is the whole point. A plain proxy returns the first thing a model
   says; this returns the first thing a model says THAT SURVIVES CHECKING, and
   when nothing survives it says so instead of picking a favourite. */
if ($route === 'solve') {
    if ($method !== 'POST') err_out('FAILED', 'Use POST for /v1/solve.', 405);
    require_once __DIR__ . '/providers.php';

    $in       = body_json();
    $question = trim((string)($in['question'] ?? ''));
    if ($question === '') {
        bump_usage($CFG, $key['id'], 'solve', false);
        err_out('NEEDS_CLARIFICATION', 'Send a "question".', 400);
    }
    if (mb_strlen($question) > 8000) {
        bump_usage($CFG, $key['id'], 'solve', false);
        err_out('FAILED', 'Question is longer than 8000 characters.', 413);
    }

    $class   = trim((string)($in['class'] ?? ''));
    $subject = trim((string)($in['subject'] ?? ''));
    $lang    = trim((string)($in['language'] ?? 'English'));
    $level   = trim((string)($in['explanation_level'] ?? ''));

    /* The system prompt carries the two rules this product is built on: solve
       before writing, and never narrate the working. Both are the difference
       between an answer a student can revise from and one that merely happens
       to be right. */
    $system = "You are 7Solve, helping a student in India.\n"
        . "Work the problem out and check it BEFORE you write. Then present ONE clean derivation.\n"
        . "Never write \"Wait\", \"Actually\", \"Let me re-check\" or any narration of your own thinking. "
        . "If a line turns out wrong while working, fix it silently and write only the corrected version.\n"
        . "Do not assert a mathematical claim you have not justified. For a maximum or minimum, "
        . "showing a candidate is feasible is NOT showing it is optimal — say why nothing else does better.\n"
        . "Structure the reply with these markdown headings, in this order:\n"
        . "## ✅ Answer\n(the answer itself, in exact form, and nothing else)\n"
        . "## 📝 Steps\n(numbered, no repetition)\n"
        . "## 🎯 Final Result\n(one line)\n";
    if ($lang !== '' && strcasecmp($lang, 'English') !== 0) $system .= "Reply in {$lang}.\n";
    if ($level !== '')   $system .= "Pitch the explanation at this level: {$level}.\n";
    elseif ($class !== '') $system .= "The student is in class {$class}.\n";
    if ($subject !== '') $system .= "Subject: {$subject}.\n";

    $attempts = [];
    $best     = null;    // first result whose verification actually passed
    $fallback = null;    // first result with text at all, if none verify

    foreach (SOLVE_CHAIN as [$prov, $model]) {
        $pkeys = provider_keys($CFG, $prov);
        if (!$pkeys) continue;

        $t0 = microtime(true);
        $r  = provider_call($prov, $model, $system, $question, $pkeys[0]);
        $ms = (int)round((microtime(true) - $t0) * 1000);

        if (!$r['ok']) {
            $attempts[] = ['provider' => $prov, 'model' => $model, 'ms' => $ms,
                           'outcome' => 'no_answer', 'detail' => $r['err']];
            continue;
        }

        $v = Checks::run($question, $r['text']);
        $attempts[] = ['provider' => $prov, 'model' => $model, 'ms' => $ms,
                       'outcome' => $v['state'], 'checks_run' => $v['checked']];

        if ($fallback === null) $fallback = ['text' => $r['text'], 'v' => $v,
                                             'provider' => $prov, 'model' => $model];

        /* Only 'disputed' — the ANSWER contradicting the question — is grounds
           to throw the reply away and pay for another one.

           'stepfail' is not, and making it so was a mistake worth naming: a
           step-level check fires on any arithmetic written anywhere in the
           working, and a model's prose can produce a spurious match without
           the answer being wrong at all. Retrying on that discards good
           answers, spends quota, and lands on UNCERTAIN — the site itself has
           always shown a stepfail answer with a warning rather than binning
           it, so the API doing otherwise would be a second opinion nobody
           asked for. 'unverified' likewise: it is the honest outcome for
           "explain photosynthesis" and retrying cannot improve it.

           The verdict still travels in the response either way. The caller
           decides what to do with a step-level doubt; the API does not decide
           for them by hiding the answer. */
        if ($v['state'] !== 'disputed') {
            $best = ['text' => $r['text'], 'v' => $v, 'provider' => $prov, 'model' => $model];
            break;
        }
    }

    if ($best === null && $fallback === null) {
        bump_usage($CFG, $key['id'], 'solve', false);
        err_out('FAILED', 'No engine returned an answer. See /v1/health.', 502);
    }

    /* Nothing verified. Return the best we have, clearly labelled — silently
       serving a disputed answer is the exact failure this product exists to
       prevent, and hiding it behind a 200 with no marker would be worse than
       returning nothing. */
    $chosen  = $best ?? $fallback;
    $v       = $chosen['v'];
    $settled = $best !== null;

    bump_usage($CFG, $key['id'], 'solve', true);
    ok_out([
        'status'   => $settled ? strtoupper($v['state']) : 'UNCERTAIN',
        'answer'   => $chosen['text'],
        'verified' => $v['state'] === 'checked',
        'means'    => $settled
            ? [
                'checked'    => 'Every check that could run agreed with the answer.',
                'stepfail'   => 'The answer stands, but a step in the working does not hold. Show it with that caveat.',
                'unverified' => 'Nothing here could be checked mechanically. This is NOT a pass.',
              ][$v['state']] ?? ''
            : 'Every engine that answered contradicted the question. Treat this as unreliable.',
        'subject'  => $subject !== '' ? $subject : null,
        'engine'   => ['provider' => $chosen['provider'], 'model' => $chosen['model']],
        'verification' => [
            'verified'      => $v['state'] === 'checked',
            'state'         => $v['state'],
            'checks_run'    => $v['checked'],
            'checks_passed' => $v['passed'],
            'checks_failed' => $v['failed'],
            'checks'        => $v['checks'],
        ],
        'attempts' => $attempts,
    ]);
}

err_out('FAILED', 'No such route. Try GET /v1/health.', 404);
