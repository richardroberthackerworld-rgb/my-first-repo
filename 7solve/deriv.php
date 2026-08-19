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
                if (($w['t'] ?? '') !== 'n') return null;
                self::note('power');
                $du = self::d($u, $v);
                if ($du === null) return null;
                if (!(($u['t'] ?? '') === 'v' && strtolower($u['v']) === $v)) self::note('chain');
                return self::B('*', self::B('*', self::N($w['v']), self::B('^', $u, self::N($w['v'] - 1))), $du);
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
                default: return null;             // abs, floor, log10 … not differentiable here
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
