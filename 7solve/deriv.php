<?php
/* ============================================================
   7Solve — SYMBOLIC DIFFERENTIATION (PHP port of Deriv)
   ------------------------------------------------------------
   A faithful transcription of the Deriv module in index.html.

   The string output matters as much as the mathematics. `expr`
   and `result` are fed into the sample-point KEY, so a serialiser
   that renders "6 x" where JS renders "6x" changes the hash,
   changes the points, and can change the verdict on an answer
   both engines actually agree about. Parity here is tested by
   string equality on every expression, not by "looks the same".

   Ported deliberately rather than reimplemented: the simplifier's
   rule ORDER is load-bearing for the output form, so the branches
   below appear in the same sequence as the original.
   ============================================================ */
declare(strict_types=1);

final class Deriv
{
    private static array $lastRules = [];

    private static function N(float $v): array { return ['t' => 'n', 'v' => $v]; }
    private static function isN($a, $v = null): bool
    {
        return is_array($a) && ($a['t'] ?? '') === 'n'
            && ($v === null || abs($a['v'] - $v) < 1e-12);
    }
    private static function B(string $op, $a, $b): array { return ['t' => 'b', 'op' => $op, 'a' => $a, 'b' => $b]; }
    private static function C(string $fn, $a): array { return ['t' => 'c', 'fn' => $fn, 'a' => $a]; }

    public static function simp($a)
    {
        if (!$a) return $a;
        if (($a['t'] ?? '') === 'u') {
            $s = self::simp($a['a']);
            return self::isN($s) ? self::N(-$s['v']) : ['t' => 'u', 'a' => $s];
        }
        if (($a['t'] ?? '') === 'c') return self::C($a['fn'], self::simp($a['a']));
        if (($a['t'] ?? '') !== 'b') return $a;

        $x = self::simp($a['a']); $y = self::simp($a['b']); $op = $a['op'];
        if (self::isN($x) && self::isN($y)) {
            if ($op === '+') return self::N($x['v'] + $y['v']);
            if ($op === '-') return self::N($x['v'] - $y['v']);
            if ($op === '*') return self::N($x['v'] * $y['v']);
            if ($op === '/' && abs($y['v']) > 1e-12) return self::N($x['v'] / $y['v']);
            if ($op === '^') return self::N(pow($x['v'], $y['v']));
        }
        if ($op === '+') { if (self::isN($x, 0)) return $y; if (self::isN($y, 0)) return $x; }
        if ($op === '-') { if (self::isN($y, 0)) return $x; if (self::isN($x, 0)) return self::simp(['t' => 'u', 'a' => $y]); }
        if ($op === '*') {
            if (self::isN($x, 0) || self::isN($y, 0)) return self::N(0);
            if (self::isN($x, 1)) return $y; if (self::isN($y, 1)) return $x;
            if (self::isN($x, -1)) return self::simp(['t' => 'u', 'a' => $y]);
            if (self::isN($y, -1)) return self::simp(['t' => 'u', 'a' => $x]);
            if (self::isN($y) && !self::isN($x)) return self::B('*', $y, $x);
        }
        if ($op === '/') { if (self::isN($y, 1)) return $x; if (self::isN($x, 0)) return self::N(0); }
        if ($op === '^') { if (self::isN($y, 1)) return $x; if (self::isN($y, 0)) return self::N(1); }
        if ($op === '*' && self::isN($x) && ($y['t'] ?? '') === 'b' && $y['op'] === '*' && self::isN($y['a']))
            return self::simp(self::B('*', self::N($x['v'] * $y['a']['v']), $y['b']));
        if ($op === '*' && self::isN($y) && ($x['t'] ?? '') === 'b' && $x['op'] === '*' && self::isN($x['a']))
            return self::simp(self::B('*', self::N($y['v'] * $x['a']['v']), $x['b']));
        if ($op === '+' && ($y['t'] ?? '') === 'u') return self::simp(self::B('-', $x, $y['a']));
        if ($op === '+' && ($y['t'] ?? '') === 'b' && $y['op'] === '*' && ($y['a']['t'] ?? '') === 'u')
            return self::simp(self::B('-', $x, self::B('*', $y['a']['a'], $y['b'])));
        if ($op === '+' && ($y['t'] ?? '') === 'b' && $y['op'] === '*' && ($y['b']['t'] ?? '') === 'u')
            return self::simp(self::B('-', $x, self::B('*', $y['a'], $y['b']['a'])));
        if ($op === '+' && self::isN($y) && $y['v'] < 0) return self::simp(self::B('-', $x, self::N(-$y['v'])));
        return self::B($op, $x, $y);
    }

    private static function note(string $r): void
    {
        if (!in_array($r, self::$lastRules, true)) self::$lastRules[] = $r;
    }

    /* The numeric value of a subtree containing no variable, or null.
       This is what lets x^(3/2) be differentiated: the exponent is a division
       node rather than a number, and refusing it meant the standard textbook
       answer to the integral of sqrt(x) received no verdict at all.

       It folds only what is exactly foldable and returns null the moment a
       variable appears, so it can never turn a variable exponent into a
       constant one. Non-finite results are null too — 1/0 inside an exponent
       is not a constant, it is a mistake.

       Byte-for-byte the same decisions as constOf() in index.html; the
       Release B suite compares both engines on every case. */
    private static function constOf($a)
    {
        if (!is_array($a)) return null;
        $t = $a['t'] ?? '';
        if ($t === 'n') return is_finite((float)$a['v']) ? (float)$a['v'] : null;
        if ($t === 'v') return null;
        if ($t === 'u') { $s = self::constOf($a['a']); return $s === null ? null : -$s; }
        if ($t === 'c') {
            $iv = self::constOf($a['a']);
            if ($iv === null) return null;
            switch ($a['fn']) {
                case 'sqrt':  $r = $iv < 0 ? NAN : sqrt($iv); break;
                case 'cbrt':  $r = ($iv < 0 ? -pow(-$iv, 1 / 3) : pow($iv, 1 / 3)); break;
                case 'abs':   $r = abs($iv); break;
                case 'exp':   $r = exp($iv); break;
                case 'ln':    $r = $iv > 0 ? log($iv) : NAN; break;
                case 'log':
                case 'log10': $r = $iv > 0 ? log10($iv) : NAN; break;
                case 'log2':  $r = $iv > 0 ? log($iv, 2) : NAN; break;
                case 'sin':   $r = sin($iv); break;
                case 'cos':   $r = cos($iv); break;
                case 'tan':   $r = tan($iv); break;
                default: return null;
            }
            return is_finite($r) ? (float)$r : null;
        }
        if ($t === 'b') {
            $x = self::constOf($a['a']);
            $y = self::constOf($a['b']);
            if ($x === null || $y === null) return null;
            switch ($a['op']) {
                case '+': $out = $x + $y; break;
                case '-': $out = $x - $y; break;
                case '*': $out = $x * $y; break;
                case '/': if (abs($y) < 1e-15) return null; $out = $x / $y; break;
                case '^': $out = pow($x, $y); break;
                default: return null;
            }
            return is_finite($out) ? (float)$out : null;
        }
        return null;
    }

    private static function d($a, string $v)
    {
        if (!$a) return null;
        $t = $a['t'] ?? '';
        if ($t === 'n') return self::N(0);
        if ($t === 'v') return self::N(strtolower($a['v']) === $v ? 1 : 0);
        if ($t === 'u') { $inner = self::d($a['a'], $v); return $inner === null ? null : ['t' => 'u', 'a' => $inner]; }
        if ($t === 'b') {
            $u = $a['a']; $w = $a['b'];
            if ($a['op'] === '+' || $a['op'] === '-') {
                self::note('sum');
                $du = self::d($u, $v); $dw = self::d($w, $v);
                if ($du === null || $dw === null) return null;
                return self::B($a['op'], $du, $dw);
            }
            if ($a['op'] === '*') {
                self::note('product');
                $du = self::d($u, $v); $dw = self::d($w, $v);
                if ($du === null || $dw === null) return null;
                return self::B('+', self::B('*', $du, $w), self::B('*', $u, $dw));
            }
            if ($a['op'] === '/') {
                self::note('quotient');
                $du = self::d($u, $v); $dw = self::d($w, $v);
                if ($du === null || $dw === null) return null;
                return self::B('/', self::B('-', self::B('*', $du, $w), self::B('*', $u, $dw)),
                                    self::B('^', $w, self::N(2)));
            }
            if ($a['op'] === '^') {
                /* The exponent must be CONSTANT — but not necessarily a bare
                   number. A textbook writes x^(3/2), which parses as a division
                   node, and the old test ($w['t'] !== 'n') refused it, so the
                   standard answer to the integral of sqrt(x) got no verdict.
                   constOf folds any variable-free exponent and still refuses
                   x^x. Mirrors index.html exactly. */
                $wc = self::constOf($w);
                if ($wc !== null) {
                    self::note('power');
                    $du = self::d($u, $v);
                    if ($du === null) return null;
                    if (!(($u['t'] ?? '') === 'v' && strtolower($u['v']) === $v)) self::note('chain');
                    return self::B('*', self::B('*', self::N($wc), self::B('^', $u, self::N($wc - 1))), $du);
                }
                /* CONSTANT BASE, variable exponent: d/dx a^u = a^u * ln(a) * du.
                   e^x is the case that matters, and `e` tokenises to a NUMBER,
                   so it arrives here as 2.718…^x, not as a named function. */
                $uc = self::constOf($u);
                if ($uc !== null) {
                    if (!($uc > 0)) return null;          // ln(a) undefined for a <= 0
                    self::note('exp');
                    $dw = self::d($w, $v);
                    if ($dw === null) return null;
                    return self::B('*', self::B('*', self::B('^', self::N($uc), $w), self::N(log($uc))), $dw);
                }
                /* x^x needs logarithmic differentiation; null rather than pretend. */
                return null;
            }
            return null;
        }
        if ($t === 'c') {
            $g = self::d($a['a'], $v);
            if ($g === null) return null;
            $inner = $a['a'];
            if (!(($inner['t'] ?? '') === 'v' && strtolower($inner['v']) === $v)) self::note('chain');
            switch ($a['fn']) {
                case 'sin':  self::note('trig');  return self::B('*', self::C('cos', $inner), $g);
                case 'cos':  self::note('trig');  return self::B('*', ['t' => 'u', 'a' => self::C('sin', $inner)], $g);
                case 'tan':  self::note('trig');  return self::B('/', $g, self::B('^', self::C('cos', $inner), self::N(2)));
                case 'exp':  self::note('exp');   return self::B('*', self::C('exp', $inner), $g);
                case 'ln':   self::note('log');   return self::B('/', $g, $inner);
                case 'sqrt': self::note('power'); return self::B('/', $g, self::B('*', self::N(2), self::C('sqrt', $inner)));
                /* |u|' = (u/|u|)*u'. Undefined at u = 0, where evalAt yields
                   0/0 and the sample is discarded rather than counted — the
                   correct reading of a point where the derivative does not
                   exist. This is what lets ln|x| be checked, and ln|x| + C is
                   how every textbook writes the integral of 1/x. */
                case 'abs':  self::note('abs');   return self::B('*', self::B('/', $inner, self::C('abs', $inner)), $g);
                /* Explicit bases only. `log` is deliberately ABSENT: in Indian
                   textbooks it means log10 in algebra and ln in calculus, and
                   the notation does not say which. Guessing would either
                   certify a wrong answer or dispute a right one, so a bare
                   log() falls through to null and the claim gets NO VERDICT. */
                case 'log10': self::note('log');  return self::B('/', $g, self::B('*', $inner, self::N(M_LN10)));
                case 'log2':  self::note('log');  return self::B('/', $g, self::B('*', $inner, self::N(M_LN2)));
                default: return null;             // log, floor, ceil … no verdict
            }
        }
        return null;
    }

    private const SUP = [2 => '²', 3 => '³', 4 => '⁴', 5 => '⁵', 6 => '⁶', 7 => '⁷', 8 => '⁸', 9 => '⁹'];

    /* Numbers must render exactly as JS String(n) does, or the sample key
       diverges: JS prints 6 not 6.0, and 0.5 not 0.50000. */
    private static function num(float $n): string
    {
        $r = round($n * 1e9) / 1e9;
        if ($r == (int)$r && abs($r) < 1e15) return (string)(int)$r;
        $s = rtrim(rtrim(sprintf('%.9F', $r), '0'), '.');
        return $s === '' || $s === '-' ? '0' : $s;
    }

    public static function str($a, int $prec = 0): string
    {
        if (!$a) return '?';
        $t = $a['t'] ?? '';
        if ($t === 'n') return self::num((float)$a['v']);
        if ($t === 'v') return $a['v'];
        if ($t === 'u') return '−' . self::str($a['a'], 3);
        if ($t === 'c') return $a['fn'] . '(' . self::str($a['a'], 0) . ')';
        $P = ['+' => 1, '-' => 1, '*' => 2, '/' => 2, '^' => 4];
        $p = $P[$a['op']] ?? 0;
        if ($a['op'] === '^' && self::isN($a['b']) && isset(self::SUP[(int)$a['b']['v']])
            && (float)(int)$a['b']['v'] === (float)$a['b']['v']) {
            $body = self::str($a['a'], 4) . self::SUP[(int)$a['b']['v']];
        } elseif ($a['op'] === '*') {
            $L = self::str($a['a'], $p); $R = self::str($a['b'], $p);
            /* JS: /[\w²³⁴)]$/ on L and /^[a-z(]/i on R -> plain space, else " · ".
               \w is ASCII in JS, so mb-safety here means testing the last
               CHARACTER, not the last byte. */
            $lastCh = mb_substr($L, -1, 1, 'UTF-8');
            $firstCh = mb_substr($R, 0, 1, 'UTF-8');
            $lOk = (bool)preg_match('/[A-Za-z0-9_²³⁴)]/u', $lastCh);
            $rOk = (bool)preg_match('/[a-zA-Z(]/u', $firstCh);
            $body = $L . (($lOk && $rOk) ? ' ' : ' · ') . $R;
        } else {
            $body = self::str($a['a'], $p) . ' ' . ($a['op'] === '-' ? '−' : $a['op'])
                  . ' ' . self::str($a['b'], $p + 1);
        }
        return $p < $prec ? '(' . $body . ')' : $body;
    }

    public static function normalise($src): string
    {
        $src = str_replace('·', '*', (string)($src ?? ''));
        $FN = 'sin|cos|tan|asin|acos|atan|ln|log|log2|log10|exp|sqrt|cbrt|abs';
        $s = preg_replace('/\b(' . $FN . ')\s*\^\s*(\d+)\s+([a-z])\b/i', '$1($3)^$2', $src);
        $s = preg_replace_callback('/\b(' . $FN . ')\s+(\d*\s*[a-z])(?![\w(])/i',
            static fn($m) => $m[1] . '(' . preg_replace('/\s+/', '', $m[2]) . ')', $s);
        $s = preg_replace('/\b(' . $FN . ')\s+(\d+(?:\.\d+)?)(?![\w(])/i', '$1($2)', $s);
        return $s;
    }

    /** @return array{expr:string,result:string,rules:array,variable:string}|null */
    public static function of(string $src, ?string $v = null): ?array
    {
        $ast = Algebra::parse(self::normalise($src));
        if ($ast === null) $ast = Algebra::parse($src);
        if ($ast === null) return null;
        $vars = array_keys(Algebra::varsOf($ast));
        if (count($vars) > 1) return null;              // partial derivatives: not here
        $v = $v ?: ($vars[0] ?? 'x');
        self::$lastRules = [];
        $raw = self::d($ast, $v);
        if ($raw === null) return null;
        return ['expr' => self::str(self::simp($ast), 0),
                'result' => self::str(self::simp($raw), 0),
                'rules' => self::$lastRules,
                'variable' => $v];
    }
}
