<?php
/* ============================================================
   7Solve — THE DESCENT, AND PELL (PHP side)
   ------------------------------------------------------------
   The PHP twin of descentCheck() and pellCheck() in index.html.
   Ported line for line, not reinvented: parity is tested by
   running both engines over one corpus and failing on any
   disagreement, so a cleverer PHP would be a bug.

   WHAT THESE TWO REACH THAT NOTHING ELSE HERE DOES. Every other
   completeness route in this codebase works by finding a finite
   region and enumerating it — a growth bound, a modular
   obstruction, a positive-coefficient box, a range the question
   itself stated. None of them can touch a question whose answer
   is infinite, and those are the questions students actually
   lose marks on:

       x² + y² + z² = xyz        infinitely many triples
       x² + y² = k(xy + 1)       an infinite ladder
       x² − Dy² = 1              infinitely many, by Pell

   So for those the engine could only ever REFUTE — find one
   solution the answer left out — and never certify. Three
   separate reports came out of that one gap.

   THE ARGUMENT, in the order the code runs it:

     1. The equation is quadratic in each variable, so fixing the
        others leaves A·xᵢ² + B·xᵢ + C = 0. A solution is one
        root; the other is the Vieta partner, and with A = ±1 it
        is an integer. It is computed and then substituted back,
        so it is verified rather than assumed.

     2. Jump whichever coordinate the jump lowers. Positive
        integers cannot decrease forever, so every solution
        descends to a TERMINAL — one no jump lowers. That is
        well-ordering, not a search.

     3. Order the variables x₁ ≤ … ≤ x_k. At a terminal the
        largest is the SMALLER root of its own quadratic, and a
        parabola opening upwards is non-negative at or left of
        its smaller root, so

            P(x₁, …, x_{k−1}, x_{k−1}) ≥ 0.

        The other way to be terminal is for the partner to leave
        the positive integers, and since xₖ·xₖ' = C that means
        C ≤ 0. Both regions are bounded by the sign of a leading
        coefficient, so both are finite and both get enumerated
        whole.

     4. The solution set is therefore exactly the union of the
        orbits of the terminals. That is a classification, and it
        is what "find all" was asking for.

   Pell gets its own engine because x² − Dy² = N has no cross
   term, so the partner of x is just −x and there is nothing to
   jump. Its families come from the fundamental unit instead, and
   Nagell's bound gives the range that provably holds a
   representative of every one.

   BOTH ENGINES BAIL ABOVE 3·10⁷ so every product stays inside an
   exact 64-bit integer here as well as inside a double in the
   browser. x² − 61y² = 1 has a fundamental solution of
   1766319049, and an engine that quietly lost precision there
   would be worse than one that declines.
   ============================================================ */
declare(strict_types=1);

final class Descent
{
    /** Stay inside exact integers in both engines. */
    private const CAP = 9.0e15;
    private const PELL_MAX = 30000000;

    /* Mirrors GENERATIVE in index.html. An answer describing a PROCESS is not
       claiming its examples are the whole set. */
    private const GENERATIVE =
        '/\b(arise[sn]? from|obtained (?:from|by)|generated (?:from|by)|generates? (?:all|every|the rest)|'
      . 'recurrence|and so on|infinitely many|unboundedly many|famil(?:y of|ies)|this family|of the form|'
      . 'iterat\w+|continu\w+)\b|…|\.\.\./iu';
    private const NONE_CLAIMED =
        '/\bno\s+(?:such\s+)?(?:positive\s+|non-?negative\s+)?(?:integer\s+)?(?:solutions?|pairs?|triples?|values?)\b'
      . '|\bthere\s+are\s+no\b|\bnone\s+exist\b|\bno\s+solutions?\s+exist\b|\bempty\b/iu';

    private static function fmtTuple(array $vars, array $tp): string
    {
        return count($vars) === 1
            ? $vars[0] . ' = ' . $tp[0]
            : '(' . implode(',', $vars) . ') = (' . implode(',', $tp) . ')';
    }

    /* ---------- the polynomial, with integer coefficients or nothing ---------- */
    private static function intPolyObj(?array $p): ?array
    {
        if ($p === null) return null;
        $out = []; $any = false;
        foreach ($p as $k => $c) {
            if (abs($c - round($c)) > 1e-9) return null;
            if (abs($c) > 1e9) return null;
            if ((int)round($c) === 0) continue;
            $out[$k] = (int)round($c); $any = true;
        }
        return $any ? $out : null;
    }
    private static function expsOfKey(string $k): array
    {
        return array_map('intval', explode(',', substr($k, 1)));
    }
    private static function quadInEach(array $P, int $k): bool
    {
        foreach ($P as $key => $_) {
            $e = self::expsOfKey((string)$key);
            for ($i = 0; $i < $k; $i++) if (($e[$i] ?? 0) > 2) return false;
        }
        return true;
    }
    private static function hasCross(array $P): bool
    {
        foreach ($P as $key => $_) {
            $e = self::expsOfKey((string)$key); $n = 0;
            foreach ($e as $v) if ($v > 0) $n++;
            if ($n >= 2) return true;
        }
        return false;
    }
    /** A·xᵢ² + B·xᵢ + C at the point $pt, exactly. */
    private static function quadAt(array $P, int $i, array $pt): ?array
    {
        $A = 0.0; $B = 0.0; $C = 0.0;
        foreach ($P as $key => $coef) {
            $e = self::expsOfKey((string)$key); $v = (float)$coef;
            foreach ($e as $j => $ej) {
                if ($j === $i) continue;
                for ($p = 0; $p < $ej; $p++) {
                    $v *= (float)$pt[$j];
                    if (abs($v) > self::CAP) return null;
                }
            }
            if (($e[$i] ?? 0) === 2)      $A += $v;
            elseif (($e[$i] ?? 0) === 1)  $B += $v;
            else                          $C += $v;
        }
        return ['A' => $A, 'B' => $B, 'C' => $C];
    }
    private static function polyAt(array $P, array $pt): ?float
    {
        $s = 0.0;
        foreach ($P as $key => $coef) {
            $e = self::expsOfKey((string)$key); $v = (float)$coef;
            foreach ($e as $j => $ej)
                for ($p = 0; $p < $ej; $p++) {
                    $v *= (float)$pt[$j];
                    if (abs($v) > self::CAP) return null;
                }
            $s += $v;
            if (abs($s) > self::CAP) return null;
        }
        return $s;
    }
    private static function isSol(array $P, array $pt): bool
    {
        $v = self::polyAt($P, $pt);
        return $v !== null && $v === 0.0;
    }
    /** The other root through the known root $pt[$i] — computed, then verified. */
    private static function vietaPartner(array $P, int $i, array $pt): ?float
    {
        $q = self::quadAt($P, $i, $pt);
        if ($q === null || $q['A'] === 0.0) return null;
        if (fmod($q['B'], $q['A']) !== 0.0) return null;
        $r = -($q['B'] / $q['A']) - (float)$pt[$i];
        if (!is_finite($r) || abs($r) > self::CAP) return null;
        if ($q['A'] * $r * $r + $q['B'] * $r + $q['C'] !== 0.0) return null;
        return $r;
    }
    private static function sortedTuple(array $t): array
    {
        $c = $t; sort($c); return array_values($c);
    }
    /** Descend to the terminal this solution belongs to. */
    private static function descendTo(array $P, array $pt, int $low): ?array
    {
        $cur = $pt; $guard = 0;
        for (;;) {
            if (++$guard > 400) return null;
            $best = null;
            for ($i = 0; $i < count($cur); $i++) {
                $p = self::vietaPartner($P, $i, $cur);
                if ($p === null || $p < $low || $p >= $cur[$i]) continue;
                $nx = $cur; $nx[$i] = $p;
                if (!self::isSol($P, $nx)) continue;
                if ($best === null || $p < $best[$i]) $best = $nx;
            }
            if ($best === null) return self::sortedTuple($cur);
            $cur = $best;
        }
    }

    /* ---------- univariate helpers, for the terminal bound ---------- */
    private static function uDegOf(array $c): ?int
    {
        $b = null;
        foreach ($c as $d => $v) { if (!$v) continue; $d = (int)$d; if ($b === null || $d > $b) $b = $d; }
        return $b;
    }
    private static function uEvalAt(array $c, float $x): float
    {
        $s = 0.0;
        foreach ($c as $d => $v) { $s += $v * pow($x, (int)$d); if (!is_finite($s)) return NAN; }
        return $s;
    }
    private static function uCauchyOf(array $c): ?int
    {
        $n = self::uDegOf($c);
        if ($n === null || !($c[$n] ?? 0)) return null;
        $m = 0.0;
        foreach ($c as $d => $v) if ((int)$d < $n) $m = max($m, abs($v));
        $b = (int)floor(1 + $m / abs($c[$n])) + 1;
        return ($b < 100000) ? $b : null;
    }
    /** The least X with poly(x) < 0 for EVERY x > X. */
    private static function negBeyondX(array $c): ?int
    {
        $n = self::uDegOf($c);
        if ($n === null || !(($c[$n] ?? 0) < 0)) return null;
        $cb = self::uCauchyOf($c);
        if ($cb === null) return null;
        $X = $cb;
        for ($x = $cb; $x >= 0; $x--) { if (self::uEvalAt($c, (float)$x) >= 0) { $X = $x; break; } $X = $x - 1; }
        return $X;
    }
    private static function posBeyondX(array $c): ?int
    {
        $n = self::uDegOf($c);
        if ($n === null || !(($c[$n] ?? 0) > 0)) return null;
        $cb = self::uCauchyOf($c);
        if ($cb === null) return null;
        $X = $cb;
        for ($x = $cb; $x >= 0; $x--) { if (self::uEvalAt($c, (float)$x) <= 0) { $X = $x; break; } $X = $x - 1; }
        return $X;
    }
    /** P with the last variable replaced by the one before it. */
    private static function collapseLast(array $P, int $k): array
    {
        $o = [];
        foreach ($P as $key => $coef) {
            $e = self::expsOfKey((string)$key);
            $f = array_slice($e, 0, $k - 1);
            $f[$k - 2] += $e[$k - 1];
            $kk = 'e' . implode(',', $f);
            $o[$kk] = ($o[$kk] ?? 0) + $coef;
        }
        foreach ($o as $j => $v) if (!$v) unset($o[$j]);
        return $o;
    }
    /** The part of P with degree 0 in the last variable. */
    private static function constInLast(array $P, int $k): array
    {
        $o = [];
        foreach ($P as $key => $coef) {
            $e = self::expsOfKey((string)$key);
            if ($e[$k - 1]) continue;
            $kk = 'e' . implode(',', array_slice($e, 0, $k - 1));
            $o[$kk] = ($o[$kk] ?? 0) + $coef;
        }
        foreach ($o as $j => $v) if (!$v) unset($o[$j]);
        return $o;
    }
    private static function toUni(array $p): array
    {
        $c = [];
        foreach ($p as $key => $coef) { $d = self::expsOfKey((string)$key)[0]; $c[$d] = ($c[$d] ?? 0) + $coef; }
        return $c;
    }
    private static function splitByLast(array $Q): array
    {
        $o = [];
        foreach ($Q as $key => $coef) {
            $e = self::expsOfKey((string)$key);
            $d = $e[1] ?? 0;
            if (!isset($o[$d])) $o[$d] = [];
            $o[$d][$e[0]] = ($o[$d][$e[0]] ?? 0) + $coef;
        }
        return $o;
    }
    /* Every coefficient positive and every variable ≥ 1: the value is positive,
       so { C ≤ 0 } is empty and no terminal arises by leaving the domain. */
    private static function allCoeffsPositive(array $p): bool
    {
        $any = false;
        foreach ($p as $v) { if ($v < 0) return false; if ($v > 0) $any = true; }
        return $any;
    }
    /* F(x) = cₙ(x)·xⁿ + Σ_{d<n} |c_d(x)|·x^d.  For y ≥ x ≥ 1,
       Q(x,y) ≤ yⁿ·(cₙ(x) + Σ |c_d(x)|/x^{n−d}), so F(x) < 0 empties the strip. */
    private static function stripBoundPoly(array $Q): ?array
    {
        $cy = self::splitByLast($Q);
        $n = null;
        foreach ($cy as $d => $_) { $d = (int)$d; if ($n === null || $d > $n) $n = $d; }
        if (!$n) return null;
        $F = [];
        foreach ($cy[$n] as $key => $v) { $g = (int)$key + $n; $F[$g] = ($F[$g] ?? 0) + $v; }
        foreach ($cy as $dd => $row) {
            if ((int)$dd === $n) continue;
            foreach ($row as $key => $v) { $g = (int)$key + (int)$dd; $F[$g] = ($F[$g] ?? 0) + abs($v); }
        }
        foreach ($F as $j => $v) if (!$v) unset($F[$j]);
        return $F;
    }
    private static function showUni(array $c): string
    {
        $ds = [];
        foreach ($c as $d => $v) if ($v) $ds[] = (int)$d;
        rsort($ds);
        if (!$ds) return '0';
        $out = '';
        foreach ($ds as $d)
            $out .= ($c[$d] > 0 ? '+' : '') . $c[$d] . ($d ? ($d === 1 ? 'x' : 'x^' . $d) : '');
        return preg_replace('/^\+/', '', $out);
    }

    /* ---------- THE BOX EVERY TERMINAL LIES IN ---------- */
    private static function terminalBox(array $P, int $k): ?array
    {
        $Q = self::collapseLast($P, $k);
        $Ck = self::constInLast($P, $k);
        if ($k === 2) {
            $qu = self::toUni($Q);
            $XA = self::negBeyondX($qu);
            if ($XA === null) return null;
            $XB = self::allCoeffsPositive($Ck) ? 0 : self::posBeyondX(self::toUni($Ck));
            if ($XB === null) return null;
            return ['his' => [max($XA, $XB, 1)], 'open' => [],
                'why' => 'a terminal is a solution no jump lowers, so either its partner is the larger root '
                       . '— which needs P(x,x) = ' . self::showUni($qu) . ' ≥ 0, forcing x ≤ ' . $XA . ' — or the partner '
                       . 'leaves the positive integers, which needs ' . self::showUni(self::toUni($Ck))
                       . ' ≤ 0, forcing x ≤ ' . $XB];
        }
        if ($k === 3) {
            $F = self::stripBoundPoly($Q);
            if ($F === null) return null;
            $XA3 = self::negBeyondX($F);
            if ($XA3 === null) return null;
            $XB3 = 0;
            if (!self::allCoeffsPositive($Ck)) {
                $CU = self::splitByLast($Ck);
                $cn = null;
                foreach ($CU as $d0 => $_) { $d0 = (int)$d0; if ($cn === null || $d0 > $cn) $cn = $d0; }
                if (!$cn) {
                    $XB3 = self::posBeyondX($CU[0]);
                } else {
                    $neg = [];
                    foreach ($Ck as $nk => $nv) $neg[$nk] = -$nv;
                    $FB = self::stripBoundPoly($neg);
                    $XB3 = $FB !== null ? self::negBeyondX($FB) : null;
                }
                if ($XB3 === null) return null;
            }
            $X = max($XA3, $XB3, 1);
            if ($X > 400) return null;
            $cy = self::splitByLast($Q);
            $n = null;
            foreach ($cy as $d1 => $_) { $d1 = (int)$d1; if ($n === null || $d1 > $n) $n = $d1; }
            $ymax = $X; $open = [];
            for ($x = 1; $x <= $X; $x++) {
                $co = [];
                foreach ($cy as $d2 => $row) $co[(int)$d2] = self::uEvalAt($row, (float)$x);
                $nn = self::uDegOf($co);
                if ($nn === null || !($co[$nn] < 0)) { $open[] = $x; continue; }
                $cb = self::uCauchyOf($co);
                if ($cb === null) return null;
                for ($y = $cb; $y >= $x; $y--)
                    if (self::uEvalAt($co, (float)$y) >= 0) { if ($y > $ymax) $ymax = $y; break; }
            }
            if ($ymax > 4000) return null;
            return ['his' => [$X, max($ymax, $X)], 'open' => $open,
                'why' => 'a terminal needs P(x,y,y) ≥ 0 with y ≥ x, and F(x) = ' . self::showUni($F)
                       . ' is negative for every x > ' . $XA3 . ', so every terminal has x ≤ ' . $X
                       . ' and y ≤ ' . max($ymax, $X)];
        }
        return null;
    }

    /* A strip x = v holds no solutions at all when the discriminant of P in the
       last variable is negative for every y ≥ v. Degree ≤ 4 in y, so it is
       recovered exactly by finite differences and then bounded the same way. */
    private static function stripHasNothing(array $P, int $k, int $v): bool
    {
        $vals = [];
        for ($y = 0; $y <= 4; $y++) {
            $pt = array_fill(0, $k, 0); $pt[0] = $v; $pt[1] = $y;
            $q = self::quadAt($P, $k - 1, $pt);
            if ($q === null) return false;
            $D = $q['B'] * $q['B'] - 4 * $q['A'] * $q['C'];
            if (!is_finite($D) || abs($D) > self::CAP) return false;
            $vals[] = $D;
        }
        $c = self::newtonCoeffs($vals);
        if ($c === null) return false;
        $n = self::uDegOf($c);
        if ($n === null) return $vals[0] < 0;
        if (!($c[$n] < 0)) return false;
        $X = self::negBeyondX($c);
        if ($X === null) return false;
        $top = max($X, $v);
        if ($top > 100000) return false;
        for ($y = $v; $y <= $top; $y++) {
            $pt2 = array_fill(0, $k, 0); $pt2[0] = $v; $pt2[1] = $y;
            $q2 = self::quadAt($P, $k - 1, $pt2);
            if ($q2 === null || $q2['A'] === 0.0) return false;
            $D2 = $q2['B'] * $q2['B'] - 4 * $q2['A'] * $q2['C'];
            if ($D2 < 0) continue;
            $r = round(sqrt($D2));
            if ($r * $r !== $D2) continue;
            $num = [-$q2['B'] + $r, -$q2['B'] - $r];
            $den = 2 * $q2['A'];
            foreach ($num as $nv)
                if (fmod($nv, $den) === 0.0 && $nv / $den >= 1) return false;
        }
        return true;
    }
    private static function newtonCoeffs(array $y): ?array
    {
        $n = count($y); $a = $y;
        for ($j = 1; $j < $n; $j++)
            for ($i = $n - 1; $i >= $j; $i--) $a[$i] = ($a[$i] - $a[$i - 1]) / $j;
        $co = []; $cur = [0 => 1.0];
        for ($j = 0; $j < $n; $j++) {
            foreach ($cur as $d => $v) $co[$d] = ($co[$d] ?? 0) + $a[$j] * $v;
            $nx = [];
            foreach ($cur as $e => $v) {
                $nx[(int)$e + 1] = ($nx[(int)$e + 1] ?? 0) + $v;
                $nx[(int)$e]     = ($nx[(int)$e] ?? 0) - $j * $v;
            }
            $cur = $nx;
        }
        foreach ($co as $q => $v) {
            if (abs($v) < 1e-6) unset($co[$q]);
            elseif (abs($v - round($v)) > 1e-6) return null;
            else $co[$q] = (float)round($v);
        }
        return $co;
    }

    /** Solve for the last variable exactly, given the others. */
    private static function solveLastVar(array $P, array $pt, int $k, float $from, float $to): array
    {
        $q = self::quadAt($P, $k - 1, $pt);
        if ($q === null) return [];
        $out = [];
        if ($q['A'] === 0.0) {
            if ($q['B'] === 0.0 || fmod(-$q['C'], $q['B']) !== 0.0) return [];
            $r0 = (-$q['C']) / $q['B'];
            if ($r0 >= $from && $r0 <= $to) $out[] = $r0;
            return $out;
        }
        $D = $q['B'] * $q['B'] - 4 * $q['A'] * $q['C'];
        if (!is_finite($D) || $D < 0 || abs($D) > self::CAP) return [];
        $r = round(sqrt($D));
        if ($r * $r !== $D) return [];
        $den = 2 * $q['A'];
        foreach ([-$q['B'] + $r, -$q['B'] - $r] as $nv) {
            if (fmod($nv, $den) !== 0.0) continue;
            $v = $nv / $den;
            if ($v >= $from && $v <= $to && !in_array($v, $out, true)) $out[] = $v;
        }
        return $out;
    }
    private static function terminalsIn(array $P, int $k, array $his, int $low): array
    {
        $out = [];
        $cur = array_fill(0, $k, 0);
        $rec = function (int $i, float $from) use (&$rec, &$out, &$cur, $P, $k, $his, $low) {
            if (count($out) > 40) return;
            if ($i === $k - 1) {
                $cur[$k - 1] = $from;
                foreach (self::solveLastVar($P, $cur, $k, $from, 1e9) as $g) {
                    $cur[$k - 1] = $g;
                    if (!self::isSol($P, $cur)) continue;
                    $term = true;
                    for ($j = 0; $j < $k; $j++) {
                        $p = self::vietaPartner($P, $j, $cur);
                        if ($p !== null && $p >= $low && $p < $cur[$j]) $term = false;
                    }
                    if ($term) $out[] = $cur;
                }
                return;
            }
            for ($v = $from; $v <= $his[$i]; $v++) { $cur[$i] = $v; $rec($i + 1, (float)$v); }
        };
        $rec(0, (float)$low);
        return $out;
    }
    /** The orbit of the terminals, up to a ceiling — the true solution set. */
    private static function orbitOf(array $P, array $roots, int $k, int $low, float $ceiling, int $cap): array
    {
        $seen = []; $queue = []; $out = [];
        foreach ($roots as $r) {
            $t0 = self::sortedTuple($r);
            $seen[implode(',', $t0)] = 1;
            $queue[] = $t0; $out[] = $t0;
        }
        $head = 0; $grew = false;
        while ($head < count($queue) && count($out) < $cap) {
            $node = $queue[$head++];
            for ($i = 0; $i < $k; $i++) {
                $p = self::vietaPartner($P, $i, $node);
                if ($p === null || $p < $low) continue;
                $nx = $node; $nx[$i] = $p;
                if (!self::isSol($P, $nx)) continue;
                $key = implode(',', self::sortedTuple($nx));
                if (isset($seen[$key])) continue;
                $mx = 0;
                for ($j = 0; $j < $k; $j++) if ($nx[$j] > $mx) $mx = $nx[$j];
                if ($mx > $ceiling) { $grew = true; continue; }
                $seen[$key] = 1;
                $queue[] = self::sortedTuple($nx);
                $out[] = self::sortedTuple($nx);
            }
        }
        return ['set' => $out, 'infinite' => ($grew || count($out) >= $cap)];
    }

    /* ============================================================
       THE CHECKER
       ============================================================ */
    public static function check(string $question, string $md): array
    {
        $full = $md;
        $zone = Checks::answerClaimZone($full);
        $dom = Exhaustion::domainOf($question);
        if ($dom === null) $dom = Exhaustion::domainOf($zone);
        if ($dom === null || $dom['low'] === null || $dom['low'] < 1) return [];
        $found = Checks::findEquation($question);
        if ($found === null) return [];
        $eq = $found['eq']; $vars = $eq['vars']; $k = count($vars);
        if ($k < 2 || $k > 3) return [];
        if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) return [];
        $P = self::intPolyObj(Exhaustion::polyExpand(['t' => 'b', 'op' => '-', 'a' => $eq['L'], 'b' => $eq['R']], $vars));
        if ($P === null) return [];
        if (!self::quadInEach($P, $k)) return [];
        /* No cross term means no jump: x² − Dy² = N is Pell, and pell() has it. */
        if (!self::hasCross($P)) return [];
        /* The ordering x₁ ≤ … ≤ x_k is what makes the terminal bound legal. */
        if (!Exhaustion::isSymmetric($eq, $vars)) return [];
        /* A reply that stopped early has not finished its list. */
        if (Checks::completeness($full)) return [];
        $box = self::terminalBox($P, $k);
        if ($box === null) return [];
        $cleared = [];
        foreach ($box['open'] as $v) {
            if (!self::stripHasNothing($P, $k, $v)) return [];
            $cleared[] = $v;
        }
        $low = (int)$dom['low'];
        $terms = self::terminalsIn($P, $k, $box['his'], $low);
        if (count($terms) > 12) return [];

        $src = trim((string)$found['src']);
        $stripNote = '';
        if ($cleared) {
            $names = array_map(static fn($v) => $vars[0] . ' = ' . $v, $cleared);
            $stripNote = ', and the ' . (count($cleared) > 1 ? 'strips ' : 'strip ')
                       . implode(' and ', $names)
                       . ' hold no solutions at all because the discriminant there is negative for every ' . $vars[1];
        }
        $proof = 'every solution of ' . $src . ' has an exact Vieta partner in each variable, '
               . 'so jumping the coordinate that falls gives a strictly smaller solution — and over '
               . $dom['label'] . ' that cannot go on forever, so every solution descends to one no jump lowers. '
               . $box['why'] . $stripNote;

        /* ---- nothing is terminal: the equation has no solutions at all ---- */
        if (!$terms) {
            $saysNone = (bool)preg_match(self::NONE_CLAIMED, $zone);
            $claimed0 = Checks::claimedTuples($full, $k);
            if (!$saysNone && !$claimed0) return [];
            $ok = $saysNone && !$claimed0;
            return [['kind' => 'descent', 'ok' => $ok,
                'text' => $ok
                    ? 'there are no solutions at all, and the answer says so — ' . $proof
                      . ', and no solution is terminal, so there is nothing for a descent to land on'
                    : 'there are NO solutions in ' . $dom['label'] . ': ' . $proof
                      . ', and no solution is terminal, so the solution set is empty']];
        }

        /* ---- the solution set is the union of the orbits of the terminals ---- */
        $ceiling = $k === 2 ? 1000000.0 : 100000.0;
        $orb = self::orbitOf($P, $terms, $k, $low, $ceiling, 400);
        $claims = Checks::claimedTuples($full, $k);
        $wantsAll = (bool)preg_match(Exhaustion::ALL_ASKED_RE, $question)
                 || (bool)preg_match(Exhaustion::CLAIMS_ALL, $zone);
        $gen = (bool)preg_match(self::GENERATIVE, $full);
        $rootList = implode(', ', array_map(
            static fn($t) => self::fmtTuple($vars, self::sortedTuple($t)), $terms));

        /* Which families has the answer actually reached? A claimed tuple belongs
           to the family it descends to, so this is decided by running the descent
           on what the answer wrote — never by reading its prose. */
        $covered = []; $bogus = null; $real = 0;
        foreach ($claims as $c) {
            if (!self::isSol($P, $c)) { if ($bogus === null) $bogus = $c; continue; }
            $real++;
            $r = self::descendTo($P, $c, $low);
            if ($r !== null) $covered[implode(',', $r)] = 1;
        }
        if (!$claims && !$wantsAll) return [];

        $missing = [];
        foreach ($terms as $t)
            if (!isset($covered[implode(',', self::sortedTuple($t))])) $missing[] = $t;

        /* ---- a family the answer never reaches ---- */
        if ($real && $missing && count($terms) > 1) {
            $mm = self::sortedTuple($missing[0]);
            return [['kind' => 'descent', 'ok' => false,
                'text' => 'the solution set has ' . count($terms) . ' families, not one. ' . $src
                        . ' has terminals ' . $rootList . ', and every solution descends to exactly one of them, '
                        . 'so each is the bottom of a separate ladder. The answer reaches '
                        . (count($covered) ? (string)count($covered) : 'none')
                        . ' of them and never reaches ' . self::fmtTuple($vars, $mm)
                        . ', which satisfies the equation and is in no jump-orbit of anything the answer lists. '
                        . 'A correct descent from one starting solution gives one family; it does not give the others. '
                        . $proof]];
        }

        /* ---- a closed list against an orbit that keeps going ---- */
        if ($orb['infinite'] && $wantsAll && !$gen && $real) {
            $beyond = null;
            foreach ($orb['set'] as $cand) {
                $key = implode(',', self::sortedTuple($cand));
                $listed = false;
                foreach ($claims as $c) if (implode(',', self::sortedTuple($c)) === $key) $listed = true;
                if (!$listed) { $beyond = $cand; break; }
            }
            if ($beyond !== null) return [['kind' => 'descent', 'ok' => false,
                'text' => 'the answer gives a finite list and presents it as every solution, but the solution set '
                        . 'is infinite. ' . self::fmtTuple($vars, self::sortedTuple($beyond)) . ' also satisfies ' . $src
                        . ' and is not in the list. What the answer has found is where the descent STOPS — '
                        . $rootList . ' — which is not the same thing as what the descent classifies: the '
                        . 'solution set is the whole orbit of ' . (count($terms) > 1 ? 'those triples' : 'that one')
                        . ' under the jumps, and reversing a descent from the bottom climbs the ladder forever. '
                        . $proof]];
        }

        /* ---- a claimed solution that is not one ----
           TWO VERY DIFFERENT FAULTS LOOK THE SAME HERE. A reported answer
           classified x²+y²−5xy=25 perfectly — all three families, the jump map
           x' = 5y − x exactly right, eight of its nine listed pairs correct — and
           then wrote (77,368) where the jump gives (77,369). One digit.

           It was told the jump map is probably wrong, which is the diagnosis for
           an answer whose whole construction is broken. Telling a student their
           correct method is suspect because of a typo sends them back to rebuild
           something that was already right. */
        if ($bogus !== null) {
            $bsorted = self::sortedTuple($bogus);
            $near = null; $nearDiff = INF;
            foreach ($orb['set'] as $cand) {
                $same = 0; $diff = 0;
                for ($oj = 0; $oj < $k; $oj++) {
                    if ((float)$cand[$oj] === (float)$bsorted[$oj]) $same++;
                    else $diff += abs($cand[$oj] - $bsorted[$oj]);
                }
                if ($same === $k - 1 && $diff < $nearDiff) { $nearDiff = $diff; $near = $cand; }
            }
            $slip = ($near !== null && $real > 2);
            /* The slipped value, structured. The badge tier needs to know WHICH
               value it was, so it can tell a substitution that failed for that
               same value from one that failed for any other reason — and reading
               it back out of the sentence would make the badge depend on wording.
               Checks::run strips it again before the response is built, so /v1
               returns exactly what it always returned. */
            return [['kind' => 'descent', 'ok' => false,
                'slipOf' => $slip ? self::fmtTuple($vars, $bogus) : null,
                'text' => $slip
                    ? 'the classification is right and one of the values in it is not. '
                      . self::fmtTuple($vars, $bogus) . ' does not satisfy ' . $src . ' — the jump from the pair '
                      . 'before it gives ' . self::fmtTuple($vars, $near) . ', which does. Every other solution the '
                      . 'answer lists is genuine and lies in the orbit of ' . $rootList . ', so the method is sound '
                      . 'and this is a slip in one number, not a fault in the construction'
                    : 'the answer puts forward ' . self::fmtTuple($vars, $bogus) . ', which does not satisfy ' . $src
                      . '. Every genuine solution lies in the orbit of ' . $rootList
                      . ' under the Vieta jumps, and this one does not — which usually means the jump map '
                      . 'itself is wrong, not the arithmetic that followed it']];
        }

        /* ---- everything checks out: this IS the classification ---- */
        if ($real && !$missing && ($gen || !$orb['infinite'])) {
            return [['kind' => 'descent', 'ok' => true,
                'text' => 'these are ALL the solutions, and that is proved rather than searched for: ' . $proof
                        . '. The only ' . (count($terms) > 1 ? 'terminals are ' : 'terminal is ') . $rootList
                        . ($orb['infinite']
                            ? ', so the solution set is exactly the orbit of '
                              . (count($terms) > 1 ? 'those' : 'that') . ' under the jumps — which is what the answer describes'
                            : ', and the orbit closes, so the solution set is finite and is exactly this one')]];
        }
        return [];
    }

    /* ============================================================
       PELL: THE FAMILY THE JUMP CANNOT REACH
       ------------------------------------------------------------
       x² − Dy² = 7 with D = 2 has TWO ladders — 3,13,75,437… and
       5,27,157,915… — and an answer that finds (3,1) and iterates
       gets every term of the first and none of the second. Every
       line correct, half the solutions missing, and no
       substitution anywhere can see it.

       The second ladder is reached only through the CONJUGATE
       representative (x, −y), which starts below the axis and
       becomes visible one multiplication up. Dropping it for
       having a negative y throws away exactly the family this is
       here to find.
       ============================================================ */
    private static function pellUnitOf(int $D): ?array
    {
        $a0 = (int)floor(sqrt((float)$D));
        if ($a0 * $a0 === $D) return null;
        $m = 0; $dd = 1; $a = $a0;
        $n1 = 1; $n = $a0; $d1 = 0; $d = 1; $guard = 0;
        while ($n * $n - $D * $d * $d !== 1) {
            if (++$guard > 4000) return null;
            if (abs($n) > self::PELL_MAX || abs($d) > self::PELL_MAX) return null;
            $m = $dd * $a - $m;
            $dd = intdiv($D - $m * $m, $dd);
            $a = intdiv($a0 + $m, $dd);
            $n2 = $a * $n + $n1; $d2 = $a * $d + $d1;
            $n1 = $n; $n = $n2; $d1 = $d; $d = $d2;
        }
        return ['x' => $n, 'y' => $d];
    }
    private static function pellMul(array $p, array $q, int $D): array
    {
        return ['x' => $p['x'] * $q['x'] + $D * $p['y'] * $q['y'],
                'y' => $p['x'] * $q['y'] + $p['y'] * $q['x']];
    }
    private static function pellDown(array $p, array $u, int $D): array
    {
        return ['x' => $p['x'] * $u['x'] - $D * $p['y'] * $u['y'],
                'y' => $p['y'] * $u['x'] - $p['x'] * $u['y']];
    }
    private static function exactSqrt(float $n): int
    {
        if ($n < 0) return -1;
        $r = (int)round(sqrt($n));
        return ((float)$r * $r === $n) ? $r : -1;
    }
    private static function pellLadders(int $D, int $N, array $u, int $count): ?array
    {
        $Y = $N > 0
            ? $u['y'] * sqrt((float)$N) / sqrt(2.0 * ($u['x'] + 1))
            : $u['y'] * sqrt((float)(-$N)) / sqrt(2.0 * ($u['x'] - 1));
        if (!is_finite($Y) || $Y > 100000) return null;
        $hi = (int)floor($Y) + 1;
        $reps = [];
        for ($y = 0; $y <= $hi; $y++) {
            $t = (float)$N + (float)$D * $y * $y;
            if ($t < 0 || $t > (float)self::PELL_MAX * self::PELL_MAX) continue;
            $x = self::exactSqrt($t);
            if ($x < 0) continue;
            $reps[] = ['x' => $x, 'y' => $y];
            if ($y) $reps[] = ['x' => $x, 'y' => -$y];
        }
        $seen = []; $out = [];
        foreach ($reps as $rep) {
            $cur = $rep; $g = 0;
            for (;;) {
                if (++$g > 200) break;
                $nx = self::pellDown($cur, $u, $D);
                if ($nx['x'] <= 0 || $nx['y'] < 0) break;
                $cur = $nx;
            }
            /* Climb until the pair is positive: a conjugate rep starts below the
               axis and its ladder only becomes visible one multiplication up. */
            $rung = []; $c = $cur;
            for ($q = 0; $q < $count + 4 && count($rung) < $count; $q++) {
                if (abs($c['x']) > self::PELL_MAX || abs($c['y']) > self::PELL_MAX) break;
                if ($c['x'] > 0 && $c['y'] >= 0) $rung[] = [$c['x'], $c['y']];
                $c = self::pellMul($c, $u, $D);
            }
            if (!$rung) continue;
            $key = $rung[0][0] . ',' . $rung[0][1];
            if (isset($seen[$key])) continue;
            $seen[$key] = 1;
            $out[] = ['base' => $rung[0], 'rung' => $rung];
        }
        return ['Y' => $hi, 'ladders' => $out];
    }
    /** x² − Dy² = N, read off the expanded polynomial. */
    private static function asPell(array $P, array $vars): ?array
    {
        if (count($vars) !== 2) return null;
        foreach ($P as $key => $_)
            if ($key !== 'e2,0' && $key !== 'e0,2' && $key !== 'e0,0') return null;
        $a = $P['e2,0'] ?? 0; $b = $P['e0,2'] ?? 0; $c = $P['e0,0'] ?? 0;
        if ($a === 0 || $b === 0) return null;
        if ($a < 0) { $a = -$a; $b = -$b; $c = -$c; }
        if ($a !== 1) return null;
        if ($b > 0) return null;
        $D = -$b; $N = -$c;
        if ($D < 2 || $D > 10000) return null;
        return ['D' => $D, 'N' => $N];
    }
    public static function pell(string $question, string $md): array
    {
        $full = $md;
        $zone = Checks::answerClaimZone($full);
        $dom = Exhaustion::domainOf($question);
        if ($dom === null) $dom = Exhaustion::domainOf($zone);
        if ($dom === null || $dom['low'] === null || $dom['low'] < 0) return [];
        $found = Checks::findEquation($question);
        if ($found === null) return [];
        $eq = $found['eq']; $vars = $eq['vars'];
        if (count($vars) !== 2) return [];
        if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) return [];
        $P = self::intPolyObj(Exhaustion::polyExpand(['t' => 'b', 'op' => '-', 'a' => $eq['L'], 'b' => $eq['R']], $vars));
        if ($P === null) return [];
        $pe = self::asPell($P, $vars);
        if ($pe === null) return [];
        $u = self::pellUnitOf($pe['D']);
        if ($u === null) return [];
        if (Checks::completeness($full)) return [];   /* a reply cut off mid-list has claimed nothing */
        $got = self::pellLadders($pe['D'], $pe['N'], $u, 12);
        if ($got === null || !$got['ladders']) return [];
        $lads = $got['ladders'];
        $src = trim((string)$found['src']);
        $claims = Checks::claimedTuples($full, 2);
        $wantsAll = (bool)preg_match(Exhaustion::ALL_ASKED_RE, $question)
                 || (bool)preg_match(Exhaustion::CLAIMS_ALL, $zone);
        $gen = (bool)preg_match(self::GENERATIVE, $full);
        if (!$claims && !$wantsAll) return [];

        $proof = 'x² − ' . $pe['D'] . 'y² = ' . $pe['N'] . ' has fundamental unit (' . $u['x'] . ', ' . $u['y']
               . '), found from the continued fraction of √' . $pe['D'] . ', and every class has a representative '
               . 'with y ≤ ' . $got['Y'] . ' — so searching that range and taking each representative with its '
               . 'conjugate gives every family there is. That is exhaustion over a proved range, not a sample';

        $covered = []; $real = 0; $bogus = null; $biggest = 0;
        foreach ($claims as $c) {
            /* claimedTuples hands these back as floats, and === compares the TYPE
               as well as the value — so 7.0 !== 7 declared every genuine solution a
               non-solution, and the API disputed an answer the site had certified.
               Numeric comparison here, never identity. */
            $cx = (float)$c[0]; $cy = (float)$c[1];
            if ($cx * $cx - (float)$pe['D'] * $cy * $cy != (float)$pe['N']) { if ($bogus === null) $bogus = $c; continue; }
            $real++;
            if ($cx > $biggest) $biggest = (int)$cx;
            foreach ($lads as $j => $lad)
                foreach ($lad['rung'] as $r)
                    if ((float)$r[0] == $cx && (float)$r[1] == $cy) $covered[$j] = 1;
        }
        if ($bogus !== null) return [['kind' => 'pell', 'ok' => false,
            'text' => 'the answer puts forward (' . implode(',', $vars) . ') = (' . implode(',', $bogus)
                    . '), which does not satisfy ' . $src . '. ' . $proof]];
        if (!$real) return [];

        $missing = [];
        foreach ($lads as $j => $lad) if (!isset($covered[$j])) $missing[] = $lad;
        if ($missing && count($lads) > 1) {
            $mb = $missing[0]['base'];
            return [['kind' => 'pell', 'ok' => false,
                'text' => 'the solutions of ' . $src . ' fall into ' . count($lads) . ' families, not one, and the '
                        . 'answer reaches ' . (count($lads) - count($missing)) . '. (' . implode(',', $vars) . ') = ('
                        . implode(', ', $mb) . ') satisfies the equation and is on none of the ladders the answer builds — '
                        . 'multiplying one solution by the fundamental unit climbs its own family and never leaves it, '
                        . 'so finding one solution and iterating cannot reach the others. ' . $proof]];
        }

        if ($wantsAll && !$gen) {
            $next = null;
            foreach ($lads as $lad) {
                foreach ($lad['rung'] as $pr) {
                    $listed = false;
                    foreach ($claims as $c) if ((float)$c[0] == (float)$pr[0] && (float)$c[1] == (float)$pr[1]) $listed = true;
                    if (!$listed && $pr[0] > $biggest) { $next = $pr; break 2; }
                }
            }
            if ($next !== null) return [['kind' => 'pell', 'ok' => false,
                'text' => 'the answer gives a finite list and presents it as every solution, but ' . $src
                        . ' has infinitely many. (' . implode(',', $vars) . ') = (' . implode(', ', $next)
                        . ') satisfies it too, and every solution multiplied by the fundamental unit ('
                        . $u['x'] . ', ' . $u['y'] . ') gives another — so the list can never be closed by listing. '
                        . $proof]];
        }
        if (!$missing && $gen) {
            $bases = array_map(static fn($l) => implode(', ', $l['base']), $lads);
            return [['kind' => 'pell', 'ok' => true,
                'text' => 'these are ALL the solutions, and that is proved rather than searched for: ' . $proof
                        . '. There ' . (count($lads) > 1 ? 'are ' . count($lads) . ' families, starting (' : 'is one family, starting (')
                        . implode(') and (', $bases) . '), and the answer reaches every one of them']];
        }
        return [];
    }
}
