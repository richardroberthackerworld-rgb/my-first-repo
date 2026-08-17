<?php
/* ============================================================
   7Hand — transcription proxy.

   The browser sends an image. The server holds the API key,
   owns the prompt, and returns text.

   WHY THIS EXISTS. A key in page source is fine for a private
   tool and fatal for a public button: anyone who opens devtools
   has it, and a free-tier quota is drained within days. This is
   the only server-side piece the product needs, and the design
   doc marks it mandatory before OCR ships.

   THE SERVER OWNS THE PROMPT. The client cannot supply one.
   Otherwise this endpoint is a free general-purpose vision model
   for anyone who finds the URL, and your quota pays for it.
   ============================================================ */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: no-store');

const MAX_IMAGE_BYTES   = 6 * 1024 * 1024;   // after base64 decode
const RATE_LIMIT_COUNT  = 12;                // requests
const RATE_LIMIT_WINDOW = 600;               // seconds
const UPSTREAM_TIMEOUT  = 45;                // seconds

function fail(string $message, int $status = 400): never {
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_SLASHES);
    exit;
}

function ok(array $payload): never {
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------- config ---------- */

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fail('Transcription is not configured on this server.', 503);
}
/** @var array $CFG */
$CFG = require $configPath;

$keys = $CFG['keys'] ?? [];
$allowedOrigins = $CFG['allowed_origins'] ?? [];

/* Same-origin by default. An open endpoint is somebody else's free OCR. */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    if (!in_array($origin, $allowedOrigins, true)) {
        fail('Origin not allowed.', 403);
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail('POST an image to this endpoint.', 405);
}

/* ---------- rate limit ---------- */

/**
 * File-backed sliding window, one entry per caller.
 * Deliberately not a database: this has to run on shared cPanel hosting with
 * nothing installed. Flock keeps two simultaneous requests from clobbering
 * each other, which on a free tier is the difference between a working quota
 * and an exhausted one.
 */
function rate_limit(string $key, string $dir): void {
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    $file = $dir . '/rl_' . hash('sha256', $key) . '.json';

    $fh = @fopen($file, 'c+');
    if ($fh === false) return;           // cannot rate limit, do not block the user
    if (!flock($fh, LOCK_EX)) { fclose($fh); return; }

    $raw  = stream_get_contents($fh);
    $hits = json_decode($raw ?: '[]', true);
    if (!is_array($hits)) $hits = [];

    $now = time();
    $hits = array_values(array_filter($hits, fn($t) => is_int($t) && $t > $now - RATE_LIMIT_WINDOW));

    if (count($hits) >= RATE_LIMIT_COUNT) {
        $wait = RATE_LIMIT_WINDOW - ($now - $hits[0]);
        flock($fh, LOCK_UN);
        fclose($fh);
        header('Retry-After: ' . max(1, $wait));
        fail('Rate limit reached. Try again in about ' . max(1, (int)ceil($wait / 60)) . ' minute(s).', 429);
    }

    $hits[] = $now;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($hits));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
}

$ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$ip = trim(explode(',', (string)$ip)[0]);
rate_limit($ip, $CFG['state_dir'] ?? (__DIR__ . '/.state'));

/* ---------- input ---------- */

$body = file_get_contents('php://input');
if ($body === false || $body === '') fail('Empty request.');
if (strlen($body) > MAX_IMAGE_BYTES * 2) fail('That image is too large. Photograph one page at a time.', 413);

$in = json_decode($body, true);
if (!is_array($in)) fail('Expected a JSON body.');

$dataUrl = (string)($in['image'] ?? '');
if (!preg_match('#^data:(image/(?:jpeg|png|webp));base64,#', $dataUrl, $m)) {
    fail('Send the page as a base64 image data URL (jpeg, png or webp).');
}
$mime = $m[1];
$b64  = substr($dataUrl, strlen($m[0]));
$binary = base64_decode($b64, true);
if ($binary === false) fail('The image could not be decoded.');
if (strlen($binary) > MAX_IMAGE_BYTES) fail('That image is too large. Photograph one page at a time.', 413);

/* Confirm it really is an image, rather than trusting the declared type. */
$info = @getimagesizefromstring($binary);
if ($info === false) fail('That file is not an image.');

/* The prompt is ours. A client-supplied prompt turns this into a free
   general-purpose vision model for whoever finds the URL. */
$prompt = <<<TXT
Transcribe the handwriting in this image exactly as written.

Rules, all of them important:
- Output ONE line of text for each line of writing, in order.
- Do not merge lines, do not reflow, do not re-wrap.
- Copy spelling and punctuation exactly, including mistakes.
- If a word is illegible, write ??? in its place.
- Output the transcription and nothing else: no preamble, no explanation,
  no markdown fences, no line numbers.
TXT;

/* ---------- providers ---------- */

function http_json(string $url, array $headers, string $payload): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => array_merge(['Content-Type: application/json'], $headers),
        CURLOPT_TIMEOUT        => UPSTREAM_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($res === false) return ['ok' => false, 'error' => $err ?: 'connection failed'];
    $json = json_decode($res, true);
    if (!is_array($json)) return ['ok' => false, 'error' => 'provider returned a non-JSON response'];
    if ($code < 200 || $code >= 300) {
        $msg = $json['error']['message'] ?? ('HTTP ' . $code);
        return ['ok' => false, 'error' => $msg];
    }
    return ['ok' => true, 'json' => $json];
}

function try_gemini(string $key, string $mime, string $b64, string $prompt): array {
    $model = 'gemini-2.0-flash';
    $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key=" . urlencode($key);
    $payload = json_encode([
        'contents' => [[ 'parts' => [
            ['text' => $prompt],
            ['inline_data' => ['mime_type' => $mime, 'data' => $b64]],
        ]]],
        'generationConfig' => ['temperature' => 0, 'maxOutputTokens' => 4096],
    ]);
    $r = http_json($url, [], $payload);
    if (!$r['ok']) return $r;
    $parts = $r['json']['candidates'][0]['content']['parts'] ?? [];
    $text = '';
    foreach ($parts as $p) $text .= $p['text'] ?? '';
    return $text === '' ? ['ok' => false, 'error' => 'empty response'] : ['ok' => true, 'text' => $text];
}

function try_github(string $key, string $mime, string $b64, string $prompt): array {
    $payload = json_encode([
        'model' => 'openai/gpt-4o-mini',
        'temperature' => 0,
        'messages' => [[
            'role' => 'user',
            'content' => [
                ['type' => 'text', 'text' => $prompt],
                ['type' => 'image_url', 'image_url' => ['url' => "data:{$mime};base64,{$b64}"]],
            ],
        ]],
    ]);
    $r = http_json('https://models.github.ai/inference/chat/completions', ['Authorization: Bearer ' . $key], $payload);
    if (!$r['ok']) return $r;
    $text = $r['json']['choices'][0]['message']['content'] ?? '';
    return $text === '' ? ['ok' => false, 'error' => 'empty response'] : ['ok' => true, 'text' => $text];
}

/* ---------- run the chain ---------- */

$attempts = [];
foreach ([['gemini', 'try_gemini'], ['github', 'try_github']] as [$id, $fn]) {
    $key = trim((string)($keys[$id] ?? ''));
    if ($key === '') continue;
    $r = $fn($key, $mime, $b64, $prompt);
    if (!empty($r['ok'])) {
        ok(['text' => $r['text'], 'provider' => $id]);
    }
    /* Record the provider and the reason, never the key. */
    $attempts[] = $id . ': ' . ($r['error'] ?? 'unknown');
}

if (!$attempts) {
    fail('No transcription provider is configured on this server.', 503);
}
fail('Transcription failed. ' . implode('; ', $attempts), 502);
