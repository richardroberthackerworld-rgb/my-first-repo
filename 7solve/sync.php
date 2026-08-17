<?php
/* ============================================================
   7SOLVE — SERVER SYNC STORE
   ------------------------------------------------------------
   The server is the source of truth for a student's study data;
   the browser keeps a cache and an outbox. This file is only the
   storage and identity layer — the HTTP actions live in api.php.

   THREE RULES THIS FILE EXISTS TO ENFORCE

   1. Idempotent writes. Every record carries a client-generated
      stable id. Pushing the same record twice — because a retry
      fired, or the tab was reopened mid-flight — updates one row
      and never creates a second. Progress cannot be double-counted.

   2. Last-write-wins per record, on updated_at. A push whose
      updated_at is older than what is already stored is REJECTED,
      not applied, so a stale device coming back online cannot
      resurrect old state over newer edits made elsewhere.

   3. Deletes are tombstones. A deleted record keeps its id and its
      timestamp with deleted=1. Without this, deleting on device A
      and then syncing device B's stale copy would resurrect it.

   Nothing derived is ever stored. Mastery, patterns and the whole
   learning profile are recomputed from these events on each client,
   so improving the algorithm improves every student's profile with
   no migration.
   ============================================================ */
declare(strict_types=1);

/* ---------- where a user's records live ---------- */
function sync_dir(array $CFG): ?string {
    $dir = trim((string)($CFG['sync_dir'] ?? ''));
    if ($dir === '') $dir = __DIR__ . '/data/sync';
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    return (is_dir($dir) && is_writable($dir)) ? rtrim($dir, '/\\') : null;
}

/* The secret that makes stored filenames unguessable.

   Configure it and that wins. Leave it blank — which is what every fresh
   install has — and we generate a long random one ONCE and keep it in
   .sync_salt beside the data. That matters: the old fallback was the literal
   string '7solve', so anyone who knew a student's hub id could compute their
   filename, which is exactly what the salt exists to prevent. A generated
   secret is strictly better than a documented one nobody remembers to set.

   The salt must never change once data exists, so this only ever creates the
   file when it is absent, and uses 'x' mode so two simultaneous requests
   cannot each write a different secret. If the directory is not writable we
   fall back to a stable derived value rather than a fresh random one: a
   different salt per request would orphan every record. */
function sync_salt(array $CFG): string {
    static $cached = null;
    if ($cached !== null) return $cached;

    $set = trim((string)($CFG['sync_salt'] ?? ''));
    if ($set !== '') return $cached = $set;

    $dir = sync_dir($CFG);
    if ($dir === null) return $cached = 'nosync';     // sync is off without a usable dir

    $f = $dir . '/.sync_salt';
    $have = is_file($f) ? trim((string)@file_get_contents($f)) : '';
    if ($have !== '') return $cached = $have;

    $new = bin2hex(random_bytes(32));
    $h = @fopen($f, 'xb');                            // create-only: the race is decided here
    if ($h) {
        @fwrite($h, $new);
        @fclose($h);
        @chmod($f, 0600);
        return $cached = $new;
    }
    // Someone else just created it, or we cannot write at all.
    $have = is_file($f) ? trim((string)@file_get_contents($f)) : '';
    if ($have !== '') return $cached = $have;
    return $cached = hash('sha256', 'sync|' . ($CFG['app'] ?? '7solve') . '|' . $dir);
}

/* A user's file is named by a salted hash of their hub id: the directory
   never reveals who has an account, and one user can never guess another's
   filename even with the raw id. */
function sync_file(array $CFG, string $uid): ?string {
    $dir = sync_dir($CFG);
    if ($dir === null || $uid === '') return null;
    return $dir . '/u_' . hash('sha256', sync_salt($CFG) . '|' . $uid) . '.json';
}

/* ---------- identity ----------
   hub_me() is a network round trip to account.7by.in. Doing that on every
   push would put a cross-domain call in the hot path, so verified tokens are
   cached briefly. The cache stores only the hub's user id, never the token. */
function sync_identify(array $CFG, string $token): ?string {
    if ($token === '') return null;
    $dir = sync_dir($CFG);
    $ttl = max(30, (int)($CFG['sync_session_ttl'] ?? 300));
    $key = hash('sha256', 'sess|' . $token);
    $cacheFile = $dir ? $dir . '/s_' . $key . '.json' : null;

    if ($cacheFile && is_file($cacheFile) && (time() - (int)@filemtime($cacheFile)) < $ttl) {
        $c = json_decode((string)@file_get_contents($cacheFile), true);
        if (is_array($c) && !empty($c['uid'])) return (string)$c['uid'];
    }
    $me = hub_me($CFG, $token, (string)($CFG['app'] ?? '7solve'));
    if (!$me) return null;
    $uid = (string)($me['id'] ?? $me['user_id'] ?? $me['email'] ?? '');
    if ($uid === '') return null;
    if ($cacheFile) @file_put_contents($cacheFile, json_encode(['uid' => $uid]), LOCK_EX);

    /* opportunistic sweep so stale sessions do not pile up forever */
    if (mt_rand(1, 50) === 1 && $dir) {
        foreach ((array)@glob($dir . '/s_*.json') as $g) {
            if (@filemtime($g) < time() - 86400) @unlink($g);
        }
    }
    return $uid;
}

/* ---------- read / write the whole record set ---------- */
function sync_load(array $CFG, string $uid): array {
    $f = sync_file($CFG, $uid);
    if (!$f || !is_file($f)) return ['rev' => 0, 'records' => []];
    $j = json_decode((string)@file_get_contents($f), true);
    if (!is_array($j) || !isset($j['records'])) return ['rev' => 0, 'records' => []];
    return ['rev' => (int)($j['rev'] ?? 0), 'records' => (array)$j['records']];
}

function sync_save(array $CFG, string $uid, array $data): bool {
    $f = sync_file($CFG, $uid);
    if (!$f) return false;
    $tmp = $f . '.' . getmypid() . '.tmp';
    $ok = @file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE), LOCK_EX);
    if ($ok === false) return false;
    return @rename($tmp, $f);            // atomic: a reader never sees a half file
}

/* ---------- the merge ----------
   Returns [applied, rejected, conflicts]. A rejected push is not an error:
   it means the server already holds something newer, and the client is told
   so it can take the server's copy. */
function sync_merge(array $CFG, string $uid, array $incoming): array {
    $lock = null;
    $f = sync_file($CFG, $uid);
    if ($f) {
        /* one writer at a time per user, or two tabs pushing together can
           interleave read-modify-write and lose records */
        $lock = @fopen($f . '.lock', 'c');
        if ($lock) @flock($lock, LOCK_EX);
    }
    $store = sync_load($CFG, $uid);
    $recs  = $store['records'];
    $applied = []; $conflicts = [];

    foreach ($incoming as $r) {
        if (!is_array($r)) continue;
        $id = (string)($r['id'] ?? '');
        $type = (string)($r['type'] ?? '');
        if ($id === '' || $type === '') continue;
        if (!preg_match('/^[A-Za-z0-9_.:-]{1,80}$/', $id)) continue;
        if (!in_array($type, sync_types(), true)) continue;

        $up = (int)($r['updated_at'] ?? 0);
        if ($up <= 0) $up = (int)(microtime(true) * 1000);

        $existing = $recs[$id] ?? null;
        if ($existing && (int)($existing['updated_at'] ?? 0) > $up) {
            /* the server is newer — refuse and hand back what we hold */
            $conflicts[] = $existing;
            continue;
        }
        $recs[$id] = [
            'id'         => $id,
            'type'       => $type,
            'updated_at' => $up,
            'created_at' => (int)($existing['created_at'] ?? ($r['created_at'] ?? $up)),
            'deleted'    => !empty($r['deleted']) ? 1 : 0,
            'device_id'  => substr((string)($r['device_id'] ?? ''), 0, 40),
            'client'     => substr((string)($r['client'] ?? ''), 0, 20),
            'server_seen'=> (int)($existing['server_seen'] ?? (microtime(true) * 1000)),
            'payload'    => !empty($r['deleted']) ? null : ($r['payload'] ?? null),
        ];
        $applied[] = $id;
    }

    $store['rev'] = (int)$store['rev'] + 1;
    $store['records'] = sync_prune($recs);
    $store['updated_at'] = (int)(microtime(true) * 1000);
    sync_save($CFG, $uid, $store);

    if ($lock) { @flock($lock, LOCK_UN); @fclose($lock); }
    return [$applied, $conflicts, $store['rev']];
}

/* Tombstones are kept long enough that any realistic offline device will have
   seen them, then dropped so the file does not grow without bound. */
function sync_prune(array $recs): array {
    $now = (int)(microtime(true) * 1000);
    $cut = $now - 60 * 86400 * 1000;
    /* Anything before 2020 is not a real client timestamp — a device with a
       wrong clock, or a test. Those are aged by when the SERVER first saw
       them, otherwise a skewed clock would have its deletes pruned on the
       same request that created them and the record would resurrect. */
    $floor = 1577836800000;                       // 2020-01-01
    $out = [];
    foreach ($recs as $id => $r) {
        if (empty($r['deleted'])) { $out[$id] = $r; continue; }
        $stamp = (int)($r['updated_at'] ?? 0);
        $seen  = (int)($r['server_seen'] ?? 0);
        $age   = ($stamp >= $floor) ? $stamp : ($seen ?: $now);
        if ($age < $cut) continue;                // genuinely old tombstone
        $out[$id] = $r;
    }
    /* a runaway client should never be able to fill the disk */
    if (count($out) > 20000) {
        uasort($out, fn($a, $b) => (int)$b['updated_at'] <=> (int)$a['updated_at']);
        $out = array_slice($out, 0, 20000, true);
    }
    return $out;
}

/* Everything changed since a cursor. The cursor is a millisecond timestamp,
   so a client that has never synced passes 0 and gets the lot. */
function sync_since(array $CFG, string $uid, int $since): array {
    $store = sync_load($CFG, $uid);
    $out = [];
    foreach ($store['records'] as $r) {
        if ((int)($r['updated_at'] ?? 0) > $since) $out[] = $r;
    }
    usort($out, fn($a, $b) => (int)$a['updated_at'] <=> (int)$b['updated_at']);
    return [$out, (int)$store['rev']];
}

/* The record types the server will accept. Anything else is dropped rather
   than stored, so a compromised client cannot use this as free file storage. */
function sync_types(): array {
    return ['event', 'mistake', 'doubt', 'deck', 'note', 'goal',
            'bookmark', 'plan', 'ledger', 'chapter', 'profile_pref'];
}
