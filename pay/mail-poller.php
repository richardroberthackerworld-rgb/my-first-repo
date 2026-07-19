<?php
/**
 * 7Pay — bank-email poller: phone-free UPI auto-detect.
 *
 * Your bank emails a credit alert the moment money lands in your account.
 * This script reads that mailbox and forwards each alert's text to 7Pay's
 * existing  api.php?action=upi.credit  matcher (the same one the SMS
 * forwarder uses), which parses the amount + UPI ref, captures the matching
 * pending payment and completes the buyer's checkout — no phone involved.
 *
 * Run it every minute from cPanel → Cron Jobs:
 *     php -q /home/USER/path-to/pay/mail-poller.php
 * or, when CLI cron isn't available, over HTTPS (guarded by the upi_auto token):
 *     https://pay.7by.in/mail-poller.php?token=UPI_AUTO_TOKEN
 *
 * Configuration lives in config.php → 'upi_mail'. A mail is marked read only
 * after the webhook accepted it, so a temporary failure is retried next run.
 * The webhook side de-duplicates by UTR, so a re-forwarded alert is harmless.
 */

$GW  = require __DIR__ . '/config.php';
$M   = isset($GW['upi_mail']) ? $GW['upi_mail'] : array();
$A   = isset($GW['upi_auto']) ? $GW['upi_auto'] : array();
$CLI = (php_sapi_name() === 'cli');

if (!$CLI) {
	header('Content-Type: text/plain; charset=utf-8');
	$tok = isset($_GET['token']) ? (string)$_GET['token'] : '';
	if (empty($A['token']) || strpos((string)$A['token'], 'TODO') === 0 || !hash_equals((string)$A['token'], $tok)) {
		http_response_code(401);
		exit("Bad token.\n");
	}
}

function plog($msg) {
	$line = '[' . date('Y-m-d H:i:s') . '] ' . $msg . "\n";
	echo $line;
	$f = __DIR__ . '/data/mail-poller.log';
	@file_put_contents($f, $line, FILE_APPEND);
	// keep the log from growing forever
	if (@filesize($f) > 300000) {
		$tail = substr((string)@file_get_contents($f), -150000);
		@file_put_contents($f, $tail);
	}
}

if (empty($M['enabled'])) { plog('upi_mail is disabled in config.php — nothing to do.'); exit; }
if (empty($A['enabled']) || empty($A['token']) || strpos((string)$A['token'], 'TODO') === 0) {
	plog('upi_auto is not configured (enabled + a real token are required).'); exit;
}
if (!function_exists('imap_open')) {
	plog('PHP "imap" extension is missing. cPanel → Select PHP Version → Extensions → tick "imap".'); exit;
}
foreach (array('user', 'pass') as $k) {
	if (empty($M[$k]) || strpos((string)$M[$k], 'TODO') === 0) { plog("upi_mail.$k is not filled in."); exit; }
}

/* ---------- connect ---------- */
$host = (string)($M['host'] ?? 'localhost');
$port = (int)($M['port'] ?? 993);
$flag = !empty($M['ssl']) ? '/imap/ssl/novalidate-cert' : '/imap/notls';
$box  = '{' . $host . ':' . $port . $flag . '}INBOX';
$mb   = @imap_open($box, (string)$M['user'], (string)$M['pass']);
if (!$mb) { plog('IMAP connect failed: ' . (string)imap_last_error()); exit; }

/* ---------- decode helper: get a message's plain text ---------- */
function poller_part_text($mb, $num, $part, $partNo) {
	$body = ($partNo === '') ? imap_body($mb, $num, FT_PEEK) : imap_fetchbody($mb, $num, $partNo, FT_PEEK);
	$enc  = isset($part->encoding) ? (int)$part->encoding : 0;
	if ($enc === ENCBASE64)          $body = base64_decode($body);
	elseif ($enc === ENCQUOTEDPRINTABLE) $body = quoted_printable_decode($body);
	return $body;
}
function poller_text($mb, $num) {
	$s = @imap_fetchstructure($mb, $num);
	if ($s && !empty($s->parts)) {
		// prefer a text/plain part; fall back to text/html stripped
		$plain = null; $html = null;
		foreach ($s->parts as $i => $p) {
			$no = (string)($i + 1);
			$sub = strtoupper((string)($p->subtype ?? ''));
			if ($p->type === 0 && $sub === 'PLAIN' && $plain === null) $plain = poller_part_text($mb, $num, $p, $no);
			if ($p->type === 0 && $sub === 'HTML'  && $html  === null) $html  = poller_part_text($mb, $num, $p, $no);
			// one level of nesting (multipart/alternative inside mixed)
			if (!empty($p->parts)) {
				foreach ($p->parts as $j => $q) {
					$no2 = $no . '.' . ($j + 1);
					$sub2 = strtoupper((string)($q->subtype ?? ''));
					if ($q->type === 0 && $sub2 === 'PLAIN' && $plain === null) $plain = poller_part_text($mb, $num, $q, $no2);
					if ($q->type === 0 && $sub2 === 'HTML'  && $html  === null) $html  = poller_part_text($mb, $num, $q, $no2);
				}
			}
		}
		if ($plain !== null && trim($plain) !== '') return $plain;
		if ($html  !== null) return trim(preg_replace('/\s+/', ' ', strip_tags($html)));
	}
	$raw = poller_part_text($mb, $num, (object)array('encoding' => 0), '');
	return trim(preg_replace('/\s+/', ' ', strip_tags((string)$raw)));
}

/* ---------- scan unseen mail ---------- */
$unseen = imap_search($mb, 'UNSEEN');
if (!$unseen) { imap_close($mb); exit; } // quiet when there is nothing — cron runs every minute

$senders = array();
foreach ((array)($M['allowed_senders'] ?? array()) as $s) { $s = strtolower(trim((string)$s)); if ($s !== '') $senders[] = $s; }
$maxAge  = max(1, (int)($M['max_age_hours'] ?? 24)) * 3600;
$self    = rtrim((string)($M['self_url'] ?? ''), '/');
if ($self === '' || strpos($self, 'TODO') === 0) $self = 'http://localhost';
$hookUrl = $self . '/api.php?action=upi.credit&token=' . rawurlencode((string)$A['token']);

$done = 0;
foreach ($unseen as $num) {
	$h    = imap_headerinfo($mb, $num);
	$from = strtolower(isset($h->fromaddress) ? (string)$h->fromaddress : '');
	$when = isset($h->udate) ? (int)$h->udate : time();
	$uid  = imap_uid($mb, $num);

	// not from the bank? mark read and move on so the scan stays fast
	if ($senders) {
		$ok = false;
		foreach ($senders as $s) { if (strpos($from, $s) !== false) { $ok = true; break; } }
		if (!$ok) { imap_setflag_full($mb, (string)$uid, '\\Seen', ST_UID); continue; }
	}
	// stale alert — don't let an old mail capture a fresh checkout
	if (time() - $when > $maxAge) { imap_setflag_full($mb, (string)$uid, '\\Seen', ST_UID); continue; }

	$text = poller_text($mb, $num);
	if ($text === '') { imap_setflag_full($mb, (string)$uid, '\\Seen', ST_UID); continue; }

	// hand the alert to the same matcher the SMS forwarder uses
	$ch = curl_init($hookUrl);
	curl_setopt_array($ch, array(
		CURLOPT_POST           => true,
		CURLOPT_POSTFIELDS     => json_encode(array('text' => $text)),
		CURLOPT_HTTPHEADER     => array('Content-Type: application/json'),
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_TIMEOUT        => 20,
	));
	$res  = curl_exec($ch);
	$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
	curl_close($ch);

	if ($res === false || $code >= 500) {
		// webhook unreachable — leave UNSEEN so the next cron run retries it
		plog("kept for retry (webhook HTTP $code) from=$from");
		continue;
	}
	imap_setflag_full($mb, (string)$uid, '\\Seen', ST_UID);
	$j = json_decode((string)$res, true);
	$matched = !empty($j['matched']) ? 'MATCHED' : ('no match' . (isset($j['reason']) ? ' (' . $j['reason'] . ')' : ''));
	plog("processed from=$from → $matched");
	$done++;
}

imap_close($mb);
if ($done) plog("done — $done alert(s) forwarded.");
