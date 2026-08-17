<?php
/* ============================================================
   7Hand — transcription proxy configuration.

   Copy this to config.php and fill in ONE key. You do not need
   both; the second is a fallback for when the first is rate
   limited.

     cp config.example.php config.php

   config.php is gitignored. Never commit a real key.

   FREE KEYS, no card needed:
     Gemini         https://aistudio.google.com/apikey
                    ~1500 requests/day. Best at handwriting.
     GitHub Models  https://github.com/settings/tokens
                    ~50/day with any GitHub account.

   DEPLOYMENT NOTE. On cPanel, put this file OUTSIDE the web root
   if you can and require it by path. If it must sit next to
   ocr.php, confirm .htaccess is denying direct access to it —
   a config.php served as plain text hands your key to anyone who
   guesses the URL.
   ============================================================ */

return [
    'keys' => [
        'gemini' => '',   // AIza...
        'github' => '',   // ghp_... or github_pat_...
    ],

    /* Where rate-limit state is written. Must be writable by PHP and must not
       be inside the web root if you can avoid it. */
    'state_dir' => __DIR__ . '/.state',

    /* Browsers only send Origin on cross-origin requests, so same-origin use
       needs nothing here. Add an entry only if the app is served from a
       different host to this endpoint. An empty list means same-origin only,
       which is the safe default. */
    'allowed_origins' => [
        // 'https://your-domain.example',
    ],
];
