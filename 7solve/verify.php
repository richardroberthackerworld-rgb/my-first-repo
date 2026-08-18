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
        $s = preg_replace('/[\x{2212}\x{2013}\x{2014}]/u', '-', $s);   // − – —
        $s = str_replace(['×', '÷'], ['*', '/'], $s);
        $s = str_replace(['⁰', '¹', '²', '³', '⁴', '⁵'],
                         ['^0', '^1', '^2', '^3', '^4', '^5'], $s);
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
        '/(-?\d[\d,]*(?:\.\d+)?(?:\s*[+\-×÷*\/]\s*-?\d[\d,]*(?:\.\d+)?)+)\s*=\s*(-?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*-?\d[\d,]*(?:\.\d+)?)?)/u';

    private const EQ_CHARS = '[0-9a-zA-Z\s^²³⁴*\/+\-−–—().]';

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
    public static function arithmetic(string $md): array
    {
        $out = [];
        $seen = [];
        if (!preg_match_all(self::CALC_RE, $md, $ms, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
            return $out;
        }
        foreach ($ms as $m) {
            if (count($out) >= 12) break;                  // a cap, not a sample
            $whole = $m[0][0];
            $at    = $m[0][1];

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

            $got   = self::evalFlat($m[1][0]);
            $exact = strpos($m[2][0], '/') !== false;       // result written as a fraction
            $want  = $exact ? self::evalFlat($m[2][0]) : self::toNum($m[2][0]);
            if (!is_finite($got) || !is_finite($want)) continue;

            $key = preg_replace('/\s+/u', '', $whole);
            if (isset($seen[$key])) continue;
            $seen[$key] = 1;

            /* A fraction carries no decimals, so the written-decimals rule gave
               it a tolerance of 0.5 and passed 4/36 = 1/8. Exact forms compare
               exactly. */
            $agree = $exact
                ? abs($got - $want) <= max(1.0, abs($got)) * 1e-9
                : self::near($got, $want, $m[2][0]);

            $out[] = ['kind' => 'arith', 'ok' => $agree,
                      'text' => trim(preg_replace('/\s+/u', ' ', $whole)),
                      'got' => Algebra::round6($got), 'want' => Algebra::round6($want)];
        }
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
                    $cand = trim(implode(' ', array_slice($words, $a, $b - $a)));
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

    /* ---------- LaTeX → plain maths ----------
       Models answer in LaTeX by default. Without this the checker sees
       \[x^{2}+y^{2}+1=3xy\] and \frac{-4}{2}, parses none of it, and reports
       "0 checks" — which looks like a clean run and is in fact total blindness.
       That is the worst possible failure for a verifier, so this runs before
       every check rather than being an optional tidy-up. */
    public static function deLatex(string $md): string
    {
        $s = $md;
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
        $s = preg_replace('/\^\s*\{([^{}]+)\}/u', '^$1', $s);
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

    public static function claimedTuples(string $md, int $nvars): array
    {
        $out = [];
        $seen = [];
        if ($nvars < 2) return $out;
        $re = '/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?)\s*)?\)/u';
        if (!preg_match_all($re, $md, $ms, PREG_SET_ORDER)) return $out;
        foreach ($ms as $m) {
            $tup = [(float)$m[1], (float)$m[2]];
            if (isset($m[3]) && $m[3] !== '') $tup[] = (float)$m[3];
            if (count($tup) !== $nvars) continue;
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
    public static function substitution(string $question, string $md): array
    {
        $found = self::findEquation($question);
        if ($found === null) return [];
        $eq = $found['eq'];
        if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) return [];  // rule 1
        $zone = self::claimZone($md);

        if (count($eq['vars']) >= 2) {
            $tuples = self::claimedTuples($zone, count($eq['vars']));
            if (!count($tuples)) return [];
            $out = [];
            foreach (array_slice($tuples, 0, 10) as $tp) {
                $env = [];
                foreach ($eq['vars'] as $i => $v) $env[$v] = $tp[$i];
                $ok = Algebra::holdsAt($eq, $env);
                if ($ok === null) continue;               // undefined there → say nothing
                $l = Algebra::round6(Algebra::evalAt($eq['L'], $env));
                $r = Algebra::round6(Algebra::evalAt($eq['R'], $env));
                $out[] = ['kind' => 'subst', 'ok' => $ok,
                    'text' => '(' . implode(',', $eq['vars']) . ') = (' . implode(',', $tp) . ') in '
                            . trim($found['src']) . ' gives ' . $l . ($ok ? ' = ' : ' ≠ ') . $r];
            }
            return $out;
        }

        /* One variable: substitute EVERY claimed root. Checking only the first
           reports a clean pass on an answer whose second root is wrong. */
        $v0 = $eq['vars'][0];
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
        while ($offset < $len && count($roots) <= 6) {
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
            if ($parts !== false && count($parts) > 1 && count($parts) <= 4) {
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

        if (!count($roots) || count($roots) > 6) return [];

        $out = [];
        foreach ($roots as $rv) {
            $env = [$v0 => $rv];
            $ok = Algebra::holdsAt($eq, $env);
            if ($ok === null) continue;                   // undefined there → no verdict
            $l = Algebra::round6(Algebra::evalAt($eq['L'], $env));
            $r = Algebra::round6(Algebra::evalAt($eq['R'], $env));
            $out[] = ['kind' => 'subst', 'ok' => $ok,
                'text' => $v0 . ' = ' . Algebra::round6($rv) . ' put back into '
                        . trim($found['src']) . ' gives ' . $l . ($ok ? ' = ' : ' ≠ ') . $r];
        }
        return $out;
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

        $checks = array_merge(
            self::substitution($question, $answer),
            self::arithmetic($answer)
        );

        $failed = array_values(array_filter($checks, static fn($c) => !$c['ok']));
        $passed = array_values(array_filter($checks, static fn($c) => $c['ok']));

        $answerLevel = ['subst' => true];
        $failedAnswer = array_filter($failed, static fn($c) => isset($answerLevel[$c['kind']]));

        if (count($failedAnswer))     $state = 'disputed';
        elseif (count($failed))       $state = 'stepfail';
        elseif (count($passed))       $state = 'checked';
        else                          $state = 'unverified';

        return [
            'state'   => $state,
            'checked' => count($checks),
            'passed'  => count($passed),
            'failed'  => count($failed),
            /* Failures first: a receipt that buries the failure under ten ticks
               contradicts its own heading. */
            'checks'  => array_merge($failed, $passed),
        ];
    }
}
