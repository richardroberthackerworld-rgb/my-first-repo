<?php
/* ============================================================
   7Solve — PROVIDER LAYER
   ------------------------------------------------------------
   The endpoint table, the model allowlist, and one function
   that calls a provider and returns text.

   This file exists because /v1/solve needed exactly what
   api.php already did, and the alternative was a second copy of
   the routing rules. The verifier taught that lesson once
   already: two copies of a rule drift, and here the drift would
   be an allowlist — the thing standing between a model name and
   an outbound HTTP request. That is not a rule to keep two of.

   api.php still owns billing, credits, caching, rate limiting
   and the browser proxy. This is only the part /v1/solve shares.
   ============================================================ */
declare(strict_types=1);

const PROVIDER_ENDPOINTS = [
    'gemini'     => 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    'groq'       => 'https://api.groq.com/openai/v1/chat/completions',
    'cerebras'   => 'https://api.cerebras.ai/v1/chat/completions',
    'openrouter' => 'https://openrouter.ai/api/v1/chat/completions',
    'mistral'    => 'https://api.mistral.ai/v1/chat/completions',
];

/* Model names must match these. It stops a caller turning a model field into a
   URL, a path traversal, or a request to a paid tier you did not intend to buy.
   Groq and OpenRouter legitimately use a vendor/ prefix; exactly one optional
   path segment is allowed, and never a scheme, host, query or fragment. */
const PROVIDER_MODEL_OK = [
    'gemini'     => '/^gemini-[a-z0-9.\-]+$/i',
    'groq'       => '/^[a-z0-9.\-]+(\/[a-z0-9.\-]+)?$/i',
    'cerebras'   => '/^[a-z0-9.\-]+$/i',
    'openrouter' => '/^[a-z0-9.\-]+\/[a-z0-9.\-]+(:free)?$/i',
    'mistral'    => '/^[a-z0-9.\-]+$/i',
];

/* The order /v1/solve walks. Ordered by what ANSWERS, which the ops log
   settled: Groq's gpt-oss-120b is the strongest prover available here and
   Cerebras is the proven workhorse, while Gemini has been returning 429 on
   this quota. Each entry is tried until one returns usable text. */
const SOLVE_CHAIN = [
    ['groq',       'openai/gpt-oss-120b'],
    ['cerebras',   'gemma-4-31b'],
    ['gemini',     'gemini-3-flash-preview'],
    ['mistral',    'mistral-large-latest'],
    ['openrouter', 'deepseek/deepseek-r1'],
];

function provider_keys(array $CFG, string $provider): array
{
    $raw  = $CFG['keys'][$provider] ?? '';
    $list = is_array($raw) ? $raw : preg_split('/[,\n]/', (string)$raw);
    return array_values(array_filter(array_map('trim', $list), static fn($k) => $k !== ''));
}

/* One attempt at one provider with one key.
   Returns ['ok'=>bool, 'text'=>string, 'code'=>int, 'err'=>string]. Never
   throws and never returns a partial: a caller that gets ok=false can move to
   the next link without inspecting anything else. */
function provider_call(string $provider, string $model, string $system, string $user,
                       string $key, int $timeout = 40): array
{
    $fail = static fn(int $c, string $e) => ['ok' => false, 'text' => '', 'code' => $c, 'err' => $e];

    if (!isset(PROVIDER_ENDPOINTS[$provider]))                  return $fail(400, 'Unknown provider');
    if (!preg_match(PROVIDER_MODEL_OK[$provider], $model))      return $fail(400, 'Model not allowed');

    $url     = str_replace('{model}', rawurlencode($model), PROVIDER_ENDPOINTS[$provider]);
    $headers = ['Content-Type: application/json'];

    if ($provider === 'gemini') {
        $headers[] = 'x-goog-api-key: ' . $key;
        $body = json_encode([
            'systemInstruction' => ['parts' => [['text' => $system]]],
            'contents' => [['role' => 'user', 'parts' => [['text' => $user]]]],
            'generationConfig' => ['temperature' => 0.4, 'maxOutputTokens' => 8192],
        ]);
    } else {
        $headers[] = 'Authorization: Bearer ' . $key;
        if ($provider === 'openrouter') $headers[] = 'X-Title: 7Solve';
        $payload = [
            'model' => $model,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user',   'content' => $user],
            ],
            'temperature' => 0.4,
            /* Groq's free tier meters PROMPT + COMPLETION against 8000 tokens
               per minute, so asking for 8192 is rejected with a 413 before the
               model runs at all — the request is over the limit by existing.
               4096 is far more than a student answer needs and leaves room for
               a long question on top. Measured against the live account, not
               inferred from the docs. */
            'max_tokens'  => $provider === 'groq' ? 4096 : 8192,
        ];
        /* gpt-oss streams its thinking into a separate `reasoning` field and
           leaves `content` empty until that finishes. Left at the default
           effort it spends the whole budget thinking and returns a 200 with no
           answer in it. Measured, not guessed. */
        if (strpos($model, 'gpt-oss') !== false) $payload['reasoning_effort'] = 'low';
        $body = json_encode($payload);
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);
    $raw  = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);

    if ($raw === false)  return $fail(0, $cerr !== '' ? $cerr : 'Network error');
    $j = json_decode((string)$raw, true);
    if (!is_array($j))   return $fail($code, 'Provider returned a non-JSON body');

    if ($code < 200 || $code >= 300) {
        $msg = $j['error']['message'] ?? (is_string($j['error'] ?? null) ? $j['error'] : 'HTTP ' . $code);
        return $fail($code, (string)$msg);
    }

    if ($provider === 'gemini') {
        $parts = $j['candidates'][0]['content']['parts'] ?? [];
        $text  = '';
        foreach ($parts as $p) $text .= (string)($p['text'] ?? '');
    } else {
        /* Deliberately NOT falling back to `reasoning` when content is empty.
           That field is the model's private working, and rule 6 is that the
           student never sees it. An empty answer is a failure to be retried,
           not raw thinking to be dressed up as one. */
        $text = (string)($j['choices'][0]['message']['content'] ?? '');
    }

    $text = trim($text);
    if ($text === '') return $fail($code, 'Provider returned no text');
    return ['ok' => true, 'text' => $text, 'code' => $code, 'err' => ''];
}
