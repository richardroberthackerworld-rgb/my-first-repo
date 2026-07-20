<?php
/**
 * 7By.in Blog — daily post uploader.
 * Open https://7by.in/blog/admin.php — first visit sets your admin password,
 * after that: log in, write, Publish. Each post becomes a real HTML page in
 * this folder (same design as the existing posts, AdSense included) and a
 * card is added to the top of the blog index automatically.
 */
session_start();
error_reporting(E_ALL & ~E_DEPRECATED);

$passFile = __DIR__ . '/admin-pass.php';
$hasPass  = file_exists($passFile);
$err = ''; $ok = '';

/* ---------- first run: create the admin password ---------- */
if (!$hasPass && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['newpass'])) {
	$p = (string)$_POST['newpass'];
	if (strlen($p) < 8) $err = 'Password must be at least 8 characters.';
	elseif ($p !== (string)($_POST['newpass2'] ?? '')) $err = 'Passwords do not match.';
	else {
		file_put_contents($passFile, "<?php return " . var_export(password_hash($p, PASSWORD_DEFAULT), true) . ";\n");
		$_SESSION['blog_admin'] = true;
		$hasPass = true; $ok = 'Password set — you are logged in.';
	}
}

/* ---------- login / logout ---------- */
if (isset($_GET['logout'])) { unset($_SESSION['blog_admin']); header('Location: admin.php'); exit; }
if ($hasPass && empty($_SESSION['blog_admin']) && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['pass'])) {
	$hash = require $passFile;
	if (password_verify((string)$_POST['pass'], $hash)) $_SESSION['blog_admin'] = true;
	else $err = 'Wrong password.';
}
$authed = !empty($_SESSION['blog_admin']);

/* ---------- tiny text -> HTML: blank line = paragraph, "## " = heading,
              "- " lines = bullet list, "1. " lines = numbered list, **bold** ---------- */
function post_html($text) {
	$out = '';
	foreach (preg_split('/\r?\n\s*\r?\n/', trim($text)) as $block) {
		$block = trim($block);
		if ($block === '') continue;
		$lines = preg_split('/\r?\n/', $block);
		$esc = function ($s) { $s = htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
			return preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $s); };
		if (strpos($block, '## ') === 0) { $out .= '      <h2>' . $esc(substr($block, 3)) . "</h2>\n"; continue; }
		$isUl = true; $isOl = true;
		foreach ($lines as $l) { if (strpos(ltrim($l), '- ') !== 0) $isUl = false; if (!preg_match('/^\s*\d+[.)]\s/', $l)) $isOl = false; }
		if ($isUl && count($lines)) { $out .= "      <ul>\n"; foreach ($lines as $l) $out .= '        <li>' . $esc(trim(substr(ltrim($l), 2))) . "</li>\n"; $out .= "      </ul>\n"; continue; }
		if ($isOl && count($lines)) { $out .= "      <ol>\n"; foreach ($lines as $l) $out .= '        <li>' . $esc(trim(preg_replace('/^\s*\d+[.)]\s*/', '', $l))) . "</li>\n"; $out .= "      </ol>\n"; continue; }
		$out .= '      <p>' . $esc(implode(' ', array_map('trim', $lines))) . "</p>\n";
	}
	return $out;
}

/* ---------- publish ---------- */
if ($authed && $_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['title'], $_POST['content'])) {
	$title   = trim((string)$_POST['title']);
	$cat     = trim((string)($_POST['category'] ?? '')) ?: 'Article';
	$emoji   = trim((string)($_POST['emoji'] ?? '')) ?: '📝';
	$mins    = trim((string)($_POST['mins'] ?? '')) ?: '5';
	$lead    = trim((string)($_POST['lead'] ?? ''));
	$content = (string)$_POST['content'];

	$slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $title), '-'));
	$slug = substr($slug, 0, 80);
	if ($title === '' || $content === '') $err = 'Title and content are required.';
	elseif ($slug === '' || in_array($slug, array('index', 'admin', 'admin-pass'))) $err = 'That title makes an invalid page name.';
	elseif (file_exists(__DIR__ . "/$slug.html")) $err = "A post named \"$slug\" already exists — change the title a little.";
	else {
		$date  = date('F j, Y');
		$desc  = htmlspecialchars($lead !== '' ? mb_substr($lead, 0, 155) : mb_substr($title, 0, 155), ENT_QUOTES, 'UTF-8');
		$tEsc  = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
		$cEsc  = htmlspecialchars($cat, ENT_QUOTES, 'UTF-8');
		$body  = post_html($content);
		$leadHtml = $lead !== '' ? '      <p class="lead" style="font-size:18px;color:var(--mut);line-height:1.8;margin-bottom:32px">' . htmlspecialchars($lead, ENT_QUOTES, 'UTF-8') . "</p>\n" : '';

		$page = <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>$tEsc | 7By.in Blog</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="apple-touch-icon" href="/assets/favicon.png">
<meta name="description" content="$desc">
<link rel="canonical" href="https://7by.in/blog/$slug">
<link rel="stylesheet" href="../assets/style.css?v=202607052329">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8250159057339426" crossorigin="anonymous"></script>
</head>
<body>
<div class="page-wrap">
<section style="padding:100px 0 40px">
  <div class="container" style="max-width:760px">
    <a href="./" style="color:var(--mut);font-size:13px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;margin-bottom:24px">← Back to Blog</a>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;font-weight:600;color:var(--ok);margin-bottom:12px">$cEsc</div>
    <h1 style="font-size:clamp(28px,4vw,44px);line-height:1.2;margin-bottom:16px">$tEsc</h1>
    <div style="color:var(--dim);font-size:13px;font-family:'JetBrains Mono',monospace;margin-bottom:32px">$date · $mins min read · by Shirandasu Sandeep</div>
  </div>
</section>
<section style="padding:40px 0 80px">
  <div class="container" style="max-width:760px">
    <div class="blog-content">
$leadHtml$body    </div>
    <div style="margin-top:48px;padding-top:24px;border-top:1px solid var(--bord)">
      <a href="./" style="color:var(--mut);font-size:13px;text-decoration:none">← Back to Blog</a>
    </div>
  </div>
</section>
</div>
</body>
</html>
HTML;
		file_put_contents(__DIR__ . "/$slug.html", $page);

		/* add the card to the top of the blog index */
		$idxFile = __DIR__ . '/index.html';
		$idx = file_get_contents($idxFile);
		$colors = array(
			array('rgba(0,212,255,.12),rgba(0,212,255,.04)', 'var(--cyan)'),
			array('rgba(255,0,110,.12),rgba(255,0,110,.04)', 'var(--mag)'),
			array('rgba(255,184,0,.12),rgba(255,184,0,.04)', 'var(--gold, #ffb800)'),
			array('rgba(0,255,136,.12),rgba(0,255,136,.04)', 'var(--ok)'),
		);
		$c = $colors[array_rand($colors)];
		$card = "\n\n      <div class=\"b-card\">\n"
			. "        <div class=\"b-thumb\" style=\"background:linear-gradient(135deg,{$c[0]})\">$emoji</div>\n"
			. "        <div class=\"b-body\">\n"
			. "          <div class=\"b-cat\" style=\"color:{$c[1]}\">$cEsc</div>\n"
			. "          <div class=\"b-title\"><a href=\"$slug\">$tEsc</a></div>\n"
			. "          <div class=\"b-meta\">$date · $mins min read</div>\n"
			. "        </div>\n"
			. "      </div>\n";
		$marker = '<div class="blog-grid">';
		$posAt = strpos($idx, $marker);
		if ($posAt !== false) {
			$idx = substr_replace($idx, $marker . $card, $posAt, strlen($marker));
			file_put_contents($idxFile, $idx);
		}
		$ok = "Published! <a href=\"$slug\" target=\"_blank\">View the post</a> · it's also on the <a href=\"./\" target=\"_blank\">blog page</a>.";
	}
}
?><!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blog admin · 7By.in</title>
<link rel="icon" type="image/png" href="/assets/favicon.png">
<style>
	body{font-family:system-ui,sans-serif;background:#0b0b12;color:#e8e8f0;margin:0;padding:24px}
	.card{max-width:720px;margin:30px auto;background:#14141f;border:1px solid #2a2a3a;border-radius:14px;padding:28px}
	h1{font-size:20px;margin:0 0 14px;color:#00d4ff}
	label{display:block;font-weight:600;margin:14px 0 5px;font-size:13.5px;color:#a8a8bc}
	input,textarea{width:100%;box-sizing:border-box;font-size:15px;padding:10px 12px;border:1px solid #33334a;border-radius:8px;background:#0e0e18;color:#e8e8f0;font-family:inherit}
	textarea{min-height:300px;line-height:1.6;font-size:14.5px}
	button{margin-top:18px;font-size:15px;font-weight:700;padding:12px 26px;border:0;border-radius:8px;background:#00d4ff;color:#001018;cursor:pointer}
	.row{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px}
	.err{background:#2a1215;border:1px solid #7a2c33;color:#ff9aa4;padding:10px 12px;border-radius:8px;margin-top:12px}
	.ok{background:#0f2a1a;border:1px solid #2c7a4c;color:#8fe6b0;padding:10px 12px;border-radius:8px;margin-top:12px}
	.ok a{color:#00d4ff}
	.hint{font-size:12.5px;color:#77778c;line-height:1.6;margin-top:8px}
	.top{display:flex;justify-content:space-between;align-items:center}
	.top a{color:#77778c;font-size:13px}
	@media(max-width:600px){.row{grid-template-columns:1fr}}
</style>
<div class="card">
<?php if (!$hasPass): ?>
	<h1>Blog admin — first-time setup</h1>
	<p style="color:#a8a8bc">Create the admin password you'll use to publish posts.</p>
	<?php if ($err): ?><div class="err"><?php echo $err; ?></div><?php endif; ?>
	<form method="post">
		<label>New password (min 8 characters)</label><input type="password" name="newpass">
		<label>Repeat password</label><input type="password" name="newpass2">
		<button>Set password</button>
	</form>
<?php elseif (!$authed): ?>
	<h1>Blog admin — log in</h1>
	<?php if ($err): ?><div class="err"><?php echo $err; ?></div><?php endif; ?>
	<form method="post">
		<label>Password</label><input type="password" name="pass" autofocus>
		<button>Log in</button>
	</form>
<?php else: ?>
	<div class="top"><h1>Write today's post</h1><a href="?logout=1">Log out</a></div>
	<?php if ($err): ?><div class="err"><?php echo $err; ?></div><?php endif; ?>
	<?php if ($ok): ?><div class="ok"><?php echo $ok; ?></div><?php endif; ?>
	<form method="post">
		<label>Title</label>
		<input name="title" placeholder="e.g. 5 Smart Ways Students Use AI to Prepare for Exams">
		<div class="row">
			<div><label>Category</label><input name="category" value="Article" placeholder="Guide / Tutorial / News"></div>
			<div><label>Emoji (card icon)</label><input name="emoji" value="📝"></div>
			<div><label>Read time (min)</label><input name="mins" value="5"></div>
		</div>
		<label>Intro line (optional, shows big at the top)</label>
		<input name="lead" placeholder="One-sentence summary of the post">
		<label>Content</label>
		<textarea name="content" placeholder="Write normally. Blank line = new paragraph.

## A line starting like this becomes a heading

- lines starting with - become
- a bullet list

1. numbered lines become
2. a numbered list

**double stars** make text bold."></textarea>
		<div class="hint">Publishing creates the post page instantly (same design as the other posts, AdSense included, byline “by Shirandasu Sandeep”) and adds it to the top of the blog index.</div>
		<button>🚀 Publish post</button>
	</form>
<?php endif; ?>
</div>
