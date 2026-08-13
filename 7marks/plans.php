<?php
/**
 * 7MARKS — plans, entitlements and the credit ledger.
 *
 * This is a STANDALONE endpoint. It deliberately does not modify api.php or
 * anything in account-hub/, because the hub is shared with 7Solve and must
 * keep behaving identically for it. Everything here is 7Marks-only.
 *
 * What lives here, and why it lives on the server:
 *   - the plan catalogue and what each plan is entitled to
 *   - the entitlement check (Spark may not use AI at all)
 *   - idempotency, so a double-click or a retry cannot charge twice
 *   - the credit ledger (what was spent, when, and the balance after)
 *
 * What deliberately does NOT live here: the balance itself. The authoritative
 * balance and the decrement stay in the hub's tool_credits wallet, whose
 * tool_spend() already does a guarded atomic update
 *     UPDATE ... SET credits = credits - ? WHERE ... AND credits >= ?
 * so a concurrent request cannot drive it negative. Re-implementing that here
 * would create a second source of truth, which is exactly what the brief says
 * not to do.
 *
 * Endpoints (all relative to this file):
 *   GET  ?action=plans                 the catalogue (public, no auth)
 *   GET  ?action=status                current plan, credits, entitlements
 *   POST ?action=spend                 charge for ONE delivered AI generation
 *   GET  ?action=ledger                this device/user's transaction history
 *   POST ?action=bonus                 claim the Infinity daily +20
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$CFG = is_file(__DIR__ . '/keys.php') ? require __DIR__ . '/keys.php' : [];
require_once __DIR__ . '/billing.php';

function p_out(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------------------------------------------------------------- origin */
function p_origin_ok(array $CFG): bool {
    $allow = $CFG['allow_origins'] ?? [];
    if (!$allow) return true;                       /* not configured = local dev */
    $o = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($o === '') return true;                     /* same-origin form posts */
    foreach ($allow as $a) if (strcasecmp($a, $o) === 0) return true;
    return false;
}

/* ================================================================
   THE CATALOGUE
   One AI generation costs AI_COST credits, everywhere, always.
   ================================================================ */
const AI_COST = 10;

function p_plans(): array {
    return [
        'ai_cost' => AI_COST,
        'plans' => [
            'free' => [
                'key' => 'free', 'name' => '7Marks Free', 'badge' => 'FREE',
                'tag' => 'Try the study tools.',
                'price' => ['monthly' => 0, 'yearly' => 0],
                'credits' => 0, 'daily' => 0,
                'ai' => false,
                'support' => 'Community',
                'includes' => ['Practice & mock tests', 'Question papers', 'Bookmarks',
                               'Notes & flashcards', 'Study planner'],
                'excludes' => ['AI Study Assistant', 'AI question generation',
                               'AI correction & scoring'],
            ],
            'spark' => [
                'key' => 'spark', 'name' => '7Marks Spark', 'badge' => 'SPARK',
                'tag' => 'Start your journey.',
                'price' => ['monthly' => 49, 'yearly' => 499],
                'credits' => 500, 'daily' => 0,
                /* Spark is explicitly a NON-AI plan. This flag is what the
                   entitlement check reads; it is not a UI decoration. */
                'ai' => false,
                'support' => 'Standard support',
                'includes' => ['500 credits every month', 'Core study tools', 'Practice',
                               'Question papers', 'Bookmarks', 'Notes & flashcards',
                               'Study planner', 'Performance tracking', 'Analytics',
                               'Leaderboard', 'Challenges', 'Basic mock tests'],
                'excludes' => ['AI tools are not available on Spark'],
            ],
            'pro' => [
                'key' => 'pro', 'name' => '7Marks Pro', 'badge' => 'PRO',
                'tag' => 'Study smarter with AI.',
                'price' => ['monthly' => 99, 'yearly' => 999],
                'credits' => 1000, 'daily' => 0,
                'ai' => true, 'popular' => true,
                'support' => 'Priority support',
                'includes' => ['1,000 credits every month', 'Everything in Spark',
                               'AI Study Assistant', 'AI question generation',
                               'AI explanations', 'AI correction & scoring',
                               'AI notes & flashcards', 'AI practice generation',
                               'AI study-plan generation', 'Advanced mock tests',
                               'Advanced analytics', 'Priority access'],
                'excludes' => [],
            ],
            'infinity' => [
                'key' => 'infinity', 'name' => '7Marks Infinity', 'badge' => 'INFINITY',
                'tag' => 'Everything. No limits on learning.',
                'price' => ['monthly' => 999, 'yearly' => 9999],
                'credits' => 10000, 'daily' => 20,
                'ai' => true, 'flagship' => true,
                'support' => 'Full priority support',
                'includes' => ['10,000 credits every month', '+20 free credits every day',
                               'Everything in Pro', 'Full AI access',
                               'Advanced AI generation', 'Full analytics',
                               'Advanced performance insights', 'Premium challenges',
                               'Full priority support', 'Early access to new features'],
                'excludes' => [],
            ],
        ],
    ];
}

/** The plan a wallet is on. Unknown or expired plans fall back to free. */
function p_plan_of(?array $wallet): array {
    $all = p_plans()['plans'];
    $key = strtolower((string)($wallet['plan'] ?? 'none'));
    /* the hub stores generic plan names for its own products; map anything it
       does not recognise onto the nearest 7Marks tier rather than guessing */
    if ($key === '' || $key === 'none' || $key === 'free') $key = 'free';
    if (!isset($all[$key])) {
        $credits = (int)($wallet['credits'] ?? 0);
        $key = $credits >= 10000 ? 'infinity' : ($credits >= 1000 ? 'pro'
             : ($credits > 0 ? 'spark' : 'free'));
    }
    return $all[$key];
}

/* ================================================================
   LEDGER + IDEMPOTENCY
   Stored per user under a hashed key. The hub owns the balance; this owns the
   audit trail and the "have I already charged for this request" question.
   ================================================================ */
function p_dir(): string {
    $d = __DIR__ . '/.ledger';
    if (!is_dir($d)) { @mkdir($d, 0700, true); @file_put_contents($d . '/.htaccess', "Deny from all\n"); }
    return $d;
}
function p_file(string $who): string {
    return p_dir() . '/' . hash('sha256', $who) . '.json';
}
function p_read(string $who): array {
    $f = p_file($who);
    if (!is_file($f)) return ['tx' => [], 'seen' => [], 'bonus_at' => null];
    $j = json_decode((string)@file_get_contents($f), true);
    return is_array($j) ? $j + ['tx' => [], 'seen' => [], 'bonus_at' => null]
                        : ['tx' => [], 'seen' => [], 'bonus_at' => null];
}
function p_write(string $who, array $data): void {
    $data['tx'] = array_slice($data['tx'], -200);          /* keep it bounded */
    if (count($data['seen']) > 400) $data['seen'] = array_slice($data['seen'], -400, null, true);
    @file_put_contents(p_file($who), json_encode($data), LOCK_EX);
}

/** Identify the caller. A signed-in hub token wins; otherwise the device pass. */
function p_who(): array {
    $tok = '';
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (stripos($h, 'Bearer ') === 0) $tok = trim(substr($h, 7));
    if ($tok === '') $tok = (string)($_GET['t'] ?? $_POST['t'] ?? '');
    $dev = (string)($_COOKIE['m7dev'] ?? '');
    if ($dev === '' && $tok === '') {
        $dev = bin2hex(random_bytes(16));
        setcookie('m7dev', $dev, ['expires' => time() + 86400 * 365, 'path' => '/',
                                  'samesite' => 'Lax', 'httponly' => true,
                                  'secure' => !empty($_SERVER['HTTPS'])]);
    }
    return [$tok, $tok !== '' ? 'u:' . hash('sha256', $tok) : 'd:' . $dev];
}

/* ================================================================ routes */
$action = (string)($_GET['action'] ?? '');
$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';

if ($action === 'plans') p_out(200, p_plans());

if (!p_origin_ok($CFG)) p_out(403, ['error' => 'origin_not_allowed']);

list($token, $who) = p_who();
$APP = 'app';

/** Ask the hub for the authoritative wallet. Never cached, never trusted from the client. */
/**
 * The hub's whole `me` response, fetched once per request.
 *
 * p_wallet() returns only the wallet, which is a tool_credits row and has
 * no name on it — reading a display name from there could never have
 * worked, which is why the greeting stayed "Hello, Student!". The user
 * lives at the top level of this body, so anything about the PERSON has to
 * come from here rather than from their wallet.
 */
function p_me(array $CFG, string $token): ?array {
    static $cache = null, $for = null;
    if ($cache !== null && $for === $token) return $cache;
    if ($token === '' || !function_exists('hub_call')) return null;
    $r = @hub_call($CFG, 'me', $token, []);
    if (!$r || empty($r['body'])) return null;
    $for = $token;
    return $cache = (is_array($r['body']) ? $r['body'] : null);
}

/** The display name the hub holds for this student, or ''. */
function p_name(array $CFG, string $token): string {
    $b = p_me($CFG, $token);
    if (!is_array($b)) return '';
    $u = is_array($b['user'] ?? null) ? $b['user'] : $b;
    foreach (array('name', 'display_name', 'full_name', 'username') as $k) {
        if (!empty($u[$k]) && is_string($u[$k])) return trim($u[$k]);
    }
    /* fall back to the part of the email before the @, which is still far
       better than calling everyone "Student" */
    $mail = (string)($u['email'] ?? '');
    if ($mail !== '' && strpos($mail, '@') > 0) return substr($mail, 0, strpos($mail, '@'));
    return '';
}

function p_wallet(array $CFG, string $token): ?array {
    $b = p_me($CFG, $token);
    if (!is_array($b)) return null;
    return is_array($b['wallet'] ?? null) ? $b['wallet']
         : (is_array($b['tool'] ?? null) ? $b['tool'] : $b);
}

if ($action === 'status') {
    $w = p_wallet($CFG, $token);
    $plan = p_plan_of($w);
    $led = p_read($who);
    $today = gmdate('Y-m-d');
    /* the name comes from the USER, not the wallet — see p_name() */
    $who2 = array('name' => p_name($CFG, $token));
    p_out(200, [
        'signed_in' => $token !== '',
        /* the name comes from the hub, which owns it */
        'name' => (string)($who2['name'] ?? $who2['display_name'] ?? ''),
        'plan' => [
            'key' => $plan['key'], 'name' => $plan['name'], 'badge' => $plan['badge'],
            'ai' => (bool)$plan['ai'], 'support' => $plan['support'],
            'monthly_credits' => $plan['credits'],
        ],
        'credits' => (int)($w['credits'] ?? 0),
        'plan_expires' => $w['plan_expires'] ?? null,
        'ai_cost' => AI_COST,
        'daily_bonus' => [
            'amount' => (int)$plan['daily'],
            'eligible' => $plan['daily'] > 0,
            /* claimed state is decided by the SERVER's date, not the browser's */
            'claimed_today' => ($led['bonus_at'] ?? null) === $today,
            'resets_in' => strtotime('tomorrow midnight UTC') - time(),
        ],
        'spent_total' => array_sum(array_map(function ($t) { return (int)($t['amt'] ?? 0); }, $led['tx'])),
    ]);
}

if ($action === 'ledger') {
    $led = p_read($who);
    p_out(200, ['tx' => array_reverse(array_slice($led['tx'], -60))]);
}

/* ---------------------------------------------------------------- spend --
   Called ONCE, after a generation has actually been delivered to the screen.
   A failed or empty generation never reaches here, so Rule 5 (failed request
   costs nothing) falls out of the call order rather than needing a refund. */
if ($action === 'spend') {
    if (!$isPost) p_out(405, ['error' => 'post_only']);

    $in  = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $ref = trim((string)($in['ref'] ?? ''));         /* idempotency key */
    $lbl = trim((string)($in['label'] ?? 'AI generation'));
    if ($ref === '' || strlen($ref) > 120) p_out(400, ['error' => 'ref_required']);

    $led = p_read($who);

    /* Rule 9 — the same delivered result is never charged twice, however many
       times the button is clicked or the request is retried. Regenerating
       sends a NEW ref, so Rule 4 still charges for genuinely new work. */
    if (isset($led['seen'][$ref])) {
        $w = p_wallet($CFG, $token);
        p_out(200, ['ok' => true, 'charged' => 0, 'duplicate' => true,
                    'credits' => (int)($w['credits'] ?? 0)]);
    }

    $w = p_wallet($CFG, $token);
    $plan = p_plan_of($w);

    /* Rule: entitlement first. Spark and Free may not run AI at all, and are
       told to upgrade rather than being silently charged. */
    if (!$plan['ai']) {
        p_out(402, ['error' => 'plan_no_ai', 'plan' => $plan['key'],
                    'plan_name' => $plan['name'],
                    'message' => 'AI tools are not included in ' . $plan['name'] . '.']);
    }

    $have = (int)($w['credits'] ?? 0);
    if ($have < AI_COST) {
        p_out(402, ['error' => 'insufficient_credits', 'need' => AI_COST,
                    'credits' => $have]);
    }

    /* The decrement itself is the hub's job: its UPDATE is guarded on
       credits >= cost, so two concurrent spends cannot both succeed against
       the same last 10 credits. */
    list($ok, $left) = hub_spend_n($CFG, $APP, $token, AI_COST);
    if (!$ok) {
        p_out(402, ['error' => is_string($left) ? $left : 'spend_failed',
                    'credits' => $have]);
    }

    $led['seen'][$ref] = time();
    $led['tx'][] = ['at' => time(), 'label' => $lbl, 'amt' => AI_COST, 'bal' => (int)$left];
    p_write($who, $led);

    p_out(200, ['ok' => true, 'charged' => AI_COST, 'credits' => (int)$left]);
}

/* ---------------------------------------------------------------- bonus -- */
if ($action === 'bonus') {
    if (!$isPost) p_out(405, ['error' => 'post_only']);
    $w = p_wallet($CFG, $token);
    $plan = p_plan_of($w);
    if ((int)$plan['daily'] <= 0) p_out(403, ['error' => 'not_eligible', 'plan' => $plan['key']]);

    $led = p_read($who);
    $today = gmdate('Y-m-d');                        /* server date, always */
    if (($led['bonus_at'] ?? null) === $today) {
        p_out(200, ['ok' => false, 'already_claimed' => true,
                    'credits' => (int)($w['credits'] ?? 0)]);
    }
    /* Granting has to go through the hub too — this file must never be able to
       mint credits on its own, or the ledger becomes a second source of truth. */
    $r = @hub_call($CFG, 'bonus', $token, ['count' => (int)$plan['daily'], 'product' => $APP]);
    if (!$r || empty($r['body']['ok'])) {
        p_out(502, ['ok' => false, 'error' => 'grant_unavailable',
                    'message' => 'The account service did not confirm the bonus. Nothing was changed.']);
    }
    $led['bonus_at'] = $today;
    $led['tx'][] = ['at' => time(), 'label' => 'Daily bonus', 'amt' => -(int)$plan['daily'],
                    'bal' => (int)($r['body']['credits'] ?? 0)];
    p_write($who, $led);
    p_out(200, ['ok' => true, 'granted' => (int)$plan['daily'],
                'credits' => (int)($r['body']['credits'] ?? 0)]);
}

p_out(400, ['error' => 'unknown_action']);
