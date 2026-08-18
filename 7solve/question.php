<?php
/* ============================================================
   7Solve — QUESTION VALIDITY
   ------------------------------------------------------------
   Every other checker in this codebase asks "is the ANSWER
   right?". This one asks the question that comes before it:
   DOES THIS PROBLEM HAVE AN ANSWER AT ALL?

   That layer did not exist, and its absence produced a failure
   worth naming. For the constraint problem

     N < 1000, N ≡ 1 (mod 2), 2 (mod 3), 4 (mod 5),
               6 (mod 7), 10 (mod 11)

   three different replies — the correct "no such N exists",
   an out-of-range N = 2309, and a fabricated N = 209 — all
   received the SAME verdict, because the engine had nothing to
   say about the problem itself. The smallest solution is 2309,
   so the question is impossible as posed; a solver that answers
   it with a number is wrong, and a solver that says "no
   solution" is right. Nothing in the system could tell those
   apart.

   WHAT THIS DOES, AND WHAT IT REFUSES TO DO
   -----------------------------------------
   It handles one class properly rather than all classes badly:
   integer constraint problems — remainders, divisibility, and
   range bounds — decided by bounded enumeration. Enumeration is
   used deliberately in place of CRT: it needs no coprimality
   assumption, it finds EVERY solution in range rather than one,
   and it cannot be wrong about a question it can read.

   Everything it cannot read, it says nothing about. A validity
   checker that guesses would be worse than none, because
   "this question is impossible" is a much heavier claim than
   "this answer looks wrong".
   ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/verify.php';

final class QuestionCheck
{
    /* Enumeration ceiling. Beyond this we decline rather than
       report a false "no solution" from having stopped early —
       the distinction between "none exist" and "I stopped
       looking" is the whole point of this file. */
    private const MAX_SCAN = 2000000;

    /* "leaves remainder 1 when divided by 2", "N ≡ 1 (mod 2)",
       "N mod 2 = 1", "remainder 1 on division by 2" */
    public static function congruences(string $q): array
    {
        $s = Checks::deLatex($q);
        $out = [];
        $push = function (int $m, int $r) use (&$out) {
            if ($m > 1) $out[$m . ':' . $r] = ['mod' => $m, 'rem' => $r];
        };

        $re = [
            '/remainder\s+(\d+)\s+(?:when|on|upon)?\s*(?:it\s+is\s+)?divided\s+by\s+(\d+)/iu' => [1, 2],
            '/remainder\s+(\d+)\s+on\s+division\s+by\s+(\d+)/iu'                              => [1, 2],
            '/≡\s*(-?\d+)\s*\(?\s*mod\s*(\d+)\s*\)?/iu'                                        => [1, 2],
            '/\bmod\s*(\d+)\s*(?:=|is)\s*(\d+)/iu'                                             => [2, 1],
            /* The reverse phrasing must not cross a clause. Allowing commas
               here let "divided by 2, remainder 2 when divided by 3" match as
               (mod 2, rem 2), inventing four constraints that were never
               written. It reached the right verdict on this question for the
               wrong reason — and on a SOLVABLE question the same invention
               would have produced a false "no solution", which is the heaviest
               false claim this file can make. */
            '/divided\s+by\s+(\d+)\s+(?:it\s+)?(?:leaves|gives|has)\s+(?:a\s+)?remainder(?:\s+of)?\s+(\d+)/iu' => [2, 1],
        ];
        foreach ($re as $pat => $ord) {
            if (!preg_match_all($pat, $s, $ms, PREG_SET_ORDER)) continue;
            foreach ($ms as $m) {
                $r = (int)$m[$ord[0]];
                $mod = (int)$m[$ord[1]];
                if ($mod <= 1) continue;
                /* A negative or oversized residue is normalised, so
                   "N ≡ -1 (mod 5)" and "remainder 4" are one constraint. */
                $push($mod, (($r % $mod) + $mod) % $mod);
            }
        }
        return array_values($out);
    }

    /* Range bounds: "N < 1000", "less than 1000", "between 1 and 500",
       "at most 200", "three-digit". Returns [lo, hi] inclusive. */
    public static function bounds(string $q): array
    {
        $s = Checks::deLatex($q);
        $lo = 1;                       // "positive integer" unless told otherwise
        $hi = null;

        if (preg_match('/\b[A-Za-z]\s*<\s*(\d[\d,]*)/u', $s, $m))            $hi = (int)str_replace(',', '', $m[1]) - 1;
        if (preg_match('/\b[A-Za-z]\s*(?:≤|<=)\s*(\d[\d,]*)/u', $s, $m))     $hi = (int)str_replace(',', '', $m[1]);
        if (preg_match('/less\s+than\s+(\d[\d,]*)/iu', $s, $m))              $hi = (int)str_replace(',', '', $m[1]) - 1;
        if (preg_match('/(?:at\s+most|no\s+more\s+than|up\s+to)\s+(\d[\d,]*)/iu', $s, $m)) $hi = (int)str_replace(',', '', $m[1]);
        if (preg_match('/\b[A-Za-z]\s*>\s*(\d[\d,]*)/u', $s, $m))            $lo = max($lo, (int)str_replace(',', '', $m[1]) + 1);
        if (preg_match('/(?:at\s+least|no\s+less\s+than)\s+(\d[\d,]*)/iu', $s, $m)) $lo = max($lo, (int)str_replace(',', '', $m[1]));
        if (preg_match('/between\s+(\d[\d,]*)\s+and\s+(\d[\d,]*)/iu', $s, $m)) {
            $lo = max($lo, (int)str_replace(',', '', $m[1]));
            $hi = (int)str_replace(',', '', $m[2]);
        }
        if (preg_match('/\bthree[-\s]digit\b/iu', $s)) { $lo = max($lo, 100); $hi = $hi ?? 999; }
        if (preg_match('/\btwo[-\s]digit\b/iu', $s))   { $lo = max($lo, 10);  $hi = $hi ?? 99; }

        if (preg_match('/\bnegative\s+integer\b/iu', $s)) $lo = PHP_INT_MIN;   // out of scope; see solve()
        return [$lo, $hi];
    }

    /* Every solution in range, by enumeration. */
    public static function solve(string $q): ?array
    {
        $cons = self::congruences($q);
        if (count($cons) < 2) return null;              // not a constraint problem we can read

        /* Two different remainders for the same modulus is either a genuinely
           contradictory question or — far more likely — a misparse. Declaring
           a question impossible on the strength of our own bad reading is the
           worst outcome available here, so we decline instead. Silence costs
           a check; a false "this question has no answer" costs the student
           their trust in every verdict we give. */
        $byMod = [];
        foreach ($cons as $c) {
            if (isset($byMod[$c['mod']]) && $byMod[$c['mod']] !== $c['rem']) return null;
            $byMod[$c['mod']] = $c['rem'];
        }
        list($lo, $hi) = self::bounds($q);
        if ($hi === null || $lo < 1) return null;       // unbounded → cannot enumerate honestly
        if ($hi < $lo) return null;
        if ($hi - $lo > self::MAX_SCAN) return null;    // decline rather than stop early

        $sols = [];
        for ($n = $lo; $n <= $hi; $n++) {
            $ok = true;
            foreach ($cons as $c) {
                if ($n % $c['mod'] !== $c['rem']) { $ok = false; break; }
            }
            if ($ok) { $sols[] = $n; if (count($sols) > 64) break; }
        }

        /* The smallest solution ignoring the upper bound, so the receipt can
           say WHY none fit rather than merely that none do. That sentence is
           the difference between a usable message and a dead end. */
        $firstAbove = null;
        if (!count($sols)) {
            $step = 1;
            foreach ($cons as $c) $step = self::lcm($step, $c['mod']);
            if ($step > 0 && $step <= self::MAX_SCAN) {
                for ($n = $lo; $n <= $lo + $step; $n++) {
                    $ok = true;
                    foreach ($cons as $c) if ($n % $c['mod'] !== $c['rem']) { $ok = false; break; }
                    if ($ok) { $firstAbove = $n; break; }
                }
            }
        }

        return ['constraints' => $cons, 'lo' => $lo, 'hi' => $hi,
                'solutions' => $sols, 'first_above' => $firstAbove];
    }

    private static function lcm(int $a, int $b): int
    {
        if ($a === 0 || $b === 0) return 0;
        $x = $a; $y = $b;
        while ($y !== 0) { $t = $x % $y; $x = $y; $y = $t; }
        return intdiv($a, $x) * $b;
    }

    /* Does the answer claim there is no solution? A correct reply to an
       impossible question says so in words, not numbers, and an engine that
       only understands numbers marks the one right answer wrong. */
    private static function claimsNoSolution(string $md): bool
    {
        $zone = Checks::claimZone(Checks::deLatex($md));
        return (bool)preg_match(
            '/\b(no\s+(?:such|positive\s+integer|integer|solution|value|number)|'
          . 'does\s+not\s+exist|there\s+is\s+no\b|none\s+exist|impossible|'
          . 'no\s+valid\b|cannot\s+be\s+satisfied)\b/iu', $zone);
    }

    /* The verdict. Returns [] — silence — for everything it cannot read. */
    public static function check(string $question, string $answer): array
    {
        $r = self::solve($question);
        if ($r === null) return [];

        $span = 'in ' . $r['lo'] . '–' . $r['hi'];
        $conds = [];
        foreach ($r['constraints'] as $c) $conds[] = 'mod ' . $c['mod'] . ' → ' . $c['rem'];
        $condText = implode(', ', $conds);

        /* ---- the question has NO solution ---- */
        if (!count($r['solutions'])) {
            $why = 'no integer ' . $span . ' satisfies ' . $condText;
            if ($r['first_above'] !== null) {
                $why .= '; the smallest that does is ' . $r['first_above']
                      . ', which is outside the range the question allows';
            }
            if (self::claimsNoSolution($answer)) {
                /* The answer is RIGHT. The question is what is broken, and
                   saying so is the correct outcome — not a failure. */
                return [['kind' => 'question', 'ok' => true, 'invalid_question' => true,
                         'text' => 'the question has no solution — ' . $why
                                 . ' — and the answer says so, which is correct']];
            }
            return [['kind' => 'question', 'ok' => false, 'invalid_question' => true,
                     'text' => 'this question has no answer: ' . $why
                             . ', so any number given as the answer cannot be right']];
        }

        /* ---- it has solutions; is the claimed one among them? ---- */
        if (self::claimsNoSolution($answer)) {
            return [['kind' => 'question', 'ok' => false,
                     'text' => 'the answer says no solution exists, but ' . $r['solutions'][0]
                             . ' satisfies ' . $condText . ' ' . $span]];
        }

        $zone = Checks::claimZone(Checks::deLatex($answer));
        if (!preg_match_all('/-?\d[\d,]*/u', $zone, $ms)) return [];
        $claimed = null;
        foreach ($ms[0] as $n) {
            $v = (int)str_replace(',', '', $n);
            if ($v >= $r['lo'] - 1 || in_array($v, $r['solutions'], true)) { $claimed = $v; break; }
        }
        if ($claimed === null) return [];

        $wantsLargest  = (bool)preg_match('/\b(largest|greatest|maximum|biggest)\b/iu', $question);
        $wantsSmallest = (bool)preg_match('/\b(smallest|least|minimum)\b/iu', $question);
        $target = $wantsLargest ? max($r['solutions'])
                : ($wantsSmallest ? min($r['solutions']) : null);

        if (!in_array($claimed, $r['solutions'], true)) {
            $out = $claimed . ' does not satisfy ' . $condText;
            if ($claimed > $r['hi'] || $claimed < $r['lo']) {
                $out = $claimed . ' is outside the range the question allows (' . $span . ')';
            }
            return [['kind' => 'question', 'ok' => false, 'text' => $out]];
        }
        if ($target !== null && $claimed !== $target) {
            return [['kind' => 'question', 'ok' => false,
                     'text' => $claimed . ' satisfies every condition, but the question asks for the '
                             . ($wantsLargest ? 'largest' : 'smallest') . ' and that is ' . $target]];
        }
        return [['kind' => 'question', 'ok' => true,
                 'text' => $claimed . ' satisfies ' . $condText . ' ' . $span
                         . ($target !== null ? ' and is the ' . ($wantsLargest ? 'largest' : 'smallest')
                            . ' such value' : '')]];
    }
}
