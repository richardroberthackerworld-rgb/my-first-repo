<?php /* 7Marks operations dashboard. Included by ops-admin.php once authenticated. */ ?>
<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>7Marks Operations</title>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Lora:wght@400;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;padding:22px 16px 60px;font-family:'Lora',Georgia,serif;color:#1d1d1d;
  background:radial-gradient(120% 70% at 50% 0,#5a4429,#3b2b18 60%,#241a0e)}
.wrap{max-width:1180px;margin:0 auto}
.paper{background:linear-gradient(150deg,#f7f2e4,#f1eada);border-radius:3px;padding:22px 24px;
  box-shadow:0 18px 44px rgba(0,0,0,.45);position:relative;margin-bottom:20px}
.paper::before{content:'';position:absolute;left:26px;top:0;bottom:0;width:1.5px;background:rgba(198,86,80,.28)}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;
  border-bottom:2px solid #1d1d1d;padding-bottom:12px;margin-bottom:16px}
h1{font-family:'Caveat',cursive;font-size:38px;margin:0}
h1 span{color:#2b46d4}
.who{font-size:12px;color:#6b6455;text-align:right}
.who a{color:#2b46d4}
h2{font-family:'Caveat',cursive;font-size:26px;margin:0 0 12px;border-bottom:1px solid #d8cfb6;padding-bottom:5px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat{border:1.5px solid #cfc6ad;border-radius:5px;padding:11px 13px;background:#fffdf6}
.stat b{display:block;font-family:'Caveat',cursive;font-size:32px;line-height:1.1;color:#2b46d4}
.stat.red b{color:#c8322f}.stat.ok b{color:#1f7a45}
.stat i{font-style:normal;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#6b6455}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:860px){.cols{grid-template-columns:1fr}}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;color:#6b6455;
  border-bottom:1.5px solid #1d1d1d;padding:5px 6px}
td{padding:6px;border-bottom:1px dotted #cfc6ad;vertical-align:top}
tr:last-child td{border-bottom:0}
.tag{display:inline-block;padding:1px 7px;border-radius:9px;font-size:10.5px;border:1px solid}
.t-ok{color:#1f7a45;border-color:#9ecdb0;background:#eef8f1}
.t-warn{color:#8a6a10;border-color:#e0c34a;background:#fdf7e0}
.t-bad{color:#a03028;border-color:#e3a19b;background:#fdeceb}
.empty{color:#8a8270;font-size:13px;padding:10px 4px}
.note{font-size:11.5px;color:#6b6455;margin-top:10px;border-top:1px dashed #cfc6ad;padding-top:9px}
</style></head><body><div class="wrap">

<div class="paper">
  <div class="top">
    <div>
      <h1><span>7</span>Marks — Operations</h1>
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6455">
        7marks.7by.in &middot; scoped to this product only</div>
    </div>
    <div class="who">
      <?= h($me['name'] ?: $me['email']) ?> &middot; <?= h($me['role']) ?><br>
      <a href="?logout=1">Sign out</a>
    </div>
  </div>

  <div class="grid">
    <div class="stat"><b><?= (int)$stat['members'] ?></b><i>Members</i></div>
    <div class="stat ok"><b><?= (int)$stat['active'] ?></b><i>Active plans</i></div>
    <div class="stat"><b><?= (int)$stat['expiring'] ?></b><i>Expiring 30d</i></div>
    <div class="stat"><b><?= (int)$stat['expired'] ?></b><i>Expired</i></div>
    <div class="stat ok"><b><?= adm_money($stat['rev_total']) ?></b><i>Revenue total</i></div>
    <div class="stat"><b><?= adm_money($stat['rev_30']) ?></b><i>Revenue 30d</i></div>
    <div class="stat"><b><?= (int)$stat['new30'] ?></b><i>Purchases 30d</i></div>
    <div class="stat <?= $stat['failed'] ? 'red' : '' ?>"><b><?= (int)$stat['failed'] ?></b><i>Unpaid / failed</i></div>
    <div class="stat <?= $stat['mail_fail'] ? 'red' : '' ?>"><b><?= (int)$stat['mail_q'] ?>/<?= (int)$stat['mail_fail'] ?></b><i>Mail queued / failed</i></div>
    <div class="stat <?= $stat['tickets'] ? 'red' : 'ok' ?>"><b><?= (int)$stat['tickets'] ?></b><i>Open tickets</i></div>
    <div class="stat <?= $stat['errors'] ? 'red' : 'ok' ?>"><b><?= (int)$stat['errors'] ?></b><i>Open errors</i></div>
    <div class="stat <?= $schedOk ? 'ok' : 'red' ?>"><b><?= $schedOk ? 'OK' : 'STALE' ?></b><i>Scheduler</i></div>
  </div>
  <?php if (!$schedOk): ?>
    <div class="note">Scheduler has not checked in for over 30 minutes. Reminder and purchase emails
      queue up but are not sent until the cron runs
      <code>php ops-scheduler.php</code> (every 5 minutes).</div>
  <?php endif; ?>
  <div class="note">
    Hub-wide rows not attributed to any product: <?= (int)$hubWide['tickets'] ?> ticket(s),
    <?= (int)$hubWide['errors'] ?> error(s). These pre-date per-product tagging and are shown
    separately rather than counted as 7Marks.
  </div>
</div>

<div class="cols">
  <div class="paper"><h2>Members</h2>
    <?php if (!$members): ?><div class="empty">No 7Marks wallets yet.</div><?php else: ?>
    <table><tr><th>Student</th><th>Plan</th><th>Credits</th><th>Expires</th></tr>
      <?php foreach ($members as $m): ?>
      <tr><td><?= h($m['name'] ?: '—') ?><br><span style="color:#6b6455;font-size:11.5px"><?= h($m['email']) ?></span></td>
        <td><?= h($m['plan']) ?></td><td><?= (int)$m['credits'] ?></td>
        <td><?= $m['plan_expires'] ? h(date('d M Y', strtotime($m['plan_expires']))) : '—' ?></td></tr>
      <?php endforeach; ?></table><?php endif; ?>
  </div>

  <div class="paper"><h2>Purchases</h2>
    <?php if (!$txs): ?><div class="empty">No 7Marks transactions yet.</div><?php else: ?>
    <table><tr><th>Payment</th><th>Plan</th><th>Amount</th><th>Status</th></tr>
      <?php foreach ($txs as $t): ?>
      <tr><td style="font-size:11.5px"><?= h($t['payment_id'] ?: '—') ?><br>
          <span style="color:#6b6455"><?= h(date('d M, H:i', strtotime($t['created_at']))) ?></span></td>
        <td><?= h($t['plan']) ?></td><td><?= adm_money((int)$t['amount']) ?></td>
        <td><span class="tag <?= $t['status']==='paid'?'t-ok':'t-warn' ?>"><?= h($t['status']) ?></span></td></tr>
      <?php endforeach; ?></table><?php endif; ?>
  </div>

  <div class="paper"><h2>Email activity</h2>
    <?php if (!$mails): ?><div class="empty">Nothing queued for 7Marks.</div><?php else: ?>
    <table><tr><th>Template</th><th>To</th><th>Status</th><th>Tries</th></tr>
      <?php foreach ($mails as $m): ?>
      <tr><td><?= h($m['template']) ?></td><td style="font-size:11.5px"><?= h($m['to_email']) ?></td>
        <td><span class="tag <?= $m['status']==='sent'?'t-ok':($m['status']==='failed'?'t-bad':'t-warn') ?>"><?= h($m['status']) ?></span></td>
        <td><?= (int)$m['attempts'] ?></td></tr>
      <?php endforeach; ?></table><?php endif; ?>
  </div>

  <div class="paper"><h2>Support tickets</h2>
    <?php if (!$tickets): ?><div class="empty">No 7Marks tickets.</div><?php else: ?>
    <table><tr><th>Ref</th><th>From</th><th>Subject</th><th>Status</th></tr>
      <?php foreach ($tickets as $t): ?>
      <tr><td style="font-size:11.5px"><?= h($t['ref']) ?></td>
        <td><?= h($t['name']) ?><br><span style="color:#6b6455;font-size:11.5px"><?= h($t['email']) ?></span></td>
        <td><?= h($t['subject']) ?><br><span style="color:#6b6455;font-size:11.5px"><?= h($t['category']) ?></span></td>
        <td><span class="tag <?= $t['status']==='resolved'?'t-ok':'t-warn' ?>"><?= h($t['status']) ?></span></td></tr>
      <?php endforeach; ?></table><?php endif; ?>
  </div>

  <div class="paper"><h2>Errors</h2>
    <?php if (!$errors): ?><div class="empty">No open 7Marks errors.</div><?php else: ?>
    <table><tr><th>Ref</th><th>Type</th><th>Route</th><th>Seen</th></tr>
      <?php foreach ($errors as $e): ?>
      <tr><td style="font-size:11.5px"><?= h($e['ref']) ?></td>
        <td><?= h($e['type']) ?><br><span class="tag <?= $e['severity']==='critical'?'t-bad':'t-warn' ?>"><?= h($e['severity']) ?></span></td>
        <td style="font-size:11.5px"><?= h($e['route']) ?></td>
        <td><?= (int)$e['occurrences'] ?>&times;<br><span style="color:#6b6455;font-size:11.5px"><?= h(date('d M, H:i', strtotime($e['last_seen']))) ?></span></td></tr>
      <?php endforeach; ?></table><?php endif; ?>
    <div class="note">Technical detail stays here and in the owner alert — students only ever see
      &ldquo;Something went wrong. We&rsquo;ve been notified.&rdquo;</div>
  </div>

  <div class="paper"><h2>Scheduler</h2>
    <?php if (!$runs): ?><div class="empty">The scheduler has never run. Add the cron entry.</div><?php else: ?>
    <table><tr><th>Started</th><th>Took</th><th>Result</th></tr>
      <?php foreach ($runs as $r): ?>
      <tr><td><?= h(date('d M, H:i', strtotime($r['started_at']))) ?></td>
        <td><?= (int)$r['duration_ms'] ?> ms</td>
        <td><span class="tag <?= $r['ok']?'t-ok':'t-bad' ?>"><?= $r['ok']?'ok':'failed' ?></span></td></tr>
      <?php endforeach; ?></table><?php endif; ?>
    <div class="note">AI key health is deliberately not here: 7Marks keys never leave
      <code>7marks/keys.php</code>. Check them at
      <code>7marks.7by.in/api.php?action=keyhealth</code> with the owner token.</div>
  </div>
</div>
</div></body></html>
