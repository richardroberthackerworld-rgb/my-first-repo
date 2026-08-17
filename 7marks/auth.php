<?php
/**
 * 7MARKS — a same-origin proxy for signing in and creating an account.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The sign-in card used to fetch https://account.7by.in/api.php straight
 * from the browser. The hub sends no Access-Control-Allow-Origin header, so
 * the browser blocked every one of those requests before they left the
 * machine. The card looked fine and nothing behind it could ever work.
 *
 * There were two ways out. Adding CORS to the hub would open a shared,
 * credential-handling service to cross-origin calls for the benefit of one
 * tool — a change to a service 7Solve also depends on. This is the other
 * way: the browser talks only to 7marks.7by.in, and this file talks to the
 * hub server-to-server with curl. Same-origin, so CORS never applies, and
 * the hub keeps its current locked-down posture.
 *
 * The hub stays the only owner of identity. Nothing here reads or writes a
 * user, hashes a password, or mints a token — it forwards a fixed set of
 * actions and returns the hub's own answer.
 *
 * WHAT IT DELIBERATELY WILL NOT DO
 *   - forward any action outside AUTH_ACTIONS (no 'me', no admin, no
 *     credit actions — those already have their own audited endpoints)
 *   - log a request body: these carry passwords and one-time codes
 *   - accept an action name from the request that it has not whitelisted
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$CFG = is_file(__DIR__ . '/keys.php') ? require __DIR__ . '/keys.php' : [];
require_once __DIR__ . '/billing.php';

function a_out(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/* The complete set this proxy will pass through. Anything else is refused,
   so a new hub action can never become reachable here by accident.

   These field lists are the hub's ACTUAL contract, read from its api.php,
   not what seemed reasonable. Two details matter and are easy to get wrong:
   signup_start takes the password up front (it hashes it into the OTP row,
   so signup_verify needs only the code), and the code field is named
   'code', not 'otp'. */
const AUTH_ACTIONS = [
    'login'         => ['email', 'password'],
    'signup_start'  => ['email', 'name', 'password'],
    'signup_verify' => ['email', 'code'],
    'reset_start'   => ['email'],
    'reset_verify'  => ['email', 'code', 'password'],
    'google'        => ['credential'],
];

$action = (string)($_GET['action'] ?? '');

/* ------------------------------------------------------------------
   What the sign-in card needs to draw itself.

   Google's own button has to be rendered by Google's script, which needs
   the OAuth client ID. That ID is public by design — it ships in the HTML
   of every page that offers Google sign-in — so serving it is not a leak.
   It is read from the hub rather than pasted into a second config file,
   so there is one place it can ever be wrong.

   When no client ID is configured the card simply omits the Google button
   rather than showing one that cannot work.
   ------------------------------------------------------------------ */
if ($action === 'config') {
    $gid = trim((string)($CFG['hub_google_client_id'] ?? ''));
    if ($gid === '' && hub_on($CFG)) {
        $ch = curl_init(rtrim((string)$CFG['hub_base'], '/') . '/api.php?action=config');
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8]);
        $j = json_decode((string)curl_exec($ch), true);
        curl_close($ch);
        if (is_array($j)) $gid = trim((string)($j['google_client_id'] ?? ''));
    }
    /* a placeholder left in the hub's config is not a usable ID */
    if (stripos($gid, 'TODO') === 0 || strpos($gid, '.apps.googleusercontent.com') === false) {
        $gid = '';
    }
    header('Cache-Control: public, max-age=300');
    a_out(200, ['ok' => true, 'google_client_id' => $gid]);
}

if (!isset(AUTH_ACTIONS[$action])) {
    a_out(400, ['error' => 'bad_action', 'message' => 'Unknown sign-in step.']);
}

$raw = file_get_contents('php://input') ?: '';
$in  = json_decode($raw, true);
if (!is_array($in)) $in = [];

/* Copy across only the fields this action is allowed to carry. A field the
   hub does not expect is dropped rather than forwarded. */
$body = [];
foreach (AUTH_ACTIONS[$action] as $k) {
    if (isset($in[$k]) && is_scalar($in[$k])) $body[$k] = (string)$in[$k];
}

/* ------------------------------------------------------------------
   Email policy.

   Disposable addresses are refused: a throwaway inbox means a student
   cannot recover the account that holds their credits and results, and
   the recovery request lands on us.

   Note this is a courtesy check, not a wall. It only runs when signing
   up THROUGH 7Marks; account.7by.in can still be used directly. Making
   it binding would mean changing the hub's own signup, which is shared
   with 7Solve and is not this file's to change.
   ------------------------------------------------------------------ */
const DISPOSABLE = [
    'mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com',
    'temp-mail.org','throwawaymail.com','yopmail.com','sharklasers.com',
    'getnada.com','trashmail.com','maildrop.cc','fakeinbox.com','dispostable.com',
    'mailnesia.com','tempr.email','emailondeck.com','moakt.com','mohmal.com',
    'spamgourmet.com','mytemp.email','tempmailo.com','minuteinbox.com',
    'temp-mail.io','luxusmail.org','1secmail.com','inboxkitten.com',
];

if (isset($body['email'])) {
    $email = trim(strtolower($body['email']));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        a_out(422, ['error' => 'bad_email', 'message' => 'That email does not look right.']);
    }
    $domain = substr($email, strrpos($email, '@') + 1);
    if (in_array($domain, DISPOSABLE, true)) {
        a_out(422, ['error' => 'disposable_email',
            'message' => 'Please use a permanent email address. ' .
                         'Your credits and results are tied to it.']);
    }
    /* An address with no MX record can never receive the sign-up code, so
       catching it here beats letting the student wait for an email that
       physically cannot arrive. Skipped if DNS is unavailable. */
    if (function_exists('checkdnsrr') && !checkdnsrr($domain, 'MX')
        && !checkdnsrr($domain, 'A')) {
        a_out(422, ['error' => 'unroutable_email',
            'message' => 'We cannot deliver email to ' . htmlspecialchars($domain) .
                         '. Please check the spelling.']);
    }
    $body['email'] = $email;
}

/* A name is required to create an account, so the app can greet the student
   by it instead of calling everyone "Student". Only signup_start carries it;
   signup_verify reads it back out of the OTP row the hub stored. */
if ($action === 'signup_start') {
    $name = trim((string)($body['name'] ?? ''));
    if ($name === '' || mb_strlen($name) < 2) {
        a_out(422, ['error' => 'bad_name', 'message' => 'Please enter your name.']);
    }
    $body['name'] = mb_substr($name, 0, 60);
}

/* ------------------------------------------------------------------
   A small throttle, per IP per action. Guessing a password or a 6-digit
   code is only practical at speed; this makes it impractical without
   inconveniencing a student who mistypes a few times.
   ------------------------------------------------------------------ */
$ip  = (string)($_SERVER['REMOTE_ADDR'] ?? '0');
$key = sys_get_temp_dir() . '/7m_auth_' . hash('sha256', $ip . '|' . $action) . '.txt';
$now = time();
$hits = [];
if (is_file($key)) {
    $hits = array_filter(
        array_map('intval', explode(',', (string)@file_get_contents($key))),
        function ($t) use ($now) { return $t > $now - 600; }   /* last 10 min */
    );
}
if (count($hits) >= 12) {
    a_out(429, ['error' => 'too_many',
        'message' => 'Too many attempts. Please wait a few minutes and try again.']);
}
$hits[] = $now;
@file_put_contents($key, implode(',', $hits), LOCK_EX);

/* ------------------------------------------------------------------
   Forward to the hub. hub_call() requires a user token and returns null
   without one, which is exactly what sign-in cannot have yet — so this
   makes the same call directly.
   ------------------------------------------------------------------ */
/* Checked here rather than at the top so that a malformed email is still
   told it is malformed on a server where accounts are not configured. */
if (!hub_on($CFG)) {
    a_out(503, ['error' => 'hub_off',
        'message' => 'Accounts are not configured on this server yet.']);
}

$url = rtrim((string)$CFG['hub_base'], '/') . '/api.php?action=' . rawurlencode($action);
$ch  = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 20,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($body),
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Accept: application/json',
        /* so the hub can tell 7Marks sign-ups from 7Solve ones */
        'X-7By-App: 7marks',
    ],
]);
$resp = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$cerr = curl_error($ch);
curl_close($ch);

if ($resp === false || $code === 0) {
    a_out(502, ['error' => 'hub_unreachable',
        'message' => 'We could not reach the account service. Please try again.',
        'detail'  => $cerr !== '' ? 'connection failed' : 'no response']);
}

$j = json_decode((string)$resp, true);
if (!is_array($j)) {
    a_out(502, ['error' => 'hub_bad_response',
        'message' => 'The account service returned something unexpected.']);
}

/* Pass the hub's own answer straight back, status code included, so the
   card can show the hub's real message rather than a guess. */
a_out($code >= 200 && $code < 600 ? $code : 502, $j);
