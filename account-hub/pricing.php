<?php
/**
 * Central pricing.
 * - India (IN) pays INR; every other country pays USD.
 * - Per-product credit amounts can be overridden in products.php
 *   ('plan_credits'), e.g. VocalRemover gives 1,000/20,000 credits
 *   because one song costs 10 credits.
 *
 * NOTE: charging USD requires "International Payments" to be enabled
 * on your Razorpay account (Dashboard -> Settings -> Payment methods).
 */
return array(

	'currencies' => array(
		'INR' => array('symbol' => '₹', 'monthly' => 27,  'yearly' => 299),
		'USD' => array('symbol' => '$', 'monthly' => 1.5, 'yearly' => 6),
	),

	// Universal credit grants — the SAME on every 7By site (no per-site
	// arbitrage). Tools differ in how many credits an action costs
	// (e.g. 10 credits = 1 song split = 1 image export).
	'plans' => array(
		'monthly' => array('days' => 30,  'label' => 'Monthly', 'credits' => 1000),
		'yearly'  => array('days' => 365, 'label' => 'Yearly',  'credits' => 20000),
	),
);
