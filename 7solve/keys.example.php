<?php
/* ============================================================
   7Solve — SERVER-SIDE API KEYS  (never sent to the browser)
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
    'allow_origins' => ['7solve.7by.in', '7by.in', 'www.7by.in', 'localhost:3061'],

    /* Some in-app browsers (Instagram/Facebook) strip the Origin header.
       true  = still allow those users (slightly weaker protection)
       false = block them */
    'allow_missing_origin' => true,

    /* ---- abuse guard: max AI requests per hour, per visitor IP. 0 = unlimited.

       This applies to ANONYMOUS visitors only. Anyone signed in is limited by
       their CREDITS and nothing else — they keep going until the credits run
       out, which is what they paid for.

       Why signed-in users are not IP-capped: the cap counts by IP, and a
       school, college lab or hostel shares ONE public IP, so a per-IP cap
       caps the whole building rather than a person. Credits are already an
       exact, server-enforced limit per account, so a second limit on top adds
       nothing but a way to wrongly block a paying student.

       'rate_per_hour_signed' is left as a knob if you ever want a ceiling on
       signed-in users too. 0 (the default) means no ceiling. ---- */
    'rate_per_hour' => 60,        // anonymous visitors
    'rate_per_hour_signed' => 0,  // signed in — 0 = unlimited, credits decide

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
       Which app this folder is:  '7marks'  or  '7solve'
       (they bill SEPARATELY — a 7Marks pass does not work on 7Solve) */
    'app' => '7solve',

    /* Each AI action (solve, paper, hint, each follow-up button) costs this
       many credits. 10 = the default. */
    'credits_per_call' => 10,

    /* FALLBACK allowance per DEVICE per day, used only when the account hub is
       unreachable. 30 credits at 10/call = 3 actions — the SAME number as the
       hub's free_daily_credits, so students never see two different figures.
       Free credits work on the BASIC (cheap, high-limit) AI only — hard
       questions that need the big models require a paid plan (Premium). */
    'free_per_day' => ['7marks' => 30, '7solve' => 30],   // matches the hub's 30 free credits/day

    /* Plans. amount is in PAISE (9900 = ₹99). Even paid plans use credits, so
       one heavy user can never drain your API quota.

       These MUST match account-hub/pricing.php AND the pricing page in
       index.html — the HUB is what actually charges, so a mismatch would show
       one price and take another. At 10 credits/answer, 1000 = 100 answers.

       'ai' is the entitlement, enforced server-side in api.php: Spark buys the
       practice tools, not the model. The FREE tier keeps its AI — that is the
       trial. 'daily' is the bonus the hub pays out once per UTC day.
       Leave this key out entirely to use the same defaults from billing.php. */
    'plans' => [
        'spark' => ['label' => 'Spark',       'amount' => 4900,  'credits' => 500,   'days' => 30, 'ai' => false],
        'solve' => ['label' => 'Solve+',      'amount' => 9900,  'credits' => 1000,  'days' => 30, 'ai' => true],
        'ultra' => ['label' => 'Solve Ultra', 'amount' => 99900, 'credits' => 10000, 'days' => 30, 'ai' => true, 'daily' => 20],

        'spark_yearly' => ['label' => 'Spark (yearly)',       'amount' => 49900,  'credits' => 6000,   'days' => 365, 'ai' => false],
        'solve_yearly' => ['label' => 'Solve+ (yearly)',      'amount' => 99900,  'credits' => 12000,  'days' => 365, 'ai' => true],
        'ultra_yearly' => ['label' => 'Solve Ultra (yearly)', 'amount' => 999900, 'credits' => 120000, 'days' => 365, 'ai' => true, 'daily' => 20],
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
    'app_label'          => '7Solve', // shown on the checkout page

    /* In 7Pay's dashboard set this merchant's Webhook URL to:
         https://7solve.7by.in/api.php?action=webhook
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
    'timeout'     => 45,   // seconds to wait for ONE attempt at the AI
    // Hard ceiling for the whole request including key-rotation retries.
    // Each in-flight call holds a PHP worker, and cPanel caps concurrent
    // processes — so this is what stops a slow provider taking the site down.
    'total_budget' => 60,
    // 'rate_dir' => '/home/USER/7by-ratelimit',  // set if your host's temp dir is wiped often

    /* ---------- contact form ----------
       Where messages from /#contact go. Every message is written to
       contact.jsonl first and only then emailed, so a host with mail()
       disabled still keeps them — the form tells the student the truth
       either way. Put contact_dir OUTSIDE the web root if you can. */
    'contact_to'  => '',                              // e.g. 'support@7by.in' — blank = store only
    // 'contact_dir' => '/home/USER/7solve-messages', // defaults to ./data

    /* ---------- study-data sync ----------
       A student's notes, mistakes, practice history and goals live on the
       account so they follow them to any device. Requires hub_base to be set
       (sync is off without it). Put sync_dir OUTSIDE public_html if you can —
       .htaccess blocks /data, but a directory the web server cannot reach at
       all is a stronger guarantee than a rule that can be edited away.

       sync_salt makes stored filenames unguessable even to someone who knows
       a user's hub id. LEAVE IT BLANK and the server generates a long random
       salt on first use and keeps it in .sync_salt inside sync_dir — that is
       the recommended setup, because a forgotten salt is worse than a
       generated one. Set it by hand only if you are moving existing sync data
       between servers, and then NEVER change it: changing it orphans every
       student's synced data. */
    // 'sync_dir'  => '/home/USER/7solve-sync',   // defaults to ./data/sync
    'sync_salt' => '',                            // blank = generate + remember one
    'sync_session_ttl' => 300,                    // seconds a verified token is trusted

    /* ---------- charging once, and only once ----------
       The browser sends an id with every charge so a retried request — a lost
       reply on mobile data, a tapped retry — cannot spend a second lot of
       credits for an answer the student was shown once. This is how long an id
       is remembered. Longer is safer for the student and costs a few bytes;
       shorter risks a slow retry being charged again. */
    'idem_seconds' => 900,                        // 15 minutes

    /* ---------- observability + the quality dashboard ----------
       api.php writes two logs beside the app:

         ops.jsonl      one line per AI request — model, latency, HTTP code,
                        cache hit/miss. NO question text, no answer text, no
                        token, no IP. It answers "is the service healthy and
                        what is it costing", which needs none of those.
         quality.jsonl  student ratings, plus what the browser's own checker
                        concluded. A thumbs-up stores no content; only an
                        explicit "report" stores the question and answer,
                        because the student pressed a button that says so.

       Both roll at 8MB and keep one generation back.

       admin.php reads them. It is OFF until admin_token is set to at least 16
       characters, and refuses to render otherwise — a quality dashboard that
       defaulted to public would leak what students are asking. Generate one
       with:  php -r "echo bin2hex(random_bytes(24));"
       Then open  https://your-site/admin.php?t=THAT_STRING  */
    'log_on'      => true,
    // 'log_dir'  => '/home/USER/7solve-logs',    // defaults to ./data
    'admin_token' => '',                          // blank = dashboard stays off

    /* ---------- live sources for time-sensitive questions ----------
       "Who is the current…", "when is the exam", "the new scheme" — a model's
       training data cannot know these, and answering anyway is the worst thing
       this product can do, because the student cannot tell that answer from a
       correct one. With this on, those questions fetch real pages first and
       the answer cites them; with it off, the model is told to answer from
       training data AND SAY SO. There is no setting that makes it invent a
       citation.

       Wikipedia is used with no key at all (labelled as an encyclopaedia, not
       a primary source). Set brave_key for a real web search and the results
       get considerably better — https://brave.com/search/api/ has a free
       tier. */
    'research_on' => true,
    'brave_key'   => '',                          // optional; blank = Wikipedia only
];
