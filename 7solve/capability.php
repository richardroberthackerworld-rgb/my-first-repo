<?php
/* ============================================================
   7Solve — API CAPABILITY REPORTING
   ------------------------------------------------------------
   /v1 runs a subset of the checkers the website runs. Without
   this, a derivative question and an unsolvable one both came
   back `unverified`, and a customer could not tell which had
   happened:

     * a checker ran and could not establish the result, versus
     * no checker for this subject exists in the API at all.

   Those are different facts and only one of them is about the
   student's answer. `capability` separates them.

   PHASE 2 / RELEASE A — this file no longer holds any capability
   knowledge of its own. It reads capabilities.json, which is the
   single source of truth for subjects, aliases, checkers, engine
   availability and certification authority. The two hand-kept
   maps that used to live here — SUBJECT_CHECKER and the regex
   ladder inside subjectOf() — were exactly half of the four-way
   split that let release .2 ship an identity checker the API did
   not know it had. They are gone; nothing replaced them on disk.

   `not_supported_by_api` must never be read as a pass, and
   neither may `covered_not_verifiable`. See
   VERIFICATION-CONTRACT.md.
   ============================================================ */
declare(strict_types=1);

final class Capability
{
    private static ?array $manifest = null;

    private static function manifest(): array
    {
        if (self::$manifest !== null) return self::$manifest;
        $out = ['kinds' => [], 'checkers' => [], 'subjects' => []];
        $f = __DIR__ . '/capabilities.json';
        if (is_readable($f)) {
            $j = json_decode((string)file_get_contents($f), true);
            if (is_array($j)) {
                $out['kinds']    = $j['kinds']    ?? [];
                $out['checkers'] = $j['checkers'] ?? [];
                $out['subjects'] = $j['subjects'] ?? [];
            }
        }
        return self::$manifest = $out;
    }

    /** Checkers this PHP build actually carries, by name. */
    private static function phpCheckers(): array
    {
        $out = [];
        foreach (self::manifest()['checkers'] as $c) {
            if (!empty($c['engines']['php'])) $out[$c['checker']] = true;
        }
        return $out;
    }

    /* Subject order is the manifest's order, which is the order the old
       SUBJECT_CHECKER literal had. /v1 reports these lists, so re-ordering
       them would be a visible API change.

       covered_not_verifiable subjects appear in NEITHER list, and that is not
       a convenience. `unsupportedSubjects` means "the site can check this and
       this API build cannot" — a promise that a checker exists somewhere. A
       Band D subject has no checker anywhere, so listing it there would be
       false, and listing it under supported would be worse. It is a third
       category, reported through `capability` on the question itself.

       It also keeps Release A honest: both lists come back exactly as they did
       at .2, so adding Band D coverage changes no existing API response. */
    private static function split(): array
    {
        $php = self::phpCheckers();
        $yes = [];
        $no  = [];
        foreach (self::manifest()['subjects'] as $s) {
            if (($s['status'] ?? 'supported') === 'covered_not_verifiable') continue;
            $has = false;
            foreach (($s['checkers'] ?? []) as $ck) {
                if (isset($php[$ck])) { $has = true; break; }
            }
            if ($has) $yes[] = $s['id']; else $no[] = $s['id'];
        }
        return [$yes, $no];
    }

    /** Subjects this API build can verify, derived from the manifest. */
    public static function supportedSubjects(): array
    {
        return self::split()[0];
    }

    /** Subjects the site verifies but this API does not. */
    public static function unsupportedSubjects(): array
    {
        return self::split()[1];
    }

    /* ------------------------------------------------------------------
       Rule evaluation.

       A pattern is stored without delimiters so it survives JSON into
       either engine unchanged. PHP needs one, and several patterns contain
       a literal '/', so the delimiter is CHOSEN rather than assumed —
       first from a fixed list that does not appear in the pattern, which
       keeps the result deterministic.
       ------------------------------------------------------------------ */
    private static function wrap(string $pattern, string $flags): string
    {
        foreach (['/', '#', '~', '%', '!', '@'] as $d) {
            if (strpos($pattern, $d) === false) return $d . $pattern . $d . $flags;
        }
        return '/' . str_replace('/', '\\/', $pattern) . '/' . $flags;
    }

    private static function matches(array $rule, string $q): bool
    {
        $flags = (string)($rule['flags'] ?? '');

        /* Two rules in the original ladder counted '=' signs rather than
           matching a pattern. A regex cannot express "at least two of these",
           so the vocabulary carries a count form instead of pretending. */
        if (isset($rule['count'])) {
            $need = (int)($rule['count']['min'] ?? 1);
            $n = substr_count($q, (string)($rule['count']['pattern'] ?? '='));
            if ($n < $need) return false;
        }

        if (!empty($rule['any'])) {
            $hit = false;
            foreach ($rule['any'] as $p) {
                if (preg_match(self::wrap($p, $flags), $q) === 1) { $hit = true; break; }
            }
            if (!$hit) return false;
        }

        if (!empty($rule['none'])) {
            foreach ($rule['none'] as $p) {
                if (preg_match(self::wrap($p, $flags), $q) === 1) return false;
            }
        }

        /* A rule with no count, no any and no none would match everything.
           That is never intended, so it matches nothing instead. */
        return isset($rule['count']) || !empty($rule['any']);
    }

    /* Which subject a question is asking about, by the same triggers the
       checkers themselves use. Best-effort and deliberately conservative: an
       unrecognised question reports no subject rather than guessing one.

       Order is by `rank`, lowest first — the old ladder's first-match-wins
       order, now stated rather than implied by source position. Subjects with
       no `match` block are never returned here; they are reachable only
       through supportedSubjects(), which is what the old code did too. */
    public static function subjectOf(string $question): ?string
    {
        $ranked = [];
        foreach (self::manifest()['subjects'] as $s) {
            if (empty($s['match'])) continue;
            $ranked[] = $s;
        }
        usort($ranked, static function ($a, $b) {
            $ra = (int)($a['match']['rank'] ?? 9999);
            $rb = (int)($b['match']['rank'] ?? 9999);
            if ($ra === $rb) return strcmp((string)$a['id'], (string)$b['id']);
            return $ra <=> $rb;
        });
        foreach ($ranked as $s) {
            if (self::matches($s['match'], $question)) return (string)$s['id'];
        }
        return null;
    }

    /** The manifest record for a subject id, or null. */
    private static function subject(?string $id): ?array
    {
        if ($id === null) return null;
        foreach (self::manifest()['subjects'] as $s) {
            if (($s['id'] ?? null) === $id) return $s;
        }
        return null;
    }

    /**
     * The capability field for a response.
     *   supported              — a checker for this subject exists and ran
     *   covered_not_verifiable — the taxonomy covers this subject and 7Solve
     *                            will answer it, but no deterministic verifier
     *                            exists for it. NOT a pass, and not a failure.
     *   not_supported_by_api   — the site can check this; this API build cannot
     *   unknown_subject        — the subject could not be identified
     */
    public static function forQuestion(string $question, string $state): array
    {
        $subject = self::subjectOf($question);
        $supported = self::supportedSubjects();

        if ($subject === null) {
            return ['subject' => null, 'capability' => 'unknown_subject',
                    'means' => 'This API could not identify the mathematical subject of the question. '
                             . 'A verdict of "unverified" here says nothing about the answer.'];
        }

        /* A subject the manifest carries with status covered_not_verifiable is
           one 7Solve answers but cannot independently check. Saying
           "unverified" alone would be true but useless — it reads as "we
           tried and failed" when in fact nothing could have been tried. */
        $rec = self::subject($subject);
        if (($rec['status'] ?? 'supported') === 'covered_not_verifiable') {
            return ['subject' => $subject, 'capability' => 'covered_not_verifiable',
                    'means' => '7Solve can help with ' . $subject . ', but it cannot independently '
                             . 'verify an answer to it. Treat the answer as a well-informed draft, '
                             . 'not a checked result. This is NOT a pass.'];
        }

        if (!in_array($subject, $supported, true)) {
            return ['subject' => $subject, 'capability' => 'not_supported_by_api',
                    'means' => 'This API has no checker for ' . $subject . '. The answer was NOT '
                             . 'examined — this is not a pass and not a failure.'];
        }
        return ['subject' => $subject, 'capability' => 'supported',
                'means' => $state === 'unverified'
                    ? 'A checker for ' . $subject . ' ran and could not establish the result. '
                    . 'This is NOT a pass.'
                    : 'A checker for ' . $subject . ' ran and reached a verdict.'];
    }

    /* ------------------------------------------------------------------
       Certification authority, read from the manifest.

       Only a kind whose authority is not `advisory` may take part in
       certification. Nothing else in Phase 2 — not the taxonomy, not a
       course appearing in the UI, not extraction confidence, not model
       prose — can put a kind in this set. Adding one is a manifest edit
       that the negative-control suite immediately demands a control for.
       ------------------------------------------------------------------ */
    /**
     * Which subject, if any, declares each of these problem types.
     *
     * The taxonomy names problem types; this file decides what may be done
     * about them. Keeping the lookup here rather than letting the taxonomy
     * reader interpret the manifest is the same boundary Release A drew: a
     * node existing in the tree must never be able to imply a capability.
     * Unmatched types map to null, which the caller reports as unknown — not
     * as unsupported, because those are different sentences.
     *
     * @param string[] $types
     * @return array<string, array|null>
     */
    public static function subjectsForProblemTypes(array $types): array
    {
        $out = [];
        foreach ($types as $t) {
            $out[$t] = null;
            foreach (self::manifest()['subjects'] as $s) {
                if (in_array($t, $s['problem_types'] ?? [], true)) { $out[$t] = $s; break; }
            }
        }
        return $out;
    }

    public static function certifyingKinds(): array
    {
        $out = [];
        foreach (self::manifest()['kinds'] as $k) {
            if (($k['authority'] ?? 'advisory') !== 'advisory') $out[] = $k['kind'];
        }
        return $out;
    }

    /* Corroborating kinds belong in the receipt and DISPUTE when they fail, but
       their passing establishes nothing about whether the answer is right —
       "the question is well posed" is true of a wrong answer too. Read from the
       manifest so the set is never written by hand; index.html gets the same
       fact as PROOF[kind] === 2, emitted by tools/gen-capabilities.js. */
    public static function corroboratingKinds(): array
    {
        $out = [];
        foreach (self::manifest()['kinds'] as $k) {
            if (($k['authority'] ?? '') === 'corroborating') $out[] = $k['kind'];
        }
        return $out;
    }
}
