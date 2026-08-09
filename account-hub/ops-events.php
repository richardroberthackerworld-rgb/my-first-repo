<?php
/* ============================================================
   ops-events.php — the transactional lifecycle.

   One function per real-world event. Each is:
     • triggered by a VERIFIED server-side event, never by a client claim
     • idempotent, via a dedupe key derived from the event's own identity
       (payment id, ticket ref, user id) rather than from a timestamp
     • queue-only — nothing here opens an SMTP connection. A dead mail host
       cannot delay a checkout or lose a receipt.

   Strictly transactional. There is deliberately no "email everyone"
   helper here: every function needs a concrete event and a recipient who
   is party to it. Bulk or promotional mail needs a consent model that
   does not exist yet, and inventing one silently would be worse than not
   having it.

   Wiring (api.php):
     signup_verify  → ops_on_signup()
     verify         → ops_on_purchase()   after grant_from_tx()
     webhook        → ops_on_purchase()   after grant_from_tx()
   ============================================================ */

require_once __DIR__ . '/ops.php';
if (!function_exists('ops_on_renewal')) require_once __DIR__ . '/ops-scheduler.php';

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

/** Money for humans. Transactions store paise. */
function ev_money($paise) {
    if ($paise === null || $paise === '') return '';
    return '₹' . number_format(((int)$paise) / 100, 2);
}

function ev_urls() {
    return [
        'dashboard_url' => ops_setting('dashboard_url', 'https://account.7by.in/'),
        'support_url'   => ops_setting('support_url',   'https://account.7by.in/#support'),
        'renew_url'     => ops_setting('renew_url',     'https://account.7by.in/#plans'),
        'upgrade_url'   => ops_setting('upgrade_url',   'https://account.7by.in/#plans'),
        'admin_url'     => ops_setting('admin_url',     'https://account.7by.in/secure-admin'),
    ];
}

/** Owner copies are opt-out-able per event type (§28). */
function ev_owner_wants($event) {
    return ops_setting('notify_owner_' . $event, '1') === '1';
}

/* ------------------------------------------------------------------
   1. NEW MEMBER  — owner only.
   No automatic welcome mail to the customer: they just completed an OTP
   round-trip, so they already know the account exists, and a "welcome"
   with nothing actionable in it is marketing wearing a transactional hat.
   ------------------------------------------------------------------ */
function ops_on_signup($userId, $email, $name) {
    if (!ev_owner_wants('new_member')) return;
    ops_mail('admin', ops_owner_email(), 'owner_new_member', array_merge(ev_urls(), [
        'name'  => $name ?: '(no name)',
        'email' => $email,
        'when'  => date('j M Y, H:i'),
    ]), ['dedupe' => 'newmember:' . $userId]);

    ops_notify('admin', null, 'new_member', 'New member: ' . ($name ?: $email), $email);
}

/* ------------------------------------------------------------------
   2. PURCHASE  — the money event.

   $tx MUST be the transactions row AFTER the signature was verified and
   the status was set to 'paid'. Nothing here re-checks the signature;
   the caller owns that, and calling this from an unverified path would
   be a bug at the call site, not here.

   Idempotency comes from the payment id: replaying a webhook produces
   the same key, so the second attempt is refused by the UNIQUE column.
   ------------------------------------------------------------------ */
function ops_on_purchase(array $tx, array $user, $isRenewal = false) {
    $payId = (string)($tx['payment_id'] ?? $tx['order_id'] ?? '');
    if ($payId === '') {
        ops_error('PURCHASE_EMAIL_NO_PAYMENT_ID', 'high',
            'ops_on_purchase called without a payment or order id for user#' . ($user['id'] ?? '?'),
            ['route' => 'payment', 'user_id' => $user['id'] ?? null]);
        return;
    }

    $expiry = $tx['plan_expires'] ?? $user['plan_expires'] ?? null;
    $vars = array_merge(ev_urls(), [
        'name'        => $user['name'] ?: 'there',
        'email'       => $user['email'],
        'plan'        => $tx['plan'] ?? ($tx['product'] ?? 'your plan'),
        'amount'      => ev_money($tx['amount'] ?? null),
        'order_id'    => $payId,
        'start_date'  => date('j M Y'),
        'expiry_date' => $expiry ? date('j M Y', strtotime($expiry)) : '—',
    ]);

    if ($isRenewal) {
        // ops_on_renewal also cancels the old term's queued reminders
        ops_on_renewal($user['id'], $user['email'], $user['name'],
                       $vars['plan'], $expiry ?: 'now', $payId, $vars['amount']);
    } else {
        ops_mail('billing', $user['email'], 'purchase_success', $vars,
                 ['dedupe' => 'purchase:' . $payId, 'user_id' => $user['id'], 'name' => $user['name']]);
        ops_notify('user', $user['id'], 'purchase', 'Your plan is active',
                   $vars['plan'] . ' until ' . $vars['expiry_date']);
    }

    if (ev_owner_wants($isRenewal ? 'renewal' : 'purchase')) {
        ops_mail('admin', ops_owner_email(),
                 $isRenewal ? 'owner_renewal' : 'owner_purchase', $vars,
                 ['dedupe' => ($isRenewal ? 'ownerrenew:' : 'ownerpurchase:') . $payId]);
    }

    ops_notify('admin', null, $isRenewal ? 'renewal' : 'purchase',
               ($isRenewal ? 'Renewal' : 'Purchase') . ' — ' . $vars['amount'],
               $user['email'] . ' · ' . $vars['plan']);

    ops_audit('system', $isRenewal ? 'renewal_email' : 'purchase_email',
              'user#' . $user['id'], $payId);
}

/**
 * The single entry point api.php calls after a verified payment.
 *
 * Never throws. A payment that has already succeeded must not be reported
 * as failed because the mail layer had a bad day — the worst acceptable
 * outcome here is a missing receipt and a logged incident.
 */
function ops_purchase_hook($tx) {
    try {
        if (!is_array($tx) || empty($tx['user_id'])) return;
        $st = db()->prepare('SELECT id, name, email, plan, plan_expires FROM users WHERE id = ?');
        $st->execute([$tx['user_id']]);
        $u = $st->fetch();
        if (!$u || empty($u['email'])) return;
        ops_on_purchase($tx, $u, ops_is_renewal($tx['user_id'], $tx['id'] ?? null));
    } catch (Throwable $e) {
        ops_error('PURCHASE_EMAIL_HOOK_FAILED', 'high',
                  'Purchase email hook threw: ' . $e->getMessage(),
                  ['route' => 'payment', 'user_id' => $tx['user_id'] ?? null]);
    }
}

/** Same contract for signup: swallow everything, log, never break the flow. */
function ops_signup_hook($userId, $email, $name) {
    try { ops_on_signup($userId, $email, $name); }
    catch (Throwable $e) {
        ops_error('SIGNUP_EMAIL_HOOK_FAILED', 'medium', $e->getMessage(),
                  ['route' => 'signup', 'user_id' => $userId]);
    }
}

/** Is this user already a paying customer? Decides purchase vs renewal
 *  wording, from the payment record — not from anything a client sent. */
function ops_is_renewal($userId, $currentTxId = null) {
    try {
        $sql = "SELECT COUNT(*) FROM transactions
                 WHERE user_id = ? AND LOWER(status) = 'paid'";
        $args = [$userId];
        if ($currentTxId) { $sql .= ' AND id <> ?'; $args[] = $currentTxId; }
        $st = db()->prepare($sql); $st->execute($args);
        return (int)$st->fetchColumn() > 0;
    } catch (Throwable $e) { return false; }
}

/* ------------------------------------------------------------------
   3. PAYMENT FAILED  — customer + owner.
   ------------------------------------------------------------------ */
function ops_on_payment_failure($userId, $email, $name, $plan, $reason, $orderId = null, $amount = null) {
    // customer copy + incident (defined in ops-scheduler.php)
    ops_on_payment_failed($userId, $email, $name, $plan, $reason, $orderId);

    if (ev_owner_wants('payment_failure')) {
        ops_mail('admin', ops_owner_email(), 'owner_payment_failed', array_merge(ev_urls(), [
            'name' => $name ?: '(no name)', 'email' => $email, 'plan' => $plan,
            'amount' => ev_money($amount), 'reason' => $reason,
            'order_id' => $orderId ?: '—', 'when' => date('j M Y, H:i'),
        ]), ['dedupe' => 'ownerpayfail:' . $userId . ':' . ($orderId ?: date('YmdH'))]);
    }
}

/* ------------------------------------------------------------------
   4. SUPPORT
   ------------------------------------------------------------------ */
function ops_support_ref() {
    return '7SOLVE-' . str_pad((string)random_int(1, 99999), 5, '0', STR_PAD_LEFT);
}

/** Create a ticket and acknowledge it. Returns the ticket ref. */
function ops_on_support_ticket($userId, $email, $name, $category, $subject, $message, $orderRef = null) {
    $ref = ops_support_ref();
    $now = date('Y-m-d H:i:s');

    db()->prepare('INSERT INTO support_tickets
                   (ref,user_id,name,email,category,subject,message,order_ref,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)')
        ->execute([$ref, $userId ?: null, $name, $email, $category,
                   mb_substr($subject, 0, 180), $message, $orderRef, $now, $now]);
    $ticketId = (int)db()->lastInsertId();

    db()->prepare('INSERT INTO support_messages (ticket_id,author,body,created_at) VALUES (?,?,?,?)')
        ->execute([$ticketId, 'customer', $message, $now]);

    $vars = array_merge(ev_urls(), [
        'name' => $name ?: 'there', 'email' => $email, 'ticket' => $ref,
        'subject' => $subject, 'category' => $category,
        'summary' => mb_substr(trim($message), 0, 400),
        'when' => date('j M Y, H:i'),
    ]);

    ops_mail('support', $email, 'support_ticket_created', $vars,
             ['dedupe' => 'ticket:' . $ref, 'user_id' => $userId ?: null, 'name' => $name]);

    if (ev_owner_wants('support_ticket')) {
        ops_mail('admin', ops_owner_email(), 'owner_support_ticket', $vars,
                 ['dedupe' => 'ownerticket:' . $ref]);
    }

    ops_notify('admin', null, 'support', 'New ticket ' . $ref, $subject);
    if ($userId) ops_notify('user', $userId, 'support', 'We got your message', 'Ticket ' . $ref);
    ops_audit('system', 'support_ticket_created', $ref, $category);
    return $ref;
}

/** An admin replied. $replyId makes each reply its own dedupe key, so a
 *  second reply on the same ticket is a second email — as it should be. */
function ops_on_support_reply($ticketRef, $body, $adminName = 'Support') {
    $st = db()->prepare('SELECT * FROM support_tickets WHERE ref = ?');
    $st->execute([$ticketRef]);
    $tk = $st->fetch();
    if (!$tk) return false;

    $now = date('Y-m-d H:i:s');
    db()->prepare('INSERT INTO support_messages (ticket_id,author,body,created_at) VALUES (?,?,?,?)')
        ->execute([$tk['id'], 'admin', $body, $now]);
    $replyId = (int)db()->lastInsertId();

    db()->prepare("UPDATE support_tickets SET status='waiting', updated_at=? WHERE id=?")
        ->execute([$now, $tk['id']]);

    ops_mail('support', $tk['email'], 'support_reply', array_merge(ev_urls(), [
        'name' => $tk['name'] ?: 'there', 'ticket' => $tk['ref'],
        'subject' => $tk['subject'], 'reply' => $body, 'agent' => $adminName,
    ]), ['dedupe' => 'reply:' . $tk['ref'] . ':' . $replyId,
         'user_id' => $tk['user_id'], 'name' => $tk['name']]);

    if ($tk['user_id']) {
        ops_notify('user', $tk['user_id'], 'support', 'Reply on ' . $tk['ref'], mb_substr($body, 0, 140));
    }
    ops_audit($adminName, 'support_reply', $tk['ref']);
    return true;
}

/* ------------------------------------------------------------------
   5. EMAIL DELIVERY FAILURE  — owner only.
   Called by ops_mail_flush() when a message is finally abandoned. The
   dedupe key is the queue row, so one dead message produces exactly one
   alert however many times the worker passes over it.
   ------------------------------------------------------------------ */
function ops_on_email_failed($queueId, $template, $to, $attempts, $error) {
    if (!ev_owner_wants('email_failure')) return;
    ops_mail('admin', ops_owner_email(), 'owner_email_failed', array_merge(ev_urls(), [
        'template' => $template, 'recipient' => $to,
        'attempts' => $attempts, 'reason' => mb_substr((string)$error, 0, 300),
        'queue_id' => $queueId, 'when' => date('j M Y, H:i'),
    ]), ['dedupe' => 'emailfail:' . $queueId]);
}
