<?php
/**
 * 7By Account Hub — configuration.
 * Deploy this whole folder to a subdomain, e.g. account.7by.in, via cPanel File Manager.
 * Fill in the values marked TODO, then you're live.
 */

return array(

	// ---- Database (create a MySQL DB + user in cPanel, then paste here) ----
	'db' => array(
		'host' => 'localhost',
		'name' => 'TODO_db_name',
		'user' => 'TODO_db_user',
		'pass' => 'TODO_db_password',
	),

	// ---- Security ----
	// A long random string. Generate one, e.g. `openssl rand -hex 32`.
	'app_secret'    => 'TODO_change_this_to_a_long_random_string',
	// Cookie domain so login is shared across every *.7by.in tool.
	'cookie_domain' => '.7by.in',

	// ---- Email (OTP codes) ----
	// RECOMMENDED: send through a real mailbox so codes actually arrive.
	// 1. cPanel → Email Accounts → Create (e.g. no-reply@7by.in), note the password.
	// 2. Fill the four values below. host is usually 'localhost' on the same
	//    cPanel server (or 'mail.7by.in'); port 465 with 'ssl'.
	// Leave user as TODO to fall back to plain PHP mail() (often lands in spam
	// or is silently dropped by the host).
	'smtp' => array(
		'host'   => 'localhost',
		'port'   => 465,
		'secure' => 'ssl',                 // 'ssl' (port 465) or 'tls' (port 587)
		'user'   => 'TODO_no-reply@7by.in', // full mailbox address
		'pass'   => 'TODO_mailbox_password',
	),
	// From address shown to users. Should match the SMTP mailbox.
	'mail_from' => 'no-reply@7by.in',

	// ---- Which tool sites may call this hub (CORS). Add every tool subdomain. ----
	'allowed_origins' => array(
		'https://removebg.7by.in',
		'https://vocalremover.7by.in',
		'https://7q.7by.in',        // 7Q
		'https://7solve.7by.in',    // 7Solve
		'https://qbank.7by.in',     // 7Q (old)
		'https://doubtsnap.7by.in', // 7Solve (old)
		// add more tools here...
		'http://localhost:3061', // local dev
		'http://localhost:3050', // local dev (7Q / 7Solve)
	),

	// ---- Payment gateway: 'razorpay' (live) or 'sevenpay' (our own, retired) ----
	'gateway' => 'razorpay',

	// ---- 7Pay (our own gateway — see the pay/ folder, deployed at pay.7by.in) ----
	'sevenpay' => array(
		'base_url'       => 'https://pay.7by.in',       // no trailing slash; local dev: http://localhost:7521
		'key_id'         => '7pay_7by',
		'key_secret'     => 'TODO_change_me_7by_secret',            // must match pay/config.php
		'webhook_secret' => 'TODO_change_me_7by_webhook_secret',    // must match pay/config.php
	),

	// ---- Razorpay (from your Razorpay dashboard) ----
	'razorpay' => array(
		'key_id'         => 'TODO_rzp_live_or_test_key_id',
		'key_secret'     => 'TODO_rzp_key_secret',      // server-only, never expose
		'webhook_secret' => 'TODO_rzp_webhook_secret',  // optional, for the webhook
	),

	// ---- Google Sign-In (Google Cloud Console → OAuth client, type "Web") ----
	// Authorised JavaScript origin must include https://account.7by.in
	'google' => array(
		'client_id' => '795705423816-2ffl53j83vir4mvau9mo4883afqc8khp.apps.googleusercontent.com',
	),

	// ---- Plans: price (INR) → credits + validity days ----
	'plans' => array(
		'monthly' => array('amount' => 27,  'credits' => 100,  'days' => 30,  'label' => 'Monthly'),
		'yearly'  => array('amount' => 299, 'credits' => 1400, 'days' => 365, 'label' => 'Yearly'),
	),

	// Free credits granted on signup so new users can try the tools.
	// 100 credits = 10 uses at the standard 10-credits-per-action. Set 0 to disable.
	'free_signup_credits' => 100,   // one-time welcome bonus (10 free actions)

	// FREE accounts are topped up to this many credits once per day (3 answers
	// at 10 credits each). Never stacks; paid plans are unaffected. 0 = off.
	'free_daily_credits' => 30,

	// Only allow these email domains to sign up. Empty array = allow any.
	// e.g. ['gmail.com'] to accept only @gmail.com addresses.
	'allowed_email_domains' => array('gmail.com'),
);
