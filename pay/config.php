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

		// 7By Account Hub (credits system on account.7by.in)
		'7pay_7by' => array(
			'name'           => '7By',
			'key_secret'     => 'TODO_change_me_7by_secret',
			'mode'           => 'test',
			'webhook_url'    => '', // e.g. https://account.7by.in/api.php?action=sevenpay_webhook
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
