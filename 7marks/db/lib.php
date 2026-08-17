<?php
/**
 * 7MARKS — database access and the identity bridge.
 *
 * Every API endpoint starts here. It answers two questions and nothing else:
 *   who is calling?   -> current_user_id(), resolved against the hub
 *   where do I write? -> db(), the 7Marks database
 *
 * The boundary this file enforces is the whole architecture:
 *   - The hub is the ONLY authority for identity, credits and plans. This
 *     file never reads a hub table, never holds a hub credential, and never
 *     decides whether someone is signed in — it asks the hub and believes
 *     the answer.
 *   - The 7Marks database holds only academic data, keyed by hub_user_id.
 *   - 7Solve shares the hub and is unaffected by anything here.
 */

declare(strict_types=1);

/* ------------------------------------------------------------------ config */
function m7_config(): array {
    static $c = null;
    if ($c === null) {
        $f = __DIR__ . '/config.php';
        if (!is_file($f)) {
            m7_fail(500, 'not_configured', 'db/config.php is missing on the server.');
        }
        $c = require $f;
    }
    return $c;
}

/** JSON error, and stop. Never leaks a query, a path or a credential. */
function m7_fail(int $code, string $error, string $message = ''): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(array('error' => $error, 'message' => $message));
    exit;
}

/* ---------------------------------------------------------------- database */
function db(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;
    $c = m7_config();
    $dsn = 'mysql:host=' . ($c['host'] ?? 'localhost') .
           ';dbname=' . ($c['name'] ?? '') .
           ';charset=' . ($c['charset'] ?? 'utf8mb4');
    try {
        $pdo = new PDO($dsn, (string)($c['user'] ?? ''), (string)($c['pass'] ?? ''),
            ($c['options'] ?? array()) + array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION));
    } catch (Throwable $e) {
        /* the message is deliberately vague to the caller and specific in the log */
        error_log('7marks db connect failed: ' . $e->getMessage());
        m7_fail(503, 'db_unavailable', 'The database could not be reached.');
    }
    return $pdo;
}

/* ================================================================ IDENTITY
   The browser already holds the hub's session cookie, because the student
   signed in there. 7Marks forwards that cookie to the hub's `me` action and
   receives a user id. That is the entire bridge: no second password, no
   second session, no copy of any credential.

   A failure to reach the hub returns "not signed in" rather than guessing.
   Guessing here would mean writing one student's work under another
   student's id, which is the worst thing this layer could do.
   ================================================================ */

/**
 * The hub user id for this request, or null if not signed in.
 * Cached in-process and, briefly, in the session, so one page view is not a
 * dozen round trips to the hub.
 */
function current_user_id(): ?int {
    static $resolved = false, $uid = null;
    if ($resolved) return $uid;
    $resolved = true;

    $c = m7_config();
    $ttl = (int)($c['identity_cache_seconds'] ?? 60);

    if (session_status() === PHP_SESSION_NONE) {
        session_set_cookie_params(array(
            'lifetime' => 0, 'path' => '/', 'httponly' => true,
            'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS'])
        ));
        @session_start();
    }

    /* A fresh enough answer from a moment ago is good enough — but it is
       keyed on the TOKEN, not just the session. Caching on the session
       alone would hand a second student the first one's id if they shared
       a browser session and swapped tokens. */
    $tokHash = substr(hash('sha256', m7_hub_token()), 0, 16);
    if (!empty($_SESSION['m7_uid']) && !empty($_SESSION['m7_uid_at'])
        && ($_SESSION['m7_uid_tok'] ?? '') === $tokHash
        && (time() - (int)$_SESSION['m7_uid_at']) < $ttl) {
        return $uid = (int)$_SESSION['m7_uid'];
    }

    $me = m7_hub_call('me');
    $id = 0;
    if (is_array($me)) {
        /* the hub has used a couple of shapes over time; accept either */
        $id = (int)($me['user']['id'] ?? $me['id'] ?? 0);
    }
    if ($id > 0) {
        $_SESSION['m7_uid'] = $id;
        $_SESSION['m7_uid_at'] = time();
        $_SESSION['m7_uid_tok'] = $tokHash;
        m7_touch_mirror($id, (string)($me['user']['name'] ?? $me['name'] ?? ''));
        return $uid = $id;
    }

    unset($_SESSION['m7_uid'], $_SESSION['m7_uid_at'], $_SESSION['m7_uid_tok']);
    return $uid = null;
}

/** Same, but stops the request if nobody is signed in. */
function require_user(): int {
    $id = current_user_id();
    if ($id === null) {
        m7_fail(401, 'not_signed_in', 'Sign in to your 7by.in account to continue.');
    }
    return $id;
}

/**
 * The caller's hub token.
 *
 * 7Marks has used a TOKEN for this since long before Phase B, sent by the
 * browser as X-7By-Hub and read by api.php. This reuses that exact
 * mechanism rather than inventing a second one.
 *
 * An earlier version of this file forwarded the browser's cookies instead,
 * which could never have worked: the hub's session cookie is scoped to
 * account.7by.in and is simply not sent to 7marks.7by.in. whoami returned
 * "not signed in" for every request because of it.
 */
function m7_hub_token(): string {
    $t = (string)($_SERVER['HTTP_X_7BY_HUB'] ?? '');
    if ($t === '') {
        $auth = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? '');
        if (stripos($auth, 'Bearer ') === 0) $t = trim(substr($auth, 7));
    }
    if ($t === '') $t = (string)($_SERVER['HTTP_X_7BY_TOKEN'] ?? '');
    /* some hosts hide Authorization from PHP; the app also accepts ?t= */
    if ($t === '') $t = (string)($_GET['t'] ?? '');
    return preg_replace('/[^A-Za-z0-9_.\-]/', '', $t);
}

/**
 * Ask the hub something as the current student.
 *
 * Sends the token as BOTH Authorization: Bearer and X-7By-Token, matching
 * billing.php — some hosts strip Authorization entirely, and the hub
 * accepts either, so sending both is what makes this work everywhere.
 */
function m7_hub_call(string $action, array $body = array()) {
    $c = m7_config();
    $base = rtrim((string)($c['hub_base'] ?? ''), '/');
    $tok  = m7_hub_token();
    if ($base === '' || $tok === '') return null;

    $ch = curl_init($base . '/api.php?action=' . rawurlencode($action));
    $headers = array(
        'Accept: application/json',
        'Content-Type: application/json',
        'Authorization: Bearer ' . $tok,
        'X-7By-Token: ' . $tok,
    );
    if ($body) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => (int)($c['hub_timeout'] ?? 6),
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => true,
    ));
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $code < 200 || $code >= 300) return null;
    $j = json_decode((string)$raw, true);
    return is_array($j) ? $j : null;
}

/**
 * Keep the display-name cache warm.
 * users_mirror is a CACHE: it is safe to truncate at any time, and nothing
 * may read a balance, plan or entitlement from it.
 */
function m7_touch_mirror(int $uid, string $name): void {
    try {
        $st = db()->prepare(
            'INSERT INTO users_mirror (hub_user_id, display_name, avatar_seed,
                                       refreshed_at, created_at)
             VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE display_name = VALUES(display_name),
                                     refreshed_at = UTC_TIMESTAMP()'
        );
        $st->execute(array($uid, mb_substr($name, 0, 60), substr(md5((string)$uid), 0, 8)));
    } catch (Throwable $e) {
        /* a cold cache must never break a request */
        error_log('7marks mirror touch failed: ' . $e->getMessage());
    }
}

/* ================================================================== EVENTS
   The activity trail. Deliberately NOT a source of truth — the real tables
   stay authoritative — so a failure to record an event must never roll back
   or block the thing that actually happened.
   ================================================================== */
function m7_event(int $uid, string $type, string $entityType = '',
                  ?int $entityId = null, ?array $payload = null): void {
    try {
        $st = db()->prepare(
            'INSERT INTO events (hub_user_id, event_type, entity_type, entity_id,
                                 payload_json, created_at)
             VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())'
        );
        $st->execute(array($uid, $type, $entityType, $entityId,
            $payload === null ? null : json_encode($payload, JSON_UNESCAPED_UNICODE)));
    } catch (Throwable $e) {
        error_log('7marks event failed (' . $type . '): ' . $e->getMessage());
    }
}

/* ================================================================ REQUESTS */

/** Decoded JSON body, or an empty array. */
function m7_body(): array {
    $raw = file_get_contents('php://input');
    $j = json_decode((string)$raw, true);
    return is_array($j) ? $j : array();
}

/** Standard JSON response. */
function m7_ok(array $body): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Same-origin guard. The API is only ever called by 7Marks itself, so a
 * cross-origin request is either a mistake or an attack; either way it is
 * refused rather than served.
 */
function m7_require_same_origin(): void {
    $o = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($o === '') return;                       /* same-origin fetches send none */
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if (parse_url($o, PHP_URL_HOST) !== $host) {
        m7_fail(403, 'bad_origin', 'Cross-origin requests are not accepted.');
    }
}
