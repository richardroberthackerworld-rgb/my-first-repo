<?php
/* ============================================================
   7Solve — BAND B, PART 2 (PHP side)
   ------------------------------------------------------------
   The last three checkers that could certify on the website and
   not through /v1:

     transformCheck   does a stated map send solutions to
                      solutions
     uniqueness       is the single value offered really the
                      only one
     extremumCheck    is the claimed maximum/minimum actually
                      the extreme value over the feasible set

   Same rule as part 1: ported, not reinvented. Every sweep
   range, cap, tolerance and bail-out is the one in index.html,
   because parity is tested by running both engines over the
   same corpus and comparing check kinds.

   ON extremumCheck AND COST. It sweeps 40,000 coarse points and
   4,000 fine ones. That is a browser-idle-CPU design, and the
   worry was that it would be a timeout risk in a request. It was
   measured rather than assumed: this PHP build evaluates ~225k
   expression nodes a second, so the sweep costs on the order of
   0.2–0.5s. Acceptable, and the reason it ships. If a future
   host is slower the honest move is to report the subject as
   not_supported_by_api, never to thin the sweep — a sparser scan
   silently finds a worse extreme and would certify a wrong
   answer as correct.
   ============================================================ */
declare(strict_types=1);

final class BandB2
{
    /* ---------- transformCheck ---------- */

    private const ARROW = '(?:->|-->|→|⟶|↦|\\\\rightarrow|\\\\to|\bmaps to\b|\bgoes to\b)';

    /** Every integer solution of a two-variable equation in a box. */
    private static function integerSolutions(array $eq, int $limit, int $cap): array
    {
        $vars = $eq['vars'] ?? [];
        if (count($vars) !== 2) return [];
        $found = [];
        for ($a = -$limit; $a <= $limit; $a++) {
            for ($b = -$limit; $b <= $limit; $b++) {
                $env = [$vars[0] => (float)$a, $vars[1] => (float)$b];
                if (Algebra::holdsAt($eq, $env) === true) {
                    $found[] = [$a, $b];
                    if (count($found) >= $cap) return $found;
                }
            }
        }
        return $found;
    }

    public static function transformCheck(string $question, string $md): array
    {
        $qe = Checks::findEquation($question);
        if ($qe === null) $qe = Checks::findEquation($md);
        if ($qe === null || count($qe['eq']['vars'] ?? []) !== 2) return [];
        if (Algebra::hasTrig($qe['eq']['L']) || Algebra::hasTrig($qe['eq']['R'])) return [];

        /* "(x, y) → (3y - x, x)" */
        $re = '/\(\s*([a-z])\s*,\s*([a-z])\s*\)\s*' . self::ARROW . '\s*\(([^()]{1,40}),([^()]{1,40})\)/iu';
        if (!preg_match_all($re, $md, $ms, PREG_SET_ORDER)) return [];

        $checks = [];
        foreach ($ms as $m) {
            if (count($checks) >= 2) break;
            $v1 = strtolower($m[1]); $v2 = strtolower($m[2]);
            $f1 = Algebra::parse($m[3]); $f2 = Algebra::parse($m[4]);
            if ($f1 === null || $f2 === null) continue;
            /* the map must be written in the same variables as the equation */
            $have = [$v1 => 1, $v2 => 1];
            $allHave = true;
            foreach ($qe['eq']['vars'] as $v) if (!isset($have[$v])) { $allHave = false; break; }
            if (!$allHave) continue;

            $sols = self::integerSolutions($qe['eq'], 60, 40);
            if (count($sols) < 2) continue;              // nothing to test against → no verdict

            /* Test the positive solutions first. The counterexample a student is
               shown should live in the same world as their question — "from
               (1,2) it gives (5,1)" teaches something; "from (−34,−13)" reads
               like a technicality even though it is equally fatal. */
            usort($sols, static function ($a, $b) {
                $pa = ($a[0] > 0 && $a[1] > 0) ? 0 : 1;
                $pb = ($b[0] > 0 && $b[1] > 0) ? 0 : 1;
                if ($pa !== $pb) return $pa - $pb;
                return (abs($a[0]) + abs($a[1])) - (abs($b[0]) + abs($b[1]));
            });

            $bad = null; $tested = 0;
            for ($i = 0; $i < count($sols) && $bad === null; $i++) {
                $cur = $sols[$i];
                for ($step = 0; $step < 3; $step++) {    // iterate: one hop can pass by luck
                    $env = [$v1 => (float)$cur[0], $v2 => (float)$cur[1]];
                    $n1 = Algebra::evalAt($f1, $env);
                    $n2 = Algebra::evalAt($f2, $env);
                    if (!is_finite($n1) || !is_finite($n2)) break;
                    $e2 = [$v1 => $n1, $v2 => $n2];
                    $tested++;
                    if (Algebra::holdsAt($qe['eq'], $e2) !== true) {
                        $bad = ['from' => $cur, 'to' => [$n1, $n2],
                                'lhs' => Algebra::evalAt($qe['eq']['L'], $e2),
                                'rhs' => Algebra::evalAt($qe['eq']['R'], $e2)];
                        break;
                    }
                    $cur = [$n1, $n2];
                }
            }
            $mapTxt = '(' . $v1 . ',' . $v2 . ') → (' . trim($m[3]) . ', ' . trim($m[4]) . ')';
            $checks[] = $bad !== null
                ? ['kind' => 'transform', 'ok' => false,
                   'text' => 'the transformation ' . $mapTxt . ' does NOT preserve ' . trim($qe['src']) .
                             ' — from (' . implode(',', $bad['from']) . ') it gives (' .
                             implode(',', $bad['to']) . '), where ' . Algebra::round6($bad['lhs']) .
                             ' ≠ ' . Algebra::round6($bad['rhs'])]
                : ['kind' => 'transform', 'ok' => true,
                   'text' => 'the transformation ' . $mapTxt . ' maps solutions to solutions (' .
                             $tested . ' checked)'];
        }
        return $checks;
    }

    /* ---------- uniqueness ---------- */

    private const UNIQUE_RE =
        '/(?:the\s+only\s+(?:solution|value|answer|possibility)\s*(?:is|are)?\s*|' .
        'only\s+|unique\s+solution\s*(?:is)?\s*|no\s+other\s+(?:solution|value)s?\b[^.]*?)' .
        '([a-z])\s*=\s*(-?\d+)/i';

    private const ALL_ASKED =
        '/\bfind all\b|\ball (?:the )?(?:integers?|values?|solutions?|pairs?|n)\b|\bfor which\b|\bdetermine all\b|\bhow many\b/i';

    public static function uniqueness(string $question, string $md): array
    {
        $m = null;
        if (preg_match(self::UNIQUE_RE, $md, $mm)) $m = $mm;
        /* Also catch a bare "therefore n = 3" answering a "find all" question —
           the shape of the reported bug, where nothing said "only" out loud. */
        if ($m === null && preg_match(self::ALL_ASKED, $question)) {
            $ans = BandB::section($md, '✅');
            if ($ans === '') $ans = substr($md, 0, 400);
            /* only when the answer offers exactly ONE value */
            $n = preg_match_all('/\b[a-z]\s*=\s*-?\d+/i', $ans);
            if ($n === 1 && preg_match('/\b([a-z])\s*=\s*(-?\d+)\b/i', $ans, $fm)) $m = $fm;
        }
        if ($m === null) return [];
        $v = strtolower($m[1]); $val = (int)$m[2];

        /* What condition is being claimed unique? Prefer a divisibility the
           answer itself asserted and that we have verified holds broadly;
           otherwise an equation from the question. */
        $tests = [];
        foreach (BandB::checkDivisibility($md) as $c) {
            if (!empty($c['holdsForAll']) && ($c['variable'] ?? null) === $v && !empty($c['expr'])) {
                $expr = $c['expr'];
                $label = preg_replace('/^“/u', '', explode('”', $c['text'])[0]);
                $tests[] = ['label' => $label, 'fn' => static function (int $n) use ($expr, $v) {
                    $env = [$v => (float)$n];
                    $dv = Algebra::evalAt($expr['divisor']['ast'], $env);
                    $nv = Algebra::evalAt($expr['dividend']['ast'], $env);
                    if (!is_finite($dv) || !is_finite($nv) || abs($dv) < 1e-9) return null;
                    if (abs($dv - round($dv)) > 1e-6 || abs($nv - round($nv)) > 1e-6) return null;
                    $D = (int)round($dv); $N = (int)round($nv);
                    return ((($N % $D) + $D) % $D) === 0;
                }];
            }
        }
        if (!count($tests)) {
            $fe = Checks::findEquation($question);
            if ($fe !== null && count($fe['eq']['vars'] ?? []) === 1 && $fe['eq']['vars'][0] === $v
                && !Algebra::hasTrig($fe['eq']['L']) && !Algebra::hasTrig($fe['eq']['R'])) {
                $eq = $fe['eq'];
                $tests[] = ['label' => trim($fe['src']), 'fn' => static function (int $n) use ($eq, $v) {
                    return Algebra::holdsAt($eq, [$v => (float)$n]);
                }];
            }
        }
        if (!count($tests)) return [];                   // nothing testable → no verdict

        /* Sweep the positives first. A "find all positive integers" question
           deserves counterexamples a student recognises. Negatives are still
           swept, just second. */
        /* And the sweep stays inside the domain the question set. Sweeping 0
           and the negatives for a question that said "positive integers" turns
           the one correct answer into "it also holds for n = −2", which disputes
           a right reply — the same constraint blindness that let −2 be ACCEPTED
           as an answer, pointed the other way. Mirrors uniqueness() in
           index.html. */
        $uDom = Exhaustion::domainOf($question);
        $order = [];
        for ($n = 1; $n <= 120; $n++) $order[] = $n;
        $order[] = 0;
        for ($n = -1; $n >= -30; $n--) $order[] = $n;
        /* Filtered through domainBreak rather than through a lower bound written
           out again here. A prime question is the case that showed why: its
           bound is 2, but 4 is inside that bound and is still not a candidate,
           and a sweep offering "it also holds for n = 4" against a question
           about primes disputes a correct answer. Mirrors index.html. */
        if ($uDom !== null) {
            $order = array_values(array_filter($order, static function ($n) use ($uDom, $v) {
                return Exhaustion::domainBreak($uDom, [$v], [(float)$n]) === null;
            }));
        }

        $t = $tests[0]; $others = []; $checked = 0;
        foreach ($order as $n) {
            if ($n === $val) continue;
            $r = ($t['fn'])($n);
            if ($r === null) continue;
            $checked++;
            if ($r === true) { $others[] = $n; if (count($others) >= 6) break; }
        }
        /* Coverage matters in ONE direction only. Concluding "nothing else
           satisfies this" needs a decent sweep; finding something that does
           needs exactly one value, however early the loop stopped. */
        if (!count($others) && $checked < 10) return [];
        if (!count($others)) {
            return [['kind' => 'unique', 'ok' => true,
                'text' => 'no other value of ' . $v . ' between '
                        . str_replace('-', '−', (string)min($order))
                        . ' and 120 satisfies ' . $t['label']
                        . ($uDom !== null ? ', within the ' . $uDom['label'] . ' the question asked for' : '')]];
        }
        sort($others);
        $shown = array_slice($others, 0, 4);
        return [['kind' => 'unique', 'ok' => false,
            'text' => '“' . $v . ' = ' . $val . '” is presented as the answer, but ' . $t['label'] .
                      ' also holds for ' . $v . ' = ' . implode(', ', $shown) .
                      (count($others) > 4 ? ' and more' : '') . ' — so it is not the only solution']];
    }

    /* ---------- extremumCheck ---------- */

    private static function symmetricConstraints(string $q0): ?array
    {
        $txt = preg_replace('/\s+/u', '', $q0);
        $num = static function (string $re) use ($txt) {
            return preg_match($re, $txt, $m) ? (float)$m[1] : null;
        };
        $s  = $num('/x\+y\+z=(-?\d+(?:\.\d+)?)/i');
        $qq = $num('/(?:xy\+yz\+zx|xy\+xz\+yz|yz\+zx\+xy)=(-?\d+(?:\.\d+)?)/i');
        $p2 = $num('/(?:x²\+y²\+z²|x\^2\+y\^2\+z\^2)=(-?\d+(?:\.\d+)?)/iu');
        if ($s === null) return null;
        if ($qq === null && $p2 !== null) $qq = ($s * $s - $p2) / 2;   // the standard identity
        if ($qq === null) return null;
        return ['s' => $s, 'q' => $qq];
    }

    private static function objectiveOf(string $q0): ?array
    {
        $re = '/(?:maximi[sz]e|minimi[sz]e|maximum value of|minimum value of|largest value of|' .
              'smallest value of|greatest value of|least value of|maximum of|minimum of|maximum|minimum)' .
              '\s*:?\s*([^.,;?\n]{1,60})/i';
        if (!preg_match($re, $q0, $m)) return null;
        $words = preg_split('/\s+/', trim($m[1]));
        for ($n = count($words); $n > 0; $n--) {
            $cand = trim(preg_replace('/[.,;:]+$/', '', implode(' ', array_slice($words, 0, $n))));
            if ($cand === '') continue;
            $ast = Algebra::parse($cand);
            if ($ast === null) continue;
            $vs = array_keys(Algebra::varsOf($ast));
            if (!count($vs)) continue;
            $onlyXYZ = true;
            foreach ($vs as $v) if (strpos('xyz', $v) === false) { $onlyXYZ = false; break; }
            if (!$onlyXYZ) continue;
            return ['ast' => $ast, 'src' => $cand];
        }
        return null;
    }

    /* Given x, the other two of a symmetric triple are the roots of a quadratic. */
    private static function feasibleTriple(float $s, float $q, float $x): ?array
    {
        $sum = $s - $x;
        $prod = $q - $x * ($s - $x);
        $d = $sum * $sum - 4 * $prod;
        if ($d < 0) return null;
        $rt = sqrt($d);
        return [$x, ($sum - $rt) / 2, ($sum + $rt) / 2];
    }

    private static function claimedValue(string $md): ?float
    {
        $zone = Checks::claimZone($md);
        foreach (preg_split('/\n/', $zone) as $raw) {
            $line = trim(preg_replace('/[.,;]+$/', '', preg_replace('/^[\s#*>✅🎯]+/u', '', $raw)));
            if ($line === '' || !preg_match('/\d/', $line)) continue;
            $whole = Checks::constOf($line);
            if ($whole !== null) return $whole;
            if (preg_match('/\(?[-\d][^\s]*(?:\s*[+\-*\/×÷]\s*[^\s]+)*/u', $line, $m)) {
                $v = Checks::constOf($m[0]);
                if ($v !== null) return $v;
            }
        }
        if (preg_match_all('/-?\d[\d,]*(?:\.\d+)?/', $zone, $ms) && count($ms[0])) {
            $n = Checks::toNum($ms[0][0]);
            return is_finite($n) ? $n : null;
        }
        return null;
    }

    public static function extremumCheck(string $question, string $md): array
    {
        $c = self::symmetricConstraints($question);
        if ($c === null) return [];
        $obj = self::objectiveOf($question);
        if ($obj === null) return [];
        $wantMax = !preg_match('/minimi[sz]e|minimum|smallest|least/i', $question);

        $span = abs($c['s']) + sqrt(abs($c['q'])) + 30;
        $lo = $c['s'] / 3 - $span;
        $hi = $c['s'] / 3 + $span;

        $evalAtX = static function (float $x) use ($c, $obj) {
            $t = self::feasibleTriple($c['s'], $c['q'], $x);
            if ($t === null) return null;
            $v = Algebra::evalAt($obj['ast'], ['x' => $t[0], 'y' => $t[1], 'z' => $t[2]]);
            return is_finite($v) ? ['v' => $v, 't' => $t] : null;
        };
        $scan = static function (float $a, float $b, int $steps) use ($evalAtX, $wantMax) {
            $best = null;
            for ($i = 0; $i <= $steps; $i++) {
                $x = $a + ($b - $a) * $i / $steps;
                $r = $evalAtX($x);
                if ($r === null) continue;
                if ($best === null || ($wantMax ? $r['v'] > $best['v'] : $r['v'] < $best['v'])) {
                    $best = ['v' => $r['v'], 't' => $r['t'], 'x' => $x];
                }
            }
            return $best;
        };

        $coarse = $scan($lo, $hi, 40000);
        if ($coarse === null) return [];
        $w = ($hi - $lo) / 40000;
        $fine = $scan($coarse['x'] - $w, $coarse['x'] + $w, 4000);
        $best = ($fine !== null && ($wantMax ? $fine['v'] > $coarse['v'] : $fine['v'] < $coarse['v']))
            ? $fine : $coarse;

        $claimed = self::claimedValue($md);
        if ($claimed === null || !is_finite($claimed)) return [];

        $tol = max(abs($best['v']), 1.0) * 2e-3;
        $ok = abs($claimed - $best['v']) <= $tol;
        $where = implode(', ', array_map(static fn($n) => Algebra::round6($n), $best['t']));
        return [['kind' => 'extremum', 'ok' => $ok,
            'text' => $ok
                ? 'swept the whole feasible set of x+y+z=' . Algebra::round6($c['s']) . ', xy+yz+zx=' .
                  Algebra::round6($c['q']) . ': the ' . ($wantMax ? 'largest' : 'smallest') .
                  ' value of ' . $obj['src'] . ' is ' . Algebra::round6($best['v']) . ' at (' . $where .
                  '), which is what the answer gives'
                : 'the answer gives ' . Algebra::round6($claimed) . ', but sweeping the whole feasible set of x+y+z=' .
                  Algebra::round6($c['s']) . ', xy+yz+zx=' . Algebra::round6($c['q']) . ' the ' .
                  ($wantMax ? 'largest' : 'smallest') . ' value of ' . $obj['src'] . ' is ' .
                  Algebra::round6($best['v']) . ' at (' . $where . ')']];
    }
}
