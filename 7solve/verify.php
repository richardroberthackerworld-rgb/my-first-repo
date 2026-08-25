<?php
/* ============================================================
   7Solve — VERIFICATION ENGINE (PHP port)
   ------------------------------------------------------------
   A faithful port of the browser's Verify module, so /v1/solve
   can return the same verdict the website shows.

   WHY THIS FILE IS A RISK, AND WHAT KEEPS IT HONEST
   -------------------------------------------------
   The checker now exists TWICE: once in JavaScript inside
   index.html, once here. Two copies of a rule drift, and drift
   in this particular code is worse than a bug — it means the
   API calls an answer verified while the website calls the same
   answer disputed, and a customer cannot tell which to believe.

   The only thing standing against that is parity-test.php,
   which runs one shared corpus through BOTH engines and fails
   loudly when they disagree. If you change a rule in ONE of the
   two files, that test is what tells you. Run it before every
   deploy. It is not optional housekeeping; it is the reason
   this design is safe to use at all.

   PORTING NOTES (deliberate, not accidents)
   -----------------------------------------
   - Math.cbrt has no PHP equivalent; the sign-preserving form
     below matches JS for negative inputs, which pow() does not.
   - JS returns NaN for x/0. PHP raises a DivisionByZeroError, so
     that case is guarded explicitly rather than left to differ.
   - JS numbers are all float64 and so are PHP's, so tolerance
     arithmetic ports across unchanged.
   ============================================================ */
declare(strict_types=1);

/* Certifying kinds come from capabilities.json via Capability::certifyingKinds().
   Release A made that the single source of truth; duplicating the list here
   would restore the fourth hand-kept copy it removed. */
require_once __DIR__ . '/capability.php';

/* Phase 1: checkers that used to exist only in the browser, ported so that
   /v1 gives the same verdict as the website. See VERIFICATION-CONTRACT.md. */
require_once __DIR__ . '/sampling.php';
require_once __DIR__ . '/deriv.php';
require_once __DIR__ . '/checkers-phase1.php';
require_once __DIR__ . '/checkers-band-b.php';
require_once __DIR__ . '/checkers-band-b2.php';
require_once __DIR__ . '/checkers-exhaustion.php';
require_once __DIR__ . '/checkers-sequence.php';
require_once __DIR__ . '/checkers-counterexample.php';
require_once __DIR__ . '/checkers-stepchain.php';
require_once __DIR__ . '/checkers-quantity.php';
require_once __DIR__ . '/checkers-books.php';
require_once __DIR__ . '/checkers-descent.php';
require_once __DIR__ . '/calculus-phase1.php';

final class Algebra
{
    /* Named functions. A run of letters is only one of these when a bracket
       follows — otherwise every letter is its own variable, which is what
       makes "3xy" read as 3·x·y rather than a variable named "xy". */
    private const FUNCS = [
        'sqrt', 'cbrt', 'abs', 'exp', 'ln', 'log', 'log10', 'log2',
        'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'floor', 'ceil', 'round',
    ];

    private static function constants(): array
    {
        return ['pi' => M_PI, 'e' => M_E];
    }

    private static function callFn(string $fn, float $x): float
    {
        switch ($fn) {
            case 'sqrt':  return $x < 0 ? NAN : sqrt($x);
            /* pow(-8, 1/3) is NAN in PHP and -2 in JS. Preserve the JS answer. */
            case 'cbrt':  return $x < 0 ? -pow(-$x, 1 / 3) : pow($x, 1 / 3);
            case 'abs':   return abs($x);
            case 'exp':   return exp($x);
            case 'ln':    return $x <= 0 ? NAN : log($x);
            case 'log':   return $x <= 0 ? NAN : log10($x);
            case 'log10': return $x <= 0 ? NAN : log10($x);
            case 'log2':  return $x <= 0 ? NAN : log($x, 2);
            case 'sin':   return sin($x);
            case 'cos':   return cos($x);
            case 'tan':   return tan($x);
            case 'asin':  return ($x < -1 || $x > 1) ? NAN : asin($x);
            case 'acos':  return ($x < -1 || $x > 1) ? NAN : acos($x);
            case 'atan':  return atan($x);
            case 'floor': return floor($x);
            case 'ceil':  return ceil($x);
            case 'round': return (float)round($x);
        }
        return NAN;
    }

    /* ---------- tokenise ----------
       Returns null — refusing the whole string — on anything it does not
       recognise. Refusing is always safe here; guessing is not. */
    public static function tokenize(string $src): ?array
    {
        $s = $src;
        /* |u| is absolute value. The bars were not in the grammar at all, so
           ln|x| failed to tokenise — and ln|x| + C is how every textbook writes
           the integral of 1/x, which meant the standard answer to the standard
           question received no verdict.

           The replacement is BRACKETED, not bare: ln|x| has to become
           ln(abs(x)) and not lnabs(x), because the tokeniser reads a run of
           letters greedily and would take lnabs as five separate variables.

           A lone unpaired bar still fails to tokenise, exactly as before —
           set-builder notation is not arithmetic and must not be guessed at.
           Mirrors tokenize() in index.html. */
        $s = preg_replace('/\|([^|]+)\|/u', '(abs($1))', $s);
        $s = preg_replace('/[\x{2212}\x{2013}\x{2014}]/u', '-', $s);   // − – —
        $s = str_replace(['×', '÷'], ['*', '/'], $s);
        /* SUPERSCRIPTS, as a RUN and for every digit. ⁶ ⁷ ⁸ ⁹ were missing
           while deLatex turns ^7 into ⁷, so one half of the pipeline produced
           what the other half refused; and a two-digit exponent came out as
           x^1^2, which is right-associative here and means x. Mirrors
           tokenize() in index.html. */
        $s = preg_replace_callback('/\x{207B}?[\x{2070}\x{00B9}\x{00B2}\x{00B3}\x{2074}-\x{2079}]+/u',
            static function (array $m): string {
                $map = ['⁰' => '0', '¹' => '1', '²' => '2', '³' => '3', '⁴' => '4',
                        '⁵' => '5', '⁶' => '6', '⁷' => '7', '⁸' => '8', '⁹' => '9', '⁻' => '-'];
                $d = '';
                foreach (preg_split('//u', $m[0], -1, PREG_SPLIT_NO_EMPTY) as $c) $d .= $map[$c] ?? '';
                return '^(' . $d . ')';
            }, $s);
        /* A root is usually written without brackets — "30√7", "√25200" — and
           sqrt() in this grammar requires them, so give it some. This is what
           lets an exact answer like 82 − 30√7 be evaluated rather than failing
           to parse and being reported as unverifiable. */
        $s = preg_replace('/√\s*\(/u', 'sqrt(', $s);
        $s = preg_replace('/√\s*(\d+(?:\.\d+)?|[a-z])/iu', 'sqrt($1)', $s);
        $s = str_replace(['√', '**'], ['sqrt', '^'], $s);

        $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
        if ($chars === false) return null;
        $n = count($chars);
        $out = [];
        $i = 0;

        while ($i < $n) {
            $c = $chars[$i];
            if (preg_match('/\s/u', $c)) { $i++; continue; }

            if (preg_match('/[0-9.]/', $c)) {
                $num = '';
                while ($i < $n && preg_match('/[0-9.]/', $chars[$i])) $num .= $chars[$i++];
                if (!preg_match('/^\d*\.?\d+$/', $num)) return null;
                $out[] = ['t' => 'n', 'v' => (float)$num];
                continue;
            }

            if (preg_match('/[a-z]/i', $c)) {
                $w = '';
                while ($i < $n && preg_match('/[a-z0-9]/i', $chars[$i])) $w .= $chars[$i++];
                $lower = strtolower($w);
                if (in_array($lower, self::FUNCS, true) && $i < $n && $chars[$i] === '(') {
                    $out[] = ['t' => 'f', 'v' => $lower];
                    continue;
                }
                $consts = self::constants();
                if (isset($consts[$lower])) {
                    $out[] = ['t' => 'n', 'v' => $consts[$lower]];
                    continue;
                }
                $len = strlen($w);
                for ($j = 0; $j < $len; $j++) {
                    if (!preg_match('/[a-z]/i', $w[$j])) return null;  // "x2" as a name — refuse
                    $out[] = ['t' => 'v', 'v' => $w[$j]];
                }
                continue;
            }

            if (strpos('+-*/^(),', $c) !== false) {
                $out[] = ['t' => 'o', 'v' => $c];
                $i++;
                continue;
            }
            return null;                                  // unknown character → refuse
        }
        return $out;
    }

    /* ---------- parse ----------
       Recursive descent, same grammar and precedence as the browser:
         expr  := term (('+'|'-') term)*
         term  := power (('*'|'/') power | power)*      <- implicit product
         power := unary ('^' power)?                    <- right-associative
    */
    public static function parse(string $src): ?array
    {
        $tk = self::tokenize($src);
        if ($tk === null || !count($tk)) return null;

        $pos = 0;
        $bad = false;
        $count = count($tk);

        $peek = static function () use (&$tk, &$pos, $count) {
            return $pos < $count ? $tk[$pos] : null;
        };
        $isAtomStart = static function ($t): bool {
            return $t !== null && ($t['t'] === 'n' || $t['t'] === 'v' || $t['t'] === 'f'
                || ($t['t'] === 'o' && $t['v'] === '('));
        };

        $expr = $term = $power = $unary = $atom = null;

        $expr = static function () use (&$term, &$peek, &$tk, &$pos, &$bad) {
            $v = $term();
            while (!$bad && ($t = $peek()) !== null && $t['t'] === 'o'
                   && ($t['v'] === '+' || $t['v'] === '-')) {
                $op = $tk[$pos++]['v'];
                $v = ['t' => 'b', 'op' => $op, 'a' => $v, 'b' => $term()];
            }
            return $v;
        };
        $term = static function () use (&$power, &$peek, &$pos, &$bad, &$isAtomStart) {
            $v = $power();
            while (!$bad) {
                $t = $peek();
                if ($t !== null && $t['t'] === 'o' && ($t['v'] === '*' || $t['v'] === '/')) {
                    $pos++;
                    $v = ['t' => 'b', 'op' => $t['v'], 'a' => $v, 'b' => $power()];
                } elseif ($isAtomStart($t)) {
                    $v = ['t' => 'b', 'op' => '*', 'a' => $v, 'b' => $power()];  // implicit ×
                } else {
                    break;
                }
            }
            return $v;
        };
        $power = static function () use (&$unary, &$power, &$peek, &$pos, &$bad) {
            $v = $unary();
            if (!$bad && ($t = $peek()) !== null && $t['t'] === 'o' && $t['v'] === '^') {
                $pos++;
                return ['t' => 'b', 'op' => '^', 'a' => $v, 'b' => $power()];
            }
            return $v;
        };
        $unary = static function () use (&$atom, &$unary, &$peek, &$pos) {
            $t = $peek();
            if ($t !== null && $t['t'] === 'o' && $t['v'] === '-') {
                $pos++;
                return ['t' => 'u', 'a' => $unary()];
            }
            if ($t !== null && $t['t'] === 'o' && $t['v'] === '+') {
                $pos++;
                return $unary();
            }
            return $atom();
        };
        $atom = static function () use (&$expr, &$peek, &$pos, &$bad) {
            $t = $peek();
            if ($t === null) { $bad = true; return ['t' => 'n', 'v' => 0.0]; }
            if ($t['t'] === 'n') { $pos++; return ['t' => 'n', 'v' => $t['v']]; }
            if ($t['t'] === 'v') { $pos++; return ['t' => 'v', 'v' => $t['v']]; }
            if ($t['t'] === 'f') {
                $pos++;
                $p = $peek();
                if ($p === null || $p['v'] !== '(') { $bad = true; return ['t' => 'n', 'v' => 0.0]; }
                $pos++;
                $a = $expr();
                $p = $peek();
                if ($p === null || $p['v'] !== ')') { $bad = true; return ['t' => 'n', 'v' => 0.0]; }
                $pos++;
                return ['t' => 'c', 'fn' => $t['v'], 'a' => $a];
            }
            if ($t['t'] === 'o' && $t['v'] === '(') {
                $pos++;
                $v = $expr();
                $p = $peek();
                if ($p === null || $p['v'] !== ')') { $bad = true; return ['t' => 'n', 'v' => 0.0]; }
                $pos++;
                return $v;
            }
            $bad = true;
            return ['t' => 'n', 'v' => 0.0];
        };

        $ast = $expr();
        if ($bad || $pos !== $count) return null;         // trailing junk → refuse
        return $ast;
    }

    /* ---------------------------------------------------------------
       MONOTONICITY — the PHP half of the completeness argument for
       equations polyOf cannot reach. Mirrors monotone() in index.html
       exactly; parity.js compares the two engines case by case, so a
       divergence here fails the build rather than reaching /v1.

       null is the default and the safe answer: everything this has not
       been explicitly taught — sin, cos, tan, abs, floor, even powers,
       products of two moving factors, anything with a pole — falls
       through to "cannot tell" and is refused.
       --------------------------------------------------------------- */
    private const MONO_FN = ['exp', 'cbrt', 'atan', 'ln', 'log', 'log10', 'log2', 'sqrt'];

    public static function dependsOn(?array $ast, string $v): bool
    {
        if ($ast === null) return true;              /* unreadable → assume it moves */
        switch ($ast['t']) {
            case 'n': return false;
            case 'v': return $ast['v'] === $v;
            case 'u': return self::dependsOn($ast['a'], $v);
            case 'c': return self::dependsOn($ast['a'], $v);
            case 'b': return self::dependsOn($ast['a'], $v) || self::dependsOn($ast['b'], $v);
        }
        return true;
    }

    public static function constValue(?array $ast, string $v): ?float
    {
        if (self::dependsOn($ast, $v)) return null;
        $n = self::evalAt($ast, self::constants());
        return is_finite($n) ? $n : null;
    }

    /** +1 strictly increasing, -1 strictly decreasing, 0 independent of $v, null cannot tell. */
    public static function monotone(?array $ast, string $v): ?int
    {
        if ($ast === null) return null;
        if (!self::dependsOn($ast, $v)) return 0;

        if ($ast['t'] === 'v') return 1;

        if ($ast['t'] === 'u') {
            $du = self::monotone($ast['a'], $v);
            return $du === null ? null : -$du;
        }

        if ($ast['t'] === 'c') {
            if (!in_array($ast['fn'], self::MONO_FN, true)) return null;
            return self::monotone($ast['a'], $v);
        }

        if ($ast['t'] === 'b') {
            $A = $ast['a']; $B = $ast['b']; $op = $ast['op'];

            if ($op === '+' || $op === '-') {
                $da = self::monotone($A, $v); $db = self::monotone($B, $v);
                if ($da === null || $db === null) return null;
                if ($op === '-') $db = -$db;
                if ($da === 0) return $db;
                if ($db === 0) return $da;
                if ($da === $db) return $da;
                return null;                          /* increasing plus decreasing proves nothing */
            }

            if ($op === '*') {
                $c = self::constValue($A, $v);
                if ($c !== null) {
                    if ($c === 0.0) return 0;
                    $db = self::monotone($B, $v);
                    return $db === null ? null : ($c > 0 ? $db : -$db);
                }
                $c = self::constValue($B, $v);
                if ($c !== null) {
                    if ($c === 0.0) return 0;
                    $da = self::monotone($A, $v);
                    return $da === null ? null : ($c > 0 ? $da : -$da);
                }
                return null;                          /* f·g, both moving */
            }

            if ($op === '/') {
                $c = self::constValue($B, $v);
                if ($c !== null && $c !== 0.0) {
                    $da = self::monotone($A, $v);
                    return $da === null ? null : ($c > 0 ? $da : -$da);
                }
                return null;                          /* a pole would split the domain */
            }

            if ($op === '^') {
                $c = self::constValue($B, $v);
                if ($c !== null) {
                    $da = self::monotone($A, $v);
                    if ($da === null) return null;
                    /* only odd positive integer powers are strictly monotone on all of R;
                       even ones fold and negative ones introduce a pole */
                    if ($c === (float)round($c) && $c > 0 && ((int)round($c)) % 2 === 1) return $da;
                    return null;
                }
                $c = self::constValue($A, $v);
                if ($c !== null && $c > 0 && $c !== 1.0) {
                    $db = self::monotone($B, $v);
                    return $db === null ? null : ($c > 1 ? $db : -$db);
                }
                return null;
            }
            return null;
        }
        return null;
    }

    public static function evalAt(?array $ast, array $env): float
    {
        if ($ast === null) return NAN;
        switch ($ast['t']) {
            case 'n':
                return (float)$ast['v'];
            case 'v':
                $k = $ast['v'];
                $lk = strtolower($k);
                if (array_key_exists($k, $env))  return (float)$env[$k];
                if (array_key_exists($lk, $env)) return (float)$env[$lk];
                return NAN;
            case 'u':
                return -self::evalAt($ast['a'], $env);
            case 'c':
                $x = self::evalAt($ast['a'], $env);
                if (!is_finite($x)) return NAN;
                return self::callFn($ast['fn'], $x);
            case 'b':
                $a = self::evalAt($ast['a'], $env);
                $b = self::evalAt($ast['b'], $env);
                if (!is_finite($a) || !is_finite($b)) return NAN;
                switch ($ast['op']) {
                    case '+': return $a + $b;
                    case '-': return $a - $b;
                    case '*': return $a * $b;
                    /* JS gives NaN here; PHP would throw. Same verdict, no crash. */
                    case '/': return $b === 0.0 ? NAN : $a / $b;
                    case '^':
                        $r = pow($a, $b);
                        return is_float($r) || is_int($r) ? (float)$r : NAN;
                }
                return NAN;
        }
        return NAN;
    }

    public static function varsOf(?array $ast, array $into = []): array
    {
        if ($ast === null) return $into;
        if ($ast['t'] === 'v') {
            $into[strtolower($ast['v'])] = 1;
        } elseif ($ast['t'] === 'u' || $ast['t'] === 'c') {
            $into = self::varsOf($ast['a'], $into);
        } elseif ($ast['t'] === 'b') {
            $into = self::varsOf($ast['a'], $into);
            $into = self::varsOf($ast['b'], $into);
        }
        return $into;
    }

    /* Trig makes a degrees-or-radians assumption a marked-up question may not
       share. Rule 1 says bail rather than guess, so any check that would pass
       or fail a student on a trig value is skipped. */
    public static function hasTrig(?array $ast): bool
    {
        if ($ast === null) return false;
        if ($ast['t'] === 'c') {
            return (bool)preg_match('/^(sin|cos|tan|asin|acos|atan)$/', $ast['fn'])
                || self::hasTrig($ast['a']);
        }
        if ($ast['t'] === 'u') return self::hasTrig($ast['a']);
        if ($ast['t'] === 'b') return self::hasTrig($ast['a']) || self::hasTrig($ast['b']);
        return false;
    }

    /* "lhs = rhs" → the two trees, or null. Refuses anything with more than
       one '=' so a chain like a = b = c is never half-read. */
    public static function parseEquation(string $src): ?array
    {
        $parts = explode('=', $src);
        if (count($parts) !== 2) return null;
        $L = self::parse($parts[0]);
        $R = self::parse($parts[1]);
        if ($L === null || $R === null) return null;
        return ['L' => $L, 'R' => $R, 'vars' => array_keys(self::varsOf($R, self::varsOf($L)))];
    }

    /* Does the equation hold at this binding? null = no verdict, which is a
       real third answer here and must not collapse to false. */
    public static function holdsAt(array $eq, array $env): ?bool
    {
        $a = self::evalAt($eq['L'], $env);
        $b = self::evalAt($eq['R'], $env);
        if (!is_finite($a) || !is_finite($b)) return null;
        $scale = max(1.0, abs($a), abs($b));
        return abs($a - $b) <= $scale * 1e-9;
    }

    /* ---------- DECLARED NUMERICAL PRECISION ----------
       holdsAt asks "is the residual ~0?" — the right question for an exact
       root and the wrong one for a decimal. x + e^x = 0 has no closed form;
       its root is -0.56714…, and a student writing x = -0.567 has given a
       CORRECT answer to three decimal places. The residual is about 3e-4, so
       the universal 1e-9 called it wrong.

       The fix is NOT a bigger epsilon, which would accept a near-miss. The
       notation is read as what it means: -0.567 denotes [-0.5675, -0.5665],
       and the claim is certified only if a root is PROVED to lie inside it by
       a sign change. A pole also changes sign, so the interval is bisected and
       |f| must actually collapse at the crossing.

       Mirrors decimalsFor()/rootInInterval() in index.html. */
    public static function decimalsFor(string $md, float $val): ?int
    {
        if (!preg_match_all('/-?\d+\.(\d+)/u', $md, $ms, PREG_SET_ORDER)) return null;
        foreach ($ms as $m) {
            if (abs((float)$m[0] - $val) < 1e-12) return strlen($m[1]);
        }
        return null;
    }

    public static function rootInInterval(array $eq, string $v, float $lo, float $hi): ?bool
    {
        $f = static function (float $x) use ($eq, $v) {
            $env = [$v => $x];
            $L = self::evalAt($eq['L'], $env);
            $R = self::evalAt($eq['R'], $env);
            if (!is_finite($L) || !is_finite($R)) return null;
            return $L - $R;
        };
        $flo = $f($lo);
        $fhi = $f($hi);
        if ($flo === null || $fhi === null) return null;
        if ($flo === 0.0 || $fhi === 0.0) return true;
        if (($flo > 0) === ($fhi > 0)) return false;       // no sign change → no root proved
        $a = $lo; $b = $hi; $fa = $flo;
        for ($k = 0; $k < 80; $k++) {
            $mid = ($a + $b) / 2;
            $fm = $f($mid);
            if ($fm === null) return null;
            if ($fm === 0.0) return true;
            if (($fm > 0) === ($fa > 0)) { $a = $mid; $fa = $fm; } else { $b = $mid; }
        }
        $fr = $f(($a + $b) / 2);
        if ($fr === null) return null;
        /* Measured against the ENDPOINT magnitudes, not against f at the
           crossing: at a pole the latter is enormous and would excuse itself. */
        return abs($fr) <= 1e-9 * max(1.0, abs($flo), abs($fhi));
    }

    public static function round6(float $n): float
    {
        return round($n * 1e6) / 1e6;
    }

    public static function isFunctionName(string $w): bool
    {
        return in_array($w, self::FUNCS, true);
    }

    public static function isConstName(string $w): bool
    {
        return isset(self::constants()[$w]);
    }
}

/* ============================================================
   THE CHECKS
   ------------------------------------------------------------
   Each returns a list of {kind, ok, text}. An empty list means
   NO VERDICT — the check could not run — and that is a normal,
   safe outcome that must never be reported as a pass. The three
   states are pass, fail, and silence; collapsing silence into
   either of the others is how a checker starts lying.
   ============================================================ */
final class Checks
{
    /* Only digits and the four operators, deliberately: anything this cannot
       represent (brackets, powers, functions, percentages) fails to match and
       the check is skipped rather than approximated. */
    private const CALC_RE =
        '/(-?\d[\d,]*(?:\.\d+)?(?:(?:\s*[+\-×÷*\/]\s*|\s+[xX]\s+)-?\d[\d,]*(?:\.\d+)?)+)\s*=\s*(-?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*-?\d[\d,]*(?:\.\d+)?)?)/u';

    /* ⁰¹⁵⁶⁷⁸⁹ were missing while ²³⁴ were present, so an equation was visible
       to this scan at x⁴ and invisible at x⁵ — and deLatex emits every one of
       them from ^0 … ^9. Mirrors EQ_CHARS in index.html. */
    private const EQ_CHARS = '[0-9a-zA-Z\s^⁰¹²³⁴⁵⁶⁷⁸⁹⁻*\/+\-−–—().]';

    public static function toNum(string $s): float
    {
        $t = preg_replace('/[,\s₹$]/u', '', $s);
        if (!preg_match('/^-?\d*\.?\d+$/', $t)) return NAN;
        return (float)$t;
    }

    /* Tolerance from the decimals actually written, with a relative floor so
       large figures are not failed by binary rounding. "1/3 = 0.33" is correct
       to two places; the written form is what says so. */
    public static function tol(string $written, float $magnitude): float
    {
        $dec = preg_match('/\.(\d+)/', $written, $m) ? strlen($m[1]) : 0;
        $half = 0.5 * pow(10, -$dec);
        return max($half * 1.001, abs($magnitude) * 1e-9, 1e-9);
    }

    public static function near(float $a, float $b, string $written): bool
    {
        return abs($a - $b) <= self::tol($written, max(abs($a), abs($b)));
    }

    /* Flat left-to-right evaluator: × and ÷ first, then + and −. */
    public static function evalFlat(string $src): float
    {
        $parts = preg_split('/\s*([+\-×÷*\/])\s*/u', trim($src), -1,
                            PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY);
        if ($parts === false || !count($parts) || count($parts) % 2 === 0) return NAN;

        $nums = [self::toNum($parts[0])];
        $ops  = [];
        for ($i = 1; $i < count($parts); $i += 2) {
            $op = $parts[$i] === '×' ? '*' : ($parts[$i] === '÷' ? '/' : $parts[$i]);
            $n  = self::toNum($parts[$i + 1]);
            if (!is_finite($n)) return NAN;
            $ops[] = $op;
            $nums[] = $n;
        }
        if (!is_finite($nums[0])) return NAN;

        for ($j = 0; $j < count($ops);) {
            if ($ops[$j] === '*' || $ops[$j] === '/') {
                if ($ops[$j] === '/' && $nums[$j + 1] == 0.0) return NAN;
                $v = $ops[$j] === '*' ? $nums[$j] * $nums[$j + 1] : $nums[$j] / $nums[$j + 1];
                array_splice($nums, $j, 2, [$v]);
                array_splice($ops, $j, 1);
            } else {
                $j++;
            }
        }
        $acc = $nums[0];
        for ($j = 0; $j < count($ops); $j++) {
            $acc = $ops[$j] === '+' ? $acc + $nums[$j + 1] : $acc - $nums[$j + 1];
        }
        return $acc;
    }

    /* ---------- arithmetic written in the working ---------- */
    /* ---------- THE SECOND ARITHMETIC PASS: closed forms ----------
       evalFlat is deliberately narrow — digits and the four operators — so it
       can never guess. The cost was that everything else went unchecked:
       2^10 = 1024, sqrt(144) = 12, (3+4)^2 = 49 and 15% of 200 = 30 were all
       invisible, and a model gets those wrong far more often than it gets
       12 x 3 wrong.

       The exact parser the verifier already uses for algebra is turned on any
       line whose two sides are both CLOSED numeric expressions; if a variable
       survives on either side it is algebra and this says nothing. Only lines
       evalFlat could not have read are looked at, so nothing is reported twice.
       Mirrors closedForm() in index.html. */
    private const RICH = '/[\^√∛()%⁰¹²³⁴⁵⁶⁷⁸⁹]/u';

    private static function pctExpand(string $t): string
    {
        $t = preg_replace('/(\d+(?:\.\d+)?)\s*%\s*of\s+/iu', '($1/100)*', $t);
        return preg_replace('/(\d+(?:\.\d+)?)\s*%/u', '($1/100)', $t);
    }

    private static function closedForm(string $md, array &$out, array &$seen): void
    {
        foreach (preg_split('/\r?\n/u', $md) as $line) {
            if (strpos($line, '=') === false) continue;
            if (preg_match('/[≠≈≤≥<>]/u', $line)) continue;
            if (strpos($line, '`') !== false) continue;
            $body = preg_replace('/^\s*[-*•]\s+|^\s*\d+[.)]\s+/u', '',
                     preg_replace('/\*\*|__/u', '', $line));
            $parts = explode('=', $body);
            if (count($parts) < 2 || count($parts) > 4) continue;
            for ($p = 0; $p + 1 < count($parts); $p++) {
                $lseg = preg_split('/[,;:]/u', $parts[$p]);
                $rseg = preg_split('/[,;:]/u', $parts[$p + 1]);
                /* The percent rewrite is for the PARSER; the receipt shows what
                   the student actually wrote. */
                $lhsShown = rtrim(trim(end($lseg)), '.,;:');
                $rhsShown = rtrim(trim($rseg[0]), '.,;:');
                $lhs = self::pctExpand($lhsShown);
                $rhs = self::pctExpand($rhsShown);
                if ($lhs === '' || $rhs === '') continue;
                if (!preg_match(self::RICH, $lhs) && !preg_match(self::RICH, $rhs)) continue;
                if (!preg_match('/\d/u', $lhs) || !preg_match('/\d/u', $rhs)) continue;
                if (!preg_match('/[+\-*\/×÷^√]/u', $lhs) && !preg_match('/[⁰¹²³⁴⁵⁶⁷⁸⁹%]/u', $lhs)) continue;
                $a = self::constOf($lhs);
                $b = self::constOf($rhs);
                if ($a === null || $b === null) continue;
                if (!is_finite($a) || !is_finite($b)) continue;
                $key = 'c' . preg_replace('/\s+/u', '', $lhs) . '=' . preg_replace('/\s+/u', '', $rhs);
                if (isset($seen[$key])) continue;
                $seen[$key] = true;
                $out[] = ['kind' => 'arith', 'ok' => self::near($a, $b, $rhs),
                          'text' => trim(preg_replace('/\s+/u', ' ', $lhsShown . ' = ' . $rhsShown)),
                          'got' => Algebra::round6($a), 'want' => Algebra::round6($b)];
                if (count($out) > 24) return;
            }
        }
    }

    public static function arithmetic(string $md): array
    {
        /* Currency marks made the arithmetic checker blind across the whole
           commerce syllabus — see the matching comment in index.html. Stripped
           only where the mark sits against a digit, so a variable is never
           turned into a numeral. Mirrors the JS exactly; parity.js compares. */
        $md = preg_replace('/(?:₹|\$|€|£|Rs\.?|INR|USD)\s*(?=[\d.])/iu', '', $md);
        $md = preg_replace('/(\d)\s*(?:Rs\.?|INR|USD)(?![A-Za-z])/iu', '$1', $md);

        $out = [];
        $seen = [];
        if (!preg_match_all(self::CALC_RE, $md, $ms, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
            /* No flat arithmetic on the page does not mean no arithmetic: a reply
               made entirely of powers, roots and brackets reaches here with an
               empty match list, and used to leave without being read at all. */
            self::closedForm($md, $out, $seen);
            return $out;
        }
        foreach ($ms as $m) {
            if (count($out) >= 12) break;                  // a cap, not a sample
            $whole = $m[0][0];
            $at    = $m[0][1];

            /* An expression does not span lines. CALC_RE joins operands with
               \s*, which matches a newline, so a line ENDING in a number fused
               with the next line starting in a signed one and produced a
               fabricated equation, reported to the student as their mistake.
               See the matching comment in index.html; parity.js compares. */
            if (strpbrk($whole, "\r\n") !== false) continue;

            $before = $at > 0 ? substr($md, $at - 1, 1) : ' ';
            $after  = substr($md, $at + strlen($whole), 1);
            if ($after === false || $after === '') $after = ' ';

            /* A radical, superscript or bracket immediately before means these
               digits are PART of a larger term. "2√3/3 + 1/3 = 13/3" was read
               as "3/3 + 1/3 = 13/3" — the tail of a surd — and reported as
               failed arithmetic on a correct answer. That is the worst kind of
               false positive: it tells a student their right answer is wrong. */
            if (preg_match('/[A-Za-z0-9_.^)]/', $before)) continue;
            if (preg_match('/[\x{221A}\x{221B}\x{221C}]/u', $before)) continue;
            if (preg_match('/[A-Za-z0-9^]/', $after)) continue;
            if (preg_match('/[()^%]/u', $whole)) continue;
            if (preg_match('/[\x{221A}\x{221B}\x{221C}]/u', $whole)) continue;

            /* The match can also start mid-surd. Walk back over the digits and
               operators of this expression; refuse if a radical sits behind. */
            $back = $at - 1;
            while ($back >= 0 && preg_match('/[\d\s.,+\-*\/]/', substr($md, $back, 1))) $back--;
            if ($back >= 0) {
                $bc = substr($md, max(0, $back - 2), 3);
                if (preg_match('/[\x{221A}\x{221B}\x{221C}]/u', $bc)) continue;
            }

            /* An arithmetic check is only honest if the WHOLE expression is
               numeric. "x² − 64x + 1024 − 600 = 0" ends in a numeric tail that
               reads as "1024 − 600 = 0". '=' ends the scan too, so the label in
               "P = 4/36 = 1/9" is not mistaken for part of the expression. */
            $cut = -1;
            for ($bi = $at - 1; $bi >= 0 && $at - $bi < 220; $bi--) {
                if (preg_match('/[\n,;:(){}\[\]=]/', substr($md, $bi, 1))) { $cut = $bi; break; }
            }
            $lead = substr($md, $cut + 1, $at - $cut - 1);
            if (preg_match('/[A-Za-z]/', $lead)) continue;  // algebra, not arithmetic

            /* A spaced x is a multiplication sign; evalFlat only knows the
               symbol operators. An attached x is a variable and never gets
               here, because CALC_RE requires whitespace on both sides.
               Mirrors index.html; parity.js compares. */
            $got   = self::evalFlat(preg_replace('/\s+[xX]\s+/u', '*', $m[1][0]));
            $exact = strpos($m[2][0], '/') !== false;       // result written as a fraction
            $want  = $exact ? self::evalFlat($m[2][0]) : self::toNum($m[2][0]);
            if (!is_finite($got) || !is_finite($want)) continue;

            /* INTEGER DIVISION IS NOT A MISTAKE.
               "59 ÷ 3 = 19 remainder 2" is correct arithmetic, but the match
               stops at the 19 and the checker judged it as 59/3 = 19 exactly —
               so a page of perfectly good remainder working came back as five
               failed checks. Worse, the ±0.5 tolerance for an integer let
               "59 ÷ 2 = 29" PASS while its four siblings failed, which is the
               checker contradicting itself in public.

               A quotient written as the floor of the true value is integer
               division, and this engine has no way to know whether the student
               meant that or an exact result — so it says nothing. A quotient
               that is not the floor either ("59 ÷ 3 = 20") is still wrong on
               both readings and is still reported. */
            $intDivision = false;
            if (preg_match('/^\s*-?[\d,]+(?:\.\d+)?\s*[÷\/]\s*-?[\d,]+(?:\.\d+)?\s*$/u', $m[1][0])
                && !$exact && abs($want - round($want)) < 1e-9 && abs($got - round($got)) > 1e-9) {
                if (abs($want - floor($got)) < 1e-9) continue;          // integer division → no verdict
                /* Not the floor either, so it is wrong on BOTH readings. It
                   must also be compared EXACTLY: the ±0.5 tolerance that an
                   integer earns from "no decimals written" was forgiving
                   "59 ÷ 3 = 20" and "7 ÷ 2 = 4", because a wrong quotient is
                   usually wrong by less than half. */
                $intDivision = true;
            }
            /* An explicit remainder in the same breath settles it outright. */
            if (preg_match('/^[^\n]{0,24}\b(r|rem|remainder|शेष|శేషం)\b/iu', substr($md, $at + strlen($whole)))) continue;

            $key = preg_replace('/\s+/u', '', $whole);
            if (isset($seen[$key])) continue;
            $seen[$key] = 1;

            /* A fraction carries no decimals, so the written-decimals rule gave
               it a tolerance of 0.5 and passed 4/36 = 1/8. Exact forms compare
               exactly. */
            $agree = ($exact || $intDivision)
                ? abs($got - $want) <= max(1.0, abs($got)) * 1e-9
                : self::near($got, $want, $m[2][0]);

            $out[] = ['kind' => 'arith', 'ok' => $agree,
                      'text' => trim(preg_replace('/\s+/u', ' ', $whole)),
                      'got' => Algebra::round6($got), 'want' => Algebra::round6($want)];
        }
        self::closedForm($md, $out, $seen);
        return $out;
    }

    /* The tokeniser reads every letter as its own variable, which is right for
       "3xy" and wrong for "Solve" — which parses beautifully as s·o·l·v·e. */
    public static function looksAlgebraic(string $cand): bool
    {
        if (!preg_match_all('/[a-zA-Z]{5,}/', $cand, $m)) return true;
        foreach ($m[0] as $run) {
            $w = strtolower($run);
            if (!Algebra::isFunctionName($w) && !Algebra::isConstName($w)) return false;
        }
        return true;
    }

    /* Longest run of algebra around an '=' that the parser accepts. Returning
       null is normal and safe — no equation, no check. */
    public static function findEquation(string $text): ?array
    {
        $best = null;
        $re = '/' . self::EQ_CHARS . '{1,80}=' . self::EQ_CHARS . '{1,80}/u';
        if (!preg_match_all($re, $text, $ms)) return null;

        foreach ($ms[0] as $hit) {
            $words = preg_split('/\s+/u', trim($hit), -1, PREG_SPLIT_NO_EMPTY);
            if ($words === false) continue;
            $n = count($words);
            for ($a = 0; $a < $n && $a < 10; $a++) {
                for ($b = $n; $b > $a; $b--) {
                    /* Trailing sentence punctuation must come off before the
                       parser sees it. "2(x+3) = 11." tokenised "11." and
                       refused, so an equation ending a sentence — which is
                       most of them in prose — was invisible to every check
                       built on this function. A decimal is unaffected: 1.5
                       does not END in a dot. */
                    $cand = rtrim(trim(implode(' ', array_slice($words, $a, $b - $a))), '.,;:');
                    if (strpos($cand, '=') === false) continue;
                    if (!self::looksAlgebraic($cand)) continue;
                    $eq = Algebra::parseEquation($cand);
                    if ($eq === null || !count($eq['vars']) || count($eq['vars']) > 3) continue;
                    if ($best === null || strlen($cand) > strlen($best['src'])) {
                        $best = ['eq' => $eq, 'src' => $cand];
                    }
                    break;
                }
            }
        }
        return $best;
    }

    public static function withHead(string $md, string $emoji): string
    {
        $re = '/##\s*' . preg_quote($emoji, '/') . '([^\n]*\n[\s\S]*?)(?=\n##\s|$)/u';
        return preg_match($re, $md, $m) ? $m[1] : '';
    }

    /* Where the answer is CLAIMED, as opposed to where it is worked out. A
       checker that reads the working judges intermediate lines the answer has
       already moved past. */
    public static function claimZone(string $md): string
    {
        $zone = self::withHead($md, '✅') . "\n" . self::withHead($md, '🎯');
        if (trim($zone) !== '') return $zone;
        return mb_substr($md, 0, 400);
    }
    /* ---------- A CONCLUSION IS A CLAIM WHEREVER THE ANSWER PUTS IT ----------
       claimZone is the ✅ and 🎯 sections, and every completeness gate read
       CLAIMS_ALL out of it. A reported answer put its claim somewhere else:

           ## ✅ Final Answer
           (x, y, z) = (3, 3, 3)
           ...
           12. Conclusion – The only positive integer triple satisfying the
               original equation is (3,3,3).

       The Final Answer names a triple and claims nothing. The claim is in step
       12, outside the zone, so CLAIMS_ALL never saw it — and with a question
       that did not say "find all" either, nothing asked for completeness at
       all. Three passing substitutions certified it GREEN. The answer is false:
       (3,3,6) gives 54 = 54.

       This is the phrasing bug one door along. It used to be decided by how the
       QUESTION was worded; that was fixed by also reading the answer's own
       claim — and then decided by which SECTION the model happened to put its
       conclusion in.

       Scoped lines are excluded: a claim about a sub-case is not a claim about
       the problem, and holding the whole answer to "Case k=1 … the only
       solution is …" would dispute correct work for showing its cases.

       The DOMAIN is read from the same widened zone, and has to be. "The only
       positive integer triple" is the only place that answer says which integers
       it means, and a completeness gate with no domain has nothing to enumerate
       over.

       Mirrors answerClaimZone() in index.html. */
    private const CASE_SCOPED =
        '/\b(cases?|sub-?cases?|if|when|whenever|assume|suppose|provided|given that|otherwise|either)\b'
      . '|\bfor\s+[a-z]\s*(?:[≥>≤<=]|is)/iu';
    public static function answerClaimZone(string $md): string
    {
        $zone = self::claimZone($md);
        $extra = [];
        foreach (preg_split('/\r?\n/', $md) as $line) {
            if (!preg_match(Exhaustion::CLAIMS_ALL, $line)) continue;
            if (preg_match(self::CASE_SCOPED, $line)) continue;
            if (strpos($zone, $line) !== false) continue;
            $extra[] = $line;
        }
        return $extra ? $zone . "\n" . implode("\n", $extra) : $zone;
    }

    /* ---------- LaTeX → plain maths ----------
       Models answer in LaTeX by default. Without this the checker sees
       \[x^{2}+y^{2}+1=3xy\] and \frac{-4}{2}, parses none of it, and reports
       "0 checks" — which looks like a clean run and is in fact total blindness.
       That is the worst possible failure for a verifier, so this runs before
       every check rather than being an optional tidy-up. */
    /* ---------- superscript letters and signs ----------
       A SUPERSCRIPT THE TOKENISER CANNOT READ IS AN EQUATION THROWN AWAY.
       Superscript digits already parse — x² and x⁴ both do. Superscript LETTERS
       and the superscript plus and minus never have, so
    
           2ⁿ⁺¹ = 8        3ˣ⁺ʸ = 9        10⁻³
    
       produced no equation at all: no integrity check, no substitution, no
       completeness. The answer came back with nothing said about it, and nothing
       on the page indicated the question had not even been read.
    
       It is decoded here rather than in the paste handler because the paste
       handler is only one way in. A shared link, an OCR read and the API all
       reach the tokeniser without passing it, and /v1 has no clipboard at all.
    
       Digit-only runs are deliberately left alone: they parse already, and
       rewriting x² into x^(2) would change text the student is looking at for
       no gain.

       Mirrors deSuper() in index.html. */
    private const UNI_SUPER = [
        '⁰' => '0', '¹' => '1', '²' => '2', '³' => '3', '⁴' => '4', '⁵' => '5',
        '⁶' => '6', '⁷' => '7', '⁸' => '8', '⁹' => '9',
        '⁺' => '+', '⁻' => '-', '⁼' => '=', '⁽' => '(', '⁾' => ')',
        'ⁱ' => 'i', 'ⁿ' => 'n',
        'ᵃ' => 'a', 'ᵇ' => 'b', 'ᶜ' => 'c', 'ᵈ' => 'd', 'ᵉ' => 'e', 'ᶠ' => 'f',
        'ᵍ' => 'g', 'ʰ' => 'h', 'ʲ' => 'j', 'ᵏ' => 'k', 'ˡ' => 'l', 'ᵐ' => 'm',
        'ᵒ' => 'o', 'ᵖ' => 'p', 'ʳ' => 'r', 'ˢ' => 's', 'ᵗ' => 't', 'ᵘ' => 'u',
        'ᵛ' => 'v', 'ʷ' => 'w', 'ˣ' => 'x', 'ʸ' => 'y', 'ᶻ' => 'z',
    ];
    private const UNI_SUPER_RUN =
        '/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻ]+/u';
    public static function deSuper(string $str): string
    {
        if (!preg_match(self::UNI_SUPER_RUN, $str)) return $str;
        return (string)preg_replace_callback(self::UNI_SUPER_RUN, static function ($m) {
            $run = $m[0];
            $plain = '';
            foreach (preg_split('//u', $run, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
                if (!isset(self::UNI_SUPER[$ch])) return $run;
                $plain .= self::UNI_SUPER[$ch];
            }
            if (preg_match('/^[0-9]+$/', $plain)) return $run;   /* already parses */
            return '^(' . $plain . ')';
        }, $str);
    }

    public static function deLatex(string $md): string
    {
        $s = self::deSuper($md);
        /* The fast path must also let braced superscripts through. Checking
           only for a backslash or a dollar meant "x^{2} - 164x + 424 = 0" —
           no delimiters, exactly how a model writes it inline in markdown —
           returned untouched, and the tokeniser cannot read "^{2}". The result
           was an equation that looked unparseable while being perfectly
           ordinary. */
        if (strpos($s, '\\') === false && strpos($s, '$') === false
            && strpos($s, '^{') === false && strpos($s, '_{') === false) return $s;

        /* Code is left alone — a programming answer may legitimately contain
           backslashes and dollar signs. */
        $guards = [];
        $s = preg_replace_callback('/```[\s\S]*?```|`[^`\n]*`/u', function ($m) use (&$guards) {
            $guards[] = $m[0];
            return ' G' . (count($guards) - 1) . ' ';
        }, $s);

        $s = preg_replace('/\\\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/u', '$1', $s);

        /* \frac{a}{b} → (a)/(b); twice, so one level of nesting survives */
        for ($i = 0; $i < 2; $i++) {
            $s = preg_replace_callback('/\\\\d?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/u', static function ($m) {
                $a = trim($m[1]);
                $b = trim($m[2]);
                $na = preg_match('/^[\d.]+$/', $a) ? $a : '(' . $a . ')';
                $nb = preg_match('/^[\d.]+$/', $b) ? $b : '(' . $b . ')';
                return $na . '/' . $nb;
            }, $s);
        }

        $s = preg_replace('/\\\\sqrt\s*\[\s*3\s*\]\s*\{([^{}]+)\}/u', 'cbrt($1)', $s);
        $s = preg_replace_callback('/\\\\sqrt\s*\{([^{}]+)\}/u', static function ($m) {
            $t = trim($m[1]);
            return '√' . (preg_match('/^[\w.]+$/u', $t) ? $t : '(' . $t . ')');
        }, $s);
        $s = preg_replace('/\\\\sqrt\s*(\w+)/u', '√$1', $s);

        $sup = ['0' => '⁰', '1' => '¹', '2' => '²', '3' => '³', '4' => '⁴',
                '5' => '⁵', '6' => '⁶', '7' => '⁷', '8' => '⁸', '9' => '⁹'];
        $s = preg_replace_callback('/\^\s*\{\s*(-?\d)\s*\}/u',
            static fn($m) => $sup[$m[1]] ?? ('^' . $m[1]), $s);
        /* A compound exponent keeps its grouping. Stripping the braces turned
           3^{x+y} into 3^x+y — which is (3^x)+y, a different expression — so
           a pure formatting difference silently became a mathematical one.
           That is the precise failure the integrity check exists to catch, and
           deLatex was manufacturing it. Single digits are already handled
           above and become ² ³ ⁴. */
        $s = preg_replace('/\^\s*\{([^{}]+)\}/u', '^($1)', $s);
        $s = preg_replace_callback('/\^(\d)(?![\d.])/u',
            static fn($m) => $sup[$m[1]] ?? ('^' . $m[1]), $s);
        $s = preg_replace('/_\s*\{([^{}]+)\}/u', '$1', $s);

        $sym = [
            'times' => '×', 'div' => '÷', 'cdot' => '·', 'pm' => '±', 'mp' => '∓',
            'neq' => '≠', 'ne' => '≠', 'leq' => '≤', 'le' => '≤', 'geq' => '≥', 'ge' => '≥',
            'approx' => '≈', 'equiv' => '≡', 'infty' => '∞', 'pi' => 'π', 'theta' => 'θ',
            'alpha' => 'α', 'beta' => 'β', 'gamma' => 'γ', 'delta' => 'Δ', 'lambda' => 'λ',
            'mu' => 'μ', 'sigma' => 'σ', 'omega' => 'ω', 'Rightarrow' => '⇒',
            'rightarrow' => '→', 'to' => '→', 'implies' => '⇒', 'iff' => '⇔',
            'therefore' => '∴', 'because' => '∵', 'in' => '∈', 'notin' => '∉',
            'subset' => '⊂', 'cup' => '∪', 'cap' => '∩', 'forall' => '∀', 'exists' => '∃',
            'sum' => '∑', 'int' => '∫', 'prod' => '∏', 'ldots' => '…', 'dots' => '…',
            'cdots' => '…', 'quad' => ' ', 'qquad' => '  ', ',' => ' ', ';' => ' ', '!' => '',
            /* Presentation wrappers carry no mathematics. \boxed is the one
               that mattered: a model boxes its restatement, the command and
               its braces survived, EQ_CHARS has no braces, and the correct
               restatement became unreadable — so the integrity check fell
               through to a later derivation step and flagged a faithful
               answer. Nested content ("3^{x+y+1}") is why this is stripped as
               a bare command with the braces cleaned up afterwards rather than
               matched as \boxed{...}. */
            'boxed' => '', 'displaystyle' => '', 'textstyle' => '', 'limits' => '',
        ];
        $s = preg_replace_callback('/\\\\([A-Za-z]+|[,;!])/u',
            static fn($m) => array_key_exists($m[1], $sym) ? $sym[$m[1]] : $m[0], $s);

        $s = preg_replace('/\\\\left\s*|\\\\right\s*/u', '', $s);
        $s = preg_replace('/\\\\begin\{[^}]*\}|\\\\end\{[^}]*\}/u', '', $s);
        $s = preg_replace('/\\\\\\\\/u', "\n", $s);
        $s = preg_replace('/\\\\[()\[\]]/u', '', $s);

        $s = preg_replace_callback('/\$\$([\s\S]*?)\$\$/u',
            static fn($m) => "\n" . trim($m[1]) . "\n", $s);
        $s = preg_replace('/\$([^$\n]+)\$/u', '$1', $s);

        /* Any braces still standing are the empty shells of stripped wrappers.
           Every rule that needed braces — \frac, \sqrt, ^{}, _{} — has already
           run, so what is left is presentation, and leaving it in makes the
           expression unparseable. */
        $s = str_replace(['{', '}'], '', $s);

        return preg_replace_callback('/ G(\d+) /u',
            static fn($m) => $guards[(int)$m[1]] ?? $m[0], $s);
    }

    /* Evaluate a constant expression — "82 - 30√7", "1/2", "(164 - 60√7)/2" —
       to a number, or null if it is not a closed numeric expression. */
    public static function constOf(string $txt): ?float
    {
        $t = trim(preg_replace('/[.;,]+$/u', '', trim($txt)));
        if ($t === '' || !preg_match('/\d/', $t)) return null;
        $ast = Algebra::parse($t);
        if ($ast === null) return null;
        if (count(Algebra::varsOf($ast))) return null;    // still a variable → not a value
        $n = Algebra::evalAt($ast, []);
        return is_finite($n) ? $n : null;
    }

    /* ---------- A VALUE OF ANOTHER EQUATION IS NOT A CLAIMED SOLUTION ----------
       Every number pair in brackets was read as a solution the answer was putting
       forward. A reported answer solved x²+y²−5xy=25 by the standard route — as a
       quadratic in x, require the discriminant 21y²+100 to be a square, solve the
       Pell equation k²−21y²=100 — and wrote (k₀,y₀) = (11,1) and the fundamental
       unit (55,12). Both were harvested as claimed (x,y) solutions and both were
       disputed. Neither was ever offered as a solution; they are the working.

       Two rules, and the second is the one that carries it:

         · a tuple LABELLED with variables that are not the question's
           — "(k,y) = (11,1)" is working, "(x,y) = (1,8)" is a claim
         · a tuple that SOLVES an equation the answer itself states over
           different variables — (11,1) solves k²−21y²=100, (55,12) solves
           u²−21v²=1, and neither solves the question

       The second needs no vocabulary and no guessing about phrasing. It only
       ever withdraws a dispute, and only when the answer supplied the equation
       that explains the pair: (121,25) in that same answer solves nothing it
       wrote down, so it stays disputed — correctly, it is a real mistake.

       Mirrors claimedTuples() and auxEquations() in index.html. */
    private const TUPLE_LABEL =
        '/\(\s*([A-Za-z][A-Za-z0-9_\'′]{0,3}(?:\s*,\s*[A-Za-z][A-Za-z0-9_\'′]{0,3}){1,2})\s*\)\s*(?:=|:|\bis\b|\bare\b)?\s*$/u';
    private static function labelVars(string $text): ?array
    {
        if (!preg_match(self::TUPLE_LABEL, $text, $m)) return null;
        $out = [];
        foreach (explode(',', $m[1]) as $v) {
            $v = trim($v);
            $v = preg_replace('/[0-9_\'′]+$/u', '', $v);
            $v = preg_replace('/[₀₁₂₃₄₅₆₇₈₉ₙ]+$/u', '', $v);
            $out[] = mb_strtolower($v);
        }
        return $out;
    }
    /* A LABEL CAN SIT ON THE FAR SIDE OF A CHAINED EQUALITY. The 24-character
       window catches "(k,y) = (11,1)". It does not catch
       
           (k,y) = (55*11 + 21*12*1, 55*1 + 12*11) = (187,8)
       
       where the label is forty characters to the left with an arithmetic expression
       in between — and (187,8) satisfies neither the question nor the answer's own
       Pell equation, so neither existing rule excluded it and the receipt reported a
       (k,y) pair as a claimed (x,y) solution.
       
       So when the tuple is the RIGHT-HAND SIDE of an equals sign, the chain is walked
       left to its head. The walk stops at a full stop, a semicolon or a newline,
       because a label on the other side of a sentence boundary belongs to a different
       statement: "(k,y) = (11,1). The solutions are (1,8)" must still read (1,8) as a
       claim, and it does. */
    private const LABEL_HEAD =
        '/\(\s*([A-Za-z][A-Za-z0-9_\'′]{0,3}(?:\s*,\s*[A-Za-z][A-Za-z0-9_\'′]{0,3}){1,2})\s*\)\s*=/u';
    private static function labelBefore(string $md, int $at): ?array
    {
        $near = substr($md, max(0, $at - 24), min(24, $at));
        $lab = self::labelVars($near);
        if ($lab !== null) return $lab;
        if (!preg_match('/=\s*$/u', $near)) return null;   /* not the tail of a chain */
        $win = substr($md, max(0, $at - 200), min(200, $at));
        $cut = max(strrpos($win, '. ') === false ? -1 : strrpos($win, '. '),
                   strrpos($win, "\n") === false ? -1 : strrpos($win, "\n"),
                   strrpos($win, ';') === false ? -1 : strrpos($win, ';'));
        if ($cut >= 0) $win = substr($win, $cut + 1);
        if (!preg_match(self::LABEL_HEAD, $win, $m)) return null;
        $out = [];
        foreach (explode(',', $m[1]) as $v) {
            $v = trim($v);
            $v = preg_replace('/[0-9_\'′]+$/u', '', $v);
            $v = preg_replace('/[₀₁₂₃₄₅₆₇₈₉ₙ]+$/u', '', $v);
            $out[] = mb_strtolower($v);
        }
        return $out;
    }

    /** Equations the ANSWER states over variables that are not the question's. */
    private static function auxEquations(string $md, array $vars): array
    {
        $out = []; $seen = [];
        $want = $vars; sort($want); $want = implode(',', $want);
        $re = '/' . self::EQ_CHARS . '{1,80}=' . self::EQ_CHARS . '{1,80}/u';
        if (!preg_match_all($re, $md, $ms)) return $out;
        foreach ($ms[0] as $hit) {
            if (count($out) >= 8) break;
            $words = preg_split('/\s+/u', trim($hit));
            $n = count($words);
            for ($a = 0; $a < $n && $a < 8 && count($out) < 8; $a++) {
                for ($b = $n; $b > $a; $b--) {
                    $cand = rtrim(trim(implode(' ', array_slice($words, $a, $b - $a))), '.,;:');
                    if (strpos($cand, '=') === false) continue;
                    if (!self::looksAlgebraic($cand)) continue;
                    if (isset($seen[$cand])) continue;
                    $seen[$cand] = 1;
                    $eq = Algebra::parseEquation($cand);
                    /* continue, not break: one SPAN failing is not the run failing,
                       and a shorter span of the same match may be the equation. */
                    if ($eq === null || count($eq['vars']) !== count($vars)) continue;
                    $ev = $eq['vars']; sort($ev);
                    if (implode(',', $ev) === $want) continue;
                    if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) continue;
                    $out[] = $eq;
                    break;
                }
            }
        }
        return $out;
    }
   /* A COINCIDENCE MUST NOT COST A CLAIM. (25,5) solves the question —
       625 + 25 − 625 = 25 — and it also solves the Pell equation the same answer
       introduced, 625 − 525 = 100. Skipping every tuple that satisfies the
       machinery threw that one away, and with it the whole (5,25) family: the
       descent then reported two families missing from an answer that had listed
       all three.
    
       So the test is not "does it solve the machinery" but "does it solve the
       machinery AND NOT the question". A pair that answers the question is a
       claim no matter what else it happens to satisfy.
      */
    public static function claimedTuples(string $md, int $nvars, ?array $vars = null, ?array $ownEq = null): array
    {
        $out = [];
        $seen = [];
        if ($nvars < 2) return $out;
        $want = null;
        if ($vars !== null) { $want = array_map(static fn($v) => mb_strtolower((string)$v), $vars); }
        $aux = null;
        $re = '/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?)\s*)?\)/u';
        if (!preg_match_all($re, $md, $ms, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) return $out;
        foreach ($ms as $m) {
            $tup = [(float)$m[1][0], (float)$m[2][0]];
            if (isset($m[3]) && $m[3][0] !== '') $tup[] = (float)$m[3][0];
            if (count($tup) !== $nvars) continue;
            if ($want !== null) {
                $at = (int)$m[0][1];
                $lab = self::labelBefore($md, $at);
                if ($lab !== null && count($lab) === count($want) && $lab !== $want) continue;
                /* a pair that answers the QUESTION is a claim, whatever else it satisfies */
                $solves = false;
                if ($ownEq !== null) {
                    $qenv = [];
                    foreach ($ownEq['vars'] as $qi => $qn) $qenv[$qn] = $tup[$qi] ?? 0;
                    $solves = Algebra::holdsAt($ownEq, $qenv) === true;
                }
                if (!$solves) {
                    if ($aux === null) $aux = self::auxEquations($md, $want);
                    $isAux = false;
                    foreach ($aux as $ae) {
                        $env = [];
                        foreach ($ae['vars'] as $vi => $vn) $env[$vn] = $tup[$vi] ?? 0;
                        if (Algebra::holdsAt($ae, $env) === true) { $isAux = true; break; }
                    }
                    if ($isAux) continue;
                }
            }
            $key = implode(',', $tup);
            if (isset($seen[$key])) continue;
            $seen[$key] = 1;
            $out[] = $tup;
            if (count($out) >= 14) break;
        }
        return $out;
    }

    /* ---------- substitute the claimed answer back in ----------
       The check that did not exist when `x² + y² + 1 = 3xy` with a claimed
       (5,3) went to a student: 35 ≠ 45, and nothing could notice. */
    /* ============================================================
       SOLUTION COMPLETENESS  (port of the JS of the same name)
       ------------------------------------------------------------
       substitution proves "every root offered is genuine". It does
       NOT prove "these are all of them", and the difference is a
       mark: x³ − 6x² + 11x − 6 = 0 answered "x = 1, x = 2" passed
       every check in the engine, because 1 and 2 really are roots
       and nothing counted them against the degree.

       This is not a value count — degree is not the number of real
       roots. (x−2)² = 0 has one distinct root and multiplicity two;
       x² + 1 = 0 has none over the reals.

       Coefficients come from finite differences of f(x) = L − R and
       must be integers; rational roots come from the rational-root
       theorem and are deflated exactly by synthetic division, so
       the school cases are found exactly rather than by a
       root-finder that could miss one. What remains must be degree
       ≤ 2 and closed-form, or there is no verdict. Everything else
       bails: no verdict beats a wrong verdict.

       Completeness is asserted over the REALS. Where a polynomial
       also has a complex pair the check refuses to certify the
       answer complete and says so advisorily, rather than either
       failing correct real-only work or pretending it is the whole
       solution set.
       ============================================================ */
    public static function polyOf(array $eq, string $v): ?array
    {
        /* The cap was 6, so a fully factored degree-8 product reconstructed as
           nothing and completeness could not run. 12 is chosen by arithmetic:
           reconstruction samples at x = 0…MAXD+1, so degree 12 evaluates at 13,
           and 13^12 is about 2.3e13 — inside the range where a double still
           represents every integer exactly. Mirrors index.html. */
        $MAXD = 12; $y = [];
        for ($i = 0; $i <= $MAXD + 1; $i++) {
            $a = Algebra::evalAt($eq['L'], [$v => (float)$i]);
            $b = Algebra::evalAt($eq['R'], [$v => (float)$i]);
            if (is_nan($a) || is_nan($b) || is_infinite($a) || is_infinite($b)) return null;
            $y[] = $a - $b;
        }
        $scale = 1.0;
        foreach ($y as $t) $scale = max($scale, abs($t));

        $rows = [$y]; $d = -1;
        for ($k = 1; $k <= $MAXD + 1; $k++) {
            $prev = $rows[$k - 1]; $cur = [];
            for ($j = 0; $j + 1 < count($prev); $j++) $cur[] = $prev[$j + 1] - $prev[$j];
            $rows[] = $cur;
            if (count($cur)) {
                $zero = true;
                foreach ($cur as $t) if (abs($t) > 1e-7 * $scale) { $zero = false; break; }
                if ($zero) { $d = $k - 1; break; }
            }
        }
        if ($d < 1) return null;

        /* f(x) = Σ Δᵏf(0)/k! · x(x−1)…(x−k+1) */
        $T = [1.0]; $out = array_fill(0, $d + 1, 0.0); $fact = 1.0;
        for ($k = 0; $k <= $d; $k++) {
            if ($k > 0) $fact *= $k;
            $c = $rows[$k][0] / $fact;
            for ($j = 0; $j < count($T); $j++) $out[$j] = ($out[$j] ?? 0.0) + $c * $T[$j];
            $nT = array_fill(0, count($T) + 1, 0.0);
            for ($j = 0; $j < count($T); $j++) { $nT[$j + 1] += $T[$j]; $nT[$j] += -$k * $T[$j]; }
            $T = $nT;
        }
        $ints = [];
        foreach ($out as $c) {
            $r = round($c);
            if (abs($c - $r) > 1e-6 * max(1.0, abs($c))) return null;
            $ints[] = (int)$r;
        }
        while (count($ints) > 1 && $ints[count($ints) - 1] === 0) array_pop($ints);
        return count($ints) >= 2 ? $ints : null;
    }

    public static function realRootsOf(array $eq, string $v): ?array
    {
        $a = self::polyOf($eq, $v);
        if ($a === null) return null;
        $deg = count($a) - 1; $roots = []; $mult = 0;

        $has = static function (array $rs, float $x): bool {
            foreach ($rs as $y) if (abs($y - $x) < 1e-9) return true;
            return false;
        };
        while (count($a) > 1 && $a[0] === 0) { array_shift($a); $roots[] = 0.0; $mult++; }

        if (count($a) > 1) {
            $divs = static function (int $n): array {
                $n = abs($n); $o = [];
                for ($q = 1; $q <= $n && $q <= 5000; $q++) if ($n % $q === 0) $o[] = $q;
                return $o;
            };
            $cand = []; $seen = [];
            foreach ($divs($a[0]) as $p) {
                foreach ($divs($a[count($a) - 1]) as $q) {
                    foreach ([$p / $q, -$p / $q] as $x) {
                        $k = (string)round($x * 1e9);
                        if (!isset($seen[$k])) { $seen[$k] = 1; $cand[] = (float)$x; }
                    }
                }
            }
            foreach ($cand as $r) {
                $guard = 0;
                while (count($a) > 1 && $guard++ < 8) {
                    $hi = array_reverse($a); $q2 = [$hi[0]];
                    for ($j = 1; $j < count($hi); $j++) $q2[] = $hi[$j] + $q2[$j - 1] * $r;
                    $rem = array_pop($q2);
                    if (abs($rem) > 1e-9 * max(1.0, abs((float)$a[0]))) break;
                    $a = array_reverse($q2);
                    $mult++;
                    if (!$has($roots, $r)) $roots[] = $r;
                }
            }
        }

        $left = count($a) - 1;
        if ($left === 2) {
            $C = (float)$a[0]; $B = (float)$a[1]; $A = (float)$a[2];
            $disc = $B * $B - 4 * $A * $C;
            if ($disc > 1e-9) {
                foreach ([(-$B + sqrt($disc)) / (2 * $A), (-$B - sqrt($disc)) / (2 * $A)] as $x)
                    if (!$has($roots, $x)) $roots[] = $x;
                $mult += 2;
            } elseif ($disc > -1e-9) {
                $x0 = -$B / (2 * $A);
                if (!$has($roots, $x0)) $roots[] = $x0;
                $mult += 2;
            }
        } elseif ($left > 2) {
            return null;
        }

        sort($roots);
        return ['real' => $roots, 'degree' => $deg, 'realMult' => $mult, 'complex' => $deg - $mult];
    }

    /** Reached only when realRootsOf could not reconstruct a polynomial. */
    private static function monotoneCompleteness(array $eq, string $v, string $md): array
    {
        $dir = Algebra::monotone(['t' => 'b', 'op' => '-', 'a' => $eq['L'], 'b' => $eq['R']], $v);
        if ($dir !== 1 && $dir !== -1) return [];

        $claimed = self::claimedRoots(self::claimZone($md), $v);
        /* Two claimed values cannot both be roots of a strictly monotone
           function, so a list of them is substitution's fault to report, not a
           completeness story. One claim is the only case this can speak to. */
        if (count($claimed) !== 1) return [];

        /* Completeness may only speak when there is a root to be complete about,
           and it must read the claim at the SAME declared precision substitution
           does. An invented tolerance here would refuse the decimals the rest of
           the engine accepts.

           This is also what makes the argument a proof rather than an estimate:
           monotonicity gives AT MOST one root, a sign change across the
           student's own rounding interval gives AT LEAST one root inside it,
           and together they give exactly one — the claimed one. */
        $root = $claimed[0];
        $d = Algebra::decimalsFor($md, $root);
        if ($d === null) {
            $isRoot = Algebra::holdsAt($eq, [$v => $root]);   /* exact or algebraic claim */
        } else {
            $half = pow(10, -$d) / 2;
            $isRoot = Algebra::rootInInterval($eq, $v, $root - $half, $root + $half);
        }
        if ($isRoot !== true) return [];

        return [['kind' => 'roots', 'ok' => true,
            'text' => 'the difference between the two sides is strictly ' .
                      ($dir > 0 ? 'increasing' : 'decreasing') .
                      ', so this equation has at most one solution — and the answer accounts for it']];
    }

    public static function solutionCompleteness(string $question, string $md): array
    {
        $found = self::findEquation($question);
        if ($found === null) return [];
        $eq = $found['eq'];
        if (count($eq['vars']) !== 1) return [];
        if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) return [];
        $v = $eq['vars'][0];
        $info = self::realRootsOf($eq, $v);
        /* Not a polynomial this engine can reconstruct. Before giving up, ask
           whether the equation is monotone — that settles completeness without
           needing the root count. */
        if ($info === null) return self::monotoneCompleteness($eq, $v, $md);

        /* CONSTRAINT PRESERVATION. "Find all POSITIVE integers n with n² − 4 = 0"
           has exactly one answer, n = 2, and reporting "n = −2 is also a root and
           is missing" disputes a correct reply. The root set is cut down to the
           domain the question set before completeness is judged against it, and a
           complex pair stops being a caveat when the question asked for integers.
           Mirrors solutionCompleteness() in index.html. */
        $dom = Exhaustion::domainOf($question);
        $narrowed = false;
        if ($dom !== null) {
            /* Exhaustion::domainBreak, not a private copy of its rules: "find all
               primes p with p² − 4p + 3 = 0" has roots 1 and 3 and only one of
               them is a prime. A second filter here would drift from the one the
               answer is judged by, and then the engine can demand a solution it
               would itself reject. */
            $keep = [];
            foreach ($info['real'] as $r) {
                if (Exhaustion::domainBreak($dom, [$v], [$r]) === null) $keep[] = $r;
            }
            $narrowed = count($keep) !== count($info['real']) || ($info['complex'] ?? 0) > 0;
            $info = ['real' => $keep, 'complex' => 0];
        }

        $zone = self::claimZone($md);
        $show = static function (float $n): string {
            $r = round($n, 6);
            $s = (abs($r - round($r)) < 1e-9) ? (string)(int)round($r) : (string)$r;
            return str_replace('-', '−', $s);
        };
        $NONE = '/\bno\s+(real\s+)?(solutions?|roots?)\b|\b(has|there\s+are)\s+no\s+real\b/i';
        $CPLX = '/(^|[^a-z])i([^a-z]|$)|\bimaginary\b|\bcomplex\b/i';

        if (!count($info['real'])) {
            if (preg_match($NONE, $zone))
                return [['kind' => 'roots', 'ok' => true,
                         'text' => ($dom !== null && $narrowed)
                             ? 'no solutions exist in ' . $dom['label'] . ', and the answer says so'
                             : 'no real solutions exist, and the answer says so']];
            if (preg_match($CPLX, $zone))
                return [['kind' => 'roots', 'ok' => false, 'soft' => true,
                         'text' => 'this equation has no real solutions and the answer gives complex ones — '
                                 . 'complex roots are outside what this engine can check, so the answer is not verified']];
            return [];
        }

        $claimed = self::claimedRoots($zone, $v);
        if (!count($claimed)) return [];
        $isRoot = static function (float $x) use ($info): bool {
            foreach ($info['real'] as $r) if (abs($r - $x) <= 1e-7 * max(1.0, abs($r))) return true;
            return false;
        };
        foreach ($claimed as $x) if (!$isRoot((float)$x)) return [];   // substitution's verdict

        $missing = [];
        foreach ($info['real'] as $r) {
            $hit = false;
            foreach ($claimed as $x) if (abs($r - (float)$x) <= 1e-7 * max(1.0, abs($r))) { $hit = true; break; }
            if (!$hit) $missing[] = $r;
        }
        if (count($missing)) {
            $names = implode(', ', array_map($show, $missing));
            $many = count($missing) > 1;
            return [['kind' => 'roots', 'ok' => false,
                     'text' => 'the solution is incomplete — ' . $v . ' = ' . $names
                             . ($many ? ' are also roots' : ' is also a root')
                             . ' and ' . ($many ? 'are' : 'is') . ' missing from the answer']];
        }
        $n = count($info['real']);
        if ($info['complex'] > 0) {
            return [['kind' => 'roots', 'ok' => false, 'soft' => true,
                     'text' => 'all ' . $n . ' real solution' . ($n > 1 ? 's are' : ' is')
                             . ' accounted for, but this equation also has complex roots that are outside what '
                             . 'this engine can check']];
        }
        return [['kind' => 'roots', 'ok' => true,
                 'text' => 'all ' . $n . ' solution' . ($n > 1 ? 's are' : ' is') . ' accounted for'
                         . (($dom !== null && $narrowed) ? ', over the ' . $dom['label'] . ' the question asked for' : '')]];
    }

    public static function substitution(string $question, string $md): array
    {
        $found = self::findEquation($question);
        if ($found === null) return [];
        $eq = $found['eq'];
        if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) return [];  // rule 1
        $zone = self::claimZone($md);

        if (count($eq['vars']) >= 2) {
            /* Read tuples from the WHOLE answer, not only the claim zone.
               An answer that lists its solutions in the working — "the
               solutions are (1,1,1), (1,1,2), (1,2,5), (1,5,13) and (5,1,1)" —
               is asserting every one of them, and the claim-zone-only reader
               checked the first and declared the answer fully verified while
               (5,1,1) gives 27 ≠ 15. Every tuple an answer puts forward as a
               solution is a claim, wherever on the page it is written. */
            $tuples = self::claimedTuples($md, count($eq['vars']), $eq['vars'], $eq);
            if (!count($tuples)) return [];
            /* FOUND IS NOT ALL. "Find all positive integers x, y with
               x² + y² + 1 = 3xy" answered with (1,1), (2,5) and (5,13) reached
               `checked` on three passing substitutions, and that equation has
               infinitely many solutions. Substitution proves each pair genuine
               and cannot prove there are no others, so a tuple offered against
               a "find all" question carries the same needsComplete flag the
               single-variable branch has carried since Phase 1. Mirrors
               substitution() in index.html. */
            /* The question's wording is not the only way a completeness claim gets
               made — an answer saying "the only solutions are ..." has made one
               itself, and a passing substitution must not certify it alone. */
            $mustBeAll = (bool)preg_match(Exhaustion::ALL_ASKED_RE, $question)
                      || (bool)preg_match(Exhaustion::CLAIMS_ALL, Checks::answerClaimZone($md));
            $out = [];
            foreach (array_slice($tuples, 0, 10) as $tp) {
                $env = [];
                foreach ($eq['vars'] as $i => $v) $env[$v] = $tp[$i];
                $ok = Algebra::holdsAt($eq, $env);
                if ($ok === null) continue;               // undefined there → say nothing
                $l = Algebra::round6(Algebra::evalAt($eq['L'], $env));
                $r = Algebra::round6(Algebra::evalAt($eq['R'], $env));
                $out[] = ['kind' => 'subst', 'ok' => $ok, 'needsComplete' => $mustBeAll,
                    'text' => '(' . implode(',', $eq['vars']) . ') = (' . implode(',', $tp) . ') in '
                            . trim($found['src']) . ' gives ' . $l . ($ok ? ' = ' : ' ≠ ') . $r];
            }
            return $out;
        }

        /* One variable: substitute EVERY claimed root. Checking only the first
           reports a clean pass on an answer whose second root is wrong. */
        $v0 = $eq['vars'][0];
        $roots = self::claimedRoots($zone, $v0);
        /* 12, not 6, to match polyOf degree cap. At 6 an answer listing 7 or more
           roots produced NO substitution checks, and completeness bails whenever a
           claimed value is not a root — leaving that case with no verdict from
           anyone. Mirrors index.html. */
        if (!count($roots) || count($roots) > 12) return [];

        $out = [];
        foreach ($roots as $rv) {
            $env = [$v0 => $rv];
            $ok = Algebra::holdsAt($eq, $env);
            if ($ok === null) continue;                   // undefined there → no verdict
            /* DECLARED PRECISION. Reached ONLY where the strict test already
               said no, and only for a value the student wrote as a decimal. It
               can turn a false into a true and never the reverse, so every
               answer that verified before still verifies on the same grounds.
               Mirrors index.html. */
            $toPrecision = false;
            if ($ok === false) {
                $dp = Algebra::decimalsFor($md, $rv);
                if ($dp !== null && $dp > 0) {
                    $half = 0.5 * pow(10, -$dp);
                    if (Algebra::rootInInterval($eq, $v0, $rv - $half, $rv + $half) === true) {
                        $ok = true;
                        $toPrecision = $dp;
                    }
                }
            }
            $l = Algebra::round6(Algebra::evalAt($eq['L'], $env));
            $r = Algebra::round6(Algebra::evalAt($eq['R'], $env));
            /* A root that checks out is EVIDENCE, not a complete answer.
               Putting x = 1, 2, 3 back into a degree-8 equation proves those
               three genuine and says nothing about the other five. Mirrors
               index.html; without it /v1 certified on evidence alone. */
            $out[] = ['kind' => 'subst', 'ok' => $ok, 'needsComplete' => true,
                'text' => $toPrecision !== false
                    ? $v0 . ' = ' . Algebra::round6($rv) . ' is a correct root of '
                      . trim($found['src']) . ' to the ' . $toPrecision . ' decimal place'
                      . ($toPrecision > 1 ? 's' : '') . ' it is written to — a root is proved '
                      . 'to lie inside the interval that figure denotes'
                    : $v0 . ' = ' . Algebra::round6($rv) . ' put back into '
                      . trim($found['src']) . ' gives ' . $l . ($ok ? ' = ' : ' ≠ ') . $r];
        }
        return $out;
    }

    /* Every value the text claims the variable takes.
       Pulled out of substitution() so the grader can read a STUDENT's roots
       with exactly the same reader that reads a model's — otherwise the two
       would drift, and a student would be marked against a different parse of
       their own answer than the one the verifier uses. */
    public static function claimedRoots(string $zone, string $v0): array
    {
        /* Strip markdown emphasis before reading any value. An answer written
           as "x = **82 + 30√7**" could not be parsed: the tokeniser turns **
           into ^, so the whole tail failed and the word-eating fallback
           harvested the fragment 82 — which satisfies nothing, and reported a
           CORRECT answer as disputed. Emphasis is presentation, never
           mathematics. */
        $zone = preg_replace('/\*\*|__|(?<![\w*])\*(?!\*)/u', '', $zone);
        $roots = [];
        $seen = [];
        $rejected = '/\b(extraneous|rejected?|discard(ed)?|invalid|not a solution|does not satisfy|fails)\b/i';
        $sep = '/\s*(?:,|\bor\b|\band\b|;|या|మరియు)\s*/iu';
        $re  = '/(?:^|[^0-9a-zA-Z])' . preg_quote($v0, '/') . '\s*=\s*([^\n=]{1,60})/iu';

        /* Scan manually and resume just after each '=', not after the whole
           tail. "x = 2 and x = 3" otherwise swallows the second statement into
           the first tail and the second root is silently never checked — which
           is the difference between catching a half-wrong answer and passing
           it. preg_match_all cannot express this; the offset walk can. */
        $offset = 0;
        $len = strlen($zone);
        /* 12, not 6, to match polyOf degree cap. A degree-8 equation has eight roots
           and a student who wrote all eight was having the last two silently
           dropped, which then read as an incomplete answer. Mirrors index.html. */
        while ($offset < $len && count($roots) <= 12) {
            if (!preg_match($re, $zone, $m, PREG_OFFSET_CAPTURE, $offset)) break;
            $at   = $m[0][1];
            $tail = $m[1][0];
            $offset = $at + strlen($m[0][0]) - strlen($tail);

            /* A qualifier applies to its OWN line and no further. Searching a
               character window instead reached onto the next line and skipped
               the real answer too — worse than the false positive it fixed. */
            $ls = strrpos(substr($zone, 0, $at), "\n");
            $ls = $ls === false ? 0 : $ls + 1;
            $le = strpos($zone, "\n", $at);
            if ($le === false) $le = $len;
            if (preg_match($rejected, substr($zone, $ls, $le - $ls))) continue;

            $tail = trim(preg_replace('/[.;]+\s*$/u', '', $tail));
            $got = [];

            /* "x = 2, 3" / "x = 2 or 3" — accepted only when EVERY part is a
               closed value on its own, so prose is not mistaken for a list. */
            $parts = preg_split($sep, $tail);
            /* Was capped at 4, so "x = 1, 2, 3, 4, 5" fell through to the word-eating
               fallback and yielded ONE root. $allOk below is what keeps this safe:
               every part must evaluate on its own. Mirrors index.html. */
            if ($parts !== false && count($parts) > 1 && count($parts) <= 12) {
                $all = [];
                $ok = true;
                foreach ($parts as $p) {
                    $n = self::constOf(trim($p));
                    if ($n === null) { $ok = false; break; }
                    $all[] = $n;
                }
                if ($ok) $got = $all;
            }

            /* "x = 82 ± 30√7" is TWO values, not the number 82. Without this
               the word-eating fallback stopped at 82 — an intermediate that
               satisfies nothing — and reported a correct answer as wrong. */
            $hasPm = (bool)preg_match('/[±∓]/u', $tail);
            if (!count($got) && $hasPm) {
                $plus  = self::constOf(preg_replace('/[±∓]/u', '+', $tail));
                $minus = self::constOf(preg_replace('/[±∓]/u', '-', $tail));
                if ($plus !== null && $minus !== null) $got = [$plus, $minus];
            }
            /* A ± family that will not resolve to two real numbers is a value
               this engine cannot represent — "x = -2 ± i√2" is the ordinary
               case, and it is CORRECT. Falling through to the word-eater there
               harvests the "-2", substitutes a fragment of the answer, and
               fails a right answer. Rule 1: no verdict beats a wrong verdict,
               so the whole claim is abandoned instead. */
            if (!count($got) && $hasPm) continue;

            /* One value: eat words off the end until what remains is a value,
               so "82 − 30√7, so the answer is…" still yields 82 − 30√7. */
            if (!count($got)) {
                $words = preg_split('/\s+/u', $tail, -1, PREG_SPLIT_NO_EMPTY) ?: [];
                for ($w = count($words); $w > 0; $w--) {
                    $cand = implode(' ', array_slice($words, 0, $w));
                    if (preg_match('/[±∓]/u', $cand)) continue;   // never halve a ± family
                    $n = self::constOf($cand);
                    if ($n !== null) { $got = [$n]; break; }
                }
            }

            foreach ($got as $n) {
                $k = (string)(round($n * 1e9) / 1e9);
                if (isset($seen[$k])) continue;
                $seen[$k] = 1;
                $roots[] = $n;
            }
        }
        return $roots;
    }

    /* ---------- QUESTION INTEGRITY ----------
       Every other check in this file asks "is the answer right?". This one
       asks the prior question: "is this the problem the student actually
       set?" — and it is the more important of the two for a paid tool,
       because a flawless solution to a misread question is indistinguishable
       from a correct answer unless somebody checks the reading.

       The failure that prompted it: a question containing 3x+y was solved as
       3(x+y). Every downstream check passed, because the answer really was
       correct — for a different problem.

       HOW IT AVOIDS CRYING WOLF
       -------------------------
       An answer legitimately contains many equations that differ from the
       question: x²=4, then x=±2. Those are derived steps, not misreadings,
       and flagging them would make this check worthless within a day.

       So it only reads the RESTATEMENT — the opening of the answer, where a
       model repeats the problem before starting — and only compares an
       equation carrying exactly the question's variables. Equivalence allows
       a constant factor, so 3x+y=7 and 6x+2y=14 agree; it is the shape that
       must match, not the writing. */
    private const RESTATE_CHARS = 600;

    /* Are two residual trees the same relation, up to a constant multiple?
       Sampled at several points: a wrong reading disagrees almost everywhere,
       and agreeing at eight scattered reals is as close to proof as numeric
       comparison gets. */
    /* Where the restatement ends and the working begins. Reading a fixed 600
       characters swept up the derivation of a SHORT answer: "Solve √(x+6) = x"
       answered correctly carries "x + 6 = x²" inside that window, which is a
       consequence of squaring and not a restatement — and comparing it to the
       question flagged a right answer as solving a different problem. Mirrors
       restateZone() in index.html. */
    private const WORKING_STARTS = '/\n\s*(?:##\s*(?:📖|📝|🧭|🔍|🎯)|\d+\s*[.)]\s)/u';
    private static function restateZone(string $answer): string
    {
        $s = ltrim($answer);
        if (preg_match(self::WORKING_STARTS, $s, $m, PREG_OFFSET_CAPTURE) && $m[0][1] > 0) {
            $s = substr($s, 0, $m[0][1]);
        }
        return mb_substr($s, 0, self::RESTATE_CHARS);
    }

    private static function sameRelation(array $a, array $b, array $vars): ?bool
    {
        $ratio = null;
        $seen  = 0;
        for ($i = 0; $i < 8; $i++) {
            $env = [];
            foreach ($vars as $k => $v) {
                /* Spread the points and keep them off small integers, where
                   different expressions coincide by accident. */
                $env[$v] = 1.37 + $i * 1.61 + $k * 0.73;
            }
            $x = Algebra::evalAt($a, $env);
            $y = Algebra::evalAt($b, $env);
            if (!is_finite($x) || !is_finite($y)) continue;
            $seen++;
            $small = 1e-9 * max(1.0, abs($x), abs($y));
            if (abs($x) <= $small && abs($y) <= $small) continue;   // both zero, no information
            if (abs($y) <= $small) return false;                    // one vanishes, the other not
            $r = $x / $y;
            if ($ratio === null) { $ratio = $r; continue; }
            if (abs($r - $ratio) > max(1e-7, abs($ratio) * 1e-7)) return false;
        }
        if ($seen < 3) return null;                                 // too little evidence to speak
        return true;
    }

    public static function integrity(string $question, string $answer): array
    {
        /* deLatex both sides HERE rather than trusting the caller. run() does
           it too, but a question reaching this function raw — as it does from
           any direct call — has braces the equation reader cannot cross, and
           the check would then silently compare the wrong thing. */
        $question = self::deLatex($question);
        $answer   = self::deLatex($answer);

        $asked = self::findEquation($question);
        if ($asked === null) return [];
        $qVars = $asked['eq']['vars'];
        sort($qVars);

        $zone = self::restateZone($answer);
        $re = '/' . self::EQ_CHARS . '{1,80}=' . self::EQ_CHARS . '{1,80}/u';

        /* Scan LINE BY LINE. EQ_CHARS contains \s, which includes newlines, so
           a zone-wide scan joined "3x = 6" to the "2." beginning the next line
           and read the restatement as "3x = 6 2" — then flagged a perfectly
           faithful answer as a misreading. A restatement is one line. */
        $hits = [];
        foreach (preg_split('/\R/u', $zone) ?: [] as $line) {
            if (preg_match_all($re, $line, $lm)) {
                foreach ($lm[0] as $h) $hits[] = $h;
            }
        }
        if (!count($hits)) return [];

        foreach ($hits as $hit) {
            $words = preg_split('/\s+/u', trim($hit), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $n = count($words);
            for ($a = 0; $a < $n; $a++) {
                for ($b = $n; $b > $a; $b--) {
                    /* Trailing sentence punctuation must come off before the
                       parser sees it. "2(x+3) = 11." tokenised "11." and
                       refused, so an equation ending a sentence — which is
                       most of them in prose — was invisible to every check
                       built on this function. A decimal is unaffected: 1.5
                       does not END in a dot. */
                    $cand = rtrim(trim(implode(' ', array_slice($words, $a, $b - $a))), '.,;:');
                    if (strpos($cand, '=') === false) continue;
                    if (!self::looksAlgebraic($cand)) continue;
                    $eq = Algebra::parseEquation($cand);
                    if ($eq === null) continue;

                    $vs = $eq['vars'];
                    sort($vs);
                    /* Only an equation over exactly the question's variables
                       can be a restatement of it. A derived step has usually
                       lost one, and a different relation entirely is not our
                       business. */
                    if ($vs !== $qVars) continue;

                    /* "x = 2" is the ANSWER, not a restatement of the
                       question, and comparing it to x²−4=0 flagged a correct
                       reply as a misreading — the exact false positive this
                       check must never produce. A side that is a bare variable
                       opposite a side with no variables is a solution
                       statement; skip it. */
                    $bare = static function (array $t): bool { return $t['t'] === 'v'; };
                    $constSide = static function (array $t): bool { return !count(Algebra::varsOf($t)); };
                    if (($bare($eq['L']) && $constSide($eq['R']))
                        || ($bare($eq['R']) && $constSide($eq['L']))) continue;

                    /* An IDENTITY is a rewrite, not a restatement. Working
                       "x² + xy + y² = (x+y)² − xy" is true for every x and y —
                       it is the algebra step, not a claim about the problem —
                       and comparing it to the question flagged a completely
                       faithful answer as solving something else. Anything that
                       holds everywhere is skipped. */
                    $everywhere = true;
                    for ($t = 0; $t < 6; $t++) {
                        $env = [];
                        foreach ($vs as $k => $vn) $env[$vn] = 1.29 + $t * 0.83 + $k * 0.57;
                        if (Algebra::holdsAt($eq, $env) !== true) { $everywhere = false; break; }
                    }
                    if ($everywhere) continue;

                    $resQ = ['t' => 'b', 'op' => '-', 'a' => $asked['eq']['L'], 'b' => $asked['eq']['R']];
                    $resA = ['t' => 'b', 'op' => '-', 'a' => $eq['L'], 'b' => $eq['R']];
                    $same = self::sameRelation($resQ, $resA, $qVars);
                    if ($same === null) return [];                 // no verdict
                    return [[
                        'kind' => 'integrity',
                        'ok'   => $same,
                        'text' => $same
                            ? 'the answer restates the question as ' . $cand
                              . ', which is the same relation as ' . trim($asked['src'])
                            : 'the question is ' . trim($asked['src']) . ' but the answer solves '
                              . $cand . ', which is a different equation — the answer may be correct '
                              . 'for a problem that was not asked',
                    ]];
                }
            }
        }
        return [];
    }

    /* ---------- SOLUTION-TO-FINAL TRACE ----------
       Does the stated answer actually follow from the working that was shown?

       A model can derive x = 2 across four careful lines and then print
       x = 4 at the bottom — a transcription slip, or a switch to a different
       train of thought — and every other check here would be satisfied,
       because x = 4 might well satisfy some equation somewhere.

       The rule is deliberately weak, because a strong one would cry wolf: a
       final value must APPEAR somewhere in the working. It does not have to be
       the last line, or reached in any particular way. An answer that states a
       value the working never mentions did not come from that working, and
       that is all this claims. */
    public static function trace(string $question, string $answer): array
    {
        $found = self::findEquation($question);
        if ($found === null || count($found['eq']['vars']) !== 1) return [];
        $v = $found['eq']['vars'][0];

        $zone = self::claimZone($answer);
        /* The working is the Steps section, read by heading.
           An earlier version tried str_replace($zone, ' ', $answer) — but
           claimZone BUILDS its string by concatenating two sections, so it is
           not a substring of the answer, the replace silently did nothing, and
           "working" became the entire reply including the final answer. Every
           value then trivially appeared in its own working and the check could
           never fail. */
        $working = self::withHead($answer, '📝');
        if (trim($working) === '') return [];               // no working shown → no verdict

        $final   = self::claimedRoots($zone, $v);
        $derived = self::claimedRoots($working, $v);
        if (!count($final) || !count($derived)) return [];   // nothing to compare → silence

        /* Numbers written loose in the working count too: "so we get 2 and -2"
           is a derivation even without an "x =" in front of it. */
        foreach (self::values($working) as $n) $derived[] = $n;

        $near = static function (float $a, float $b): bool {
            return abs($a - $b) <= max(1.0, abs($a), abs($b)) * 1e-6;
        };

        $orphans = [];
        foreach ($final as $f) {
            $seen = false;
            foreach ($derived as $d) if ($near($f, $d)) { $seen = true; break; }
            if (!$seen) $orphans[] = Algebra::round6($f);
        }

        if (!count($orphans)) {
            return [['kind' => 'trace', 'ok' => true,
                'text' => 'every value in the final answer appears in the working above it']];
        }
        return [['kind' => 'trace', 'ok' => false,
            'text' => $v . ' = ' . implode(', ', $orphans)
                    . ' is stated as the answer but never appears in the working shown, '
                    . 'so the final answer does not follow from the steps given']];
    }

    /* Every number written in a stretch of text. Used by trace() to notice a
       value that was derived without an "x =" in front of it. */
    private static function values(string $text): array
    {
        $out = [];
        if (!preg_match_all('/-?\d+(?:\.\d+)?/', $text, $m)) return $out;
        foreach ($m[0] as $n) $out[] = (float)$n;
        return $out;
    }

    /* ---------- PRESENTATION: self-correction leakage ----------
       "Wait, let me re-check that" is not a mathematical error, and it must
       never make an answer read as wrong. It is a PRODUCT error: a student
       revising for an exam sees the solver arguing with itself and stops
       trusting the answer, even when the final value is right.

       The system prompt already forbids it. That is exactly why a detector is
       needed — an instruction a model can ignore is not a guarantee, and every
       other rule in this engine is enforced rather than requested.

       Reported as ADVISORY. The mathematics is untouched by it, so it appears
       in the receipt and never in the failure count. */
    /* A LIST MARKER MUST NOT HIDE THE SELF-TALK. A production answer wrote its
       planning as bullets — "*   Wait, the previous message used x^2" — and the
       line-start anchor did not survive the "*   " in between, so the loudest
       possible leak went unreported. Mirrors LEAK_RE in index.html. */
    private const LEAK_RE =
        '/(?:^|[.!?]\s+|\n)[ \t]*(?:[-*•>]+[ \t]*|\d+[.)][ \t]*)*(wait|hold on|hmm+|actually|oh(?:\s|,)|let me (?:re-?check|recalculate|reconsider|try again|redo|verify that)|'
      . 'on second thought|i made a mistake|that(?:\'s| is) (?:wrong|not right)|scratch that|'
      . 'let me start over|is that right\??|no,? wait)\b/iu';

    public static function leaks(string $answer): array
    {
        $s = self::deLatex($answer);
        /* Code may legitimately contain any of these words in a string or a
           comment, and a programming answer must not be penalised for them. */
        $s = preg_replace('/```[\s\S]*?```|`[^`\n]*`/u', ' ', $s);
        if (!preg_match_all(self::LEAK_RE, $s, $ms, PREG_SET_ORDER)) return [];
        $found = [];
        foreach ($ms as $m) {
            $w = strtolower(trim($m[1]));
            if (!isset($found[$w])) $found[$w] = 1;
        }
        return array_keys($found);
    }

    public static function presentation(string $answer): array
    {
        $found = self::leaks($answer);
        if (!count($found)) return [];
        $shown = array_slice($found, 0, 4);
        return [['kind' => 'presentation', 'ok' => false, 'soft' => true,
            'text' => 'the answer thinks out loud (' . implode('", "', array_map(
                        static fn($w) => '"' . $w . '"', $shown)) . ') — the mathematics is '
                    . 'unaffected, but a solution that visibly argues with itself reads as one '
                    . 'that cannot be trusted']];
    }

    /* ---------- UNPROVED CLAIMS ----------
       Every check above this one asks whether a NUMBER is right. None of them
       reads the sentence that carries the actual mathematical claim, so an
       answer could substitute four correct tuples, pass every check, and
       conclude "there are infinitely many prime sums" on the strength of
       "observing the density of primes" — and be reported FULLY_VERIFIED.

       Four correct substitutions are evidence. They are not a proof of
       infinitude, and the gap between those two things is the entire failure.

       WHY A THEOREM NAME IS NOT A PROOF
       ---------------------------------
       Citing Dirichlet does not make a sequence an arithmetic progression.
       The named theorem is treated as an unsupported citation unless the
       answer also establishes the hypotheses that theorem actually needs —
       which this engine cannot check — so a bare citation FAILS rather than
       passes. A checker that accepts a theorem name accepts any theorem name.

       This never asserts the claim is false. It asserts the answer has not
       shown it to be true, which is a different and much safer statement. */
    /* Three claim shapes were missing, and each is a way of saying "and there
       are no others" without tripping `exclusive`: a construction said to
       generate every solution, a universal wearing an adjective ("always
       positive"), and infinitude of a series rather than of a solution set.
       Mirrors CLAIM_RE in index.html. */
    private const CLAIM_RE = [
        'infinitude' => '/\b(infinitely\s+many|there\s+are\s+infinite|unbounded(?:ly)?\s+many|arbitrarily\s+(?:large|many)|the\s+(?:sum|series)\s+(?:is\s+infinite|diverges))\b/iu',
        'universal'  => '/\b(for\s+all\s+|for\s+every\s+|always\s+(?:holds|true)|in\s+every\s+case|the\s+expression\s+is\s+always)\b/iu',
        'exclusive'  => '/\b(only\s+(?:solutions?|values?|these|\(|the\s+pair)|the\s+unique\s+solution|no\s+other\s+(?:solutions?|values?)|these\s+are\s+all\s+the)\b/iu',
        'generates'  => '/\b((?:this\s+)?recurrence\s+generates|generates?\s+(?:all|every)\s+(?:the\s+)?solutions?|all\s+(?:the\s+)?solutions?\s+(?:arise|are\s+obtained|are\s+generated|follow|come)\b|every\s+solution\s+(?:arises|is\s+obtained|is\s+generated)|continuing\s+(?:this|the)\s+pattern)/iu',
        'never'      => '/\b(never\s+(?:happens|holds|occurs|prime)|is\s+never\b|cannot\s+ever\b)\b/iu',
    ];

    /* ---------- DESCENT IS NOT A MAGIC WORD ----------
       PROOF_RE accepts "vieta" and "descent" as evidence that an argument is
       present, and for every other technique on that list the word does come
       with the argument. Descent is the exception: "by Vieta jumping, all
       solutions follow" is a complete sentence that says nothing, and it was
       accepted. A descent argument has obligations that are checkable as text
       — the second root is an INTEGER, it is SMALLER under the ordering used,
       and the descent TERMINATES with classified base cases. Naming none of
       them is not a proof. Mirrors index.html. */
    private const DESCENT_RE = '/\b(vieta|descent|jumping)\b/iu';
    /* PROOF_RE minus the descent family: is any OTHER argument present? */
    private const OTHER_PROOF_RE =
        '/\b(induction|inductive\s+step|base\s+case|contradiction|suppose\s+not|assume\s+for\s+contradiction|'
      . 'pigeonhole|well[-\s]ordering|minimal\s+counterexample|bijection|construct(?:ion|ed)?\s+(?:a|an|the)\s+|'
      . 'therefore\s+by\s+induction|q\.?e\.?d|∎|hence\s+every|for\s+each\s+k\b)\b/iu';
    private const DESCENT_DUTY = [
        ['/\b(integer|integral|whole\s+number)\b/iu', 'that the second root is an integer'],
        ['/\b(smaller|small(?:est)?|decreas\w+|minimal|least|strictly\s+less|reduces?|descend\w*|drops?)\b/iu',
         'that the second root is smaller under the ordering used'],
        ['/\b(terminat\w+|base\s+case|minimal\s+(?:counterexample|solution|triple)|well[-\s]ordering|'
       . 'cannot\s+(?:decrease|descend)\s+forever|finitely\s+many\s+steps|bottom(?:s\s+out)?)\b/iu',
         'that the descent terminates'],
    ];

    /* Language that would carry a real argument. Deliberately generous: the
       point is to catch answers with NO argument at all, not to grade the
       quality of one that is present. */
    private const PROOF_RE =
        '/\b(induction|inductive\s+step|base\s+case|contradiction|suppose\s+not|assume\s+for\s+contradiction|'
      . 'vieta|descent|infinite\s+descent|pigeonhole|well[-\s]ordering|minimal\s+counterexample|'
      . 'bijection|construct(?:ion|ed)?\s+(?:a|an|the)\s+|therefore\s+by\s+induction|'
      . 'q\.?e\.?d|∎|hence\s+every|for\s+each\s+k\b|recurrence\s+gives)\b/iu';

    /* Hand-waving that LOOKS like justification. Each of these is a phrase
       that concedes it is not proving anything. */
    private const HANDWAVE_RE =
        '/\b(observing\s+the\s+density|density\s+of\s+primes|it\s+is\s+(?:clear|obvious|well[-\s]known)\s+that|'
      . 'grows?\s+(?:without\s+bound|exponentially|rapidly)[^.]{0,40}(?:therefore|so|hence|thus)|'
      . 'no\s+(?:obvious\s+)?(?:modular\s+)?obstruction|heuristic|numerical\s+evidence\s+suggests|'
      . 'seems?\s+to\s+(?:be|suggest)|appears?\s+to\s+(?:be|hold)|one\s+can\s+conclude|we\s+can\s+conclude)\b/iu';

    /* A theorem cited by name, which is a citation and not an argument. */
    private const THEOREM_RE =
        '/\b(dirichlet|green[-\s]tao|bertrand|chebyshev|fermat\'?s?\s+little|euler\'?s?\s+theorem|'
      . 'wilson\'?s?\s+theorem|chinese\s+remainder|mordell|siegel|roth\'?s?\s+theorem)\b/iu';

    public static function unproved(string $answer): array
    {
        $s = self::deLatex($answer);
        $s = preg_replace('/```[\s\S]*?```/u', ' ', $s);          // code is not prose

        $kind = null;
        foreach (self::CLAIM_RE as $name => $re) {
            if (!preg_match($re, $s, $m, PREG_OFFSET_CAPTURE)) continue;
            /* An answer that DECLINES the claim must never be punished for it.
               "the argument does not establish that infinitely many exist" is
               the correct, honest reply — and flagging it would teach the
               solver that hedging is as costly as overclaiming, which is
               precisely backwards. Look behind the phrase for a denial. */
            $before = mb_substr($s, max(0, $m[0][1] - 90), min(90, $m[0][1]));
            if (preg_match('/\b(do(?:es)?\s+not\s+(?:establish|prove|show|follow|imply)|'
                         . 'not\s+(?:established|proved|proven|shown)|cannot\s+(?:be\s+)?(?:prove|establish|conclude)|'
                         . 'no\s+proof\s+that|without\s+(?:proving|establishing)|'
                         . 'fails?\s+to\s+(?:establish|prove|show)|is\s+not\s+enough\s+to)\b/iu', $before)) {
                continue;                                          // a denial, not a claim
            }
            $kind = $name;
            break;
        }
        if ($kind === null) return [];                            // no strong claim → nothing to say

        $hasProof    = (bool)preg_match(self::PROOF_RE, $s);
        $handwave    = preg_match(self::HANDWAVE_RE, $s, $hm) ? trim($hm[0]) : null;
        $theoremOnly = preg_match(self::THEOREM_RE, $s, $tm) ? trim($tm[0]) : null;

        $label = [
            'infinitude' => 'that infinitely many exist',
            'universal'  => 'that it holds in every case',
            'exclusive'  => 'that these are the only solutions',
            'generates'  => 'that this construction produces every solution',
            'never'      => 'that it never happens',
        ][$kind];

        /* Descent named, nothing else offered, and the obligations unmet: the
           "by Vieta jumping all solutions follow" case, which must not pass on
           the strength of the word. */
        if ($handwave === null && preg_match(self::DESCENT_RE, $s) && !preg_match(self::OTHER_PROOF_RE, $s)) {
            $gaps = [];
            foreach (self::DESCENT_DUTY as $duty) {
                if (!preg_match($duty[0], $s)) $gaps[] = $duty[1];
            }
            if (count($gaps)) {
                return [['kind' => 'claim', 'ok' => false, 'claimType' => $kind, 'viaDescent' => true,
                    'text' => 'the answer claims ' . $label . ' by descent, but the descent is not '
                            . 'established — it never shows ' . implode(', nor ', $gaps)
                            . '. A jump that produces smaller solutions proves nothing about '
                            . 'completeness until the descent is known to terminate and its base '
                            . 'cases are classified']];
            }
        }

        if ($handwave !== null) {
            return [['kind' => 'claim', 'ok' => false, 'claimType' => $kind,
                'text' => 'the answer claims ' . $label . ', but supports it with "' . $handwave
                        . '" — which concedes it is not a proof; examples and density arguments are '
                        . 'evidence, not a demonstration']];
        }
        if (!$hasProof && $theoremOnly !== null) {
            return [['kind' => 'claim', 'ok' => false, 'claimType' => $kind,
                'text' => 'the answer claims ' . $label . ' by citing ' . $theoremOnly
                        . ', but does not establish that this problem satisfies that theorem\'s '
                        . 'hypotheses — naming a theorem is a citation, not an argument']];
        }
        if (!$hasProof) {
            return [['kind' => 'claim', 'ok' => false, 'claimType' => $kind,
                'text' => 'the answer claims ' . $label . ' without an argument that establishes it '
                        . '— no induction, descent, contradiction or construction appears in the working']];
        }
        return [['kind' => 'claim', 'ok' => true, 'claimType' => $kind,
            'text' => 'the answer claims ' . $label . ' and gives an argument for it '
                    . '(this engine checks that reasoning is PRESENT, not that it is correct)']];
    }

    /* ---------- PRIMALITY, computed not believed ----------
       "It seems 5779 is prime" is not a mathematical statement, it is a guess
       wearing one. Primality is decidable in microseconds; letting a language
       model estimate it is the clearest possible case of trusting an LLM with
       something a computer can settle. */
    public static function isPrime(int $n): bool
    {
        if ($n < 2) return false;
        foreach ([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37] as $p) {
            if ($n === $p) return true;
            if ($n % $p === 0) return false;
        }
        /* Deterministic Miller-Rabin: this witness set is proven correct for
           every n below 3.3 · 10^24, which is far past anything a school
           question produces. No probabilistic answer is returned. */
        $d = $n - 1; $r = 0;
        while ($d % 2 === 0) { $d = intdiv($d, 2); $r++; }
        foreach ([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37] as $a) {
            $x = self::powmod($a, $d, $n);
            if ($x === 1 || $x === $n - 1) continue;
            $ok = false;
            for ($i = 1; $i < $r; $i++) {
                $x = self::powmod($x, 2, $n);
                if ($x === $n - 1) { $ok = true; break; }
            }
            if (!$ok) return false;
        }
        return true;
    }

    private static function powmod(int $b, int $e, int $m): int
    {
        $r = 1; $b %= $m;
        while ($e > 0) {
            if ($e & 1) $r = (int)((float)$r * $b % $m) === 0 && $r * $b > PHP_INT_MAX
                              ? self::mulmod($r, $b, $m) : self::mulmod($r, $b, $m);
            $b = self::mulmod($b, $b, $m);
            $e >>= 1;
        }
        return $r;
    }
    /* Multiplication that cannot overflow for the sizes a question produces. */
    private static function mulmod(int $a, int $b, int $m): int
    {
        return (int)bcmod(bcmul((string)$a, (string)$b), (string)$m);
    }

    /* Claims of the form "N is prime" / "N is composite" / "N is not prime". */
    /* ---------- FACTORISATION CLAIMS ----------
       "No, 5779 = 7 x 826" is a complete answer to "is 5779 prime?" and it
       reached no checker at all: the primality regex only ever matched the
       phrasing "N is prime/composite", so an answer making its case by
       exhibiting factors went entirely unread.

       That answer is false twice over — 5779 is prime, AND 7 x 826 is 5782.
       The second fault is the one to check first: it is decidable by
       multiplication alone and needs no view on primality.

       Mirrors factorisationClaims() in index.html; the Release B suite
       compares both engines on every case. */
    private static function factorisationClaims(string $answer, array &$out, array &$seen): void
    {
        $s = self::deLatex($answer);
        /* N = a x b [x c …]. The trailing guard stops "12 = 3 x 4 + 1" being
           read as a factorisation — a product continuing into a sum is an
           expression, not a factor list. */
        /* Two faults in one line, and together they DISPUTED a correct answer.
           The trailing guard's whitespace class spanned newlines, so it looked
           onto the NEXT line for its + or -; and the product group could
           backtrack, so the engine settled for a shorter product that kept the
           guard happy. "30 = 3 x 2 x 5" followed by a line starting "25 + 169"
           was read as the claim 30 = 3 x 2 and reported as false. The class no
           longer crosses a line, and the product group is atomic. Mirrors
           factorisationClaims() in index.html. */
        $re = '/(?:^|[^\d.])(\d{2,15})\s*=\s*(?>(\d{1,15}(?:[ \t]*[×x*·][ \t]*\d{1,15})+))(?![\d.\t ]*[+\-^\/])/iu';
        if (!preg_match_all($re, $s, $ms, PREG_SET_ORDER)) return;
        foreach ($ms as $m) {
            if (count($out) >= 8) break;
            $n = (int)$m[1];
            $key = 'f' . $n . '|' . preg_replace('/\s+/u', '', $m[2]);
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $raw = preg_split('/[×x*·]/u', $m[2]);
            if ($raw === false || count($raw) < 2) continue;
            $parts = [];
            $okParts = true;
            foreach ($raw as $t) {
                $p = (int)trim($t);
                if ($p <= 0) { $okParts = false; break; }
                $parts[] = $p;
            }
            if (!$okParts) continue;
            $prod = 1;
            foreach ($parts as $p) $prod *= $p;
            /* Beyond 2^53 the product is no longer exact, so a mismatch would
               be a rounding artefact rather than the student's error. */
            if (!is_finite((float)$prod) || $prod > 9007199254740991) continue;
            $good = ($prod === $n);
            /* A TRUE factorisation into factors above 1 also settles primality.
               N = 1 x N is true and shows nothing. */
            $nontrivial = count(array_filter($parts, static function ($p) { return $p > 1; })) >= 2;
            $joined = implode(' × ', $parts);
            $out[] = [
                'kind' => 'primality',
                'ok'   => $good,
                'soft' => ($good && !$nontrivial),
                'text' => $good
                    ? ($nontrivial
                        ? $n . ' = ' . $joined . ' — the product checks out, so ' . $n .
                          ' is composite as the answer says'
                        : $n . ' = ' . $joined . ' is true but trivial: 1 × ' . $n .
                          ' shows nothing about primality')
                    : $n . ' ≠ ' . $joined . ' — that product is ' . $prod .
                      ', so the factorisation given does not hold',
            ];
        }
    }

    public static function primality(string $answer): array
    {
        $s = self::deLatex($answer);
        $out = [];
        $seen = [];
        /* Factorisation claims first, and OUTSIDE the early return below — the
           phrasing regex not matching is precisely the case where an answer
           made its argument by exhibiting factors instead. Mirrors index.html. */
        self::factorisationClaims($answer, $out, $seen);
        $re = '/(-?\d{1,15})\s*(?:is|seems\s+to\s+be|appears\s+to\s+be|looks)\s+'
            . '(not\s+prime|composite|prime)\b/iu';
        if (!preg_match_all($re, $s, $ms, PREG_SET_ORDER)) return $out;
        foreach ($ms as $m) {
            if (count($out) >= 8) break;
            $n = (int)$m[1];
            if ($n < 0 || $n > 999999999999) continue;
            if (isset($seen[$n])) continue;
            $seen[$n] = 1;
            $claimPrime = stripos($m[2], 'prime') !== false && stripos($m[2], 'not') === false
                          && stripos($m[2], 'composite') === false;
            $really = self::isPrime($n);
            $out[] = ['kind' => 'primality', 'ok' => ($claimPrime === $really),
                'text' => $claimPrime
                    ? ($really ? $n . ' is prime — confirmed by exact test'
                               : $n . ' is NOT prime: ' . $n . ' = ' . self::firstFactor($n)
                                 . ' × ' . intdiv($n, self::firstFactor($n)))
                    : ($really ? $n . ' IS prime, but the answer calls it composite'
                               : $n . ' is composite — confirmed by exact test')];
        }
        return $out;
    }

    /* PUBLIC: the counterexample engine names the factor that refutes a
       primality claim, and one factoriser is better than two. */
    public static function firstFactor(int $n): int
    {
        for ($i = 2; $i * $i <= $n; $i++) if ($n % $i === 0) return $i;
        return $n;
    }

    /* ---------- COMPLETENESS: a truncated answer is not an answer ----------
       "If a, b, c are all odd: a² + b² + c² is ..." was shown to a student as a
       finished solution. Presenting half a proof as a whole one is worse than
       showing an error, because nothing on the page says it stopped. */
    public static function completeness(string $answer): array
    {
        $s = rtrim(self::deLatex($answer));
        if ($s === '') return [];
        $why = null;

        $tail = mb_substr($s, -160);
        /* A short mathematical result is not a truncated sentence. An earlier
           rule flagged any last line lacking a full stop, which fires on
           "x = 2 and x = -2" — most correct answers. Only a line left hanging
           on a word that CANNOT end a statement is unfinished: a copula, an
           article, a connective, or a bare operator. That is what
           "a² + b² + c² is" has and a finished answer does not. */
        $lastLine = '';
        foreach (array_reverse(preg_split('/\R/u', $s) ?: []) as $ln) {
            if (trim($ln) !== '') { $lastLine = trim($ln); break; }
        }
        if ($lastLine !== '' && preg_match(
            '/(?:^|\s)(is|are|was|were|be|the|a|an|of|and|or|to|for|with|if|then|so|we|it|that|which|by|from|as|but|since|because|where|when|gives?|equals?|becomes?|[=+\-*\/^<>,])\s*$/iu',
            $lastLine)) {
            $why = 'the last line stops mid-sentence: "…' . mb_substr($lastLine, -60) . '"';
        }
        if ($why === null && preg_match('/\b(therefore|hence|thus|so we get|which gives)\s*[:,]?\s*$/iu', $tail)) {
            $why = 'the answer ends on "therefore" with no conclusion after it';
        }
        /* Unbalanced delimiters mean a formula was cut in half.

           A dollar AMOUNT is not a delimiter: "$12,000 + $11,400 = $23,400"
           carries three $ and was disputed as an unclosed formula, which tells
           a student their correct answer is wrong. US CMA, US CPA, CFA and
           ACCA all price in dollars. Mirrors index.html; parity.js compares. */
        $delim = preg_replace('/\$(?=\s*[\d.])/u', '', $s);
        $dollars = substr_count($delim, '$') - 2 * substr_count($delim, '$$');
        if ($why === null && substr_count($delim, '$$') % 2 !== 0) $why = 'an unclosed $$…$$ block';
        if ($why === null && $dollars % 2 !== 0)               $why = 'an unclosed $…$ formula';
        if ($why === null && substr_count($s, '\\[') !== substr_count($s, '\\]')) $why = 'an unclosed \\[…\\] block';
        if ($why === null && substr_count($s, '\\(') !== substr_count($s, '\\)')) $why = 'an unclosed \\(…\\) formula';
        $open = substr_count($s, '(') - substr_count($s, ')');
        if ($why === null && $open > 1) $why = $open . ' unclosed brackets';

        if ($why === null) return [];
        return [['kind' => 'truncated', 'ok' => false,
            'text' => 'this solution is not finished — ' . $why
                    . '. It must not be shown as a completed answer']];
    }

    /* ---------- CLAIM TAXONOMY ----------
       The checks above ask whether the answer's NUMBERS are right. This asks
       what KIND of statement each assertion is, because two of them are things
       no solver is entitled to assert and no engine here can confirm.

       STATUS CLAIMS. "It is currently an open conjecture" promotes the
       solver's own failure into a theorem about the state of mathematics.
       "I cannot prove this" and "nobody can prove this" are entirely different
       claims, and only the first was ever established. This engine cannot know
       what is open, so it says so rather than agreeing or disagreeing.

       DENSITY CLAIMS. "exactly one-third of all Markov triples have an odd
       sum" was false — the real figure is about 26% — but the fault is not the
       number. It is the word EXACTLY attached to a proportion of an infinite
       family with no argument behind it. A wrong proportion and a lucky one
       are the same failure.

       Neither is ever called FALSE. Both are reported as claims the system
       could not establish, which is the honest position and the one §5 asks
       for. Advisory where the answer is otherwise sound, so a good solution is
       not condemned for one over-confident sentence — but never silent. */
    private const STATUS_RE =
        '/\b(open\s+(?:conjecture|problem|question)|unsolved\s+(?:problem|question)|'
      . 'remains?\s+(?:unproven|unsolved|open)|no\s+known\s+proof|it\s+is\s+conjectured|'
      . 'long[-\s]standing\s+conjecture|deep\s+unsolved|famous\s+conjecture|'
      . 'has\s+never\s+been\s+proved|nobody\s+has\s+proved)\b/iu';

    private const DENSITY_RE =
        '/\b(exactly\s+(?:one|a|two|three)[-\s](?:third|half|quarter|fifth)s?|'
      /* No trailing \b on the percentage forms: "%" is not a word character,
         so \b after it demands a following letter and "exactly 25% of" never
         matched. The alternation ends where each phrase ends. */
      . 'exactly\s+\d+(?:\.\d+)?\s*(?:%|percent)|precisely\s+\d+(?:\.\d+)?\s*(?:%|percent)|'
      . '(?:one|two|three)[-\s](?:third|half|quarter)s?\s+of\s+all|'
      . 'exactly\s+half\s+of\s+all)/iu';

    public static function taxonomy(string $answer): array
    {
        $s = self::deLatex($answer);
        $s = preg_replace('/```[\s\S]*?```/u', ' ', $s);
        $out = [];

        if (preg_match(self::STATUS_RE, $s, $m)) {
            $out[] = ['kind' => 'taxonomy', 'ok' => false, 'soft' => true,
                'claimStatus' => 'STATUS_UNESTABLISHED',
                'text' => 'the answer states that this is "' . trim($m[0]) . '" — a claim about what '
                        . 'mathematics currently knows, not about this problem. The system could not '
                        . 'establish that claim: being unable to prove something is not evidence that '
                        . 'nobody has'];
        }
        if (preg_match(self::DENSITY_RE, $s, $m)) {
            $out[] = ['kind' => 'taxonomy', 'ok' => false, 'soft' => true,
                'claimStatus' => 'PROPORTION_UNESTABLISHED',
                'text' => 'the answer asserts a precise proportion ("' . trim($m[0]) . '") of an '
                        . 'infinite family. The system could not establish it — and a proportion that '
                        . 'happens to be right without an argument is the same failure as one that is '
                        . 'wrong'];
        }
        return $out;
    }

    /* ---------- CONTRADICTION ----------
       The working derives one value and the final answer states another:

         2x + 4 = 14  →  2x = 10  →  x = 5   …then   "Therefore x = 7"

       Neither `trace` nor `substitution` catches this on its own. trace only
       asks whether the final value APPEARS in the working, and x = 7 might
       appear as a line number or a coefficient. substitution tests the final
       value against the question, so it reports "7 is wrong" — true, but it
       never notices that the answer's OWN working already said 5.

       The difference matters to a student. "Your answer is wrong" and "your
       answer contradicts your line 3" are different pieces of information,
       and the second one points at where it went wrong.

       Deliberately narrow: one variable, and only when the working states a
       value for it. Where both values can be tested against the question it
       also says WHICH one the working got right — that is the sentence worth
       reading. */
    public static function contradiction(string $question, string $answer): array
    {
        $found = self::findEquation(self::deLatex($question));
        if ($found === null || count($found['eq']['vars']) !== 1) return [];
        $v = $found['eq']['vars'][0];

        $md      = self::deLatex($answer);
        $working = self::withHead($md, '📝');
        if (trim($working) === '') return [];
        $zone = self::claimZone($md);

        $derived = self::claimedRoots($working, $v);
        $final   = self::claimedRoots($zone, $v);
        if (!count($derived) || !count($final)) return [];

        /* The working's LAST statement is what it concluded. */
        $last = $derived[count($derived) - 1];
        $near = static fn(float $a, float $b): bool
            => abs($a - $b) <= max(1.0, abs($a), abs($b)) * 1e-6;

        foreach ($final as $f) if ($near($f, $last)) return [];      // they agree

        /* They disagree. Which one does the question actually support? */
        $holds = static function (float $x) use ($found, $v): ?bool {
            return Algebra::holdsAt($found['eq'], [$v => $x]);
        };
        $lastOk  = $holds($last);
        $finalOk = $holds($final[0]);

        $text = 'the working concludes ' . $v . ' = ' . Algebra::round6($last)
              . ' but the answer states ' . $v . ' = ' . Algebra::round6($final[0])
              . ' — a solution cannot disagree with its own steps';
        if ($lastOk === true && $finalOk === false) {
            $text .= '. Substituting both into ' . trim($found['src'])
                   . ' shows the WORKING is right and the final line is the mistake';
        } elseif ($lastOk === false && $finalOk === true) {
            $text .= '. Substituting both shows the final answer is right and a step above it is wrong';
        }
        return [['kind' => 'contradiction', 'ok' => false, 'text' => $text]];
    }

    /* ---------- the verdict ----------
       Answer-level failures dispute the ANSWER. Working-level failures dispute
       a STEP, which is a different and lesser claim, and flattening the two
       into one state is how "verified" stops meaning anything. */
    public static function run(string $question, string $answer): array
    {
        /* Strip LaTeX from BOTH sides first. A question pasted from a textbook
           carries it just as often as an answer does, and an unparsed question
           yields no equation, which yields no checks at all. */
        $question = self::deLatex($question);
        $answer   = self::deLatex($answer);

        /* The "Understood as" block echoes the QUESTION back; it is not a claim
           about the answer. Only integrity should read it — every other check
           must see the answer without it, or the question's own numbers get
           mistaken for competing claims. That is not hypothetical: adding the
           heading made the consistency check report "the Answer says 2, the
           Summary says 4" on a flawless reply, and one spurious failure was
           enough to drop every answer to "Partially verified". */
        $body = trim(preg_replace('/##\s*📌[^\n]*\n[\s\S]*?(?=\n##\s|$)/u', '', $answer));
        if ($body === '') $body = $answer;

        $checks = array_merge(
            /* Integrity first, deliberately. If the question was misread,
               every other verdict below is about a different problem, and the
               receipt should say so before it says anything else. */
            /* Question validity comes before everything, because if the
               problem has no answer then "is the answer right" is not the
               question to be asking. */
            QuestionCheck::check($question, $body),
            self::integrity($question, $answer),
            self::substitution($question, $body),
            self::solutionCompleteness($question, $body),
            self::arithmetic($body),
            Units::check($question, $body),
            self::trace($question, $body),
            self::presentation($body),
            self::unproved($body),
            self::primality($body),
            /* completeness reads the FULL answer: truncation is about where the
               reply stops, and the 📌 block is stripped from $body. */
            self::completeness($answer),
            self::taxonomy($body),

            /* A solution that disagrees with its own working. Answer-level,
               and it points at WHERE it went wrong, not only that it did. */
            self::contradiction($question, $answer),
            /* Phase 1 — parity with the site. Ported, not reinvented: each of
               these reproduces the safety property its JS twin earned. */
            Phase1::systemCheck($question, $body),
            Phase1::identityCheck($body),
            Phase1Calculus::derivativeCheck($question, $body),
            Phase1Calculus::integralCheck($question, $body),
            /* Band B — four checkers the website could certify on and this API
               could not, because they were only ever written in JavaScript.
               Never a safety hole: /v1 said `unverified` where the site said
               `checked`, which is honest. It was a CAPABILITY gap, and an API
               customer was getting a strictly weaker verifier than a student.

               chemistry and checkDivisibility read the ANSWER only — a reaction
               or a divisibility claim carries its own subject. bounds and
               conditionCheck need the question too, because "is this a
               probability" and "what condition was set" are its to answer. */
            BandB::chemistry($body),
            BandB::bounds($question, $body),
            BandB::checkDivisibility($body),
            BandB::conditionCheck($question, $body),
            /* Band B part 2 — the last three the API could not run.
               extremumCheck sweeps 44,000 points; that was measured before it
               shipped (~225k node evaluations a second here, so ~0.2–0.5s) and
               the sweep is NOT thinned to save time: a sparser scan finds a
               worse extreme and would certify a wrong answer as correct. */
            BandB2::transformCheck($question, $body),
            BandB2::uniqueness($question, $body),
            BandB2::extremumCheck($question, $body),
            /* Domain and certified exhaustion. Reads the domain the question
               sets — positive, non-negative, distinct — and rejects a claimed
               value outside it; then, for the one shape whose search region can
               be PROVED finite, enumerates that region whole. It never reports a
               bounded search as a completeness proof. */
            Exhaustion::check($question, $body),
            Descent::check($question, $body),
            Descent::pell($question, $body),
            /* Sequence identification. "This is the Fibonacci sequence" is a
               claim, and 1, 1, 2, 5, 13 — every other Fibonacci number, which is
               what the Markov equation produces — is the case that makes it one
               worth checking. */
            SequenceId::check($question, $body),
            /* The counterexample engine. A universal claim is refuted by one
               value, and until this existed nothing looked — "n^2 + n + 41 is
               prime for all n" is prime for n = 0…39 and composite at 40. It can
               only ever FAIL: a clean search is not a proof and must never be
               reported as one. */
            Counterexample::check($question, $body),
            /* The derivation chain. Substitution says the ANSWER is a root;
               this says whether the WORKING that reached it kept every
               solution on the way — dividing 2x^2 = 6x by x loses x = 0 and
               every line after it is still true. */
            StepChain::check($question, $body),
            /* Unit arithmetic. Units.php asks whether the answer is the right
               KIND of thing; this asks whether the number and the unit follow
               from the working — "60 km/h = 21 m/s" and "5 kg x 2 m/s^2 = 10 J"
               are both invisible to a dimension-only check. */
            Qty::check($question, $body),
            /* Double entry. Accounting has been covered_not_verifiable since this
               manifest existed, while CA and CMA students are the audience this
               product names first. Most of the subject genuinely cannot be checked
               here; the law it rests on can, and is arithmetic: every entry debits
               exactly what it credits. */
            Books::check($question, $body)
        );

        /* ---- A PROVED DESCENT SETTLES THE PROSE COMPLAINT ABOUT THE DESCENT ----
           The claim checker reads the words and asks whether the four obligations
           of a descent were STATED. It says so itself: it establishes that the
           reasoning is present, never that it is correct.

           Descent::check does the opposite — it computes the partner, substitutes
           it back, proves the box the terminals lie in and enumerates it. When
           that comes back ok, the descent is established to a higher standard
           than any wording would have reached, and holding the answer red for not
           having spelled the same steps out is judging the write-up rather than
           the mathematics.

           Mirrors the same pass in index.html, and it has to: without it the site
           certified an answer the API disputed, which is the one thing parity
           exists to stop. */
        /* ---- A PROVED CLASSIFICATION OUTRANKS THE SEARCH THAT GUESSED AT IT ----
           Two findings below descentCheck are asking the same question with weaker
           tools, and when the classification comes back proved they are not merely
           redundant — they are WRONG, and they were turning a certified answer red.

           claim (generates / exclusive) reads the prose for an argument. descent
           supplied one, computed rather than read.

           exhaust offers a witness it believes the answer left out. Its generative
           rule is textual: a solution below the answer's largest listed value is
           treated as a hole. For "every solution is obtained from (3,3,3) by the
           jumps; for example (3,3,6), (3,6,15), (6,15,87)" it offered (3,15,39) —
           which IS in that orbit, sits below 87, and was never left out at all.

           descent certifies only when every terminal is reached by something the
           answer put forward and every claimed tuple is a genuine solution. Under
           those conditions the solution set IS the orbit, so any witness a bounded
           search turns up is a member of it. The proof settles it.

           Nothing here fires unless descent or pell came back ok. When they do not,
           both findings dispute exactly as they did before. */
        $proved = false;
        foreach ($checks as $c)
            if ((($c['kind'] ?? '') === 'descent' || ($c['kind'] ?? '') === 'pell')
                && ($c['ok'] ?? false) === true) { $proved = true; break; }
        if ($proved) {
            foreach ($checks as $i => $c) {
                if (($c['ok'] ?? true) !== false) continue;
                $kind = $c['kind'] ?? '';
                if ($kind === 'claim' && (!empty($c['viaDescent'])
                        || ($c['claimType'] ?? '') === 'generates' || ($c['claimType'] ?? '') === 'exclusive')) {
                    $checks[$i] = ['kind' => 'method', 'ok' => true,
                        'text' => 'the write-up asserts the solution set without proving it — it never says that the '
                                . 'second root is an integer, that it is smaller, or that the descent terminates. The '
                                . 'engine established all three independently, so the answer is right; but a marker '
                                . 'reading only what is written here would be entitled to ask for those lines'];
                    continue;
                }
                if ($kind === 'exhaust') {
                    $checks[$i] = ['kind' => 'method', 'ok' => true,
                        'text' => 'a bounded search put forward a solution it took to be missing from the answer. The '
                                . 'classification above proves the solution set is the whole orbit of the terminals, '
                                . 'and that solution is in it — so nothing was left out, and the proved result stands '
                                . 'over the search'];
                }
            }
        }

        /* A soft check is advisory: it reports something worth telling the
           student that is NOT a mathematical fault — presentation, or a limit
           on what could be tested. It belongs in the receipt and nowhere near
           the failure count, because a caveat must never decide the verdict.
           The JS engine already did this; leaving it out here made a correct
           answer with untidy prose report as "a step does not hold". */
        $failed   = array_values(array_filter($checks, static fn($c) => !$c['ok'] && empty($c['soft'])));
        $passed   = array_values(array_filter($checks, static fn($c) => $c['ok']));
        $advisory = array_values(array_filter($checks, static fn($c) => !$c['ok'] && !empty($c['soft'])));

        /* A wrong DIMENSION disputes the answer, not a step in the working:
           "find the acceleration" answered in newtons is wrong whatever the
           arithmetic did, so it belongs here beside substitution rather than
           in the milder step-level bucket. */
        /* integrity is answer-level and then some: a misread question makes
           the answer wrong no matter how clean the working is. */
        /* domain and exhaust are ANSWER-level. A value outside the domain the
           question set is not a wrong step, it is a wrong answer; a solution
           set missing a member is not a presentational matter either. */
    /* books is ANSWER-level. A journal entry that does not balance is not a
       wrong step on the way to a right answer — the entry IS the answer, and
       an unbalanced one is wrong before anyone asks which account it hit.
       Registering the kind without adding it here left it reporting
       "a step does not hold" on an answer that was simply wrong. */
        /* ---------- THE ONE TIER BETWEEN GREEN AND RED ----------
           A student wrote a complete, correct classification of x²+y²−5xy=25 —
           all three families, the jump map right, the descent argued — and
           mistyped one pair out of nine. The badge said VERIFICATION FAILED, in
           the same red as an answer wrong from its first line.

           PRESENTATION AND NOTHING ELSE. $r['state'] does not move: it stays
           disputed, the answer still must not be copied, and /v1 returns exactly
           what it always returned — the field computed here is not in ok_out's
           list, and slipOf is stripped from the checks below.

           WHAT IT REFUSES TO SOFTEN is the design. It needs a descent finding
           that already carried the slip diagnosis — which itself requires a
           sound construction, most of the answer inside the proved orbit, and a
           near member to correct TO — and then every other failing check must be
           the substitution of that same value. One unrelated failure of any kind
           and it is null. A broken construction never reaches here at all,
           because it never gets the slip diagnosis.

           Mirrors correctionOnly() in index.html; parity compares the result. */
        $answerLevel = ['subst' => true, 'units' => true, 'integrity' => true, 'question' => true, 'claim' => true, 'primality' => true, 'truncated' => true, 'contradiction' => true, 'roots' => true, 'domain' => true, 'exhaust' => true, 'system' => true, 'deriv' => true, 'integral' => true, 'books' => true, 'descent' => true, 'pell' => true];

        /* A question with no answer is its own outcome, and flattening it into
           "the answer is wrong" tells a student to try again at something
           impossible. It is reported whether the reply got it right or not:
           the reply saying "no solution exists" is CORRECT, and the question
           is still the thing that is broken. */
        $invalidQuestion = false;
        foreach ($checks as $c) if (!empty($c['invalid_question'])) $invalidQuestion = true;
        $failedAnswer = array_filter($failed, static fn($c) => isset($answerLevel[$c['kind']]));

        /* ---------- EVIDENCE IS NOT A COMPLETE ANSWER ----------
           This rule existed only in index.html. It never showed up in parity
           because a passing `subst` was always accompanied by a passing
           `roots` on the polynomial corpus, so both engines said `checked` for
           the same reason. Release B's precision policy made substitution pass
           on a TRANSCENDENTAL equation, where completeness cannot run — and
           the divergence appeared at once: JS declined, PHP certified.

           PHP was the one that was wrong. Putting x = -0.567 back into
           x + e^x = 0 proves that value is A root; it says nothing about
           whether it is THE solution set. Certifying on that alone is exactly
           the false certification the contract forbids, and /v1 would have
           done it.

           The certifying kinds come from capabilities.json, the same single
           source index.html's PROOF set is generated from — mirroring the JS
           list by hand here would put back the fourth copy Release A removed. */
        $certifying = array_fill_keys(Capability::certifyingKinds(), true);
        $passedProofs = array_values(array_filter($passed,
            static fn($c) => isset($certifying[$c['kind'] ?? ''])));
        $completeProved = false;
        /* `exhaust` joins `roots` as a way to DISCHARGE the completeness flag,
           and it is the only one that can do so for more than one variable.
           Nothing else may: a bounded search that found no more is not a proof
           that there are no more. */
        foreach ($passed as $c) {
            $k = $c['kind'] ?? '';
            /* descent and pell join roots and exhaust, and they are the only two
               that reach an INFINITE solution set: every solution descends to a
               terminal, the terminals lie in a box that is proved rather than
               searched, and the solution set is the union of their orbits. A
               bounded search still may not discharge the flag — those two return
               nothing at all unless the region came out of the leading-coefficient
               argument and every open strip was cleared. */
            if ($k === 'roots' || $k === 'exhaust' || $k === 'descent' || $k === 'pell') { $completeProved = true; break; }
        }
        $evidenceOnly = false;
        $CORROB = array_fill_keys(Capability::corroboratingKinds(), true);
        $certifyingChecks = array_values(array_filter($passedProofs, static fn($c) => !isset($CORROB[$c['kind']])));
        $anyNeeds = count($passedProofs) > 0 && !$completeProved;
        if ($anyNeeds) {
            foreach ($passedProofs as $c) {
                if (!empty($c['needsComplete'])) { $evidenceOnly = true; break; }
            }
        }

        if ($invalidQuestion)         $state = 'invalid_question';
        elseif (count($failedAnswer)) $state = 'disputed';
        elseif (count($failed))       $state = 'stepfail';
        elseif (count($certifyingChecks) && !$evidenceOnly) $state = 'checked';
        else                          $state = 'unverified';

        /* ---------- three trust layers, reported separately ----------
           They answer different questions and must not be averaged into one
           number. "Arithmetic verified" is true and useless when the question
           was misread — the sum really does add up, for the wrong problem —
           so each layer carries its own status and the overall verdict is a
           conjunction, never a majority. */
        $layer = static function (array $checks, array $kinds): string {
            $seen = false;
            foreach ($checks as $c) {
                if (!isset($kinds[$c['kind']])) continue;
                $seen = true;
                if (!$c['ok']) return 'MISMATCH';
            }
            return $seen ? 'VERIFIED' : 'NOT_CHECKED';
        };
        $question   = $layer($checks, ['integrity' => 1]);
        $arithmetic = $layer($checks, ['arith' => 1, 'subst' => 1, 'units' => 1, 'question' => 1, 'claim' => 1, 'primality' => 1, 'truncated' => 1, 'contradiction' => 1]);
        $traceState = $layer($checks, ['trace' => 1]);

        /* NOT_CHECKED is not a failure. Requiring all three layers to have RUN
           meant a two-variable question — where the trace layer cannot apply —
           could never be more than PARTIALLY_VERIFIED, so almost every correct
           answer carried a warning badge and the label stopped meaning
           anything.

           What FULLY_VERIFIED must actually assert: nothing contradicted the
           answer, AND the substantive layer really ran. A trace alone is not
           enough to claim it — that only says the final value appears in the
           working, which is true of plenty of wrong answers. */
        if ($invalidQuestion)                  $overall = 'QUESTION_INVALID';
        elseif ($question === 'MISMATCH')      $overall = 'QUESTION_MISMATCH';
        elseif ($arithmetic === 'MISMATCH')    $overall = 'ARITHMETIC_MISMATCH';
        elseif ($traceState === 'MISMATCH')    $overall = 'TRACE_MISMATCH';
        elseif ($arithmetic === 'VERIFIED')    $overall = 'FULLY_VERIFIED';
        elseif ($question === 'VERIFIED'
                || $traceState === 'VERIFIED') $overall = 'PARTIALLY_VERIFIED';
        else                                   $overall = 'NOT_VERIFIED';

        /* The presentation tier. Computed here so both engines derive it from
           the same checks, and compared by parity — a site that softens a badge
           the API still calls a flat failure is the disagreement that matters
           most, because a student and a teacher would be reading two different
           verdicts on one answer. */
        $correction = null;
        if ($state === 'disputed') {
            $slip = null;
            foreach ($checks as $ck)
                if (($ck['kind'] ?? '') === 'descent' && ($ck['ok'] ?? true) === false
                    && !empty($ck['slipOf'])) { $slip = $ck; break; }
            if ($slip !== null) {
                $correction = $slip;
                foreach ($checks as $ck) {
                    if (($ck['ok'] ?? true) !== false || !empty($ck['soft'])) continue;
                    if (($ck['kind'] ?? '') === 'descent' && !empty($ck['slipOf'])) continue;
                    /* the only other failure this tier tolerates is the
                       substitution of the very value the descent corrected */
                    if (($ck['kind'] ?? '') === 'subst'
                        && strpos((string)$ck['text'], (string)$slip['slipOf']) !== false) continue;
                    $correction = null; break;
                }
            }
        }
        /* slipOf has done its job. Stripping it keeps /v1's checks array byte
           identical to every release before this one. */
        $strip = static function (array $list): array {
            foreach ($list as $i => $ck) { unset($ck['slipOf'], $ck['slipTo']); $list[$i] = $ck; }
            return $list;
        };

        return [
            'state'   => $state,
            /* Both values, so parity compares the pair the badge will SHOW and not
               merely that a correction exists. The badge read "(77,368) should be ?"
               in production — it recovered the corrected value by matching
               /gives ([^,]+?), which does/ against the diagnosis, and the value it
               was looking for contains a comma — while every check that only asked
               whether a correction existed stayed green. */
            'correction' => $correction === null ? null
                : (string)$correction['slipOf'] . ' > ' . (string)($correction['slipTo'] ?? ''),
            'trust'   => [
                'question'   => 'QUESTION_' . $question,
                'arithmetic' => 'ARITHMETIC_' . $arithmetic,
                'trace'      => 'TRACE_' . $traceState,
                'overall'    => $overall,
            ],
            'advisory' => $advisory,
            'checked' => count($checks),
            'passed'  => count($passed),
            'failed'  => count($failed),
            /* Failures first: a receipt that buries the failure under ten ticks
               contradicts its own heading. */
            /* Advisory notes last: they are context, not verdicts — but they must
               still REACH the receipt. Building this from failed+passed alone
               dropped them entirely, so the API counted a presentation note in
               'checked' and then never showed it. */
            'checks'  => $strip(array_merge($failed, $passed, $advisory)),
        ];
    }
}

/* Loaded last: Units uses Checks::claimZone and Checks::deLatex, and Checks::run
   uses Units::check. Requiring it from the top of this file would be a cycle. */
require_once __DIR__ . '/units.php';
require_once __DIR__ . '/question.php';
