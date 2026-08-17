<?php
/**
 * 7MARKS — API v1 front controller.
 *
 * Every request enters here, and the first three things that happen are the
 * same every time: reject cross-origin callers, resolve who is asking, and
 * refuse anything that needs a user when nobody is signed in. An endpoint
 * below never has to remember to check — it cannot run otherwise.
 *
 * This is the Phase B0/B1 surface: proving identity, database reachability
 * and integrity. It reads and reports; it does not yet own attempts or
 * grading. That is B2, and moving it here before this layer is proven is
 * exactly what the phased order exists to prevent.
 */

declare(strict_types=1);
require_once __DIR__ . '/../db/lib.php';

m7_require_same_origin();

$action = (string)($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ------------------------------------------------------------------ health
   Deliberately needs no sign-in: it answers "is the database reachable and
   migrated", which is the question you ask when things are broken, and
   requiring a session to ask it would be useless at exactly that moment.
   It exposes no user data and no configuration. */
if ($action === 'health') {
    $out = array('ok' => false, 'db' => false, 'schema' => 0, 'tables' => 0);
    try {
        $pdo = db();
        $out['db'] = true;
        $out['schema'] = (int)$pdo->query('SELECT MAX(version) FROM schema_version')->fetchColumn();
        $out['tables'] = (int)$pdo->query(
            'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
        )->fetchColumn();
        $out['ok'] = $out['schema'] >= 1 && $out['tables'] >= 18;
    } catch (Throwable $e) {
        error_log('7marks health: ' . $e->getMessage());
    }
    m7_ok($out);
}

/* ------------------------------------------------------------------ whoami
   The B1 proof: that a browser signed in to the hub is recognised here, and
   maps to a stable hub_user_id. Returns null rather than guessing when the
   hub cannot be reached. */
if ($action === 'whoami') {
    $uid = current_user_id();
    if ($uid === null) {
        /* Say WHICH of the two failures happened. "Not signed in" covers
           both "you sent no token" and "the hub rejected the one you sent",
           and those need completely different fixes. */
        $tok = m7_hub_token();
        m7_ok(array(
            'signed_in'      => false,
            'hub_user_id'    => null,
            'token_received' => $tok !== '',
            'reason' => $tok === ''
                ? 'no_token'
                : 'hub_rejected_token',
            'message' => $tok === ''
                ? 'No hub token was sent with this request. Opening this URL ' .
                  'directly in a browser will always show this: the token is ' .
                  'attached by the 7Marks app, not stored as a cookie. Sign in ' .
                  'inside 7Marks and let the app call this, or append ?t=<token>.'
                : 'A token was sent but the hub did not accept it. It may have ' .
                  'expired — sign in again at account.7by.in.'
        ));
    }
    $row = null;
    try {
        $st = db()->prepare('SELECT display_name, privacy_profile, privacy_results,
                                    refreshed_at FROM users_mirror WHERE hub_user_id = ?');
        $st->execute(array($uid));
        $row = $st->fetch();
    } catch (Throwable $e) { error_log('whoami mirror: ' . $e->getMessage()); }

    m7_ok(array(
        'signed_in'   => true,
        'hub_user_id' => $uid,
        /* from the CACHE, and labelled as such — never an authority */
        'display_name'     => $row['display_name'] ?? '',
        'privacy_profile'  => $row['privacy_profile'] ?? 'friends',
        'privacy_results'  => $row['privacy_results'] ?? 'nobody',
        'mirror_cached_at' => $row['refreshed_at'] ?? null,
        'note' => 'Identity and credits come from the hub. This database holds ' .
                  'academic data only.'
    ));
}

/* ----------------------------------------------------------------- summary
   A signed-in read across the academic tables. Nothing is written, so this
   is the safe way to prove authorization and the hub_user_id mapping are
   really scoping data per student. */
if ($action === 'summary') {
    $uid = require_user();
    $pdo = db();
    $count = function (string $table) use ($pdo, $uid): int {
        $st = $pdo->prepare("SELECT COUNT(*) FROM `$table` WHERE hub_user_id = ?");
        $st->execute(array($uid));
        return (int)$st->fetchColumn();
    };
    m7_ok(array(
        'hub_user_id' => $uid,
        'counts' => array(
            'question_sets' => $count('question_sets'),
            'attempts'      => $count('attempts'),
            'results'       => $count('results'),
            'mistakes'      => $count('mistakes'),
            'sessions'      => $count('sessions'),
            'achievements'  => $count('achievements'),
            'events'        => $count('events'),
        )
    ));
}

/* ---------------------------------------------------------------- selftest
   Integrity tests that PROVE the constraints, rather than checking that an
   index exists by name.

   Every test runs inside a transaction that is always rolled back, so no
   row survives and a live database is safe to run this against. A test
   "passes" when the database REFUSES the second write — a duplicate that
   succeeds is the failure.

   Needs a signed-in user because the rows are written against a real
   hub_user_id, and because an unauthenticated endpoint that writes anything
   at all, even temporarily, is not worth having. */
if ($action === 'selftest') {
    $uid = require_user();
    $pdo = db();
    $tests = array();

    $add = function (string $name, bool $pass, string $detail = '') use (&$tests) {
        $tests[] = array('test' => $name, 'pass' => $pass, 'detail' => $detail);
    };

    /* 1. A duplicate attempt nonce must be rejected — this is what stops a
          double-tapped Start creating two clocks. */
    try {
        $pdo->beginTransaction();
        $pdo->prepare('INSERT INTO question_sets
            (hub_user_id, subject, topic, questions_json, question_count, marks, minutes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())')
            ->execute(array($uid, '__selftest', '__selftest', '[]', 0, 0, 1));
        $setId = (int)$pdo->lastInsertId();
        $nonce = 'selftest-' . bin2hex(random_bytes(6));
        $ins = $pdo->prepare('INSERT INTO attempts
            (hub_user_id, set_id, client_nonce, started_at, updated_at)
            VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())');
        $ins->execute(array($uid, $setId, $nonce));
        $second = false;
        try { $ins->execute(array($uid, $setId, $nonce)); $second = true; }
        catch (Throwable $e) { /* expected */ }
        $add('attempts: duplicate nonce rejected', !$second,
             $second ? 'A second attempt was created — one Start could make two clocks.'
                     : 'Second insert refused by uq_attempt_nonce.');
        $pdo->rollBack();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $add('attempts: duplicate nonce rejected', false, $e->getMessage());
    }

    /* 2. A mistake recorded twice must collapse to one row, or "wrong 3
          times" becomes three rows saying "wrong once". */
    try {
        $pdo->beginTransaction();
        $hash = hash('sha256', 'selftest-' . microtime(true));
        $ins = $pdo->prepare('INSERT INTO mistakes
            (hub_user_id, question_hash, subject, topic, question, first_at, last_at)
            VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())');
        $ins->execute(array($uid, $hash, '__selftest', '__selftest', 'q'));
        $second = false;
        try { $ins->execute(array($uid, $hash, '__selftest', '__selftest', 'q')); $second = true; }
        catch (Throwable $e) {}
        $add('mistakes: duplicate question rejected', !$second,
             $second ? 'Duplicated — the Mistake Bank would double-count.'
                     : 'Second insert refused by uq_mistake.');
        $pdo->rollBack();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $add('mistakes: duplicate question rejected', false, $e->getMessage());
    }

    /* 3. An achievement must not unlock twice. */
    try {
        $pdo->beginTransaction();
        $key = 'selftest_' . bin2hex(random_bytes(4));
        $ins = $pdo->prepare('INSERT INTO achievements (hub_user_id, achieve_key, earned_at)
                              VALUES (?, ?, UTC_TIMESTAMP())');
        $ins->execute(array($uid, $key));
        $second = false;
        try { $ins->execute(array($uid, $key)); $second = true; } catch (Throwable $e) {}
        $add('achievements: duplicate unlock rejected', !$second,
             $second ? 'Unlocked twice.' : 'Second insert refused by uq_achieve.');
        $pdo->rollBack();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $add('achievements: duplicate unlock rejected', false, $e->getMessage());
    }

    /* 4. Multi-byte text must survive a round trip. utf8 (3-byte) silently
          truncates Devanagari, Telugu and emoji, and question text has all
          three — a corruption that is invisible until a student reads it. */
    try {
        $pdo->beginTransaction();
        $sample = 'गणित · గణితం · 数学 · 🎯';
        $pdo->prepare('INSERT INTO question_sets
            (hub_user_id, subject, topic, questions_json, question_count, marks, minutes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())')
            ->execute(array($uid, $sample, '__selftest', '[]', 0, 0, 1));
        $id = (int)$pdo->lastInsertId();
        $st = $pdo->prepare('SELECT subject FROM question_sets WHERE id = ?');
        $st->execute(array($id));
        $back = (string)$st->fetchColumn();
        $add('charset: Indic text and emoji round-trip', $back === $sample,
             $back === $sample ? 'Stored and returned unchanged.'
                               : 'Returned as: ' . $back);
        $pdo->rollBack();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $add('charset: Indic text and emoji round-trip', false, $e->getMessage());
    }

    /* 5. Deleting a set must take its attempts with it, or orphaned attempts
          accumulate pointing at questions that no longer exist. */
    try {
        $pdo->beginTransaction();
        $pdo->prepare('INSERT INTO question_sets
            (hub_user_id, subject, topic, questions_json, question_count, marks, minutes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())')
            ->execute(array($uid, '__selftest', '__selftest', '[]', 0, 0, 1));
        $setId = (int)$pdo->lastInsertId();
        $pdo->prepare('INSERT INTO attempts
            (hub_user_id, set_id, client_nonce, started_at, updated_at)
            VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())')
            ->execute(array($uid, $setId, 'cascade-' . bin2hex(random_bytes(5))));
        $pdo->prepare('DELETE FROM question_sets WHERE id = ?')->execute(array($setId));
        $st = $pdo->prepare('SELECT COUNT(*) FROM attempts WHERE set_id = ?');
        $st->execute(array($setId));
        $left = (int)$st->fetchColumn();
        $add('attempts: cascade on set delete', $left === 0,
             $left === 0 ? 'Attempts removed with their set.'
                         : $left . ' orphaned attempt(s) left behind.');
        $pdo->rollBack();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $add('attempts: cascade on set delete', false, $e->getMessage());
    }

    /* Nothing above may survive. If it did, the rollbacks are not working
       and the results are not trustworthy. */
    $leaked = 0;
    try {
        $st = $pdo->prepare("SELECT COUNT(*) FROM question_sets
                             WHERE hub_user_id = ? AND topic = '__selftest'");
        $st->execute(array($uid));
        $leaked = (int)$st->fetchColumn();
    } catch (Throwable $e) {}
    $add('cleanup: no test rows left behind', $leaked === 0,
         $leaked === 0 ? 'All test writes rolled back.'
                       : $leaked . ' row(s) survived — rollback is not working.');

    $passed = count(array_filter($tests, function ($t) { return $t['pass']; }));
    m7_ok(array(
        'hub_user_id' => $uid,
        'passed' => $passed, 'total' => count($tests),
        'ready'  => $passed === count($tests),
        'tests'  => $tests
    ));
}

m7_fail(404, 'unknown_action',
    'Try health, whoami, summary or selftest.');
