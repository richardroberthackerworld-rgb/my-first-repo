<?php
/* ============================================================
   7Solve — ANSWER GRADING
   ------------------------------------------------------------
   §9 of the spec: a student submits a question and their own
   answer, and gets back correct/incorrect, marks, and what went
   wrong.

   WHY THIS IS A DIFFERENT PRODUCT FROM /v1/verify
   -----------------------------------------------
   /v1/verify asks "is this AI's answer right?". This asks "is
   this STUDENT's answer right?" — a different buyer entirely.
   Schools and coaching centres pay for marking; nobody pays to
   audit their own chatbot.

   WHY IT IS DETERMINISTIC
   -----------------------
   The two halves are already built. Solver::solve produces the
   true roots; Checks::claimedRoots reads the student's. Grading
   is then set comparison, which means the mark comes with a
   PROOF rather than an opinion — and costs nothing per call.

   Crucially it reads the student's answer with exactly the same
   reader the verifier uses. Marking someone against a different
   parse of their own writing than the one the rest of the system
   uses is how a grader becomes unfair without anyone noticing.

   THE MARK THAT MATTERS
   ---------------------
   Not right-or-wrong: INCOMPLETE. A student who writes x = 2 for
   x² − 4 = 0 has done real work and missed a root, and every
   teacher marks that differently from a student who wrote x = 5.
   A grader that cannot tell those apart is not worth running.
   ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/solver.php';

final class Grader
{
    /* Two roots count as the same answer when they agree to within this.
       Loose enough for a student who rounded 2.6274607 to 2.63; tight enough
       that 2.6 and 2.7 stay different answers. */
    private const SAME = 5e-3;

    private static function near(float $a, float $b): bool
    {
        return abs($a - $b) <= max(1.0, abs($a), abs($b)) * self::SAME;
    }

    private static function tidy(float $n): float
    {
        return round($n, 6);
    }

    /* $penalty is how much of a mark each WRONG value costs, as a fraction of
       one root's worth. The default is 0 — credit for what is right, no
       deduction for what is not — because that is the common school scheme and
       because over-penalising is the more damaging error in a product a
       student sees. An earlier version hard-coded a full mark's deduction, and
       a student who found one of two roots and added a wrong one scored zero,
       which no teacher would give. Set it to 0.5 or 1.0 for negative marking
       (JEE, NEET) where that is genuinely the rule. */
    public static function check(string $question, string $studentAnswer,
                                 float $maxMarks = 1.0, float $penalty = 0.0): array
    {
        $q = Checks::deLatex($question);
        $a = Checks::deLatex($studentAnswer);

        $found = Checks::findEquation($q);
        if ($found === null) {
            return self::unmarkable('No equation could be read from the question, so there is nothing to mark against.');
        }
        $eq = $found['eq'];
        if (count($eq['vars']) !== 1) {
            return self::unmarkable('This grader marks one-variable equations; that question has ' . count($eq['vars']) . '.');
        }
        $v = $eq['vars'][0];

        /* The true answer, computed rather than assumed. */
        $truth = Solver::solve(trim($found['src']));
        if (($truth['status'] ?? '') !== 'SOLVED' || !isset($truth['roots']) || !count($truth['roots'])) {
            /* No real roots to compare against — a complex-root question, or
               something the solver declines. Marking on a truth we do not have
               would be guessing at a student's expense. */
            return self::unmarkable(
                ($truth['status'] ?? 'UNSUPPORTED') === 'SOLVED'
                    ? 'The equation has no real roots, so a numeric answer cannot be marked this way.'
                    : 'The equation could not be solved deterministically, so there is no truth to mark against.'
            );
        }
        $expected = array_map([self::class, 'tidy'], $truth['roots']);

        /* The student's claims, read with the SAME reader the verifier uses. */
        $given = array_map([self::class, 'tidy'], Checks::claimedRoots($a, $v));
        if (!count($given)) {
            return self::unmarkable('No value for ' . $v . ' could be read from the answer. Write it as "' . $v . ' = ...".');
        }

        /* ---- the comparison ---- */
        $correct = [];      // student values that are genuinely roots
        $wrong   = [];      // student values that are not
        foreach ($given as $g) {
            $hit = false;
            foreach ($expected as $e) if (self::near($g, $e)) { $hit = true; break; }
            if ($hit) $correct[] = $g; else $wrong[] = $g;
        }
        $missed = [];
        foreach ($expected as $e) {
            $hit = false;
            foreach ($given as $g) if (self::near($g, $e)) { $hit = true; break; }
            if (!$hit) $missed[] = $e;
        }

        /* ---- the verdict ---- */
        $mistakes = [];
        foreach ($wrong as $w) {
            $env = [$v => $w];
            $l = Algebra::round6(Algebra::evalAt($eq['L'], $env));
            $r = Algebra::round6(Algebra::evalAt($eq['R'], $env));
            $mistakes[] = [
                'type' => 'wrong_value',
                'text' => $v . ' = ' . $w . ' is not a solution: it gives ' . $l . ' ≠ ' . $r
                        . ' in ' . trim($found['src']),
            ];
        }
        foreach ($missed as $m) {
            $mistakes[] = [
                'type' => 'missing_root',
                'text' => $v . ' = ' . $m . ' is also a solution and was not given',
            ];
        }

        if (count($wrong)) {
            $verdict = count($correct) ? 'PARTIAL' : 'INCORRECT';
        } elseif (count($missed)) {
            $verdict = 'INCOMPLETE';
        } else {
            $verdict = 'CORRECT';
        }

        /* Marks track the roots actually found. Never below zero — a student
           cannot owe marks — and never above the maximum. */
        $total = count($expected);
        $earned = $total > 0
            ? (count($correct) - $penalty * count($wrong)) / $total
            : 0.0;
        $marks = max(0.0, min(1.0, $earned)) * $maxMarks;

        return [
            'status'   => $verdict,
            'marks'    => round($marks, 2),
            'out_of'   => round($maxMarks, 2),
            'variable' => $v,
            'equation' => trim($found['src']),
            'expected' => $expected,
            'given'    => $given,
            'mistakes' => $mistakes,
            'feedback' => self::feedback($verdict, $v, count($correct), count($wrong), count($missed)),
            'scheme'   => ['penalty_per_wrong' => $penalty, 'roots_expected' => $total],
            'deterministic' => true,
            /* Say how the truth was obtained. A numeric solve may itself be
               incomplete, and a mark derived from an incomplete truth must not
               be presented as final. */
            'truth_method'   => $truth['method'] ?? null,
            'truth_complete' => $truth['complete'] ?? null,
        ];
    }

    private static function feedback(string $verdict, string $v, int $ok, int $bad, int $miss): string
    {
        switch ($verdict) {
            case 'CORRECT':
                return 'Correct, and complete — every solution is there.';
            case 'INCOMPLETE':
                return 'Every value given is right, but ' . $miss . ' more '
                     . ($miss === 1 ? 'solution was' : 'solutions were')
                     . ' missed. Check whether the equation has other roots before finishing.';
            case 'PARTIAL':
                return $ok . ' of the values given ' . ($ok === 1 ? 'is' : 'are') . ' right and '
                     . $bad . ' ' . ($bad === 1 ? 'is' : 'are') . ' not. Substitute each answer back '
                     . 'into the original equation — that catches this before you hand it in.';
            default:
                return 'None of the values given satisfy the equation. Substituting '
                     . $v . ' back into the original is the quickest way to see it.';
        }
    }

    private static function unmarkable(string $why): array
    {
        /* UNMARKABLE is not a zero. A student must never lose marks because
           the grader could not read the question. */
        return [
            'status'   => 'UNMARKABLE',
            'marks'    => null,
            'reason'   => $why,
            'feedback' => 'This answer needs a human. It was not marked, and no marks were lost.',
            'deterministic' => true,
        ];
    }
}
