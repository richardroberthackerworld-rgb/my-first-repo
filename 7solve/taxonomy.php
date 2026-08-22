<?php
/* ============================================================
   7Solve — TAXONOMY READER
   ------------------------------------------------------------
   The academic tree under taxonomy/ is 1,710 nodes across 16
   shards, and until now nothing read it: it shipped, and it sat
   there. This is the reader that gives it a consumer.

   THE ONE RULE IT ENFORCES, ABOVE EVERYTHING ELSE:

     a node in this tree says NOTHING about whether an answer to
     it can be verified.

   Coverage and capability are different facts and live in
   different files. A caller walking the tree gets the honest
   capability of each node — supported, covered_not_verifiable,
   or unknown — read from capabilities.json, never inferred from
   the fact that a node exists. That distinction is the whole
   reason the taxonomy is a separate file from the manifest, and
   an endpoint that blurred it would undo Release A.

   LOADING. Shards are read lazily and cached per request. The
   index is small; legacy-exam.json alone is 132 KB, and a
   caller asking for the children of one B.Tech branch should
   not pay for 302 competitive exams.
   ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/capability.php';

final class Taxonomy
{
    private static ?array $index = null;
    private static array $loaded = [];        // shard file => nodes
    private static ?array $all = null;        // id => node, only when a full walk is needed

    private static function dir(): string
    {
        return __DIR__ . '/taxonomy';
    }

    private static function index(): array
    {
        if (self::$index !== null) return self::$index;
        $f = self::dir() . '/index.json';
        if (!is_readable($f)) return self::$index = ['nodes' => [], 'shards' => []];
        $j = json_decode((string)file_get_contents($f), true);
        return self::$index = is_array($j) ? $j : ['nodes' => [], 'shards' => []];
    }

    private static function shard(string $rel): array
    {
        if (isset(self::$loaded[$rel])) return self::$loaded[$rel];
        $f = self::dir() . '/' . $rel;
        if (!is_readable($f)) return self::$loaded[$rel] = [];
        $j = json_decode((string)file_get_contents($f), true);
        return self::$loaded[$rel] = (is_array($j) && isset($j['nodes'])) ? $j['nodes'] : [];
    }

    /** Every node, id-keyed. Only for operations that genuinely need the whole tree. */
    private static function all(): array
    {
        if (self::$all !== null) return self::$all;
        $out = [];
        foreach (self::index()['nodes'] ?? [] as $n) $out[$n['id']] = $n;
        foreach (self::index()['shards'] ?? [] as $s) {
            foreach (self::shard($s) as $n) if (!isset($out[$n['id']])) $out[$n['id']] = $n;
        }
        return self::$all = $out;
    }

    /* ------------------------------------------------------------------
       CAPABILITY OF A NODE — read, never inferred.

       A topic names problem types; capabilities.json says what, if
       anything, can check them. A node with no problem types is not
       "unsupported", it is a node that has not been connected to a
       checker — which is a different sentence and the honest one.
       ------------------------------------------------------------------ */
    public static function capabilityOf(array $node): array
    {
        $types = $node['problem_types'] ?? [];
        if (!count($types)) {
            return ['capability' => 'unknown', 'problem_types' => [],
                    'means' => 'This node names no problem type, so nothing is claimed about '
                             . 'verifying answers under it. Coverage is not capability.'];
        }
        $supported = [];
        $covered = [];
        foreach (Capability::subjectsForProblemTypes($types) as $t => $s) {
            if ($s === null) continue;
            if (($s['status'] ?? 'supported') === 'covered_not_verifiable') $covered[] = $t;
            else $supported[] = $t;
        }
        if (count($supported)) {
            return ['capability' => 'supported', 'problem_types' => $types,
                    'verifiable' => $supported,
                    'means' => 'A deterministic checker exists for ' . implode(', ', $supported) . '.'];
        }
        if (count($covered)) {
            return ['capability' => 'covered_not_verifiable', 'problem_types' => $types,
                    'means' => '7Solve can help with this, and cannot independently verify an '
                             . 'answer to it. This is NOT a pass.'];
        }
        return ['capability' => 'unknown', 'problem_types' => $types,
                'means' => 'No subject in the manifest declares these problem types.'];
    }

    private static function shape(array $n, bool $withCapability): array
    {
        $out = [
            'id'     => $n['id'],
            'kind'   => $n['kind'] ?? null,
            'label'  => $n['label'] ?? null,
            'parent' => $n['parent'] ?? null,
        ];
        if (!empty($n['aliases'])) $out['aliases'] = $n['aliases'];
        if (!empty($n['problem_types'])) $out['problem_types'] = $n['problem_types'];
        if ($withCapability) $out += self::capabilityOf($n);
        return $out;
    }

    /** Direct children of a node, or the roots when $id is null. */
    public static function children(?string $id): array
    {
        $all = self::all();
        $out = [];
        foreach ($all as $n) {
            $p = $n['parent'] ?? null;
            if ($id === null ? ($p === null) : ($p === $id)) $out[] = self::shape($n, false);
        }
        usort($out, static fn($a, $b) => strcmp((string)$a['label'], (string)$b['label']));
        return $out;
    }

    public static function node(string $id): ?array
    {
        $all = self::all();
        if (!isset($all[$id])) return null;
        $n = self::shape($all[$id], true);
        $n['children'] = self::children($id);
        /* the path back to the root, so a caller never has to walk up by hand */
        $trail = [];
        $cur = $all[$id]['parent'] ?? null;
        $guard = 0;
        while ($cur !== null && isset($all[$cur]) && $guard++ < 32) {
            array_unshift($trail, ['id' => $cur, 'label' => $all[$cur]['label'] ?? null,
                                   'kind' => $all[$cur]['kind'] ?? null]);
            $cur = $all[$cur]['parent'] ?? null;
        }
        $n['path'] = $trail;
        return $n;
    }

    /** Label and alias search. Deliberately simple: prefix and substring, ranked. */
    public static function search(string $q, int $limit = 40): array
    {
        $needle = trim(mb_strtolower($q));
        if ($needle === '') return [];
        $hits = [];
        foreach (self::all() as $n) {
            $names = array_merge([(string)($n['label'] ?? '')], $n['aliases'] ?? []);
            $best = null;
            foreach ($names as $name) {
                $l = mb_strtolower($name);
                if ($l === $needle) { $best = 0; break; }
                if (strpos($l, $needle) === 0) { $best = min($best ?? 9, 1); continue; }
                if (strpos($l, $needle) !== false) { $best = min($best ?? 9, 2); }
            }
            if ($best === null) continue;
            $hits[] = ['rank' => $best, 'node' => $n];
        }
        usort($hits, static function ($a, $b) {
            if ($a['rank'] !== $b['rank']) return $a['rank'] - $b['rank'];
            return strcmp((string)$a['node']['label'], (string)$b['node']['label']);
        });
        $out = [];
        foreach (array_slice($hits, 0, $limit) as $h) $out[] = self::shape($h['node'], false);
        return $out;
    }

    public static function stats(): array
    {
        $kinds = [];
        foreach (self::all() as $n) {
            $k = $n['kind'] ?? 'unknown';
            $kinds[$k] = ($kinds[$k] ?? 0) + 1;
        }
        ksort($kinds);
        return ['nodes' => count(self::all()), 'shards' => count(self::index()['shards'] ?? []),
                'by_kind' => $kinds];
    }
}
