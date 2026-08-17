<?php
/**
 * 7MARKS — Phase B0 setup and verification.
 *
 * Run this ONCE from a browser after creating the database and filling in
 * db/config.php. It exists because the migration has to be applied on the
 * server, where the credentials live — nothing outside the server can or
 * should be able to reach that database.
 *
 * Everything here is idempotent. Every statement in schema.sql is a
 * CREATE TABLE IF NOT EXISTS, so running this twice changes nothing the
 * second time. Nothing drops, truncates or alters an existing table.
 *
 * Usage
 *   1. Add  'setup_token' => '<a long random string>'  to db/config.php
 *   2. https://7marks.7by.in/db/setup.php?token=<that string>&action=verify
 *      → connects and reports what is missing, changing nothing
 *   3. ...&action=migrate      → applies schema.sql to the 7Marks database
 *   4. ...&action=hub-bonus    → applies hub-bonus.sql to the SHARED hub
 *   5. DELETE THIS FILE when you are done.
 *
 * The token is mandatory. Without one in config.php this script refuses to
 * do anything, so an unfinished install cannot leave a public endpoint that
 * touches the database.
 */

declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');
header('X-Robots-Tag: noindex, nofollow');
header('Cache-Control: no-store');

function out(string $s): void { echo $s . "\n"; }
function fail(string $s): void { http_response_code(400); out('FAIL  ' . $s); exit; }

/* ---------------------------------------------------------------- config */
$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) {
    fail("db/config.php not found.\n" .
         "      Copy db/config.example.php to db/config.php on the server and\n" .
         "      fill in the database name, user and password.");
}
$CFG = require $cfgFile;

$token = (string)($CFG['setup_token'] ?? '');
if ($token === '' || strlen($token) < 16) {
    fail("No 'setup_token' in db/config.php, or it is shorter than 16 characters.\n" .
         "      Add a long random string, e.g.\n" .
         "        'setup_token' => '" . bin2hex(random_bytes(16)) . "',\n" .
         "      then reload this page with ?token=<that value>");
}
/* hash_equals so a wrong token cannot be found by timing the response */
if (!hash_equals($token, (string)($_GET['token'] ?? ''))) {
    http_response_code(403);
    out('FAIL  Bad or missing token.');
    exit;
}

$action = (string)($_GET['action'] ?? 'verify');

/* ---------------------------------------------------------------- connect */
function connect(array $c): PDO {
    $dsn = 'mysql:host=' . ($c['host'] ?? 'localhost') .
           ';dbname=' . ($c['name'] ?? '') .
           ';charset=' . ($c['charset'] ?? 'utf8mb4');
    return new PDO($dsn, (string)($c['user'] ?? ''), (string)($c['pass'] ?? ''),
        ($c['options'] ?? array()) + array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION));
}

try {
    $pdo = connect($CFG);
} catch (Throwable $e) {
    fail("Could not connect to the 7Marks database.\n" .
         '      ' . $e->getMessage() . "\n" .
         "      Check host, name, user and password in db/config.php, and that the\n" .
         "      user has been added to the database with All Privileges.");
}

$dbName = (string)($CFG['name'] ?? '');
out('7MARKS — Phase B0 setup');
out(str_repeat('=', 58));
out('Database : ' . $dbName);
out('Action   : ' . $action);
out('');

/* A guard worth having: this database must not be the hub's. If the hub's
   own tables are visible here, the credentials point at the shared database
   and applying the 7Marks schema would mix the two products together. */
$hubish = $pdo->query("SHOW TABLES LIKE 'tool_credits'")->fetchColumn();
if ($hubish) {
    fail("This looks like the ACCOUNT HUB database — it contains 'tool_credits'.\n" .
         "      7Marks must have its own separate database and its own user.\n" .
         "      Nothing was changed.");
}

/* ---------------------------------------------------------------- schema */
$TABLES = array(
    'users_mirror', 'subjects', 'topics', 'question_sets', 'attempts', 'results',
    'mistakes', 'sessions', 'achievements', 'events',
    'friends', 'challenges', 'challenge_runs', 'drops', 'drop_runs',
    'notifications', 'leaderboard', 'schema_version'
);
/* the keys that carry the integrity guarantees, checked by name */
$UNIQUES = array(
    'attempts'       => 'uq_attempt_nonce',   // one clock per Start
    'results'        => 'uq_result_attempt',  // graded once
    'mistakes'       => 'uq_mistake',         // "wrong 3 times" not 3 rows
    'achievements'   => 'uq_achieve',         // a badge unlocks once
    'challenge_runs' => 'uq_run',             // no re-sitting a challenge
    'friends'        => 'uq_pair',            // one row per friendship
    'leaderboard'    => 'uq_board'
);

function haveTables(PDO $pdo, array $want): array {
    $have = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
    $have = array_map('strtolower', $have);
    $missing = array();
    foreach ($want as $t) if (!in_array(strtolower($t), $have, true)) $missing[] = $t;
    return $missing;
}

function runSqlFile(PDO $pdo, string $file): array {
    $sql = (string)@file_get_contents($file);
    if ($sql === '') return array(0, array('could not read ' . basename($file)));
    /* strip line comments, then split on semicolons at end of line */
    $sql = preg_replace('/^\s*--.*$/m', '', $sql);
    $parts = array_filter(array_map('trim', preg_split('/;\s*[\r\n]/', $sql)));
    $ok = 0; $errs = array();
    foreach ($parts as $stmt) {
        if ($stmt === '' || stripos($stmt, 'SET ') === 0) { continue; }
        try { $pdo->exec($stmt); $ok++; }
        catch (Throwable $e) { $errs[] = substr($e->getMessage(), 0, 160); }
    }
    return array($ok, $errs);
}

/* ---------------------------------------------------------------- migrate */
if ($action === 'migrate') {
    out('Applying schema.sql ...');
    list($n, $errs) = runSqlFile($pdo, __DIR__ . '/schema.sql');
    out('  statements applied: ' . $n);
    foreach ($errs as $e) out('  ERROR ' . $e);
    out('');
}

/* ------------------------------------------------------------- hub bonus */
if ($action === 'hub-bonus') {
    /* Runs against the SHARED hub database, using the hub's OWN config so no
       hub credentials are ever copied into 7Marks. Additive only. */
    $hubCfgPath = dirname(__DIR__, 2) . '/account-hub/config.php';
    if (!is_file($hubCfgPath)) {
        fail("account-hub/config.php not found at:\n      " . $hubCfgPath . "\n" .
             "      Run this from the same server as the hub, or apply\n" .
             "      db/hub-bonus.sql by hand in phpMyAdmin.");
    }
    $HUB = require $hubCfgPath;
    $hc = array(
        'host' => $HUB['db_host'] ?? $HUB['host'] ?? 'localhost',
        'name' => $HUB['db_name'] ?? $HUB['name'] ?? '',
        'user' => $HUB['db_user'] ?? $HUB['user'] ?? '',
        'pass' => $HUB['db_pass'] ?? $HUB['pass'] ?? '',
    );
    if ($hc['name'] === '') {
        fail("Could not read the hub database name from its config.\n" .
             "      Apply db/hub-bonus.sql by hand in phpMyAdmin instead —\n" .
             "      it is one CREATE TABLE and alters nothing.");
    }
    try { $hub = connect($hc); }
    catch (Throwable $e) { fail('Could not connect to the hub database: ' . $e->getMessage()); }

    out('Applying hub-bonus.sql to the shared hub database ...');
    out('  (additive: one CREATE TABLE IF NOT EXISTS, nothing altered)');
    list($n2, $errs2) = runSqlFile($hub, __DIR__ . '/hub-bonus.sql');
    out('  statements applied: ' . $n2);
    foreach ($errs2 as $e) out('  ERROR ' . $e);
    $has = $hub->query("SHOW TABLES LIKE 'credit_bonus_log'")->fetchColumn();
    out('  credit_bonus_log present: ' . ($has ? 'YES' : 'NO'));
    /* prove the idempotency key is really there — it is the whole mechanism */
    if ($has) {
        $idx = $hub->query("SHOW INDEX FROM credit_bonus_log WHERE Key_name = 'uq_bonus_day'")
                   ->fetchAll();
        out('  uq_bonus_day unique key : ' . (count($idx) ? 'YES (' . count($idx) .
            ' columns)' : 'MISSING — the daily bonus would not be idempotent'));
    }
    out('');
}

/* ----------------------------------------------------------- fix charset */
if ($action === 'fix-charset') {
    /* Changes only the DEFAULT for tables created later. Existing tables keep
       their own charset, which is already utf8mb4, so nothing is rewritten and
       no data can be lost by running this. */
    out('Setting the database default charset to utf8mb4 ...');
    try {
        $pdo->exec('ALTER DATABASE `' . str_replace('`', '', $dbName) .
                   '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        out('  done.');
    } catch (Throwable $e) {
        out('  could not: ' . $e->getMessage());
        out('  Shared hosting often withholds ALTER DATABASE. This is harmless:');
        out('  every table is already utf8mb4, so your data is unaffected.');
        out('  To change it anyway: phpMyAdmin > select the database >');
        out('  Operations > Collation > utf8mb4_unicode_ci.');
    }
    out('');
}

/* ---------------------------------------------------------------- verify */
out('VERIFY');
out(str_repeat('-', 58));

$missing = haveTables($pdo, $TABLES);
out('Tables expected : ' . count($TABLES));
out('Tables missing  : ' . count($missing) . (count($missing) ? '  → ' . implode(', ', $missing) : ''));

$badKeys = array();
foreach ($UNIQUES as $table => $key) {
    if (in_array($table, $missing, true)) { $badKeys[] = $table . '.' . $key . ' (no table)'; continue; }
    try {
        $rows = $pdo->query("SHOW INDEX FROM `$table` WHERE Key_name = " . $pdo->quote($key))
                    ->fetchAll();
        if (!count($rows)) $badKeys[] = $table . '.' . $key;
    } catch (Throwable $e) { $badKeys[] = $table . '.' . $key . ' (' . $e->getMessage() . ')'; }
}
out('Integrity keys  : ' . (count($badKeys) ? 'MISSING → ' . implode(', ', $badKeys)
                                            : 'all ' . count($UNIQUES) . ' present'));

/* Charset, measured properly.
   What actually determines whether Devanagari, Telugu and emoji survive is
   the charset of each TABLE, not the database default — and every table in
   schema.sql declares utf8mb4 explicitly. The database default only decides
   what a future table gets if someone creates one without saying.
   An earlier version of this check read only the database default and
   reported NOT READY for a database whose data was perfectly safe. */
$dbDefault = (string)$pdo->query('SELECT @@character_set_database')->fetchColumn();

$st = $pdo->prepare(
    "SELECT t.TABLE_NAME, c.CHARACTER_SET_NAME
       FROM information_schema.TABLES t
       JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION
      WHERE t.TABLE_SCHEMA = ?"
);
$st->execute(array($dbName));
$badTables = array();
foreach ($st->fetchAll() as $row) {
    if (strtolower((string)$row['CHARACTER_SET_NAME']) !== 'utf8mb4') {
        $badTables[] = $row['TABLE_NAME'] . ' (' . $row['CHARACTER_SET_NAME'] . ')';
    }
}
$tablesOk = !count($badTables);

out('Table charset   : ' . ($tablesOk
    ? 'utf8mb4 on all tables  OK — Indic text and emoji are safe'
    : 'WRONG on ' . count($badTables) . ' → ' . implode(', ', $badTables)));
out('Database default: ' . $dbDefault . ($dbDefault === 'utf8mb4' ? '  OK'
    : "  — only affects tables created later without an explicit charset.\n" .
      '                  Harmless now; fix with &action=fix-charset'));

$ver = 0;
try { $ver = (int)$pdo->query('SELECT MAX(version) FROM schema_version')->fetchColumn(); }
catch (Throwable $e) {}
out('Schema version  : ' . ($ver ?: 'not applied yet'));

out('');
/* READY depends on what actually protects the data: the tables. The
   database default is reported, and offered a fix, but does not block. */
$ready = !count($missing) && !count($badKeys) && $tablesOk;
out($ready ? 'RESULT: READY — the 7Marks database is set up correctly.'
           : 'RESULT: NOT READY — run this again with &action=migrate');
if ($ready && $dbDefault !== 'utf8mb4') {
    out('        Optional: &action=fix-charset sets the database default to');
    out('        utf8mb4 as well. Not required — your tables are already utf8mb4.');
}
out('');
out('When everything reads READY, DELETE db/setup.php from the server.');
