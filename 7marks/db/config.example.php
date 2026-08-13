<?php
/**
 * 7MARKS — database configuration TEMPLATE.
 *
 * Copy to db/config.php on the server and fill in the real values there.
 * config.php is gitignored and must never be committed; this file carries
 * placeholders only and is safe in the repository.
 *
 * ⚠ These credentials must NOT be the account hub's.
 *    The whole point of the architecture is that 7Marks cannot read or
 *    write hub tables, and 7Solve cannot read or write these. Sharing a
 *    database user would quietly hand back the access the design removes.
 *    Grant this user rights on the 7Marks database ONLY.
 */

return array(

    /* ---- the 7Marks database ---- */
    'host'    => 'localhost',
    'name'    => 'REPLACE_ME_7marks_db',
    'user'    => 'REPLACE_ME_7marks_user',
    'pass'    => 'REPLACE_ME',
    'charset' => 'utf8mb4',

    /* PDO options worth being explicit about:
       ERRMODE_EXCEPTION      so a failed write raises rather than returning
                              false and being ignored — a silently dropped
                              result is the worst failure this app can have
       EMULATE_PREPARES false so placeholders are bound by the server and
                              integers stay integers
       STRINGIFY_FETCHES      off, so pct and counts come back as numbers */
    'options' => array(
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_STRINGIFY_FETCHES  => false,
    ),

    /* ---- how 7Marks resolves a caller to a hub_user_id ----
       The browser already holds the hub session cookie. 7Marks calls the
       hub's `me` action with it and gets back the user id; nothing else
       crosses. There is no second password, no second session and no copy
       of any credential here. */
    'hub_base'    => 'https://account.7by.in',
    'hub_timeout' => 6,

    /* Cache a resolved id briefly so one page view is not a dozen hub
       round trips. Short enough that a sign-out is felt almost at once. */
    'identity_cache_seconds' => 60,

    /* ---- leaderboard recompute ----
       Materialised on a schedule, never per request. Ranks that move on
       every refresh read as noise rather than progress. */
    'leaderboard_interval_minutes' => 10,
    'leaderboard_min_attempts'     => 3,
    'leaderboard_min_questions'    => 25,

    /* The agreed weighting. Kept in config so it can be tuned without a
       deploy, and so the numbers live in exactly one place. */
    'leaderboard_weights' => array(
        'accuracy'    => 0.45,
        'difficulty'  => 0.25,
        'volume'      => 0.15,
        'improvement' => 0.15,
    ),
    'difficulty_multiplier' => array(
        'Easy'   => 0.80,
        'Medium' => 1.00,
        'Hard'   => 1.25,
        'Mixed'  => 1.00,
    ),
);
