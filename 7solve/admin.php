<?php
/* ============================================================
   7Solve — QUALITY DASHBOARD (§44)
   ------------------------------------------------------------
   The point of this page is NOT the pretty totals. It is the
   three lists at the bottom:

     · answers a student reported as wrong
     · answers our own checker said were self-contradictory
     · answers the checker passed but the student marked down

   Those are the improvement dataset. Everything above them is
   context for reading them.

   ACCESS
     Set 'admin_token' in keys.php to a long random string, then
     open:  /admin.php?t=YOUR_TOKEN
     With no token set, this page refuses to render at all — a
     dashboard that defaults to public is worse than no dashboard.

   It reads the JSONL files api.php writes and computes in PHP.
   No database, nothing to install, and it never sees a key.
   ============================================================ */
declare(strict_types=1);

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

$cfgFile = __DIR__ . '/keys.php';
$CFG = is_file($cfgFile) ? (require $cfgFile) : [];
if (!is_array($CFG)) $CFG = [];

$want = trim((string)($CFG['admin_token'] ?? ''));
$got  = (string)($_GET['t'] ?? '');

/* hash_equals so the comparison cannot be timed, and a minimum length so a
   two-character token is not accepted as "configured". */
if ($want === '' || strlen($want) < 16) {
    http_response_code(503);
    exit('<!doctype html><meta charset=utf-8><title>Dashboard off</title>'
       . '<body style="font:15px system-ui;padding:40px;max-width:640px">'
       . '<h1>Dashboard is off</h1><p>Set <code>admin_token</code> in <code>keys.php</code> '
       . 'to a random string of at least 16 characters, then open this page with '
       . '<code>?t=THAT_STRING</code>.</p>'
       . '<p>It stays off until you do. A quality dashboard that is public by default '
       . 'would leak what students are asking.</p>');
}
if (!hash_equals($want, $got)) {
    http_response_code(403);
    exit('<!doctype html><meta charset=utf-8><title>Not allowed</title>'
       . '<body style="font:15px system-ui;padding:40px"><h1>Not allowed</h1>');
}

/* ---------- read ---------- */
function log_path(array $CFG, string $f): string {
    $dir = trim((string)($CFG['log_dir'] ?? ''));
    if ($dir === '') $dir = rtrim((string)($CFG['contact_dir'] ?? __DIR__ . '/data'), '/\\');
    return $dir . '/' . $f;
}
/* Reads a JSONL file newest-last, capped so a huge log cannot exhaust memory
   on shared hosting. Reads the tail rather than the head — recent is what
   matters on a dashboard. */
function read_jsonl(string $path, int $max = 20000): array {
    $rows = [];
    foreach ([$path, $path . '.1'] as $p) {
        if (!is_file($p)) continue;
        $h = @fopen($p, 'r');
        if (!$h) continue;
        while (($line = fgets($h)) !== false) {
            $d = json_decode(trim($line), true);
            if (is_array($d)) $rows[] = $d;
            if (count($rows) > $max * 2) array_splice($rows, 0, $max);   // keep the tail
        }
        fclose($h);
    }
    if (count($rows) > $max) $rows = array_slice($rows, -$max);
    return $rows;
}

$days = max(1, min(90, (int)($_GET['days'] ?? 7)));
$since = time() - $days * 86400;
$recent = function (array $r) use ($since): bool {
    $t = strtotime((string)($r['t'] ?? '')) ?: 0;
    return $t >= $since;
};

$ops     = array_values(array_filter(read_jsonl(log_path($CFG, 'ops.jsonl')), $recent));
$quality = array_values(array_filter(read_jsonl(log_path($CFG, 'quality.jsonl')), $recent));

/* ---------- aggregate ---------- */
$total   = count($ops);
$hits    = 0; $ok = 0; $fail = 0; $premium = 0; $signed = 0;
$lat = []; $byModel = []; $byErr = []; $byDay = [];
foreach ($ops as $r) {
    if (($r['cache'] ?? '') === 'hit') { $hits++; }
    $good = ($r['cache'] ?? '') === 'hit' || !empty($r['ok']);
    if ($good) $ok++; else $fail++;
    if (!empty($r['premium'])) $premium++;
    if (!empty($r['signed']))  $signed++;
    if (isset($r['ms'])) $lat[] = (int)$r['ms'];
    $m = (string)($r['model'] ?? '?');
    $byModel[$m] = ($byModel[$m] ?? 0) + 1;
    if (!$good) {
        $e = trim((string)($r['err'] ?? '')) ?: ('HTTP ' . (int)($r['code'] ?? 0));
        $byErr[$e] = ($byErr[$e] ?? 0) + 1;
    }
    $d = substr((string)($r['t'] ?? ''), 0, 10);
    if ($d !== '') $byDay[$d] = ($byDay[$d] ?? 0) + 1;
}
sort($lat);
$pct = function (array $a, float $p) {
    if (!$a) return 0;
    $i = (int)floor(($p / 100) * (count($a) - 1));
    return (int)$a[max(0, min(count($a) - 1, $i))];
};
arsort($byModel); arsort($byErr); ksort($byDay);

$up = $down = $reports = 0;
$disputedAndUp = []; $passedAndDown = []; $reported = []; $verifyMix = [];
foreach ($quality as $q) {
    $v = (string)($q['vote'] ?? '');
    if ($v === 'up') $up++; elseif ($v === 'down') $down++; elseif ($v === 'report') { $reports++; $reported[] = $q; }
    $ver = (string)($q['verify'] ?? '');
    if ($ver !== '') $verifyMix[$ver] = ($verifyMix[$ver] ?? 0) + 1;
    /* the two disagreements worth a human's time */
    if ($ver === 'disputed' && $v === 'up')                 $disputedAndUp[] = $q;
    if (in_array($ver, ['checked', 'worked'], true) && $v === 'down') $passedAndDown[] = $q;
}
arsort($verifyMix);
$reported = array_slice(array_reverse($reported), 0, 40);
$votes = $up + $down;

function h($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function pctOf(int $n, int $d): string { return $d ? number_format($n / $d * 100, 1) . '%' : '—'; }
$tok = rawurlencode($got);
?>
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>7Solve — quality</title>
<style>
  :root{--bg:#f4f6fd;--surface:#fff;--line:#e6e9f7;--ink:#0d1533;--ink2:#3c456e;--ink3:#656d90;
        --ok:#0b6b45;--okb:#e6f8f0;--warn:#8a6413;--warnb:#fdf4e3;--err:#a52347;--errb:#fdedf2;--brand:#4459f5}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink2);
       font:14px/1.6 'Outfit',system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}
  .wrap{max-width:1120px;margin:0 auto}
  h1{font-size:24px;color:var(--ink);margin:0 0 2px;letter-spacing:-.02em}
  .sub{color:var(--ink3);font-size:13px;margin:0 0 18px}
  .range{display:flex;gap:6px;margin-bottom:18px;flex-wrap:wrap}
  .range a{padding:5px 12px;border-radius:999px;background:var(--surface);border:1px solid var(--line);
           color:var(--ink3);text-decoration:none;font-size:12.5px}
  .range a.on{background:var(--brand);border-color:var(--brand);color:#fff}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
  .tile{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
  .tile b{display:block;font-size:26px;font-weight:800;color:var(--ink);letter-spacing:-.02em;line-height:1.15}
  .tile span{font-size:11.5px;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em}
  .tile.bad b{color:var(--err)} .tile.good b{color:var(--ok)}
  .panel{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:16px}
  .panel h2{font-size:15px;color:var(--ink);margin:0 0 3px}
  .panel p.n{margin:0 0 12px;font-size:12.4px;color:var(--ink3)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;
     color:var(--ink3);font-weight:600;padding:0 8px 6px 0;border-bottom:1px solid var(--line)}
  td{padding:6px 8px 6px 0;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:0}
  .num{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;white-space:nowrap}
  .bar{height:7px;border-radius:4px;background:#eef1fb;overflow:hidden;min-width:80px}
  .bar i{display:block;height:100%;background:var(--brand)}
  .pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:11.5px;border:1px solid var(--line)}
  .pill.ok{background:var(--okb);border-color:#bfe8d6;color:var(--ok)}
  .pill.no{background:var(--errb);border-color:#f6c9d8;color:var(--err)}
  .pill.warn{background:var(--warnb);border-color:#f0dcb0;color:var(--warn)}
  .q{color:var(--ink);font-size:13px;margin-bottom:3px}
  .a{color:var(--ink3);font-size:12.2px;white-space:pre-wrap;max-height:120px;overflow:auto;
     background:#fafbff;border:1px solid var(--line);border-radius:8px;padding:8px;margin-top:5px}
  .empty{color:var(--ink3);font-size:13px;padding:8px 0}
  .hero{border-left:3px solid var(--err)}
  code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;background:#f3f5fe;
       border-radius:5px;padding:1px 5px}
</style>
<div class="wrap">
  <h1>7Solve — quality</h1>
  <p class="sub">Last <?= $days ?> day<?= $days === 1 ? '' : 's' ?> · <?= number_format($total) ?> AI requests ·
     <?= number_format(count($quality)) ?> student ratings. Metadata only — no question text is recorded
     except on an explicit report.</p>

  <div class="range">
    <?php foreach ([1, 7, 30, 90] as $d): ?>
      <a class="<?= $d === $days ? 'on' : '' ?>" href="?t=<?= $tok ?>&days=<?= $d ?>"><?= $d ?>d</a>
    <?php endforeach; ?>
  </div>

  <div class="tiles">
    <div class="tile"><b><?= number_format($total) ?></b><span>requests</span></div>
    <div class="tile <?= $fail ? 'bad' : 'good' ?>"><b><?= pctOf($ok, $total) ?></b><span>answered</span></div>
    <div class="tile"><b><?= pctOf($hits, $total) ?></b><span>from cache</span></div>
    <div class="tile"><b><?= $pct($lat, 50) ?>ms</b><span>median latency</span></div>
    <div class="tile"><b><?= $pct($lat, 95) ?>ms</b><span>p95 latency</span></div>
    <div class="tile"><b><?= pctOf($signed, $total) ?></b><span>signed in</span></div>
    <div class="tile"><b><?= pctOf($premium, $total) ?></b><span>premium model</span></div>
    <div class="tile <?= $down > $up ? 'bad' : '' ?>"><b><?= $votes ? pctOf($up, $votes) : '—' ?></b><span>rated good</span></div>
  </div>

  <?php
  /* ---- the three lists that are the actual point of the page ---- */
  $sections = [
    ['Reported as wrong', $reported,
     'A student pressed “report”. These are the only records that carry the question and the answer, because they chose to send them.'],
    ['Checker said no, student said yes', $disputedAndUp,
     'Our own arithmetic check found a contradiction and the student still rated the answer good. Either the checker has a false positive worth fixing, or the student did not notice. Both are worth knowing.'],
    ['Checker said yes, student said no', $passedAndDown,
     'The arithmetic checked out and the student still marked it down — so the problem is the method, the level, or the explanation, none of which a calculator can catch.'],
  ];
  foreach ($sections as [$title, $rows, $note]): ?>
    <div class="panel hero">
      <h2><?= h($title) ?> <span class="pill <?= count($rows) ? 'no' : 'ok' ?>"><?= count($rows) ?></span></h2>
      <p class="n"><?= h($note) ?></p>
      <?php if (!$rows): ?>
        <div class="empty">Nothing here for this period.</div>
      <?php else: foreach (array_slice($rows, 0, 25) as $r): ?>
        <div style="padding:9px 0;border-bottom:1px solid var(--line)">
          <div class="q"><?= h(($r['q'] ?? '') !== '' ? $r['q'] : '(no question recorded — this was a rating, not a report)') ?></div>
          <div style="font-size:11.6px;color:var(--ink3)">
            <?= h(substr((string)($r['t'] ?? ''), 0, 16)) ?> ·
            <?= h($r['course'] ?? '?') ?> · <?= h($r['subject'] ?? '?') ?> ·
            <code><?= h($r['model'] ?? '?') ?></code> ·
            checker: <span class="pill <?= ($r['verify'] ?? '') === 'disputed' ? 'no' : 'ok' ?>"><?= h($r['verify'] ?: 'n/a') ?></span>
            <?php if (!empty($r['failed'])): ?> · <?= (int)$r['failed'] ?> failed check<?= $r['failed'] === 1 ? '' : 's' ?><?php endif; ?>
            <?php if (!empty($r['rid'])): ?> · <code><?= h($r['rid']) ?></code><?php endif; ?>
          </div>
          <?php if (!empty($r['note'])): ?><div class="a"><?= h($r['note']) ?></div><?php endif; ?>
          <?php if (!empty($r['answer'])): ?><div class="a"><?= h($r['answer']) ?></div><?php endif; ?>
        </div>
      <?php endforeach; endif; ?>
    </div>
  <?php endforeach; ?>

  <div class="panel">
    <h2>What the checker concluded</h2>
    <p class="n">The browser's deterministic checks, as reported alongside ratings. “disputed” means an answer disagreed with its own working.</p>
    <?php if (!$verifyMix): ?><div class="empty">No ratings yet.</div><?php else: ?>
      <table><tr><th>State</th><th>Count</th><th style="width:45%"></th></tr>
      <?php $vm = max($verifyMix); foreach ($verifyMix as $k => $n): ?>
        <tr><td><span class="pill <?= $k === 'disputed' ? 'no' : ($k === 'checked' ? 'ok' : '') ?>"><?= h($k) ?></span></td>
            <td class="num"><?= $n ?></td>
            <td><div class="bar"><i style="width:<?= (int)round($n / $vm * 100) ?>%"></i></div></td></tr>
      <?php endforeach; ?></table>
    <?php endif; ?>
  </div>

  <div class="panel">
    <h2>Failures</h2>
    <p class="n">Requests that returned no usable answer. A provider quota running out shows up here first.</p>
    <?php if (!$byErr): ?><div class="empty">No failures in this period.</div><?php else: ?>
      <table><tr><th>Error</th><th>Count</th></tr>
      <?php foreach (array_slice($byErr, 0, 15, true) as $e => $n): ?>
        <tr><td><?= h($e) ?></td><td class="num"><?= $n ?></td></tr>
      <?php endforeach; ?></table>
    <?php endif; ?>
  </div>

  <div class="panel">
    <h2>Models</h2>
    <p class="n">Which engine actually answered. A sudden shift usually means a provider started refusing.</p>
    <?php if (!$byModel): ?><div class="empty">No requests yet.</div><?php else: ?>
      <table><tr><th>Model</th><th>Requests</th><th style="width:40%"></th></tr>
      <?php $mm = max($byModel); foreach (array_slice($byModel, 0, 12, true) as $m => $n): ?>
        <tr><td><code><?= h($m) ?></code></td><td class="num"><?= $n ?></td>
            <td><div class="bar"><i style="width:<?= (int)round($n / $mm * 100) ?>%"></i></div></td></tr>
      <?php endforeach; ?></table>
    <?php endif; ?>
  </div>

  <div class="panel">
    <h2>By day</h2>
    <?php if (!$byDay): ?><div class="empty">No requests yet.</div><?php else: ?>
      <table><tr><th>Day</th><th>Requests</th><th style="width:55%"></th></tr>
      <?php $dm = max($byDay); foreach ($byDay as $d => $n): ?>
        <tr><td class="num"><?= h($d) ?></td><td class="num"><?= $n ?></td>
            <td><div class="bar"><i style="width:<?= (int)round($n / $dm * 100) ?>%"></i></div></td></tr>
      <?php endforeach; ?></table>
    <?php endif; ?>
  </div>

  <p class="sub">Logs live beside the app as <code>ops.jsonl</code> and <code>quality.jsonl</code>,
     roll at 8&nbsp;MB, and keep one generation. Nothing here is sent anywhere.</p>
</div>
