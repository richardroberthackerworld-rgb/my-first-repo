<?php
/* ============================================================
   7Solve — COUNTEREXAMPLE ENGINE (PHP side)
   ------------------------------------------------------------
   The PHP twin of counterexample() in index.html. Ported, not
   reinvented: same shapes, same search points, same margins,
   because parity is tested by running both engines over one
   corpus and comparing what they emit.

   Every other checker asks "is what the answer computed
   correct?". This one asks the question that actually kills a
   proof: the answer says this holds for EVERY n — does it?

   A universal claim is refuted by one value, which is the
   cheapest decisive mathematics there is, and nothing looked.
   An answer could assert "n^2 + n + 41 is prime for all n" —
   Euler's polynomial, prime for n = 0 through 39 and composite
   at 40 — and no check in the engine would open it.

   IT CAN ONLY EVER FAIL. Searching a range and finding no
   counterexample is not a proof, and this must never turn
   "I looked" into "it is true" — that is the exact confusion the
   completeness gate exists to stop. A clean search emits nothing
   and the claim is left to unproved(), which asks whether an
   ARGUMENT was given.

   Silent on purpose: a sentence that already denies or qualifies
   the claim, trigonometry (a degrees-or-radians convention the
   question may not share), equalities (identityCheck reads those
   already), and anything that does not parse.
   ============================================================ */
declare(strict_types=1);

final class Counterexample
{
    private const FORALL_MARK =
        '/\b(for all|for every|for any|for each|always|in every case|whenever|holds for all)\b/iu';
    /* the answer has already qualified or withdrawn the claim */
    private const QUALIFIED =
        '/\b(counterexample|except|unless|fails?\b|does not hold|is not always|apart from|other than|but not|for n =|breaks down)\b/iu';
    private const REL_OPS = '/(>=|<=|≥|≤|≠|!=|>|<)/u';

    /** Where to look: the question's own domain, else the integers a school
        problem lives in, positives first. Mirrors searchPoints(). */
    private static function searchPoints(?array $dom, bool $wantReal): array
    {
        $pts = [];
        $low = ($dom !== null && $dom['low'] !== null) ? $dom['low'] : null;
        for ($n = ($low === null ? 1 : $low); $n <= 200; $n++) $pts[] = (float)$n;
        if ($low === null) {
            $pts[] = 0.0;
            for ($n = -1; $n >= -50; $n--) $pts[] = (float)$n;
        }
        if ($wantReal) {
            for ($n = -40; $n <= 40; $n++) { $pts[] = $n / 4; $pts[] = $n / 3; }
        }
        return $pts;
    }

    /** Over the integers the comparison is exact; elsewhere a violation must
        clear a margin, so float dust can never manufacture a counterexample. */
    private static function relHolds(string $op, float $a, float $b): ?bool
    {
        if (!is_finite($a) || !is_finite($b)) return null;
        $eps = max(1.0, abs($a), abs($b)) * 1e-9;
        if ($op === '>')  return ($a - $b >  $eps) ? true : (($b - $a > $eps) ? false : null);
        if ($op === '<')  return ($b - $a >  $eps) ? true : (($a - $b > $eps) ? false : null);
        if ($op === '≥')  return ($a - $b > -$eps) ? true : (($b - $a > $eps) ? false : null);
        if ($op === '≤')  return ($b - $a > -$eps) ? true : (($a - $b > $eps) ? false : null);
        if ($op === '≠')  return abs($a - $b) > $eps;
        return null;
    }

    private static function showNum(float $x): string
    {
        $r = round($x, 6);
        return (abs($r - round($r)) < 1e-9) ? (string)(int)round($r) : (string)$r;
    }

    private static function bindText(array $vars, array $pt): string
    {
        $parts = [];
        foreach ($vars as $i => $v) $parts[] = $v . ' = ' . self::showNum($pt[$i]);
        return implode(', ', $parts);
    }

    /** The FIRST binding that refutes the claim, or null. Two variables sweep a
        coarser grid: k^2 points of a 250-point sweep is not a cost this can
        carry inside a request. Mirrors hunt(). */
    private static function hunt(array $vars, array $pts, callable $test): ?array
    {
        if (count($vars) === 1) {
            foreach ($pts as $p) if ($test([$p]) === false) return [$p];
            return null;
        }
        /* THREE VARIABLES USED TO BE REFUSED OUTRIGHT, and "for all x, y, z" is
           an ordinary thing to claim. The grid thins as the dimension grows so
           the cost stays flat rather than cubing. A coarser net catches fewer
           counterexamples and invents none. Mirrors hunt() in index.html. */
        $span = count($vars) === 2 ? 40 : 16;
        $coarse = array_values(array_filter($pts, static fn($x) => abs($x) <= $span && $x === round($x)));
        $k = count($vars);
        $cur = array_fill(0, $k, 0.0);
        $found = null;
        $rec = static function (int $d) use (&$rec, &$cur, &$found, $k, $coarse, $test): void {
            if ($found !== null) return;
            if ($d === $k) { if ($test($cur) === false) $found = $cur; return; }
            foreach ($coarse as $v) { if ($found !== null) break; $cur[$d] = $v; $rec($d + 1); }
        };
        $rec(0);
        return $found;
    }

    public static function check(string $question, string $md): array
    {
        $text = preg_replace('/```[\s\S]*?```/u', ' ', Checks::deLatex($md));
        $dom = Exhaustion::domainOf($question);
        $out = [];
        $sents = preg_split('/(?:[.!?;]\s+|\n+)/u', $text);

        foreach ($sents as $sent) {
            if (count($out) >= 2) break;
            if (!preg_match(self::FORALL_MARK, $sent)) continue;
            if (preg_match(self::QUALIFIED, $sent)) continue;    // the answer already hedged it

            $wantReal = (bool)(preg_match('/\breal\b/iu', $sent) || preg_match('/\breal\b/iu', $question));
            $pts = self::searchPoints($dom, $wantReal);

            /* ---- shape 1: "… is prime for every n" ---- */
            if (preg_match('/([^,]{1,60}?)\s+is\s+(?:always\s+)?prime\b/iu', $sent, $pm)) {
                $pe = BandB::grabExpr($pm[1], true);
                $pv = $pe !== null ? array_keys(Algebra::varsOf($pe['ast'])) : [];
                if ($pe !== null && count($pv) === 1 && !Algebra::hasTrig($pe['ast'])) {
                    $ints = array_values(array_filter($pts, static fn($x) => $x === round($x) && $x >= 0));
                    $hit = self::hunt($pv, $ints, static function (array $pt) use ($pe, $pv): ?bool {
                        $val = Algebra::evalAt($pe['ast'], [$pv[0] => $pt[0]]);
                        if (!is_finite($val) || abs($val - round($val)) > 1e-9) return null;
                        if (abs($val) > 9007199254740991) return null;
                        return Checks::isPrime((int)round($val));
                    });
                    if ($hit !== null) {
                        $v = (int)round(Algebra::evalAt($pe['ast'], [$pv[0] => $hit[0]]));
                        $fac = Checks::firstFactor(abs($v));
                        $out[] = ['kind' => 'counter', 'ok' => false,
                            'text' => 'the answer claims ' . $pe['src'] . ' is prime for every ' . $pv[0] .
                                      ', but ' . self::bindText($pv, $hit) . ' gives ' . $v .
                                      (($fac > 1 && $fac < abs($v)) ? ' = ' . $fac . ' × ' . intdiv(abs($v), $fac) : '') .
                                      ', which is not prime — one counterexample settles a universal claim'];
                        continue;
                    }
                }
            }

            /* ---- shape 2: "… is always positive / negative / even / odd" ---- */
            if (preg_match('/([^,]{1,60}?)\s+is\s+always\s+(positive|negative|non-?negative|even|odd)\b/iu', $sent, $sm)) {
                $se = BandB::grabExpr($sm[1], true);
                $sv = $se !== null ? array_keys(Algebra::varsOf($se['ast'])) : [];
                $word = str_replace('non-negative', 'nonnegative', mb_strtolower($sm[2], 'UTF-8'));
                if ($se !== null && count($sv) >= 1 && count($sv) <= 3 && !Algebra::hasTrig($se['ast'])) {
                    $hit = self::hunt($sv, $pts, static function (array $pt) use ($se, $sv, $word): ?bool {
                        $env = [];
                        foreach ($sv as $i => $v) $env[$v] = $pt[$i];
                        $val = Algebra::evalAt($se['ast'], $env);
                        if (!is_finite($val)) return null;
                        /* A NEAR-ZERO VALUE IS NOT A COUNTEREXAMPLE. "e^x is
                           always positive" is true, and a plain > 0 test on a
                           float calls e^-50 = 2e-22 "not positive", disputing a
                           correct answer. Same margin as the inequality shape,
                           and inside it the point is undecidable. Mirrors
                           index.html. */
                        $eps = max(1.0, abs($val)) * 1e-9;
                        if ($word === 'positive')    return ($val >  $eps) ? true : (($val < -$eps) ? false : null);
                        if ($word === 'negative')    return ($val < -$eps) ? true : (($val >  $eps) ? false : null);
                        if ($word === 'nonnegative') return ($val > -$eps) ? true : (($val < -$eps) ? false : null);
                        if (abs($val - round($val)) > 1e-9) return null;   // parity needs an integer
                        $even = abs(((int)round($val)) % 2) === 0;
                        return $word === 'even' ? $even : !$even;
                    });
                    if ($hit !== null) {
                        $env = [];
                        foreach ($sv as $i => $v) $env[$v] = $hit[$i];
                        $out[] = ['kind' => 'counter', 'ok' => false,
                            'text' => 'the answer claims ' . $se['src'] . ' is always ' . $sm[2] . ', but ' .
                                      self::bindText($sv, $hit) . ' gives ' .
                                      self::showNum(Algebra::evalAt($se['ast'], $env)) .
                                      ' — one counterexample settles a universal claim'];
                        continue;
                    }
                }
            }

            /* ---- shape 3: a universal INEQUALITY ---- */
            if (!preg_match(self::REL_OPS, $sent, $rm, PREG_OFFSET_CAPTURE)) continue;
            $raw = $rm[0][0];
            $op = str_replace(['>=', '<=', '!='], ['≥', '≤', '≠'], $raw);
            $at = $rm[0][1];
            $L = BandB::grabExpr(substr($sent, 0, $at), true);
            $R = BandB::grabExpr(substr($sent, $at + strlen($raw)), false);
            if ($L === null || $R === null) continue;
            if (Algebra::hasTrig($L['ast']) || Algebra::hasTrig($R['ast'])) continue;
            $vs = array_keys(Algebra::varsOf($R['ast'], Algebra::varsOf($L['ast'], [])));
            if (!count($vs) || count($vs) > 3) continue;

            $hit = self::hunt($vs, $pts, static function (array $pt) use ($L, $R, $vs, $op): ?bool {
                $env = [];
                foreach ($vs as $i => $v) $env[$v] = $pt[$i];
                return self::relHolds($op, Algebra::evalAt($L['ast'], $env), Algebra::evalAt($R['ast'], $env));
            });
            if ($hit === null) continue;
            $env = [];
            foreach ($vs as $i => $v) $env[$v] = $hit[$i];
            $la = Algebra::evalAt($L['ast'], $env);
            $rb = Algebra::evalAt($R['ast'], $env);
            if (self::relHolds($op, $la, $rb) !== false) continue;   // re-checked before it is reported
            $out[] = ['kind' => 'counter', 'ok' => false,
                'text' => 'the answer claims ' . $L['src'] . ' ' . $op . ' ' . $R['src'] .
                          ' for every value, but ' . self::bindText($vs, $hit) . ' gives ' .
                          self::showNum($la) . ' and ' . self::showNum($rb) .
                          ', so the claim is false there — one counterexample settles a universal claim'];
        }
        return $out;
    }
}
