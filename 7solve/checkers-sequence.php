<?php
/* ============================================================
   7Solve — SEQUENCE IDENTIFICATION (PHP side)
   ------------------------------------------------------------
   The PHP twin of sequenceCheck() in index.html. Ported, not
   reinvented — same patterns, same recurrences, same wording,
   because parity is tested by running both engines over one
   corpus and comparing what they emit.

   "This is the Fibonacci sequence" is a mathematical claim and
   neither engine used to check it. The case that matters is not
   a near miss but a real trap:

       1, 1, 2, 5, 13, 34, …

   Every one of those IS a Fibonacci number. They are F₁, F₃, F₅,
   F₇ — every OTHER one — and they satisfy a_n = 3a_(n−1) − a_(n−2),
   not a_n = a_(n−1) + a_(n−2). An answer calling them "the
   Fibonacci sequence" has the indexing wrong and predicts the
   wrong next term. The Markov equation x² + y² + z² = 3xyz
   produces exactly that sequence, so this is not contrived.
   ============================================================ */
declare(strict_types=1);

final class SequenceId
{
    private const SEQ_CLAIM =
        '/\b(fibonacci|lucas\s+(?:sequence|numbers?)|arithmetic\s+(?:progression|sequence|series)|'
      . 'geometric\s+(?:progression|sequence|series)|triangular\s+numbers?|(?:perfect\s+)?square\s+numbers?)\b/iu';

    /** The longest run of four or more integers written as a list. */
    private static function numberRun(string $text): ?array
    {
        if (!preg_match_all('/(-?\d{1,12})(?:\s*,\s*(?:-?\d{1,12}))+/u', $text, $ms)) return null;
        $best = null;
        foreach ($ms[0] as $hit) {
            $xs = array_map(static fn($t) => (int)trim($t), explode(',', $hit));
            if (count($xs) < 4) continue;
            if ($best === null || count($xs) > count($best)) $best = $xs;
        }
        return $best;
    }

    private static function fibsUpTo(int $n): array
    {
        $out = [1, 1];
        $i = 2;
        while ($out[$i - 1] + $out[$i - 2] <= $n && count($out) < 90) {
            $out[] = $out[$i - 1] + $out[$i - 2];
            $i++;
        }
        return $out;
    }

    private static function holdsRec(array $xs, callable $f): bool
    {
        for ($i = 2; $i < count($xs); $i++) if ($xs[$i] !== $f($xs[$i - 1], $xs[$i - 2])) return false;
        return true;
    }

    public static function check(string $question, string $md): array
    {
        $s = Checks::deLatex($md);
        if (!preg_match(self::SEQ_CLAIM, $s, $m)) return [];
        $named = mb_strtolower($m[0], 'UTF-8');
        $xs = self::numberRun($s);
        if ($xs === null) $xs = self::numberRun($question);
        if ($xs === null || count($xs) < 4) return [];    // nothing to test the claim against
        $list = implode(', ', $xs);

        /* --- the two-term additive family --- */
        if (preg_match('/fibonacci|lucas/u', $named)) {
            if (self::holdsRec($xs, static fn(int $a, int $b): int => $a + $b)) {
                return [['kind' => 'sequence', 'ok' => true,
                    'text' => 'the terms ' . $list . ' really do satisfy a(n) = a(n−1) + a(n−2), '
                            . 'so the sequence is identified correctly']];
            }
            $fibs = self::fibsUpTo(max(array_map('abs', $xs)));
            $allFib = true;
            foreach ($xs as $x) if (!in_array($x, $fibs, true)) { $allFib = false; break; }
            if ($allFib && self::holdsRec($xs, static fn(int $a, int $b): int => 3 * $a - $b)) {
                return [['kind' => 'sequence', 'ok' => false,
                    'text' => 'every term of ' . $list . ' is a Fibonacci number, but they are every '
                            . 'OTHER one — F₁, F₃, F₅, F₇ — and they satisfy a(n) = 3a(n−1) − a(n−2), not '
                            . 'a(n) = a(n−1) + a(n−2). Calling this "the Fibonacci sequence" gets the indexing '
                            . 'wrong, and the next term with it']];
            }
            if ($allFib) {
                return [['kind' => 'sequence', 'ok' => false,
                    'text' => 'the terms ' . $list . ' are all Fibonacci numbers but are not consecutive '
                            . 'ones — they do not satisfy a(n) = a(n−1) + a(n−2), so naming the sequence '
                            . 'Fibonacci without saying which terms are meant is not an identification']];
            }
            return [['kind' => 'sequence', 'ok' => false,
                'text' => 'the terms ' . $list . ' do not satisfy a(n) = a(n−1) + a(n−2), so this is '
                        . 'not the sequence the answer names']];
        }

        /* --- arithmetic --- */
        if (preg_match('/arithmetic/u', $named)) {
            $d = $xs[1] - $xs[0];
            $ok = true;
            for ($i = 1; $i < count($xs); $i++) if ($xs[$i] - $xs[$i - 1] !== $d) $ok = false;
            return [['kind' => 'sequence', 'ok' => $ok,
                'text' => $ok
                    ? 'the terms ' . $list . ' have a constant difference of ' . $d
                      . ', so the progression is arithmetic as the answer says'
                    : 'the terms ' . $list . ' do not have a constant difference, so the '
                      . 'progression is not arithmetic']];
        }

        /* --- geometric: compared by cross-multiplication, never by dividing --- */
        if (preg_match('/geometric/u', $named)) {
            $ok = true;
            for ($j = 1; $j < count($xs) - 1; $j++) {
                if ($xs[$j] * $xs[$j] !== $xs[$j - 1] * $xs[$j + 1]) $ok = false;
            }
            if (in_array(0, $xs, true)) $ok = false;
            return [['kind' => 'sequence', 'ok' => $ok,
                'text' => $ok
                    ? 'the terms ' . $list . ' satisfy a(n)² = a(n−1)·a(n+1) throughout, so the '
                      . 'progression is geometric as the answer says'
                    : 'the terms ' . $list . ' do not have a constant ratio, so the progression '
                      . 'is not geometric']];
        }

        /* --- triangular and square --- */
        $isTri = (bool)preg_match('/triangular/u', $named);
        $name  = $isTri ? 'triangular' : 'square';
        $of = static function (int $k) use ($isTri): int { return $isTri ? intdiv($k * ($k + 1), 2) : $k * $k; };
        $idx = [];
        foreach ($xs as $x) {
            $k = 1; $hit = -1;
            while ($of($k) <= $x && $k < 100000) { if ($of($k) === $x) { $hit = $k; break; } $k++; }
            $idx[] = $hit;
        }
        $ok = true;
        foreach ($idx as $k) if ($k <= 0) $ok = false;
        if ($ok) for ($u = 1; $u < count($idx); $u++) if ($idx[$u] !== $idx[$u - 1] + 1) $ok = false;
        return [['kind' => 'sequence', 'ok' => $ok,
            'text' => $ok
                ? 'the terms ' . $list . ' are the consecutive ' . $name . ' numbers the answer names'
                : 'the terms ' . $list . ' are not the consecutive ' . $name . ' numbers the answer names']];
    }
}
