<?php
/* ============================================================
   ops.php — operational backbone for the 7By account hub.

   Slice 1 of the platform upgrade: the database foundation, error
   monitoring, and the email service (queue + retry + templates).

   Additive by design. Nothing here runs unless it is called, and it
   never modifies an existing table — so requiring this file cannot
   change how the live hub behaves today.

   It builds on what lib.php already provides:
     db()                     PDO handle
     send_email($to,$s,$html) SMTP transport (falls back to mail())
     email_template($h,$b)    branded, client-safe HTML wrapper
     mail_from()              default sender

   Usage:
     require_once __DIR__ . '/ops.php';
     ops_migrate();                       // safe to call repeatedly
     ops_error('AI_PROVIDER_UNAVAILABLE', 'high', $msg, [...]);
     ops_mail('billing', $to, 'purchase_success', ['name'=>'…']);
     ops_mail_flush();                    // called by the cron worker
   ============================================================ */

if (!function_exists('db')) { require_once __DIR__ . '/lib.php'; }

/* ------------------------------------------------------------------
   1. SCHEMA
   Every table is IF NOT EXISTS and additive; running this against a
   live database adds tables and touches nothing that already exists.
   Indexes are on the columns the admin panel will actually filter by.
   ------------------------------------------------------------------ */
function ops_migrate() {
    $pdo = db();

    /* key/value config editable from the admin panel, so senders and
       toggles do not require a code change */
    $pdo->exec("CREATE TABLE IF NOT EXISTS settings (
        skey        VARCHAR(64) PRIMARY KEY,
        sval        TEXT NULL,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    /* One row per DISTINCT problem, not per occurrence — that is what
       makes throttling possible. `fingerprint` groups repeats. */
    $pdo->exec("CREATE TABLE IF NOT EXISTS system_errors (
        id            BIGINT AUTO_INCREMENT PRIMARY KEY,
        ref           VARCHAR(24) NOT NULL,
        fingerprint   CHAR(40) NOT NULL,
        type          VARCHAR(64) NOT NULL,
        severity      ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
        route         VARCHAR(191) NULL,
        message       TEXT NULL,
        detail        MEDIUMTEXT NULL,
        user_id       BIGINT NULL,
        user_email    VARCHAR(191) NULL,
        occurrences   INT NOT NULL DEFAULT 1,
        first_seen    DATETIME NOT NULL,
        last_seen     DATETIME NOT NULL,
        status        ENUM('open','investigating','identified','fixing','resolved','ignored') NOT NULL DEFAULT 'open',
        resolution    TEXT NULL,
        resolved_at   DATETIME NULL,
        last_alert_at DATETIME NULL,
        alerts_sent   INT NOT NULL DEFAULT 0,
        UNIQUE KEY uniq_ref (ref),
        KEY idx_group  (fingerprint, status),
        KEY idx_status (status, last_seen),
        KEY idx_type   (type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    /* Outbound mail is queued, never sent inline — a slow SMTP server
       must never hold up a purchase or a page load. */
    $pdo->exec("CREATE TABLE IF NOT EXISTS email_queue (
        id            BIGINT AUTO_INCREMENT PRIMARY KEY,
        dedupe_key    VARCHAR(191) NULL,
        sender_kind   VARCHAR(24) NOT NULL DEFAULT 'noreply',
        to_email      VARCHAR(191) NOT NULL,
        to_name       VARCHAR(191) NULL,
        template      VARCHAR(64) NOT NULL,
        subject       VARCHAR(255) NOT NULL,
        vars          MEDIUMTEXT NULL,
        user_id       BIGINT NULL,
        status        ENUM('pending','sending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
        attempts      INT NOT NULL DEFAULT 0,
        next_attempt  DATETIME NOT NULL,
        last_error    TEXT NULL,
        created_at    DATETIME NOT NULL,
        sent_at       DATETIME NULL,
        UNIQUE KEY uniq_dedupe (dedupe_key),
        KEY idx_due    (status, next_attempt),
        KEY idx_user   (user_id),
        KEY idx_tpl    (template)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    /* permanent record, kept even after the queue row is pruned */
    $pdo->exec("CREATE TABLE IF NOT EXISTS email_log (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        queue_id    BIGINT NULL,
        to_email    VARCHAR(191) NOT NULL,
        from_email  VARCHAR(191) NULL,
        template    VARCHAR(64) NULL,
        subject     VARCHAR(255) NULL,
        status      ENUM('sent','failed') NOT NULL,
        provider    VARCHAR(32) NULL,
        attempts    INT NOT NULL DEFAULT 1,
        error       TEXT NULL,
        created_at  DATETIME NOT NULL,
        KEY idx_to     (to_email),
        KEY idx_status (status, created_at),
        KEY idx_tpl    (template)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    /* editable copy overrides the built-in template of the same name */
    $pdo->exec("CREATE TABLE IF NOT EXISTS email_templates (
        name       VARCHAR(64) PRIMARY KEY,
        subject    VARCHAR(255) NOT NULL,
        heading    VARCHAR(191) NULL,
        body_html  MEDIUMTEXT NOT NULL,
        updated_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    /* in-app notification centre, for both admin and user */
    $pdo->exec("CREATE TABLE IF NOT EXISTS notifications (
        id         BIGINT AUTO_INCREMENT PRIMARY KEY,
        audience   ENUM('user','admin') NOT NULL DEFAULT 'user',
        user_id    BIGINT NULL,
        type       VARCHAR(48) NOT NULL,
        title      VARCHAR(191) NOT NULL,
        body       TEXT NULL,
        link       VARCHAR(255) NULL,
        read_at    DATETIME NULL,
        created_at DATETIME NOT NULL,
        KEY idx_user  (user_id, read_at),
        KEY idx_admin (audience, read_at, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_logs (
        id         BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor      VARCHAR(191) NOT NULL,
        action     VARCHAR(64) NOT NULL,
        target     VARCHAR(191) NULL,
        detail     TEXT NULL,
        result     VARCHAR(32) NOT NULL DEFAULT 'ok',
        ip         VARCHAR(45) NULL,
        created_at DATETIME NOT NULL,
        KEY idx_actor  (actor, created_at),
        KEY idx_action (action, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    /* Slice 4 fills these in. Created now so there is exactly one
       migration to run against production, not two. */
    $pdo->exec("CREATE TABLE IF NOT EXISTS api_keys (
        id           BIGINT AUTO_INCREMENT PRIMARY KEY,
        provider     VARCHAR(32) NOT NULL,
        label        VARCHAR(64) NOT NULL,
        secret_enc   TEXT NOT NULL,
        hint         VARCHAR(32) NULL,
        enabled      TINYINT(1) NOT NULL DEFAULT 1,
        priority     INT NOT NULL DEFAULT 100,
        uses         BIGINT NOT NULL DEFAULT 0,
        failures     INT NOT NULL DEFAULT 0,
        cooldown_until DATETIME NULL,
        last_used_at DATETIME NULL,
        created_at   DATETIME NOT NULL,
        KEY idx_pick (provider, enabled, priority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS api_health (
        provider     VARCHAR(32) PRIMARY KEY,
        state        ENUM('healthy','degraded','offline') NOT NULL DEFAULT 'healthy',
        ok_count     BIGINT NOT NULL DEFAULT 0,
        fail_count   BIGINT NOT NULL DEFAULT 0,
        avg_ms       INT NOT NULL DEFAULT 0,
        last_ok_at   DATETIME NULL,
        last_fail_at DATETIME NULL,
        last_error   TEXT NULL,
        updated_at   DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS support_tickets (
        id         BIGINT AUTO_INCREMENT PRIMARY KEY,
        ref        VARCHAR(24) NOT NULL,
        user_id    BIGINT NULL,
        name       VARCHAR(191) NULL,
        email      VARCHAR(191) NOT NULL,
        category   VARCHAR(32) NOT NULL DEFAULT 'other',
        subject    VARCHAR(191) NOT NULL,
        message    MEDIUMTEXT NOT NULL,
        order_ref  VARCHAR(64) NULL,
        status     ENUM('open','in_progress','waiting','resolved','closed') NOT NULL DEFAULT 'open',
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        UNIQUE KEY uniq_ref (ref),
        KEY idx_status (status, updated_at),
        KEY idx_email  (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS support_messages (
        id         BIGINT AUTO_INCREMENT PRIMARY KEY,
        ticket_id  BIGINT NOT NULL,
        author     ENUM('customer','admin') NOT NULL,
        body       MEDIUMTEXT NOT NULL,
        created_at DATETIME NOT NULL,
        KEY idx_ticket (ticket_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    $pdo->exec("CREATE TABLE IF NOT EXISTS admin_users (
        id            BIGINT AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(191) NOT NULL,
        pass_hash     VARCHAR(255) NOT NULL,
        name          VARCHAR(191) NULL,
        role          ENUM('owner','admin','viewer') NOT NULL DEFAULT 'admin',
        enabled       TINYINT(1) NOT NULL DEFAULT 1,
        last_login_at DATETIME NULL,
        created_at    DATETIME NOT NULL,
        UNIQUE KEY uniq_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    /* one row per scheduler tick — execution log and heartbeat history */
    $pdo->exec("CREATE TABLE IF NOT EXISTS scheduler_runs (
        id          BIGINT AUTO_INCREMENT PRIMARY KEY,
        started_at  DATETIME NOT NULL,
        duration_ms INT NOT NULL DEFAULT 0,
        ok          TINYINT(1) NOT NULL DEFAULT 1,
        summary     TEXT NULL,
        KEY idx_when (started_at),
        KEY idx_ok   (ok, started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    /* plans become data so new tiers need no frontend change (§10) */
    $pdo->exec("CREATE TABLE IF NOT EXISTS plans (
        code        VARCHAR(32) PRIMARY KEY,
        name        VARCHAR(64) NOT NULL,
        price_paise INT NOT NULL DEFAULT 0,
        days        INT NOT NULL DEFAULT 30,
        credits     INT NOT NULL DEFAULT 0,
        features    TEXT NULL,
        enabled     TINYINT(1) NOT NULL DEFAULT 1,
        sort_order  INT NOT NULL DEFAULT 100
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    return true;
}

/* ------------------------------------------------------------------
   2. SETTINGS  — admin-editable, with a config.php fallback
   ------------------------------------------------------------------ */
function ops_setting($key, $default = null) {
    static $cache = null;
    if ($cache === null) {
        $cache = [];
        try {
            foreach (db()->query('SELECT skey, sval FROM settings') as $r) {
                $cache[$r['skey']] = $r['sval'];
            }
        } catch (Throwable $e) { /* table not migrated yet — fall through */ }
    }
    return array_key_exists($key, $cache) ? $cache[$key] : $default;
}

function ops_set_setting($key, $val) {
    db()->prepare('INSERT INTO settings (skey, sval) VALUES (?,?)
                   ON DUPLICATE KEY UPDATE sval = VALUES(sval)')
        ->execute([$key, $val]);
}

/* Which mailbox a given kind of message comes from. Defaults to @7by.in
   because a subdomain mailbox needs its own SPF/DKIM and most hosts will
   not issue one; override per-kind from the admin panel. */
function ops_sender($kind = 'noreply') {
    $domain = ops_setting('mail_domain', '7by.in');
    $map = [
        'hello'   => 'hello@'    . $domain,
        'support' => 'support@'  . $domain,
        'billing' => 'billing@'  . $domain,
        'noreply' => 'no-reply@' . $domain,
        'admin'   => 'admin@'    . $domain,
    ];
    $addr = ops_setting('mail_from_' . $kind, $map[$kind] ?? $map['noreply']);
    return $addr;
}

function ops_owner_email() {
    global $CFG;
    return ops_setting('owner_email', $CFG['owner_email'] ?? ops_sender('admin'));
}

/* ------------------------------------------------------------------
   3. TEMPLATES — {{var}} substitution, escaped by default
   A template is trusted HTML; the VALUES are not, so they are escaped
   unless the placeholder is explicitly marked raw with {{{var}}}.
   ------------------------------------------------------------------ */
function ops_render($html, array $vars) {
    // {{{raw}}} first, so the escaped pass cannot double-handle it
    $html = preg_replace_callback('/\{\{\{\s*([a-z0-9_]+)\s*\}\}\}/i', function ($m) use ($vars) {
        return isset($vars[$m[1]]) ? (string)$vars[$m[1]] : '';
    }, $html);
    return preg_replace_callback('/\{\{\s*([a-z0-9_]+)\s*\}\}/i', function ($m) use ($vars) {
        return isset($vars[$m[1]]) ? htmlspecialchars((string)$vars[$m[1]], ENT_QUOTES, 'UTF-8') : '';
    }, $html);
}

/* A DB template of the same name wins, so copy can be edited without a
   deploy; otherwise the built-in below is used. */
function ops_template($name) {
    try {
        $st = db()->prepare('SELECT subject, heading, body_html FROM email_templates WHERE name = ?');
        $st->execute([$name]);
        if ($row = $st->fetch()) return $row;
    } catch (Throwable $e) { /* not migrated yet */ }
    $b = ops_builtin_templates();
    return $b[$name] ?? null;
}

function ops_builtin_templates() {
    $btn = function ($href, $label) {
        return '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto"><tr>'
             . '<td align="center" bgcolor="#2647cf" style="border-radius:6px">'
             . '<a href="' . $href . '" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;'
             . 'font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none">' . $label . '</a>'
             . '</td></tr></table>';
    };
    $p = function ($t) {
        return '<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#33334a">' . $t . '</p>';
    };
    $rows = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
          . 'style="border-collapse:collapse;margin:6px 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px">';

    return [
        'purchase_success' => [
            'subject' => '🎉 Welcome to 7Solve {{plan}}',
            'heading' => 'Your plan is active',
            'body_html' =>
                $p('Hi {{name}}, thank you — your payment came through and <b>{{plan}}</b> is live on your account right now.')
              . $rows
              . '<tr><td style="padding:7px 0;color:#71718c">Plan</td><td style="padding:7px 0;text-align:right"><b>{{plan}}</b></td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Amount</td><td style="padding:7px 0;text-align:right"><b>{{amount}}</b></td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Order ID</td><td style="padding:7px 0;text-align:right">{{order_id}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Starts</td><td style="padding:7px 0;text-align:right">{{start_date}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Renews / expires</td><td style="padding:7px 0;text-align:right"><b>{{expiry_date}}</b></td></tr>'
              . '</table>'
              . $btn('{{dashboard_url}}', 'Open my dashboard')
              . $p('Any trouble at all, just reply to this email and a human will pick it up.'),
        ],
        'owner_purchase' => [
            'subject' => '💰 New 7Solve purchase — {{amount}}',
            'heading' => 'New purchase',
            'body_html' => $rows
              . '<tr><td style="padding:7px 0;color:#71718c">Customer</td><td style="padding:7px 0;text-align:right"><b>{{name}}</b></td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Email</td><td style="padding:7px 0;text-align:right">{{email}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Plan</td><td style="padding:7px 0;text-align:right">{{plan}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Amount</td><td style="padding:7px 0;text-align:right"><b>{{amount}}</b></td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Payment ID</td><td style="padding:7px 0;text-align:right">{{order_id}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Expires</td><td style="padding:7px 0;text-align:right">{{expiry_date}}</td></tr>'
              . '</table>' . $btn('{{admin_url}}', 'Open admin'),
        ],
        'system_error' => [
            'subject' => '🚨 7Solve system alert — {{type}}',
            'heading' => 'Something needs your attention',
            'body_html' =>
                $p('<b>{{type}}</b> — severity <b>{{severity}}</b>.')
              . $p('This has happened <b>{{occurrences}}×</b> since {{first_seen}}. This is one grouped alert, not one per occurrence.')
              . $rows
              . '<tr><td style="padding:7px 0;color:#71718c">Incident</td><td style="padding:7px 0;text-align:right"><b>{{ref}}</b></td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Where</td><td style="padding:7px 0;text-align:right">{{route}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Last seen</td><td style="padding:7px 0;text-align:right">{{last_seen}}</td></tr>'
              . '</table>'
              . '<pre style="margin:0 0 18px;padding:12px;background:#f4f4f8;border-radius:6px;font-size:12px;'
              . 'line-height:1.5;color:#43435c;white-space:pre-wrap;word-break:break-word">{{message}}</pre>'
              . $btn('{{admin_url}}', 'View incident'),
        ],
        'system_resolved' => [
            'subject' => '✅ 7Solve incident resolved — {{ref}}',
            'heading' => 'Resolved',
            'body_html' =>
                $p('<b>{{type}}</b> is resolved.')
              . $rows
              . '<tr><td style="padding:7px 0;color:#71718c">Incident</td><td style="padding:7px 0;text-align:right"><b>{{ref}}</b></td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Started</td><td style="padding:7px 0;text-align:right">{{first_seen}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Resolved</td><td style="padding:7px 0;text-align:right">{{resolved_at}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Duration</td><td style="padding:7px 0;text-align:right">{{duration}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Total occurrences</td><td style="padding:7px 0;text-align:right">{{occurrences}}</td></tr>'
              . '</table>'
              . $p('<b>Resolution:</b> {{resolution}}'),
        ],
        /* ---- subscription lifecycle ----
           Urgency rises down the ladder, but the tone stays civil: these go
           to someone who has already paid us once. */
        'expiry_30' => [
            'subject' => '⏰ Your 7Solve {{plan}} renews in a month',
            'heading' => 'A month to go',
            'body_html' =>
                $p('Hi {{name}}, your <b>{{plan}}</b> plan runs until <b>{{expiry_date}}</b> — about a month away.')
              . $p('Nothing to do today. This is just so the date is not a surprise.')
              . $btn('{{renew_url}}', 'Renew early'),
        ],
        'expiry_15' => [
            'subject' => '📚 15 days left on your 7Solve {{plan}}',
            'heading' => '15 days left',
            'body_html' =>
                $p('Hi {{name}}, your <b>{{plan}}</b> plan ends on <b>{{expiry_date}}</b>.')
              . $p('Renewing keeps your notebook, saved doubts and history exactly as they are.')
              . $btn('{{renew_url}}', 'Renew now'),
        ],
        'expiry_5' => [
            'subject' => '⚠️ 5 days left on your 7Solve {{plan}}',
            'heading' => '5 days left',
            'body_html' =>
                $p('Hi {{name}}, your <b>{{plan}}</b> plan ends on <b>{{expiry_date}}</b> — that is 5 days away.')
              . $btn('{{renew_url}}', 'Renew now')
              . $p('Want more of everything instead? <a href="{{upgrade_url}}" style="color:#2647cf">Compare plans</a>.'),
        ],
        'expiry_3' => [
            'subject' => '🚨 Only 3 days left on your 7Solve plan',
            'heading' => 'Only 3 days left',
            'body_html' =>
                $p('Hi {{name}}, your <b>{{plan}}</b> plan ends on <b>{{expiry_date}}</b>.')
              . $p('After that your account stays, but {{plan}} features pause until you renew.')
              . $btn('{{renew_url}}', 'Renew now'),
        ],
        'expiry_1' => [
            'subject' => '⏳ Your 7Solve plan ends tomorrow',
            'heading' => 'Ends tomorrow',
            'body_html' =>
                $p('Hi {{name}}, this is the last reminder — your <b>{{plan}}</b> plan ends <b>tomorrow, {{expiry_date}}</b>.')
              . $btn('{{renew_url}}', 'Renew now')
              . $p('If you would rather not continue, no action is needed. Nothing will be charged automatically.'),
        ],
        'expired' => [
            'subject' => 'Your 7Solve {{plan}} has expired',
            'heading' => 'Your plan has expired',
            'body_html' =>
                $p('Hi {{name}}, your <b>{{plan}}</b> plan ended on <b>{{expiry_date}}</b>.')
              . $p('Your account, notebook and saved doubts are all still here. Renewing switches the paid features straight back on.')
              . $btn('{{renew_url}}', 'Renew my plan')
              . $p('Or <a href="{{upgrade_url}}" style="color:#2647cf">look at the other plans</a> if your needs have changed.'),
        ],
        'renewal_success' => [
            'subject' => '✅ Your 7Solve {{plan}} is renewed',
            'heading' => 'Renewed — thank you',
            'body_html' =>
                $p('Hi {{name}}, your <b>{{plan}}</b> plan is renewed and active.')
              . $rows
              . '<tr><td style="padding:7px 0;color:#71718c">Plan</td><td style="padding:7px 0;text-align:right"><b>{{plan}}</b></td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Amount</td><td style="padding:7px 0;text-align:right">{{amount}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Order ID</td><td style="padding:7px 0;text-align:right">{{order_id}}</td></tr>'
              . '<tr><td style="padding:7px 0;color:#71718c">Now active until</td><td style="padding:7px 0;text-align:right"><b>{{expiry_date}}</b></td></tr>'
              . '</table>'
              . $btn('{{dashboard_url}}', 'Open my dashboard'),
        ],
        'payment_failed' => [
            'subject' => 'We could not process your 7Solve payment',
            'heading' => 'Payment did not go through',
            'body_html' =>
                $p('Hi {{name}}, your payment for <b>{{plan}}</b> did not complete, so nothing has been charged.')
              . $p('Reason given by the payment provider: <b>{{reason}}</b>')
              . $p('Your plan and data are untouched. You can try again whenever suits you.')
              . $btn('{{renew_url}}', 'Try again')
              . $p('If money did leave your account, reply to this email with order <b>{{order_id}}</b> and we will trace it.'),
        ],
        'test_email' => [
            'subject' => '7By test email',
            'heading' => 'It works',
            'body_html' => $p('If you are reading this, sending is configured correctly.')
                         . $p('Sent {{sent_at}} from {{from}}.'),
        ],
    ];
}

/* ------------------------------------------------------------------
   4. EMAIL — queue, send, retry
   Nothing sends inline. A purchase queues a row and returns; the cron
   worker delivers it. A slow or dead SMTP host can therefore never
   delay a checkout or lose the message.
   ------------------------------------------------------------------ */

/** Queue one email. $dedupe makes it idempotent — the same key can only
 *  ever be queued once, which is what stops a retried webhook or a
 *  re-run cron from emailing a customer twice. */
function ops_mail($senderKind, $to, $template, array $vars = [], array $opt = []) {
    $tpl = ops_template($template);
    if (!$tpl) return false;
    $subject = ops_render($tpl['subject'], $vars);
    $now = date('Y-m-d H:i:s');
    try {
        $st = db()->prepare(
            'INSERT INTO email_queue
             (dedupe_key, sender_kind, to_email, to_name, template, subject, vars, user_id, status, next_attempt, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        $st->execute([
            $opt['dedupe'] ?? null, $senderKind, $to, $opt['name'] ?? null,
            $template, $subject, json_encode($vars, JSON_UNESCAPED_UNICODE),
            $opt['user_id'] ?? null,
            // 'burn' claims the dedupe key without ever delivering. Used to
            // retire reminder rungs that a more urgent one has overtaken, so
            // they can never fire later.
            !empty($opt['burn']) ? 'cancelled' : 'pending',
            $now, $now,
        ]);
        return (int)db()->lastInsertId();
    } catch (PDOException $e) {
        // 23000 = duplicate dedupe_key. That is the feature working, not a fault.
        if ($e->getCode() === '23000') return 0;
        throw $e;
    }
}

/** Cancel anything still pending for a user — used when someone renews,
 *  so the queued "you are about to expire" reminders never go out. */
function ops_mail_cancel($userId, $templateLike = null) {
    $sql = "UPDATE email_queue SET status='cancelled'
            WHERE status='pending' AND user_id = ?";
    $args = [$userId];
    if ($templateLike) { $sql .= ' AND template LIKE ?'; $args[] = $templateLike; }
    $st = db()->prepare($sql); $st->execute($args);
    return $st->rowCount();
}

/* Three attempts total, so two retries: +2 min, then +10 min.
   Indexed by RETRY number (0-based), not by attempt count — feeding the
   post-increment count in here made the first rung dead code and pushed
   the first retry out to ten minutes. */
function ops_backoff($retry) {
    $ladder = [120, 600, 2700];
    return $ladder[max(0, min($retry, count($ladder) - 1))];
}

/** The worker. Sends what is due, retries with backoff, gives up after
 *  3 attempts and raises an incident so a dead mailbox is not silent. */
function ops_mail_flush($limit = 20) {
    $sent = 0; $failed = 0;
    $rows = db()->prepare(
        "SELECT * FROM email_queue
         WHERE status = 'pending' AND next_attempt <= NOW()
         ORDER BY id ASC LIMIT " . (int)$limit);
    $rows->execute();

    foreach ($rows->fetchAll() as $q) {
        // claim the row so two overlapping cron runs cannot both send it
        $claim = db()->prepare("UPDATE email_queue SET status='sending' WHERE id = ? AND status = 'pending'");
        $claim->execute([$q['id']]);
        if ($claim->rowCount() === 0) continue;

        $vars = json_decode($q['vars'] ?: '{}', true) ?: [];
        $tpl  = ops_template($q['template']);
        $from = ops_sender($q['sender_kind']);
        $ok = false; $err = null;

        try {
            if (!$tpl) throw new RuntimeException('Unknown template: ' . $q['template']);
            $body = email_template($tpl['heading'] ?? '', ops_render($tpl['body_html'], $vars));
            $ok = (bool)send_email($q['to_email'], $q['subject'], $body);
            if (!$ok) $err = 'transport returned false';
        } catch (Throwable $e) { $err = $e->getMessage(); }

        $attempts = (int)$q['attempts'] + 1;

        if ($ok) {
            db()->prepare("UPDATE email_queue SET status='sent', attempts=?, sent_at=NOW() WHERE id=?")
                ->execute([$attempts, $q['id']]);
            $sent++;
        } elseif ($attempts >= 3) {
            db()->prepare("UPDATE email_queue SET status='failed', attempts=?, last_error=? WHERE id=?")
                ->execute([$attempts, $err, $q['id']]);
            $failed++;
            ops_error('EMAIL_DELIVERY_FAILED', 'high',
                'Gave up sending "' . $q['template'] . '" to ' . $q['to_email'] . ' after ' . $attempts . ' attempts',
                ['route' => 'email_queue#' . $q['id'], 'detail' => $err]);
        } else {
            db()->prepare("UPDATE email_queue SET status='pending', attempts=?, last_error=?,
                           next_attempt = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id=?")
                ->execute([$attempts, $err, ops_backoff($attempts - 1), $q['id']]);
        }

        db()->prepare('INSERT INTO email_log
                       (queue_id,to_email,from_email,template,subject,status,provider,attempts,error,created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,NOW())')
            ->execute([$q['id'], $q['to_email'], $from, $q['template'], $q['subject'],
                       $ok ? 'sent' : 'failed', 'smtp', $attempts, $ok ? null : $err]);
    }
    return ['sent' => $sent, 'failed' => $failed];
}

/* ------------------------------------------------------------------
   5. ERROR MONITORING
   Repeats of the same fault collapse into one incident, and the owner
   is alerted at most once per throttle window with a running count —
   so 100 failures in five minutes is one email that says "100×", not
   100 emails.
   ------------------------------------------------------------------ */
function ops_error($type, $severity, $message, array $ctx = []) {
    try {
        $route = $ctx['route'] ?? ($_SERVER['REQUEST_URI'] ?? 'cli');
        // Normalise volatile bits out of the message so retries group together
        $norm  = preg_replace('/\d{3,}/', 'N', (string)$message);
        $fp    = sha1($type . '|' . $route . '|' . substr($norm, 0, 200));
        $now   = date('Y-m-d H:i:s');

        $st = db()->prepare("SELECT * FROM system_errors
                             WHERE fingerprint = ? AND status NOT IN ('resolved','ignored')
                             ORDER BY id DESC LIMIT 1");
        $st->execute([$fp]);
        $inc = $st->fetch();

        if ($inc) {
            db()->prepare('UPDATE system_errors SET occurrences = occurrences + 1, last_seen = ? WHERE id = ?')
                ->execute([$now, $inc['id']]);
            $inc['occurrences']++; $inc['last_seen'] = $now;
        } else {
            $ref = 'ERR-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));
            db()->prepare('INSERT INTO system_errors
                (ref,fingerprint,type,severity,route,message,detail,user_id,user_email,first_seen,last_seen)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$ref, $fp, $type, $severity, substr($route, 0, 191),
                           substr((string)$message, 0, 4000), $ctx['detail'] ?? null,
                           $ctx['user_id'] ?? null, $ctx['user_email'] ?? null, $now, $now]);
            $st2 = db()->prepare('SELECT * FROM system_errors WHERE id = ?');
            $st2->execute([db()->lastInsertId()]);
            $inc = $st2->fetch();
        }

        ops_maybe_alert($inc);
        return $inc['ref'];
    } catch (Throwable $e) {
        // Monitoring must never become the outage. Swallow and move on.
        return null;
    }
}

/** One alert per incident per throttle window, regardless of volume. */
function ops_maybe_alert(array $inc) {
    if (!in_array($inc['severity'], ['high', 'critical'], true)) return;
    if (ops_setting('notify_owner_errors', '1') !== '1') return;

    $window = (int)ops_setting('error_alert_window_min', '15');
    if (!empty($inc['last_alert_at']) &&
        strtotime($inc['last_alert_at']) > time() - $window * 60) return;

    ops_mail('admin', ops_owner_email(), 'system_error', [
        'ref' => $inc['ref'], 'type' => $inc['type'], 'severity' => $inc['severity'],
        'route' => $inc['route'], 'message' => $inc['message'],
        'occurrences' => $inc['occurrences'],
        'first_seen' => $inc['first_seen'], 'last_seen' => $inc['last_seen'],
        'admin_url' => ops_setting('admin_url', 'https://account.7by.in/secure-admin'),
    ], ['dedupe' => 'alert:' . $inc['ref'] . ':' . floor(time() / max(60, $window * 60))]);

    db()->prepare('UPDATE system_errors SET last_alert_at = NOW(), alerts_sent = alerts_sent + 1 WHERE id = ?')
        ->execute([$inc['id']]);
}

/** Close an incident and tell the owner it is over. */
function ops_resolve($ref, $resolution, $actor = 'system') {
    $st = db()->prepare('SELECT * FROM system_errors WHERE ref = ?');
    $st->execute([$ref]);
    $inc = $st->fetch();
    if (!$inc) return false;

    db()->prepare("UPDATE system_errors SET status='resolved', resolution=?, resolved_at=NOW() WHERE id=?")
        ->execute([$resolution, $inc['id']]);

    $mins = max(1, (int)round((time() - strtotime($inc['first_seen'])) / 60));
    ops_mail('admin', ops_owner_email(), 'system_resolved', [
        'ref' => $inc['ref'], 'type' => $inc['type'],
        'first_seen' => $inc['first_seen'], 'resolved_at' => date('Y-m-d H:i:s'),
        'duration' => $mins < 60 ? $mins . ' min' : round($mins / 60, 1) . ' h',
        'occurrences' => $inc['occurrences'], 'resolution' => $resolution,
    ], ['dedupe' => 'resolved:' . $inc['ref']]);

    ops_audit($actor, 'error_resolved', $inc['ref'], $resolution);
    return true;
}

/* ------------------------------------------------------------------
   6. AUDIT
   ------------------------------------------------------------------ */
function ops_audit($actor, $action, $target = null, $detail = null, $result = 'ok') {
    try {
        db()->prepare('INSERT INTO audit_logs (actor,action,target,detail,result,ip,created_at)
                       VALUES (?,?,?,?,?,?,NOW())')
            ->execute([$actor, $action, $target, $detail, $result, $_SERVER['REMOTE_ADDR'] ?? null]);
    } catch (Throwable $e) { /* auditing must not break the action */ }
}

/* ------------------------------------------------------------------
   7. NOTIFICATION CENTRE (rows now; UI in slices 4–5)
   ------------------------------------------------------------------ */
function ops_notify($audience, $userId, $type, $title, $body = null, $link = null) {
    try {
        db()->prepare('INSERT INTO notifications (audience,user_id,type,title,body,link,created_at)
                       VALUES (?,?,?,?,?,?,NOW())')
            ->execute([$audience, $userId, $type, $title, $body, $link]);
    } catch (Throwable $e) { /* non-critical */ }
}
