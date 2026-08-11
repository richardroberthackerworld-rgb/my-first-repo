<?php /* Login / first-run bootstrap for the 7Marks console. Included by ops-admin.php. */ ?>
<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>7Marks Operations</title>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Lora:wght@400;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
  font-family:'Lora',Georgia,serif;color:#1d1d1d;
  background:radial-gradient(120% 90% at 50% 0,#5a4429,#3b2b18 55%,#241a0e)}
.sheet{width:100%;max-width:420px;padding:30px 28px 26px;border-radius:3px;position:relative;
  background:linear-gradient(150deg,#f7f2e4,#f1eada);box-shadow:0 26px 60px rgba(0,0,0,.55)}
.sheet::before{content:'';position:absolute;left:11%;top:0;bottom:0;width:1.5px;background:rgba(198,86,80,.35)}
h1{font-family:'Caveat',cursive;font-size:40px;margin:0 0 2px}
h1 span{color:#2b46d4}
.sub{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6455;margin-bottom:20px}
label{display:block;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6b6455;margin:14px 0 5px}
input{width:100%;padding:11px 12px;border:1.5px solid #cfc6ad;border-radius:4px;background:#fffdf6;
  font-family:'Lora',serif;font-size:15px}
input:focus{outline:none;border-color:#2b46d4}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:4px;cursor:pointer;
  background:#2b46d4;color:#fff;font-family:'Caveat',cursive;font-size:22px;letter-spacing:.5px}
button:hover{background:#233bb5}
.err{margin-top:14px;padding:9px 11px;border:1.5px solid #e0a09a;background:#fdeceb;color:#8c2f28;
  border-radius:4px;font-size:13px}
.hint{margin-top:16px;font-size:12px;line-height:1.6;color:#6b6455;border-top:1px dashed #cfc6ad;padding-top:12px}
code{background:#eee7d4;padding:1px 5px;border-radius:3px;font-size:11.5px;word-break:break-all}
</style></head><body>
<div class="sheet">
  <h1><span>7</span>Marks</h1>
  <div class="sub">Operations Console</div>

<?php if ($count === -1): ?>
  <div class="err">Cannot reach the database. Check <code>config.php</code>, then reload.</div>

<?php elseif ($count === 0): ?>
  <?php $tokSet = trim((string)ops_setting('admin_bootstrap_token','')) !== ''; ?>
  <div class="sub" style="margin:0 0 10px">First run — create the owner account</div>
  <?php if (!$tokSet): ?>
    <div class="err">No bootstrap token is set, so this page cannot create an account.</div>
    <div class="hint">
      This is deliberate: without it, whoever found this page first could claim ownership.<br><br>
      In MySQL run:<br>
      <code>INSERT INTO settings (skey,sval) VALUES ('admin_bootstrap_token','&lt;64-char-random&gt;');</code><br><br>
      Then reload and paste the same value below. It is erased automatically once the account exists.
    </div>
  <?php else: ?>
    <?php if ($err): ?><div class="err"><?= h($err) ?></div><?php endif; ?>
    <form method="post" autocomplete="off">
      <input type="hidden" name="do" value="bootstrap">
      <input type="hidden" name="csrf" value="<?= h(adm_csrf()) ?>">
      <label>Bootstrap token</label><input name="token" required>
      <label>Your name</label><input name="name" value="Owner">
      <label>Email</label><input name="email" type="email" required>
      <label>Password (10+ characters)</label><input name="pass" type="password" required>
      <button>Create owner account</button>
    </form>
  <?php endif; ?>

<?php else: ?>
  <?php if ($err): ?><div class="err"><?= h($err) ?></div><?php endif; ?>
  <form method="post" autocomplete="off">
    <input type="hidden" name="do" value="login">
    <input type="hidden" name="csrf" value="<?= h(adm_csrf()) ?>">
    <label>Email</label><input name="email" type="email" required autofocus>
    <label>Password</label><input name="pass" type="password" required>
    <button>Sign in</button>
  </form>
<?php endif; ?>
</div></body></html>
