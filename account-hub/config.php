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

	// ---- Which tool sites may call this hub (CORS). Add every tool subdomain. ----
	'allowed_origins' => array(
		'https://removebg.7by.in',
		'https://vocalremover.7by.in',
		// add more tools here...
		'http://localhost:3061', // local dev
	),

	// ---- Payment gateway: 'sevenpay' (our own, at pay.7by.in) or 'razorpay' ----
	'gateway' => 'sevenpay',

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
		'client_id' => 'TODO_xxxxx.apps.googleusercontent.com',
	),

	// ---- Plans: price (INR) → credits + validity days ----
	'plans' => array(
		'monthly' => array('amount' => 27,  'credits' => 100,  'days' => 30,  'label' => 'Monthly'),
		'yearly'  => array('amount' => 299, 'credits' => 1400, 'days' => 365, 'label' => 'Yearly'),
	),

	// Free credits granted on signup so new users can try the tools.
	// 30 credits = 3 uses at the standard 10-credits-per-action. Set 0 to disable.
	'free_signup_credits' => 30,
);
