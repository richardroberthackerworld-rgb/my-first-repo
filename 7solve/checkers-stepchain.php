<?php
/* ============================================================
   7Solve — THE DERIVATION CHAIN (PHP side)
   ------------------------------------------------------------
   The PHP twin of stepChain() in index.html. Ported, not
   reinvented, because parity is tested by running both engines
   over one corpus and comparing what they emit.

   Every other checker judges the ANSWER. This one walks the
   working line by line and asks, at each step: does this follow
   from the one before it?

   The error it is built for is the commonest in school algebra
   and one a model reproduces faithfully:

       2x^2 = 6x
       2x   = 6        <- divided by x
       x    = 3

   Every line after the division is true. x = 3 substitutes back
   perfectly, so substitution passes it, and x = 0 — a real
   solution of the question — has silently disappeared. The step
   that lost it is step 2, and until now nothing said so.

   THE TEST. Two consecutive equations are compared by their
   SOLUTION SETS, not their text. A step may legitimately GAIN
   solutions — squaring does — but may never LOSE one. The first
   line where a root disappears is the first line that is wrong,
   and the ones after it are downstream, so only the first is
   reported.

   DECLINED: more than one variable, and anything whose residual
   this engine cannot find the roots of exactly. A case split is
   not an error, so a root the answer states somewhere is never
   reported as lost.

   CORROBORATING, never certifying: that the steps follow from
   one another says nothing about whether the answer is right.
   ============================================================ */
declare(strict_types=1);

final class StepChain
{
    private const CASE_SPLIT = '/\b(case|cases|either|otherwise|separately|split|if\s+[a-z]\s*=\s*0)\b/iu';

    /** @return array{real:array,complex:int}|null */
    private static function rootsOfResidual(array $L, array $R, string $v): ?array
    {
        $eq = ['L' => ['t' => 'b', 'op' => '-', 'a' => $L, 'b' => $R],
               'R' => ['t' => 'n', 'v' => 0.0],
               'vars' => [$v]];
        return Checks::realRootsOf($eq, $v);
    }

    private static function show(float $n): string
    {
        $r = round($n, 6);
        $s = (abs($r - round($r)) < 1e-9) ? (string)(int)round($r) : (string)$r;
        return str_replace('-', '−', $s);
    }

    public static function check(string $question, string $md): array
    {
        $q = Checks::findEquation($question);
        if ($q === null || count($q['eq']['vars']) !== 1) return [];
        $v = $q['eq']['vars'][0];
        if (Algebra::hasTrig($q['eq']['L']) || Algebra::hasTrig($q['eq']['R'])) return [];

        $zone = Checks::withHead($md, '📖');
        if ($zone === '') $zone = Checks::withHead($md, '📝');
        if ($zone === '') $zone = $md;

        $chain = [['step' => 0, 'src' => trim((string)$q['src']), 'eq' => $q['eq']]];
        $step = 0;
        foreach (preg_split('/\r?\n/u', $zone) as $line) {
            if (count($chain) >= 14) break;
            if (preg_match('/^\s*(\d+)\s*[.)]\s/u', $line, $sm)) $step = (int)$sm[1];
            if (strpos($line, '=') === false) continue;
            $fe = Checks::findEquation(preg_replace('/\*\*|__/u', '', $line));
            if ($fe === null || count($fe['eq']['vars']) !== 1 || $fe['eq']['vars'][0] !== $v) continue;
            if (Algebra::hasTrig($fe['eq']['L']) || Algebra::hasTrig($fe['eq']['R'])) continue;
            /* "x = 3" is the ANSWER, not a link in the derivation. Letting it
               into the chain made this report every root the answer did not
               list as "lost by the last step", which is solutionCompleteness's
               verdict under a name that already exists. */
            $bareVal = (($fe['eq']['L']['t'] === 'v' && !count(Algebra::varsOf($fe['eq']['R']))) ||
                        ($fe['eq']['R']['t'] === 'v' && !count(Algebra::varsOf($fe['eq']['L']))));
            if ($bareVal) continue;
            $last = $chain[count($chain) - 1];
            if (trim((string)$fe['src']) === $last['src']) continue;      // the same line restated
            $chain[] = ['step' => $step, 'src' => trim((string)$fe['src']), 'eq' => $fe['eq']];
        }
        /* Two entries is one comparison, and one lost root is decisive. The
           asymmetry is deliberate: the pass below still refuses to call a
           single surviving link a sound derivation. */
        if (count($chain) < 2) return [];

        $stated = Checks::claimedRoots(Checks::claimZone($md), $v);
        $splits = (bool)preg_match(self::CASE_SPLIT, $zone);
        /* A root outside the domain the question set was never a solution to
           lose. The same reader every other check uses. */
        $sDom = Exhaustion::domainOf($question);

        $checked = 0;
        for ($k = 1; $k < count($chain); $k++) {
            $A = self::rootsOfResidual($chain[$k - 1]['eq']['L'], $chain[$k - 1]['eq']['R'], $v);
            $B = self::rootsOfResidual($chain[$k]['eq']['L'], $chain[$k]['eq']['R'], $v);
            if ($A === null || $B === null) continue;      // not reconstructable → no verdict
            $checked++;
            $lost = [];
            foreach ($A['real'] as $r) {
                if ($sDom !== null && Exhaustion::domainBreak($sDom, [$v], [$r]) !== null) continue;
                $keptLater = false;
                foreach ($B['real'] as $x) if (abs($x - $r) <= 1e-7 * max(1.0, abs($r))) { $keptLater = true; break; }
                if ($keptLater) continue;
                $inAnswer = false;
                foreach ($stated as $x) if (abs((float)$x - $r) <= 1e-7 * max(1.0, abs($r))) { $inAnswer = true; break; }
                if ($inAnswer) continue;
                $lost[] = $r;
            }
            if (!count($lost)) continue;
            if ($splits) continue;                          // the working said it was splitting cases
            $where = $chain[$k]['step'] ? 'step ' . $chain[$k]['step'] : 'the working';
            $names = implode(', ', array_map([self::class, 'show'], $lost));
            return [['kind' => 'step', 'ok' => false,
                'text' => 'the derivation breaks at ' . $where . ': going from ' . $chain[$k - 1]['src'] .
                          ' to ' . $chain[$k]['src'] . ' loses ' . $v . ' = ' . $names . ', which ' .
                          (count($lost) > 1 ? 'are solutions' : 'is a solution') .
                          ' of the line before it. Every step after this one is working on a smaller ' .
                          'problem than the question asked']];
        }
        if ($checked < 2) return [];
        return [['kind' => 'step', 'ok' => true,
            'text' => 'the derivation keeps its solution set across all ' . $checked .
                      ' steps that could be checked — no root is lost between one line and the next ' .
                      '(this says the working is sound, not that the answer is right)']];
    }
}
