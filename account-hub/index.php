<?php
require __DIR__ . '/lib.php';
boot_session();
$me = current_user();

// Resolve the product (from the pretty URL rewrite ?p=... ), else generic 7By.
$PRODUCTS = require __DIR__ . '/products.php';
$pkey = isset($_GET['p']) ? preg_replace('/[^a-z0-9]/', '', strtolower($_GET['p'])) : '';

// Visitor pricing: India pays INR, everyone else USD ($1.5 / $6).
// Credits per plan can differ per product (VocalRemover: 10 credits = 1 song).
$PLANS = array(
	'monthly' => plan_details('monthly', $pkey),
	'yearly'  => plan_details('yearly', $pkey),
);

$GENERIC = array(
	'brand'    => '7By',
	'title'    => '7By Account — Sign in',
	'tool_url' => 'https://7by.in',
	'accent'   => null,
	'hero'     => 'One account.<br><span class="grad">Every 7By tool.</span>',
	'sub'      => 'Sign in to get export credits that work across every 7By tool.',
	'auth_sub' => 'Sign in to your 7By account to manage credits.',
	'feats'    => array(
		array('💳', 'One credit balance across all 7By tools'),
		array('⚡', $PLANS['monthly']['price_text'] . ' = ' . number_format($PLANS['monthly']['credits']) . ' credits every month'),
		array('🔒', '100% safe &amp; secure payments'),
	),
	'card'     => '7By · CREDITS',
);
$P = ($pkey && isset($PRODUCTS[$pkey])) ? array_merge($GENERIC, $PRODUCTS[$pkey]) : $GENERIC;
$UNIT = !empty($P['unit_note']) ? $P['unit_note'] : 'Each tool shows how many credits an action costs.';
?><!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title><?php echo htmlspecialchars($P['title']); ?></title>
	<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
	<link rel="stylesheet" href="/assets/account.css?v=7">
	<?php if (!empty($P['accent'])): ?>
	<style>:root{--primary:<?php echo $P['accent'][0]; ?>;--primary2:<?php echo $P['accent'][1]; ?>}</style>
	<?php endif; ?>
	<script src="https://accounts.google.com/gsi/client" async defer></script>
	<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
	<script>
		window.HUB = {
			googleClientId: <?php echo json_encode($CFG['google']['client_id']); ?>,
			plans: <?php echo json_encode($PLANS); ?>,
			redirect: (new URLSearchParams(location.search)).get('return') || '',
			product: <?php echo json_encode($pkey); ?>,
			toolUrl: <?php echo json_encode($P['tool_url']); ?>,
			brandName: <?php echo json_encode($P['brand']); ?>
		};
	</script>
</head>
<body>
	<div class="bg-anim">
		<span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
		<span class="spark s1"></span><span class="spark s2"></span><span class="spark s3"></span><span class="spark s4"></span>
	</div>

	<div class="shell">
		<!-- ================= BRAND ================= -->
		<aside class="brand-panel">
			<a class="brand-logo" href="<?php echo htmlspecialchars($P['tool_url']); ?>"><span class="logo-mark">◧</span> <?php echo htmlspecialchars($P['brand']); ?></a>
			<h1 class="brand-h"><?php echo $P['hero']; ?></h1>
			<p class="brand-p"><?php echo $P['sub']; ?></p>
			<ul class="brand-feats">
				<?php foreach ($P['feats'] as $f): ?>
				<li><span><?php echo $f[0]; ?></span> <?php echo $f[1]; ?></li>
				<?php endforeach; ?>
			</ul>

			<?php $holder = ($me && trim($me['name']) !== '') ? strtoupper($me['name']) : 'YOUR NAME HERE'; ?>
			<div class="pay-card">
				<div class="pc-top"><span class="pc-brand"><?php echo htmlspecialchars($P['card']); ?></span><span class="pc-logo">◧</span></div>
				<div class="pc-mid"><div class="pc-chip"></div><span class="pc-nfc">)))</span></div>
				<div class="pc-num"><?php echo number_format($PLANS['monthly']['credits']); ?> · CREDITS · MONTHLY</div>
				<div class="pc-bottom">
					<div class="pc-col"><span class="pc-lbl">CARD HOLDER</span><span class="pc-name"><?php echo htmlspecialchars($holder); ?></span></div>
					<div class="pc-col pc-right"><span class="pc-lbl">PRICE</span><span class="pc-amt"><?php echo htmlspecialchars($PLANS['monthly']['price_text']); ?>/mo</span></div>
				</div>
			</div>

			<div class="brand-foot">© 2026 <b>7By.in</b> · Founder &amp; CEO — Shirandasu Sandeep</div>
		</aside>

		<!-- ================= AUTH ================= -->
		<main class="auth-panel">
			<section class="card auth-card" id="authCard" <?php echo $me ? 'hidden' : ''; ?>>

				<div class="astep" data-step="home">
					<h2 class="auth-title">Welcome back</h2>
					<p class="auth-sub"><?php echo htmlspecialchars($P['auth_sub']); ?></p>
					<?php if (strpos($CFG['google']['client_id'], 'TODO') !== 0): // hide Google until a real client ID is configured ?>
					<div id="g_id_onload" data-client_id="<?php echo htmlspecialchars($CFG['google']['client_id']); ?>" data-callback="onGoogle" data-auto_prompt="false"></div>
					<div class="g_id_signin" data-type="standard" data-shape="pill" data-theme="outline" data-text="continue_with" data-size="large" data-width="330" data-logo_alignment="left"></div>
					<div class="or"><span>or</span></div>
					<?php endif; ?>
					<button type="button" class="btn btn-outline btn-block btn-mail" data-go="choice">✉&nbsp; Continue with email</button>
				</div>

				<div class="astep" data-step="choice" hidden>
					<button type="button" class="back" data-go="home">←</button>
					<h2 class="auth-title">Continue with email</h2>
					<p class="auth-sub">New here, or coming back?</p>
					<button type="button" class="btn btn-primary btn-block" data-go="signin">I already have an account</button>
					<button type="button" class="btn btn-outline btn-block" data-go="signup">Create a new account</button>
				</div>

				<form class="astep" data-step="signin" id="signinForm" hidden>
					<button type="button" class="back" data-go="choice">←</button>
					<h2 class="auth-title">Sign in</h2>
					<label>Email<input type="email" name="email" required autocomplete="email"></label>
					<label>Password<input type="password" name="password" required autocomplete="current-password"></label>
					<button class="btn btn-primary btn-block" type="submit">Sign in</button>
					<button type="button" class="link-btn" data-go="forgot">Forgot password?</button>
				</form>

				<form class="astep" data-step="forgot" id="forgotForm" hidden>
					<button type="button" class="back" data-go="signin">←</button>
					<h2 class="auth-title">Reset password</h2>
					<p class="auth-sub">Enter your email and we'll send a 6-digit code.</p>
					<label>Email<input type="email" name="email" required autocomplete="email"></label>
					<button class="btn btn-primary btn-block" type="submit">Send code</button>
				</form>

				<form class="astep" data-step="reset" id="resetForm" hidden>
					<button type="button" class="back" data-go="forgot">←</button>
					<h2 class="auth-title">Set a new password</h2>
					<p class="auth-sub">We sent a code to <b class="email-echo"></b>.</p>
					<label>6-digit code<input type="text" name="code" inputmode="numeric" maxlength="6" class="otp-input" required></label>
					<label>New password<input type="password" name="password" minlength="6" required autocomplete="new-password"></label>
					<label>Confirm password<input type="password" name="confirm" minlength="6" required autocomplete="new-password"></label>
					<button class="btn btn-primary btn-block" type="submit">Reset password</button>
				</form>

				<form class="astep" data-step="signup" id="signupForm" hidden>
					<button type="button" class="back" data-go="choice">←</button>
					<h2 class="auth-title">Create account</h2>
					<label>Name<input type="text" name="name" required autocomplete="name"></label>
					<label>Email<input type="email" name="email" required autocomplete="email"></label>
					<label>Password<input type="password" name="password" minlength="6" required autocomplete="new-password"></label>
					<button class="btn btn-primary btn-block" type="submit">Continue</button>
				</form>

				<form class="astep" data-step="verify" id="verifyForm" hidden>
					<button type="button" class="back" data-go="signup">←</button>
					<h2 class="auth-title">Verify your email</h2>
					<p class="auth-sub">We sent a 6-digit code to <b class="email-echo"></b>.</p>
					<label>Verification code<input type="text" name="code" inputmode="numeric" maxlength="6" class="otp-input" required></label>
					<button class="btn btn-primary btn-block" type="submit">Verify &amp; create account</button>
					<button type="button" class="link-btn" id="resendBtn">Resend code</button>
				</form>

				<p class="msg" id="authMsg"></p>
			</section>

			<section class="card dash-card" id="dashCard" <?php echo $me ? '' : 'hidden'; ?>>
				<div class="dash-head">
					<div>
						<div class="hello">Welcome, <b id="dName"><?php echo $me ? htmlspecialchars($me['name']) : ''; ?></b> 👋</div>
						<div class="email" id="dEmail"><?php echo $me ? htmlspecialchars($me['email']) : ''; ?></div>
					</div>
					<button class="btn btn-ghost" id="logoutBtn">Log out</button>
				</div>
				<div class="credit-box">
					<div class="credit-num" id="dCredits"><?php echo $me ? (int)$me['credits'] : 0; ?></div>
					<div class="credit-label">credits available</div>
					<div class="plan-line" id="dPlan"></div>
				</div>
				<h3>Buy credits</h3>
				<div class="plans">
					<?php $m = $PLANS['monthly']; $y = $PLANS['yearly']; ?>
					<div class="plan">
						<div class="plan-name">Monthly</div>
						<div class="plan-price"><?php echo htmlspecialchars($m['price_text']); ?></div>
						<div class="plan-desc"><?php echo number_format($m['credits']); ?> credits<?php echo $m['note'] ? ' · ' . htmlspecialchars($m['note']) : ''; ?> · valid 30 days</div>
						<button class="btn btn-primary" data-buy="monthly">Buy Monthly</button>
					</div>
					<div class="plan plan-best">
						<div class="plan-badge">BEST VALUE</div>
						<div class="plan-name">Yearly</div>
						<div class="plan-price"><?php echo htmlspecialchars($y['price_text']); ?></div>
						<div class="plan-desc"><?php echo number_format($y['credits']); ?> credits<?php echo $y['note'] ? ' · ' . htmlspecialchars($y['note']) : ''; ?> · valid 1 year</div>
						<button class="btn btn-primary" data-buy="yearly">Buy Yearly</button>
					</div>
				</div>
				<p class="fineprint"><?php echo htmlspecialchars($UNIT); ?> Credits work across every 7By tool. Prices in <?php echo htmlspecialchars($m['currency']); ?> · 100% safe &amp; secure payments.</p>
				<p class="msg" id="dashMsg"></p>
				<a class="back-link" id="backLink" hidden>← Back to the tool</a>
			</section>
		</main>
	</div>

	<script src="/assets/account.js?v=8"></script>
</body>
</html>
