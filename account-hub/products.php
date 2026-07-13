<?php
/**
 * Product-branded account pages.
 * Each key is reachable at a pretty URL (see .htaccess), e.g.
 *   account.7by.in/removebgpremiumaccount      -> product 'removebg'
 *   account.7by.in/vocalremoverpremiumaccount  -> product 'vocalremover'
 *
 * The login, credits and payments are the SAME shared 7By account — only the
 * on-page text, colours, credit amounts and "back to tool" target change.
 *
 * Credit grants are UNIVERSAL (see pricing.php) — every page sells the same
 * 1,000 / 20,000 credits. Tools differ in credits-per-action (10 = 1 song,
 * 10 = 1 image export). 'plan_notes' adds the "≈ 100 songs" line on the card.
 *
 * To add a tool: copy a block, change the fields, then add one line to .htaccess.
 */
return array(

	'removebg' => array(
		'brand'    => 'RemoveBG',
		'title'    => 'RemoveBG Premium — 7By Account',
		'tool_url' => 'https://removebg.7by.in',
		'accent'   => array('#5b3df5', '#8b5cf6'), // primary, primary-2
		'hero'     => 'Premium credits for your<br><span class="grad">background remover.</span>',
		'sub'      => 'Sign in to your 7By account to get export credits for RemoveBG. Editing is free — exporting your finished image costs 10 credits.',
		'auth_sub' => 'Sign in to manage your RemoveBG export credits.',
		'feats'    => array(
			array('🪄', 'Remove backgrounds &amp; export in HD'),
			array('⚡', '10 credits = 1 image export'),
			array('🔒', '100% safe &amp; secure payments'),
		),
		'card'       => 'REMOVEBG · CREDITS',
		'unit_note'  => '10 credits = 1 image export.',
		'plan_notes' => array('monthly' => '≈ 100 exports', 'yearly' => '≈ 2,000 exports'),

		// ---- Per-tool unlock (one price, unlocks ONLY this tool) ----
		// 'days' => 30 for a monthly pass; 0 = lifetime (never expires).
		// Add per-currency prices; the visitor is charged in their own currency.
		'unlock' => array(
			'label'  => 'RemoveBG Premium',
			'days'   => 30,
			'prices' => array('INR' => 49, 'USD' => 1.5),
		),
	),

	'vocalremover' => array(
		'brand'    => 'VocalRemover',
		'title'    => 'VocalRemover Premium — 7By Account',
		'tool_url' => 'https://vocalremover.7by.in',
		'accent'   => array('#0ea5e9', '#22d3ee'),
		'hero'     => 'Premium credits for your<br><span class="grad">vocal remover.</span>',
		'sub'      => 'Sign in to your 7By account to get credits for VocalRemover. Each AI song split (vocals + music) costs 10 credits.',
		'auth_sub' => 'Sign in to manage your VocalRemover credits.',
		'feats'    => array(
			array('🎤', 'AI Vocal Remover + Stem Splitter'),
			array('⚡', '10 credits = 1 song · WAV 24-bit + 320kbps MP3'),
			array('🔒', '100% safe &amp; secure payments'),
		),
		'card'       => 'VOCALREMOVER · CREDITS',
		'unit_note'  => '10 credits = 1 song split.',
		'plan_notes' => array('monthly' => '≈ 100 songs', 'yearly' => '≈ 2,000 songs'),

		'unlock' => array(
			'label'  => 'VocalRemover Premium',
			'days'   => 30,
			'prices' => array('INR' => 99, 'USD' => 2.5),
		),
	),

);
