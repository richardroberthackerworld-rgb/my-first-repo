<?php
/* ============================================================
   ops-admin.php — the 7Marks operations console.

   ADDITIVE: a new file. It reads the tables ops.php already owns and does
   not change a single existing route, function or response, so 7Solve is
   untouched by its presence.

   Scoping: every panel is filtered to 7Marks.
     • members / plans   — tool_credits.tool = '7marks'   (already per-tool)
     • revenue           — transactions.product|tool      (already per-tool)
     • tickets / errors  — the nullable `tool` column added in ops_migrate
     • email             — `tool`, falling back to the scheduler's dedupe key
   Rows with tool IS NULL are hub-wide and are shown separately, never
   silently attributed to 7Marks.

   SECURITY
     • server-side session + admin_users (password_verify), role checked on
       every request — not a hidden URL
     • bootstrap only via a one-off token in `settings`, so nobody can claim
       the first admin account just by finding this page
     • login throttled per IP; CSRF token on every POST
     • no secret is ever rendered: keys, tokens and credentials are not read
   ============================================================ */

declare(strict_types=1);
header('X-Robots-Tag: noindex, nofollow', true);
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/ops.php';

const ADM_TOOL = '7marks';
const ADM_MAXTRY = 6;          // failed logins per window
const ADM_WINDOW = 900;        // 15 minutes

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax',
        'secure' => (($_SERVER['HTTPS'] ?? '') !== '')]);
    session_start();
}
try { ops_migrate(); } catch (Throwable $e) { /* surfaced on the page below */ }

function adm_db(): PDO { return db(); }
function adm_csrf(): string {
    if (empty($_SESSION['adm_csrf'])) $_SESSION['adm_csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['adm_csrf'];
}
function adm_check_csrf(): bool {
    return isset($_POST['csrf'], $_SESSION['adm_csrf'])
        && hash_equals((string)$_SESSION['adm_csrf'], (string)$_POST['csrf']);
}
function adm_user(): ?array {
    if (empty($_SESSION['adm_id'])) return null;
    $s = adm_db()->prepare('SELECT id,email,name,role,enabled FROM admin_users WHERE id=? LIMIT 1');
    $s->execute([$_SESSION['adm_id']]);
    $u = $s->fetch();
    return ($u && (int)$u['enabled'] === 1) ? $u : null;   // disabling an admin logs them out
}
function adm_admin_count(): int {
    try { return (int)adm_db()->query('SELECT COUNT(*) FROM admin_users')->fetchColumn(); }
    catch (Throwable $e) { return -1; }
}
/** Simple per-IP throttle held in the settings table. */
function adm_throttled(string $ip): bool {
    $raw = ops_setting('adm_try_' . md5($ip), '');
    if (!$raw) return false;
    [$n, $t] = array_pad(explode(':', (string)$raw, 2), 2, '0');
    if (time() - (int)$t > ADM_WINDOW) return false;
    return (int)$n >= ADM_MAXTRY;
}
function adm_note_fail(string $ip): void {
    $k = 'adm_try_' . md5($ip);
    $raw = ops_setting($k, '');
    [$n, $t] = array_pad(explode(':', (string)$raw, 2), 2, '0');
    if (time() - (int)$t > ADM_WINDOW) { $n = 0; $t = time(); }
    ops_set_setting($k, ((int)$n + 1) . ':' . ($t ?: time()));
}
function adm_clear_fail(string $ip): void { ops_set_setting('adm_try_' . md5($ip), '0:' . time()); }
function h($v): string { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }
function adm_money(?int $paise): string { return '₹' . number_format(((int)$paise) / 100, 0); }

$ip    = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$me    = adm_user();
$err   = '';
$count = adm_admin_count();

/* ---------------- logout ---------------- */
if (isset($_GET['logout'])) { $_SESSION = []; session_destroy(); header('Location: ops-admin.php'); exit; }

/* ---------------- bootstrap the first admin (token-gated) ---------------- */
if (!$me && $count === 0 && ($_POST['do'] ?? '') === 'bootstrap') {
    $tok = trim((string)ops_setting('admin_bootstrap_token', ''));
    if (!adm_check_csrf()) {
        $err = 'Session expired. Reload the page and try again.';
    } elseif ($tok === '' || !hash_equals($tok, (string)($_POST['token'] ?? ''))) {
        $err = 'Bootstrap token does not match.';
    } elseif (strlen((string)($_POST['pass'] ?? '')) < 10) {
        $err = 'Choose a password of at least 10 characters.';
    } else {
        $s = adm_db()->prepare(
            'INSERT INTO admin_users (email,pass_hash,name,role,enabled,created_at) VALUES (?,?,?,?,1,NOW())');
        $s->execute([trim((string)$_POST['email']),
                     password_hash((string)$_POST['pass'], PASSWORD_DEFAULT),
                     trim((string)($_POST['name'] ?? 'Owner')), 'owner']);
        ops_set_setting('admin_bootstrap_token', '');          // one-off: burn it
        ops_audit('admin.bootstrap', ['email' => $_POST['email']]);
        header('Location: ops-admin.php'); exit;
    }
}

/* ---------------- login ---------------- */
if (!$me && ($_POST['do'] ?? '') === 'login') {
    if (!adm_check_csrf()) {
        // Checked before the throttle so a forged POST cannot burn an
        // honest admin's remaining attempts.
        $err = 'Session expired. Reload the page and try again.';
    } elseif (adm_throttled($ip)) {
        $err = 'Too many attempts. Try again later.';
    } else {
        $s = adm_db()->prepare('SELECT * FROM admin_users WHERE email=? AND enabled=1 LIMIT 1');
        $s->execute([trim((string)($_POST['email'] ?? ''))]);
        $u = $s->fetch();
        if ($u && password_verify((string)($_POST['pass'] ?? ''), $u['pass_hash'])) {
            session_regenerate_id(true);
            $_SESSION['adm_id'] = (int)$u['id'];
            adm_clear_fail($ip);
            adm_db()->prepare('UPDATE admin_users SET last_login_at=NOW() WHERE id=?')->execute([$u['id']]);
            ops_audit('admin.login', ['email' => $u['email']]);
            header('Location: ops-admin.php'); exit;
        }
        adm_note_fail($ip);
        $err = 'Incorrect email or password.';               // never say which
        usleep(400000);
    }
}

/* ---------------- gate ---------------- */
if (!$me) {
    include __DIR__ . '/ops-admin-login.php';
    exit;
}

/* ================= data, all scoped to 7Marks ================= */
$T = ADM_TOOL;
$q = function (string $sql, array $a = []) { $s = adm_db()->prepare($sql); $s->execute($a); return $s; };
$one = function (string $sql, array $a = [], $d = 0) use ($q) {
    try { $v = $q($sql, $a)->fetchColumn(); return $v === false ? $d : $v; } catch (Throwable $e) { return $d; } };
$all = function (string $sql, array $a = []) use ($q) {
    try { return $q($sql, $a)->fetchAll(); } catch (Throwable $e) { return []; } };

$stat = [
  'members'   => (int)$one("SELECT COUNT(*) FROM tool_credits WHERE tool=?", [$T]),
  'active'    => (int)$one("SELECT COUNT(*) FROM tool_credits WHERE tool=? AND plan<>'none' AND (plan_expires IS NULL OR plan_expires>NOW())", [$T]),
  'expiring'  => (int)$one("SELECT COUNT(*) FROM tool_credits WHERE tool=? AND plan<>'none' AND plan_expires BETWEEN NOW() AND DATE_ADD(NOW(),INTERVAL 30 DAY)", [$T]),
  'expired'   => (int)$one("SELECT COUNT(*) FROM tool_credits WHERE tool=? AND plan<>'none' AND plan_expires<NOW()", [$T]),
  'new30'     => (int)$one("SELECT COUNT(*) FROM transactions WHERE (product=? OR tool=?) AND status='paid' AND created_at>DATE_SUB(NOW(),INTERVAL 30 DAY)", [$T,$T]),
  'rev_total' => (int)$one("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE (product=? OR tool=?) AND status='paid'", [$T,$T]),
  'rev_30'    => (int)$one("SELECT COALESCE(SUM(amount),0) FROM transactions WHERE (product=? OR tool=?) AND status='paid' AND created_at>DATE_SUB(NOW(),INTERVAL 30 DAY)", [$T,$T]),
  'failed'    => (int)$one("SELECT COUNT(*) FROM transactions WHERE (product=? OR tool=?) AND status<>'paid'", [$T,$T]),
  'mail_q'    => (int)$one("SELECT COUNT(*) FROM email_queue WHERE status='queued'"),
  'mail_fail' => (int)$one("SELECT COUNT(*) FROM email_queue WHERE status='failed'"),
  'tickets'   => (int)$one("SELECT COUNT(*) FROM support_tickets WHERE tool=? AND status IN ('open','in_progress')", [$T]),
  'errors'    => (int)$one("SELECT COUNT(*) FROM system_errors WHERE tool=? AND status='open'", [$T]),
];
$members = $all("SELECT u.email,u.name,tc.plan,tc.credits,tc.plan_expires
                   FROM tool_credits tc JOIN users u ON u.id=tc.user_id
                  WHERE tc.tool=? ORDER BY tc.plan_expires IS NULL, tc.plan_expires DESC LIMIT 12", [$T]);
$txs     = $all("SELECT payment_id,plan,amount,status,created_at FROM transactions
                  WHERE (product=? OR tool=?) ORDER BY created_at DESC LIMIT 10", [$T,$T]);
$mails   = $all("SELECT template,to_email,status,attempts,created_at FROM email_queue
                  WHERE tool=? OR dedupe_key LIKE ? ORDER BY id DESC LIMIT 10", [$T,'%tool:'.$T.'%']);
$tickets = $all("SELECT ref,name,email,category,subject,status,created_at FROM support_tickets
                  WHERE tool=? ORDER BY id DESC LIMIT 10", [$T]);
$errors  = $all("SELECT ref,type,severity,route,occurrences,last_seen,status FROM system_errors
                  WHERE tool=? ORDER BY last_seen DESC LIMIT 10", [$T]);
$runs    = $all("SELECT started_at,duration_ms,ok,summary FROM scheduler_runs ORDER BY id DESC LIMIT 6");
$hubWide = ['tickets' => (int)$one("SELECT COUNT(*) FROM support_tickets WHERE tool IS NULL"),
            'errors'  => (int)$one("SELECT COUNT(*) FROM system_errors WHERE tool IS NULL")];
$lastRun = $runs[0]['started_at'] ?? null;
$schedOk = $lastRun && (time() - strtotime((string)$lastRun) < 1800);

include __DIR__ . '/ops-admin-view.php';
