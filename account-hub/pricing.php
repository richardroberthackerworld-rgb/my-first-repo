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
 *
 * A plan key must appear in BOTH 'plans' and every currency block —
 * plan_details() reads the price as $currencies[$cur][$planKey].
 */
return array(

	'currencies' => array(
		'INR' => array(
			'symbol' => '₹',
			// shared plans (RemoveBG, VocalRemover)
			'monthly' => 47,  'yearly' => 499,
			// 7Solve / student tiers
			'spark' => 49,  'spark_yearly' => 499,
			'solve' => 99,  'solve_yearly' => 999,
			'ultra' => 999, 'ultra_yearly' => 9999,
		),
		// USD is the rest-of-world price. Yearly tracks the rupee price at
		// roughly 83/$; monthly is rounded up to a viable card charge, which
		// is the same shape the original 47/499 -> 1.5/6 pair already had.
		'USD' => array(
			'symbol' => '$',
			'monthly' => 1.5, 'yearly' => 6,
			'spark' => 1.5,  'spark_yearly' => 6,
			'solve' => 2.5,  'solve_yearly' => 12,
			'ultra' => 12,   'ultra_yearly' => 120,
		),
	),

	// Universal credit grants — the SAME on every 7By site (no per-site
	// arbitrage). Tools differ in how many credits an action costs
	// (e.g. 10 credits = 1 song split = 1 image export).
	//
	// 'tier'  — what the WALLET records. Monthly and yearly of the same tier
	//           are one entitlement, so 'solve_yearly' is stored as 'solve'
	//           and every downstream check stays a simple tier comparison.
	// 'ai'    — may this plan spend its credits on AI? Spark deliberately
	//           cannot: it buys the practice tools, not the model.
	// 'daily' — bonus credits claimable once per UTC day (see api.php 'bonus').
	'plans' => array(
		'monthly' => array('days' => 30,  'label' => 'Monthly', 'credits' => 1000,
		                   'tier' => 'monthly', 'ai' => true, 'daily' => 0),
		'yearly'  => array('days' => 365, 'label' => 'Yearly',  'credits' => 20000,
		                   'tier' => 'yearly',  'ai' => true, 'daily' => 0),

		/* ---- 7Solve student tiers. 10 credits = 1 AI generation. ---- */
		'spark' => array('days' => 30,  'label' => 'Spark', 'credits' => 500,
		                 'tier' => 'spark', 'ai' => false, 'daily' => 0),
		'solve' => array('days' => 30,  'label' => 'Solve+', 'credits' => 1000,
		                 'tier' => 'solve', 'ai' => true,  'daily' => 0),
		'ultra' => array('days' => 30,  'label' => 'Solve Ultra', 'credits' => 10000,
		                 'tier' => 'ultra', 'ai' => true,  'daily' => 20),

		'spark_yearly' => array('days' => 365, 'label' => 'Spark (yearly)', 'credits' => 6000,
		                        'tier' => 'spark', 'ai' => false, 'daily' => 0),
		'solve_yearly' => array('days' => 365, 'label' => 'Solve+ (yearly)', 'credits' => 12000,
		                        'tier' => 'solve', 'ai' => true,  'daily' => 0),
		'ultra_yearly' => array('days' => 365, 'label' => 'Solve Ultra (yearly)', 'credits' => 120000,
		                        'tier' => 'ultra', 'ai' => true,  'daily' => 20),
	),
);
