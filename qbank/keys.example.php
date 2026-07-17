<?php
/* ============================================================
   7Q — SERVER-SIDE API KEYS  (never sent to the browser)
   ------------------------------------------------------------
   1. Copy this file to  keys.php   (same folder)
   2. Paste your keys below
   3. In config.js set:   proxy: "api.php"
      and leave the keys in config.js EMPTY — they aren't used any more.

   Why this file is safe:
   - PHP is executed on the server, never shown as text
   - .htaccess also blocks direct access to keys*.php
   - Visitors only ever see api.php's response, never a key

   Re-uploading the site zip will NOT overwrite keys.php
   (the zip only ships keys.example.php).
   ============================================================ */

return [

    /* ---- your keys. One key, "key1,key2", or ['key1','key2'] ----
       Multiple keys = more free quota: when one hits its daily
       limit the proxy automatically rotates to the next. */
    'keys' => [
        'gemini'     => '',   // AIza...            https://aistudio.google.com/apikey
        'groq'       => '',   // gsk_...            https://console.groq.com/keys
        'cerebras'   => '',   // csk-...            https://cloud.cerebras.ai
        'openrouter' => '',   // sk-or-...          https://openrouter.ai/keys
        'mistral'    => '',   //                    https://console.mistral.ai/api-keys
        'github'     => '',   // github_pat_...     https://github.com/settings/tokens  (Models: Read-only)
    ],

    /* ---- only these sites may use the proxy (stops others stealing your quota) ---- */
    'allow_origins' => ['qbank.7by.in', 'doubtsnap.7by.in', '7by.in', 'www.7by.in', 'localhost:3050'],

    /* Some in-app browsers (Instagram/Facebook) strip the Origin header.
       true  = still allow those users (slightly weaker protection)
       false = block them */
    'allow_missing_origin' => true,

    /* ---- abuse guard: max AI requests per hour, per visitor IP.
       Raise it once you add logins/paid plans. 0 = unlimited. ---- */
    'rate_per_hour' => 60,

    /* ---- ANSWER CACHE — your biggest quota saver ----
       Hundreds of students ask the same topics ("plant cell", "quadratic
       equations"). The first one costs an AI call; everyone after that is
       served instantly from disk for FREE. Typically cuts API usage by
       60-80% once you have real traffic.
         168 = keep answers 7 days   |   0 = disable caching
       Photo questions are never cached (every photo is unique). */
    'cache_hours' => 168,
    // 'cache_dir' => '/home/USER/7by-cache',   // set if your host wipes /tmp often

    /* ============================================================
       PAYWALL — free tier, credits, ₹99/month
       ============================================================
       Which app this folder is:  '7q'  or  '7solve'
       (they bill SEPARATELY — a 7Q pass does not work on 7Solve) */
    'app' => '7q',

    /* Free credits per DEVICE per DAY (resets at midnight).
       Students get this much without paying anything. */
    'free_per_day' => ['7q' => 5, '7solve' => 5],

    /* Plans. amount is in PAISE (9900 = ₹99). Even paid plans use
       credits, so one heavy user can never drain your API quota. */
    'plans' => [
        'monthly'  => ['label' => 'Monthly ₹99',  'amount' => 9900, 'credits' => 500, 'days' => 30],
        'pack_50'  => ['label' => '50 credits',   'amount' => 2000, 'credits' => 50,  'days' => 365],
        'pack_150' => ['label' => '150 credits',  'amount' => 4900, 'credits' => 150, 'days' => 365],
    ],

    /* Your 7Pay checkout page. The Subscribe button sends buyers here with
       ?app=..&plan=..&amount=..  After payment, 7Pay must:
         1) POST to  api.php?action=activate  with
            {"secret":"<billing_secret>","order_id":"..","app":"7q","plan":"monthly"}
         2) redirect the buyer back to the site with  ?paid=<order_id> */
    'pay_url' => '',   // e.g. 'https://pay.7by.in/checkout.php'

    /* Shared secret your 7Pay webhook sends to prove a payment is real.
       MUST be long and random. Never put it in config.js. */
    'billing_secret' => '',

    /* true = switch the paywall off completely (everything free) */
    'billing_off' => false,

    // 'billing_dir' => '/home/USER/7by-billing',   // passes + credit balances live here

    /* ---- advanced (safe to leave alone) ---- */
    'max_body_mb' => 12,   // photo uploads need room
    'timeout'     => 120,  // seconds to wait for the AI
    // 'rate_dir' => '/home/USER/7by-ratelimit',  // set if your host's temp dir is wiped often
];
