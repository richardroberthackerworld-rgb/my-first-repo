<?php
/* ============================================================
   7Solve — DETERMINISTIC MATH SOLVER
   ------------------------------------------------------------
   §4 of the spec: "For calculations, prioritize deterministic
   computation instead of relying solely on an LLM."

   This solves without asking a model anything. That matters for
   two reasons: it cannot hallucinate, and it costs nothing per
   call — so /v1/math/solve has the same economics as
   /v1/verify, which is the only reason either is worth selling.

   WHAT IT REFUSES TO DO
   ---------------------
   It handles what it can prove it handles and says UNSUPPORTED
   for everything else. It does NOT guess. A solver that returns
   a plausible-looking wrong root is worse than one that returns
   nothing, because the caller has no way to tell the difference
   — and this whole product exists because of that asymmetry.

   Concretely it will not touch: more than one variable,
   trigonometric equations (degrees-or-radians is a convention
   the question may not share), or anything the parser refuses.
   ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/verify.php';

final class Solver
{
    /* How close to zero a residual has to be before a value counts as a root.
       Relative, because f(x) for a large-coefficient polynomial carries float
       dust proportional to its own magnitude. */
    private const EPS = 1e-9;

    /* f(x) = L - R, as a tree. Solving f(x) = 0 is the same problem as
       L = R and gives one place to evaluate instead of two. */
    private static function residual(array $eq): array
    {
        return ['t' => 'b', 'op' => '-', 'a' => $eq['L'], 'b' => $eq['R']];
    }

    private static function at(array $f, string $v, float $x): float
    {
        return Algebra::evalAt($f, [$v => $x]);
    }

    /* Is f a polynomial of degree <= 2 in v? Fit a, b, c from three points and
       then CHECK the fit at two more. Fitting alone proves nothing — any three
       points lie on some parabola — so the verification step is the whole
       argument, not a formality. */
    private static function quadraticFit(array $f, string $v): ?array
    {
        $f0  = self::at($f, $v, 0.0);
        $f1  = self::at($f, $v, 1.0);
        $fm1 = self::at($f, $v, -1.0);
        if (!is_finite($f0) || !is_finite($f1) || !is_finite($fm1)) return null;

        $c = $f0;
        $a = ($f1 + $fm1) / 2 - $f0;
        $b = ($f1 - $fm1) / 2;

        foreach ([2.0, -3.0, 5.5] as $x) {
            $actual = self::at($f, $v, $x);
            if (!is_finite($actual)) return null;
            $model = $a * $x * $x + $b * $x + $c;
            $scale = max(1.0, abs($actual), abs($model));
            if (abs($actual - $model) > $scale * 1e-9) return null;   // not a quadratic
        }
        return ['a' => $a, 'b' => $b, 'c' => $c];
    }

    /* Present a float the way a student would write it: 2 rather than
       2.0000000001, 0.5 rather than 0.49999999999. */
    private static function tidy(float $n): float
    {
        $r = round($n, 9);
        return $r == 0.0 ? 0.0 : $r;     // fold -0.0 into 0
    }

    /* Exact surd form for a quadratic root when the discriminant is not a
       perfect square: (-b ± √D) / 2a, reduced where it reduces cleanly. A
       student's answer sheet says "(-3 + √5)/2", not "-0.381966". */
    private static function gcd(int $x, int $y): int
    {
        $x = abs($x); $y = abs($y);
        while ($y !== 0) { $t = $x % $y; $x = $y; $y = $t; }
        return $x;
    }

    private static function surdForm(float $a, float $b, float $d): ?array
    {
        /* Only worth attempting when the coefficients are whole numbers —
           otherwise the "exact" form is a decimal wearing a square root. */
        if (abs($a - round($a)) > 1e-9 || abs($b - round($b)) > 1e-9) return null;
        if (abs($d - round($d)) > 1e-9) return null;
        $ai = (int)round($a);
        $bi = (int)round($b);
        $di = (int)round($d);
        if ($di <= 0) return null;

        /* Pull the largest square factor out: √25200 = 60√7, not √25200.
           Without this the "exact form" is arithmetically correct and
           completely useless — no student writes (164 + √25200)/2 when the
           answer is 82 + 30√7, and an exact form nobody would write is not
           worth returning. */
        $out = 1;
        $in  = $di;
        for ($k = 2; $k * $k <= $in; $k++) {
            while ($in % ($k * $k) === 0) { $out *= $k; $in = intdiv($in, $k * $k); }
        }
        if ($in === 1) return null;                      // perfect square → plain rational

        $num = -$bi;                                     // (-b ± out√in) / 2a
        $den = 2 * $ai;
        if ($den < 0) { $den = -$den; $num = -$num; $out = -$out; }

        /* Reduce the whole thing by the common factor of all three parts. */
        $g = self::gcd(self::gcd($num, $out), $den);
        if ($g > 1) { $num = intdiv($num, $g); $out = intdiv($out, $g); $den = intdiv($den, $g); }

        $sign = $out < 0 ? -1 : 1;
        $mag  = abs($out);
        $radical = ($mag === 1 ? '' : (string)$mag) . '√' . $in;

        $build = static function (int $dir) use ($num, $radical, $den, $sign) {
            $op = ($dir * $sign) > 0 ? ' + ' : ' - ';
            $body = ($num === 0 ? ($op === ' - ' ? '-' : '') . $radical : $num . $op . $radical);
            return $den === 1 ? $body : '(' . $body . ')/' . $den;
        };
        return [$build(1), $build(-1)];
    }

    /* Numeric fallback: scan for sign changes and bisect each one.
       Reported as 'numeric' and explicitly NOT claimed to be complete — a
       root outside the scanned window, or a repeated root that never changes
       sign, will be missed, and saying so is the difference between a tool
       and a liability. */
    private static function numericRoots(array $f, string $v): array
    {
        $lo = -1000.0;
        $hi = 1000.0;
        $steps = 200000;
        $roots = [];
        $prevX = $lo;
        $prevY = self::at($f, $v, $lo);

        for ($i = 1; $i <= $steps && count($roots) < 12; $i++) {
            $x = $lo + ($hi - $lo) * $i / $steps;
            $y = self::at($f, $v, $x);
            if (!is_finite($y)) { $prevX = $x; $prevY = $y; continue; }

            if (is_finite($prevY)) {
                if ($prevY == 0.0) {
                    $roots[] = $prevX;
                } elseif (($prevY < 0 && $y > 0) || ($prevY > 0 && $y < 0)) {
                    $a = $prevX; $b = $x; $fa = $prevY;
                    for ($k = 0; $k < 80; $k++) {
                        $m  = ($a + $b) / 2;
                        $fm = self::at($f, $v, $m);
                        if (!is_finite($fm)) break;
                        if (($fa < 0 && $fm > 0) || ($fa > 0 && $fm < 0)) { $b = $m; }
                        else { $a = $m; $fa = $fm; }
                    }
                    $roots[] = ($a + $b) / 2;
                }
            }
            $prevX = $x;
            $prevY = $y;
        }

        /* de-duplicate: bisection on adjacent brackets can land twice on one root */
        $out = [];
        foreach ($roots as $r) {
            $r = self::tidy($r);
            $dup = false;
            foreach ($out as $o) if (abs($o - $r) < 1e-6) { $dup = true; break; }
            if (!$dup) $out[] = $r;
        }
        return $out;
    }

    /* Every root is substituted back before it is returned. The solver does
       not get to mark its own homework any more than a model does. */
    private static function confirm(array $f, string $v, float $x): bool
    {
        $y = self::at($f, $v, $x);
        if (!is_finite($y)) return false;
        $scale = max(1.0, abs(self::at($f, $v, $x + 1)), abs(self::at($f, $v, $x - 1)));
        return abs($y) <= $scale * 1e-6;
    }

    public static function solve(string $input): array
    {
        $src = Checks::deLatex($input);

        /* No '=' at all → this is an expression to evaluate, not an equation. */
        if (substr_count($src, '=') === 0) {
            $ast = Algebra::parse(trim($src));
            if ($ast === null) {
                return ['status' => 'UNSUPPORTED', 'reason' => 'That is not an expression this engine can parse.'];
            }
            if (count(Algebra::varsOf($ast))) {
                /* The tokeniser reads every letter as its own variable, so
                   "who is the president" parses beautifully as a product of
                   sixteen variables. Saying "an expression with a variable in
                   it has no single value" is technically true and tells the
                   caller nothing about what actually went wrong. */
                if (!Checks::looksAlgebraic($src)) {
                    return ['status' => 'UNSUPPORTED',
                            'reason' => 'That does not look like a mathematical expression.'];
                }
                return ['status' => 'UNSUPPORTED',
                        'reason' => 'An expression with a variable in it has no single value. Send an equation instead.'];
            }
            $val = Algebra::evalAt($ast, []);
            if (!is_finite($val)) {
                return ['status' => 'UNDEFINED', 'reason' => 'That expression is undefined (division by zero, or a root of a negative).'];
            }
            return ['status' => 'SOLVED', 'kind' => 'evaluation',
                    'value' => self::tidy($val), 'method' => 'exact arithmetic'];
        }

        $eq = Algebra::parseEquation($src);
        if ($eq === null) {
            return ['status' => 'UNSUPPORTED',
                    'reason' => substr_count($src, '=') > 1
                        ? 'A chain like a = b = c is ambiguous. Send one equation.'
                        : 'That equation could not be parsed.'];
        }
        if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) {
            return ['status' => 'UNSUPPORTED',
                    'reason' => 'Trigonometric equations need a degrees-or-radians convention this engine will not assume.'];
        }
        if (count($eq['vars']) !== 1) {
            return ['status' => 'UNSUPPORTED',
                    'reason' => count($eq['vars']) === 0
                        ? 'There is no variable to solve for.'
                        : 'This engine solves one variable at a time; that equation has ' . count($eq['vars']) . '.'];
        }

        $v = $eq['vars'][0];
        $f = self::residual($eq);

        /* ---- exact path: linear and quadratic ---- */
        $q = self::quadraticFit($f, $v);
        if ($q !== null) {
            $a = $q['a']; $b = $q['b']; $c = $q['c'];

            if (abs($a) < 1e-12) {                        // linear
                if (abs($b) < 1e-12) {
                    return abs($c) < 1e-12
                        ? ['status' => 'IDENTITY', 'variable' => $v,
                           'reason' => 'True for every value of ' . $v . '.']
                        : ['status' => 'NO_SOLUTION', 'variable' => $v,
                           'reason' => 'The equation reduces to a false statement.'];
                }
                $x = -$c / $b;
                if (!self::confirm($f, $v, $x)) {
                    return ['status' => 'UNSUPPORTED', 'reason' => 'A root was computed but did not survive substitution.'];
                }
                return ['status' => 'SOLVED', 'kind' => 'linear', 'variable' => $v,
                        'roots' => [self::tidy($x)], 'method' => 'exact (linear)',
                        'complete' => true];
            }

            $d = $b * $b - 4 * $a * $c;                   // quadratic
            if ($d < -1e-12) {
                $re = self::tidy(-$b / (2 * $a));
                $im = self::tidy(sqrt(-$d) / (2 * abs($a)));
                return ['status' => 'SOLVED', 'kind' => 'quadratic', 'variable' => $v,
                        'roots' => [], 'complex_roots' => [
                            $re . ' + ' . $im . 'i', $re . ' - ' . $im . 'i',
                        ],
                        'discriminant' => self::tidy($d),
                        'method' => 'exact (quadratic formula)', 'complete' => true,
                        'note' => 'The discriminant is negative, so there is no real solution.'];
            }

            $rt = sqrt(max(0.0, $d));
            $r1 = (-$b + $rt) / (2 * $a);
            $r2 = (-$b - $rt) / (2 * $a);
            $roots = abs($r1 - $r2) < 1e-12 ? [self::tidy($r1)] : [self::tidy($r1), self::tidy($r2)];
            foreach ($roots as $r) {
                if (!self::confirm($f, $v, $r)) {
                    return ['status' => 'UNSUPPORTED', 'reason' => 'A root was computed but did not survive substitution.'];
                }
            }
            sort($roots);
            $out = ['status' => 'SOLVED', 'kind' => 'quadratic', 'variable' => $v,
                    'roots' => $roots, 'discriminant' => self::tidy($d),
                    'method' => 'exact (quadratic formula)', 'complete' => true];
            $surd = self::surdForm($a, $b, $d);
            if ($surd !== null) $out['exact_form'] = $surd;
            if (count($roots) === 1) $out['note'] = 'A repeated root: the discriminant is zero.';
            return $out;
        }

        /* ---- numeric path ---- */
        $roots = array_values(array_filter(
            self::numericRoots($f, $v),
            static fn($r) => self::confirm($f, $v, $r)
        ));
        if (!count($roots)) {
            return ['status' => 'NO_SOLUTION_FOUND', 'variable' => $v,
                    'searched' => '-1000 to 1000',
                    'reason' => 'No sign change was found in the searched range. There may still be roots outside it, or repeated roots that never cross zero.'];
        }
        sort($roots);
        return ['status' => 'SOLVED', 'kind' => 'numeric', 'variable' => $v,
                'roots' => $roots, 'method' => 'numeric (bisection on sign changes)',
                /* The honest part. A caller that needs completeness must not
                   read this as a complete answer. */
                'complete' => false,
                'note' => 'Found by scanning -1000 to 1000. Roots outside that range, and repeated roots that do not cross zero, are not detected.'];
    }
}
