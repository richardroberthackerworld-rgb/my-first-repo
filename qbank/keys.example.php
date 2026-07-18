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
    'allow_origins' => ['7q.7by.in', '7solve.7by.in', 'qbank.7by.in', 'doubtsnap.7by.in', '7by.in', 'www.7by.in', 'localhost:3050'],

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

    /* Each AI action (solve, paper, hint, each follow-up button) costs this
       many credits. 10 = the default. */
    'credits_per_call' => 10,

    /* Free CREDITS per DEVICE per DAY (resets at midnight). 50 credits at
       10/call = 5 free actions a day. Free credits work on the BASIC (cheap,
       high-limit) AI only — hard questions that need the big models require a
       paid plan (Premium). */
    'free_per_day' => ['7q' => 50, '7solve' => 50],

    /* Plans. amount is in PAISE (9900 = ₹99). Even paid plans use credits, so
       one heavy user can never drain your API quota. Paid credits unlock the
       big "Premium" models too. */
    'plans' => [
        // credits shown = credits given. At 10/action: 3000 = 300 questions, etc.
        'monthly'  => ['label' => 'Monthly',    'amount' => 9900, 'credits' => 3000, 'days' => 30],
        'pack_big' => ['label' => 'Value pack', 'amount' => 4900, 'credits' => 1500, 'days' => 365],
        'pack_sm'  => ['label' => 'Starter',    'amount' => 2000, 'credits' => 500,  'days' => 365],
    ],

    /* ---- ACCOUNTS (account.7by.in) — sign in / sign up ----
       With this set, students sign in and their credits live on their
       ACCOUNT: pay on a phone, keep the credits on a laptop. Leave it
       empty to switch accounts off (credits then stick to one browser).
       The hub must list this site in its 'allowed_origins' (config.php). */
    'hub_base' => '',   // e.g. 'https://account.7by.in'
    'hub_google_client_id' => '',   // optional: Google sign-in button

    /* ---- 7Pay gateway (your own, at pay.7by.in) ----
       The order is created here on the SERVER using key_secret, so the
       secret never reaches the browser. Get these from 7Pay's dashboard. */
    'pay_base'           => '',   // e.g. 'https://pay.7by.in'   (no trailing slash)
    'pay_key_id'         => '',   // 7Pay key_id
    'pay_key_secret'     => '',   // 7Pay key_secret  — server only, never in config.js
    'pay_webhook_secret' => '',   // 7Pay merchant webhook_secret (verifies payment.captured)
    'app_label'          => '7Q', // shown on the checkout page

    /* In 7Pay's dashboard set this merchant's Webhook URL to:
         https://7q.7by.in/api.php?action=webhook
       (7Solve → https://7solve.7by.in/api.php?action=webhook)
       That is what actually grants the credits. Nothing else is needed —
       7Pay redirects the buyer back with ?sevenpay_order_id=… and the page
       picks the pass up automatically. */

    /* Optional manual hook (only if you are NOT using the webhook above):
       POST api.php?action=activate {"secret":..,"order_id":..,"app":..,"plan":..} */
    'billing_secret' => '',

    /* true = switch the paywall off completely (everything free) */
    'billing_off' => false,

    // 'billing_dir' => '/home/USER/7by-billing',   // passes + credit balances live here

    /* ---- advanced (safe to leave alone) ---- */
    'max_body_mb' => 12,   // photo uploads need room
    'timeout'     => 120,  // seconds to wait for the AI
    // 'rate_dir' => '/home/USER/7by-ratelimit',  // set if your host's temp dir is wiped often
];
