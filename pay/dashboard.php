<?php
/**
 * 7Pay — merchant dashboard.
 * Sign in with your key_id + key_secret. Shows payments, volume stats,
 * approve pending live-UPI payments, refund captured ones.
 */
require __DIR__ . '/lib.php';
session_name('sevenpay_dash');
session_start();

$me = !empty($_SESSION['gw_key']) ? gw_merchant($_SESSION['gw_key']) : null;
$msg = ''; $msgOk = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	$act = $_POST['act'] ?? '';
	if ($act === 'login') {
		$m = gw_merchant(trim($_POST['key_id'] ?? ''));
		if ($m && hash_equals($m['key_secret'], (string)($_POST['key_secret'] ?? ''))) {
			$_SESSION['gw_key'] = $m['key_id'];
			header('Location: dashboard.php'); exit;
		}
		$msg = 'Wrong key ID or secret.';
	}
	elseif ($act === 'logout') {
		$_SESSION = array(); session_destroy();
		header('Location: dashboard.php'); exit;
	}
	elseif ($me && $act === 'approve') {
		$p = gw_get_payment((string)($_POST['pid'] ?? ''));
		if ($p && $p['merchant_key'] === $me['key_id'] && $p['status'] === 'pending') {
			gw_capture($p);
			$msg = 'Payment approved — webhook sent.'; $msgOk = true;
		} else $msg = 'Payment not found or not pending.';
	}
	elseif ($me && $act === 'reject') {
		$p = gw_get_payment((string)($_POST['pid'] ?? ''));
		if ($p && $p['merchant_key'] === $me['key_id'] && $p['status'] === 'pending') {
			gw_db()->prepare("UPDATE gw_payments SET status='failed', error='Rejected by merchant', updated_at=? WHERE id=?")
				->execute(array(gw_now(), $p['id']));
			$msg = 'Payment rejected.'; $msgOk = true;
		} else $msg = 'Payment not found or not pending.';
	}
	elseif ($me && $act === 'refund') {
		$p = gw_get_payment((string)($_POST['pid'] ?? ''));
		if ($p && $p['merchant_key'] === $me['key_id'] && $p['status'] === 'captured') {
			gw_db()->prepare("UPDATE gw_payments SET status='refunded', updated_at=? WHERE id=?")
				->execute(array(gw_now(), $p['id']));
			gw_webhook($me['key_id'], 'payment.refunded', gw_get_payment($p['id']));
			$msg = 'Marked refunded — remember to actually send the money back if this was a live payment.'; $msgOk = true;
		} else $msg = 'Only captured payments can be refunded.';
	}
}

$payments = array(); $stats = array('captured' => 0, 'pending' => 0, 'failed' => 0);
$volumeText = '0';
if ($me) {
	gw_expire_stale_reservations(); // clear abandoned auto-detect checkouts
	$st = gw_db()->prepare('SELECT * FROM gw_payments WHERE merchant_key = ? ORDER BY created_at DESC, id DESC LIMIT 100');
	$st->execute(array($me['key_id']));
	$payments = $st->fetchAll();
	$ag = gw_db()->prepare("SELECT status, currency, COUNT(*) n, SUM(amount) s FROM gw_payments WHERE merchant_key = ? GROUP BY status, currency");
	$ag->execute(array($me['key_id']));
	$vol = array(); // per-currency captured volume (mixing ₹ and $ makes no sense)
	foreach ($ag->fetchAll() as $r) {
		if ($r['status'] === 'captured') { $stats['captured'] += (int)$r['n']; $vol[$r['currency']] = (int)$r['s']; }
		if ($r['status'] === 'pending')  $stats['pending'] += (int)$r['n'];
		if ($r['status'] === 'failed')   $stats['failed'] += (int)$r['n'];
	}
	if ($vol) {
		$parts = array();
		foreach ($vol as $cur => $s) $parts[] = gw_money($s, $cur);
		$volumeText = implode(' + ', $parts);
	}
}
function e($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Dashboard · 7Pay</title>
<link rel="icon" type="image/png" href="favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/pay.css">
<style>
  .nav { height: 64px; background: rgba(255,255,255,0.85); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 32px; position: sticky; top: 0; z-index: 10; }
  .brand { font-weight: 800; font-size: 19px; letter-spacing: -0.5px; color: var(--text); text-decoration: none !important; }
  .brand b { color: var(--accent); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; }
  .login-card { max-width: 400px; margin: 64px auto; padding: 32px; }
  .login-card h1 { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
  .login-card p { font-size: 14px; color: var(--muted); margin-bottom: 20px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 20px 0 28px; }
  .stat { padding: 18px 20px; }
  .stat .v { font-size: 28px; font-weight: 800; letter-spacing: -1px; margin-top: 4px; }
  .head-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  h1.page { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
  .tbl-card { padding: 8px 16px 16px; overflow-x: auto; }
  .btn-approve { background: var(--success); color: #fff; border: 0; }
  .btn-approve:hover { filter: brightness(1.08); }
  .btn-danger { background: var(--surface); color: var(--error); border: 1px solid rgba(220,38,38,0.3); }
  .btn-danger:hover { background: var(--error-dim); }
  form.inline { display: inline; }
  .mode-tag { margin-left: 10px; }
</style>
</head>
<body>
<nav class="nav">
	<a class="brand" href="index.php">7<b>Pay</b></a>
	<?php if ($me): ?>
	<form method="post" class="inline"><input type="hidden" name="act" value="logout">
		<span class="mono-label" style="margin-right:14px"><?php echo e($me['name']); ?> · <?php echo e($me['key_id']); ?></span>
		<button class="btn btn-ghost btn-sm">Sign out</button>
	</form>
	<?php endif; ?>
</nav>

<?php if (!$me): ?>
<div class="card login-card">
	<h1>Merchant sign in</h1>
	<p>Use the key ID and secret from <code class="inline">config.php</code>.</p>
	<?php if ($msg): ?><div class="msg msg-err"><?php echo e($msg); ?></div><?php endif; ?>
	<form method="post">
		<input type="hidden" name="act" value="login">
		<div class="field"><label>Key ID</label><input class="input mono" name="key_id" placeholder="7pay_xxx" autofocus></div>
		<div class="field"><label>Key secret</label><input class="input mono" type="password" name="key_secret"></div>
		<button class="btn btn-primary btn-block">Sign in</button>
	</form>
</div>

<?php else: ?>
<div class="wrap">
	<div class="head-row">
		<h1 class="page">Payments</h1>
		<span class="badge <?php echo $me['mode'] === 'live' ? 'badge-live' : 'badge-test'; ?> mode-tag"><?php echo e($me['mode']); ?> mode</span>
	</div>
	<?php if ($msg): ?><div class="msg <?php echo $msgOk ? 'msg-ok' : 'msg-err'; ?>"><?php echo e($msg); ?></div><?php endif; ?>

	<div class="stats">
		<div class="card stat"><span class="mono-label">Volume (captured)</span><div class="v"><?php echo e($volumeText); ?></div></div>
		<div class="card stat"><span class="mono-label">Captured</span><div class="v"><?php echo (int)$stats['captured']; ?></div></div>
		<div class="card stat"><span class="mono-label">Pending approval</span><div class="v" style="color:<?php echo $stats['pending'] ? 'var(--warn)' : 'inherit'; ?>"><?php echo (int)$stats['pending']; ?></div></div>
		<div class="card stat"><span class="mono-label">Failed</span><div class="v"><?php echo (int)$stats['failed']; ?></div></div>
	</div>

	<div class="card tbl-card">
		<table class="data">
			<thead><tr>
				<th>Payment</th><th>Order</th><th>Method</th><th>Detail</th><th>Amount</th><th>Status</th><th>When</th><th></th>
			</tr></thead>
			<tbody>
			<?php if (!$payments): ?>
				<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px">No payments yet. Try the <a href="demo.php">demo store</a>.</td></tr>
			<?php endif; ?>
			<?php foreach ($payments as $p): ?>
				<tr>
					<td class="mono"><?php echo e($p['id']); ?></td>
					<td class="mono"><?php echo e($p['order_id']); ?></td>
					<td><?php echo e($p['method']); ?></td>
					<td class="mono"><?php
						if ($p['method'] === 'card') echo e(($p['card_network'] ?: '') . ' •••• ' . $p['card_last4']);
						elseif ($p['method'] === 'paypal' && $p['utr']) echo 'TXN ' . e($p['utr']);
						elseif ($p['utr']) echo 'UTR ' . e($p['utr']);
						elseif ($p['vpa']) echo e($p['vpa']);
						elseif ($p['bank']) echo e($p['bank']);
					?></td>
					<td style="font-weight:600"><?php echo e(gw_money($p['amount'], $p['currency'])); ?></td>
					<td><span class="pill pill-<?php echo e($p['status']); ?>"><?php echo e($p['status']); ?></span></td>
					<td class="mono" style="color:var(--muted)"><?php echo e($p['created_at']); ?></td>
					<td style="white-space:nowrap">
						<?php if ($p['status'] === 'pending'): ?>
						<form method="post" class="inline"><input type="hidden" name="act" value="approve"><input type="hidden" name="pid" value="<?php echo e($p['id']); ?>">
							<button class="btn btn-sm btn-approve">Approve</button></form>
						<form method="post" class="inline"><input type="hidden" name="act" value="reject"><input type="hidden" name="pid" value="<?php echo e($p['id']); ?>">
							<button class="btn btn-sm btn-danger">Reject</button></form>
						<?php elseif ($p['status'] === 'captured'): ?>
						<form method="post" class="inline" onsubmit="return confirm('Mark this payment refunded?')"><input type="hidden" name="act" value="refund"><input type="hidden" name="pid" value="<?php echo e($p['id']); ?>">
							<button class="btn btn-sm btn-danger">Refund</button></form>
						<?php endif; ?>
					</td>
				</tr>
			<?php endforeach; ?>
			</tbody>
		</table>
	</div>
</div>
<?php endif; ?>
</body>
</html>
