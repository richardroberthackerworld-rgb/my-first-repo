<?php
/**
 * 7Pay — 7By's own payment gateway. Configuration.
 * Deploy this whole folder to a subdomain, e.g. pay.7by.in, via cPanel File Manager.
 *
 * Modes per merchant:
 *   'test' — cards / UPI / netbanking are SIMULATED (no real money). Perfect for
 *            development and for wiring tools up before going live.
 *   'live' — real UPI collect: the buyer pays your VPA (QR / UPI app link),
 *            enters the UTR reference, and the payment sits in "pending" until
 *            you approve it in the dashboard. Card + netbanking are hidden in
 *            live mode (real card processing needs a bank/PCI setup 7Pay
 *            deliberately does not pretend to have).
 */

return array(

	// ---- Database ----
	// 'sqlite' works out of the box (file DB in ./data) — ideal for local dev
	// and fine for low volume. On cPanel you can switch to 'mysql'.
	'db' => array(
		'driver'      => 'sqlite',                       // 'sqlite' | 'mysql'
		'sqlite_path' => __DIR__ . '/data/sevenpay.sqlite',
		'host' => 'localhost',
		'name' => 'TODO_db_name',
		'user' => 'TODO_db_user',
		'pass' => 'TODO_db_password',
	),

	// A long random string (e.g. `openssl rand -hex 32`) — signs dashboard sessions.
	'app_secret' => 'TODO_change_this_to_a_long_random_string',

	// ---- Live-mode UPI collect ----
	// Buyers pay this VPA directly — via the QR scanner code or the Google Pay /
	// PhonePe / Paytm / BHIM buttons on the checkout (all standard UPI deep links).
	'upi' => array(
		'vpa'   => 'TODO_yourname@upi',
		'payee' => '7By',
	),

	// ---- Automatic UPI payment detection (no UTR, no manual approval) ----
	// Your bank texts you the moment money lands in your account. Install an
	// SMS-forwarder app on your phone (see SETUP.md) and point it at:
	//   https://7pay.7by.in/api.php?action=upi.credit&token=<token below>
	// The gateway parses the credited amount + UPI ref from the SMS, matches it
	// to the pending payment and captures it automatically — the buyer's
	// checkout completes on its own. Manual dashboard approval stays available
	// as a fallback. Set a long random token to enable.
	'upi_auto' => array(
		'enabled'        => true,
		'token'          => 'TODO_random_token_for_sms_forwarder',
		'window_minutes' => 45, // how long a pending payment is matchable
		// false = every buyer pays the exact flat price (e.g. ₹27), matched
		//         oldest-pending-first. Clean amounts; a rare same-price clash
		//         in the same window falls back to dashboard approval.
		// true  = each open checkout gets base + 0–99 unique paise so unlimited
		//         simultaneous buyers auto-verify with zero ambiguity.
		'unique_paise'   => false,
	),

	// ---- Phone-free auto-detect: bank credit-alert EMAILS ----
	// Works with any bank that emails you a credit alert (enable it in your
	// bank's netbanking → alerts). Steps:
	//   1. cPanel → Email Accounts → create a dedicated mailbox,
	//      e.g. upi-alerts@7by.in (never reuse a personal inbox).
	//   2. In your bank, set credit alerts to email that address.
	//   3. Fill this block, set enabled => true.
	//   4. cPanel → Cron Jobs → every minute:
	//        php -q /home/USER/path-to/pay/mail-poller.php
	//      (or, if CLI cron is unavailable, hit over HTTPS:
	//        https://pay.7by.in/mail-poller.php?token=UPI_AUTO_TOKEN)
	// The poller reads UNSEEN mails, forwards the text to the same upi.credit
	// matcher the SMS forwarder uses, and marks the mail read once delivered.
	// 'upi_auto' above must be enabled (it provides the webhook + token).
	'upi_mail' => array(
		'enabled'         => false,
		'host'            => 'localhost',      // cPanel mail host; often 'mail.7by.in'
		'port'            => 993,
		'ssl'             => true,
		'user'            => 'TODO_upi-alerts@7by.in',
		'pass'            => 'TODO_mailbox_password',
		// Only process mail whose From contains one of these (empty = any sender).
		// e.g. array('@icicibank.com', '@hdfcbank.net', 'alerts@axisbank.com')
		'allowed_senders' => array(),
		'max_age_hours'   => 24,               // ignore alerts older than this
		'self_url'        => 'https://pay.7by.in', // where 7Pay's api.php lives (no trailing slash)
	),

	// ---- Live-mode international payments (PayPal) ----
	// Non-INR buyers pay through your PayPal.me link; they paste the PayPal
	// Transaction ID and the payment stays "pending" until you approve it in
	// the dashboard (same flow as UPI collect). In test mode PayPal is simulated.
	'paypal' => array(
		'me_link' => 'https://paypal.me/TODO_yourname',
	),

	// ---- Registered merchants (keyed by public key_id) ----
	// Every 7By tool that charges money is a "merchant" here. key_secret is
	// server-only: it authenticates the API and signs payments (HMAC-SHA256 of
	// "order_id|payment_id"), exactly like Razorpay's scheme, so switching a
	// site between gateways is a one-line change.
	'merchants' => array(

		// 7By Account Hub (credits system on account.7by.in).
		// key_secret + webhook_secret must MATCH the 'sevenpay' block in
		// account-hub/config.php. Flip mode to 'live' to take real payments.
		'7pay_7by' => array(
			'name'           => '7By',
			'key_secret'     => 'TODO_change_me_7by_secret',
			'mode'           => 'test',
			'webhook_url'    => 'https://account.7by.in/api.php?action=sevenpay_webhook',
			'webhook_secret' => 'TODO_change_me_7by_webhook_secret',
		),

		// Demo store used by demo.php — remove in production if you like.
		'7pay_demo' => array(
			'name'           => '7Pay Demo Store',
			'key_secret'     => 'demo_key_secret_not_for_production',
			'mode'           => 'test',
			'webhook_url'    => '',
			'webhook_secret' => '',
		),
	),
);
