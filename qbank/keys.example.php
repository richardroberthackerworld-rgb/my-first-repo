<?php
/* ============================================================
   7Marks — SERVER-SIDE API KEYS  (never sent to the browser)
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

    /* ---- advanced (safe to leave alone) ---- */
    'max_body_mb' => 12,   // photo uploads need room
    'timeout'     => 120,  // seconds to wait for the AI
    // 'rate_dir' => '/home/USER/7by-ratelimit',  // set if your host's temp dir is wiped often
];
