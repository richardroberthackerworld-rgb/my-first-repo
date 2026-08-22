<?php
/* ============================================================
   7Solve — BAND B CHECKERS (PHP side)
   ------------------------------------------------------------
   Four checkers that existed only in JavaScript, so the website
   could certify on them and /v1 could not:

     chemistry          does the reaction balance
     bounds             is a probability inside 0…1
     checkDivisibility  does a divide b, actually
     conditionCheck     does the answer satisfy the question's
                        own stated condition

   That was never a safety hole — /v1 returned `unverified` where
   the site returned `checked`, which is honest. It was a
   CAPABILITY gap, and a customer of the API was getting a
   strictly weaker verifier than a student on the website. All
   four emit kinds that sit in the PROOF set.

   PORTED, NOT REINVENTED. Every threshold, loop bound, sweep
   range and bail-out below is the one in index.html, because
   parity is tested by running both engines on the same corpus
   and comparing the check kinds, not by "looks equivalent".
   Where a JS idiom has no clean PHP analogue the JS behaviour
   wins — notably `%` on negatives, which JS and PHP both make
   sign-of-dividend, and which the divisibility checkers correct
   with ((n % d) + d) % d exactly as the original does.

   See VERIFICATION-CONTRACT.md and parity-band-b.js.
   ============================================================ */
declare(strict_types=1);

final class BandB
{
    /* ---------- chemistry ---------- */

    private const ELEMENTS =
        'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' .
        'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm ' .
        'Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu';

    private static ?array $elset = null;

    private static function elset(): array
    {
        if (self::$elset !== null) return self::$elset;
        $out = [];
        foreach (explode(' ', self::ELEMENTS) as $e) $out[$e] = 1;
        return self::$elset = $out;
    }

    private static function deSub(string $s): string
    {
        return str_replace(
            ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'],
            ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], $s);
    }

    /** A chemical formula to an element→count map, or null. */
    public static function parseFormula(string $f): ?array
    {
        $s = trim(self::deSub($f));
        $s = preg_replace('/\((?:s|l|g|aq)\)/i', '', $s);   // state symbols are not groups
        $s = preg_replace('/[·⋅]\s*/u', '.', $s);           // hydrate dot
        $s = preg_replace('/\s+/', '', $s);
        if ($s === '') return null;
        if (preg_match('/[+\-^]/', $s)) return null;        // an ion or a charge: out of scope
        if (!preg_match('/^[A-Za-z0-9().]+$/', $s)) return null;

        /* A hydrate ("CuSO4.5H2O") is two formulas joined by a dot. */
        if (strpos($s, '.') !== false) {
            $acc = []; $ok = true;
            foreach (explode('.', $s) as $part) {
                preg_match('/^(\d*)(.*)$/', $part, $m);
                $mult = ($m[1] !== '') ? (int)$m[1] : 1;
                $sub = self::parseFormula($m[2]);
                if ($sub === null) { $ok = false; break; }
                foreach ($sub as $k => $v) $acc[$k] = ($acc[$k] ?? 0) + $v * $mult;
            }
            return $ok ? $acc : null;
        }

        $i = 0; $bad = false; $els = self::elset();
        $len = strlen($s);
        $group = static function () use (&$group, &$i, &$bad, $s, $len, $els): array {
            $out = [];
            while ($i < $len && !$bad) {
                $c = $s[$i];
                if ($c === ')') break;
                if ($c === '(') {
                    $i++;
                    $inner = $group();
                    if ($bad || ($i >= $len || $s[$i] !== ')')) { $bad = true; return $out; }
                    $i++;
                    $n = '';
                    while ($i < $len && ctype_digit($s[$i])) $n .= $s[$i++];
                    $mult = $n !== '' ? (int)$n : 1;
                    foreach ($inner as $k => $v) $out[$k] = ($out[$k] ?? 0) + $v * $mult;
                    continue;
                }
                if (!preg_match('/[A-Z]/', $c)) { $bad = true; return $out; }
                $el = $c; $i++;
                if ($i < $len && preg_match('/[a-z]/', $s[$i])) {
                    if (isset($els[$el . $s[$i]])) { $el .= $s[$i]; $i++; }
                    else { $bad = true; return $out; }
                }
                if (!isset($els[$el])) { $bad = true; return $out; }
                $d = '';
                while ($i < $len && ctype_digit($s[$i])) $d .= $s[$i++];
                $out[$el] = ($out[$el] ?? 0) + ($d !== '' ? (int)$d : 1);
            }
            return $out;
        };
        $res = $group();
        if ($bad || $i < $len) return null;
        return count($res) ? $res : null;
    }

    private static function parseSide(string $side): ?array
    {
        $total = []; $ok = true;
        foreach (preg_split('/\s*\+\s*/', self::deSub($side)) as $term) {
            if (!$ok) break;
            $t = trim(preg_replace('/\((?:s|l|g|aq)\)/i', '', trim($term)));
            if (!preg_match('/^(\d+)?\s*([A-Za-z0-9().·⋅]+)$/u', $t, $m)) { $ok = false; break; }
            $coef = (isset($m[1]) && $m[1] !== '') ? (int)$m[1] : 1;
            $f = self::parseFormula($m[2]);
            if ($f === null) { $ok = false; break; }
            foreach ($f as $k => $v) $total[$k] = ($total[$k] ?? 0) + $v * $coef;
        }
        return ($ok && count($total)) ? $total : null;
    }

    /** Shed words from one end until the side parses as chemistry. */
    private static function trimSide(string $raw, bool $fromEnd): ?array
    {
        $words = preg_split('/\s+/', trim($raw));
        $n = count($words);
        for ($drop = 0; $drop < $n && $drop < 8; $drop++) {
            $slice = $fromEnd ? array_slice($words, 0, $n - $drop) : array_slice($words, $drop);
            if (!count($slice)) break;
            $txt = trim(preg_replace('/^[+,;.]+|[+,;.]+$/', '', implode(' ', $slice)));
            if ($txt === '') continue;
            $counts = self::parseSide($txt);
            if ($counts !== null) return ['counts' => $counts, 'text' => $txt];
        }
        return null;
    }

    public static function chemistry(string $md): array
    {
        $out = []; $seen = [];
        /* Only an explicit reaction arrow counts. "=" is left out on purpose: it
           is the arithmetic checker's territory, and "2 + 2 = 4" is not a
           reaction. */
        $re = '/([^\n]{1,120}?)\s*(?:-->|->|→|⟶|⇌|⇋|<=>)\s*([^\n]{1,120})/u';
        if (!preg_match_all($re, $md, $ms, PREG_SET_ORDER)) return $out;
        foreach ($ms as $m) {
            if (count($out) >= 3) break;
            $L = self::trimSide($m[1], false);
            $R = self::trimSide($m[2], true);
            if ($L === null || $R === null) continue;      // rule 1: unparseable → no check
            $els = [];
            foreach (array_keys($L['counts']) as $k) $els[$k] = 1;
            foreach (array_keys($R['counts']) as $k) $els[$k] = 1;
            /* One element on one side only is a fragment, not an equation — it is
               how "x -> 0" and single-word prose sneak through. */
            if (count($els) < 2) continue;
            $shown = $L['text'] . ' → ' . $R['text'];
            if (isset($seen[$shown])) continue;
            $seen[$shown] = 1;
            $wrong = [];
            foreach (array_keys($els) as $k) {
                if (($L['counts'][$k] ?? 0) !== ($R['counts'][$k] ?? 0)) $wrong[] = $k;
            }
            $parts = [];
            foreach ($wrong as $k) {
                $parts[] = $k . ': ' . ($L['counts'][$k] ?? 0) . ' left, ' . ($R['counts'][$k] ?? 0) . ' right';
            }
            $out[] = ['kind' => 'chem', 'ok' => !count($wrong),
                'text' => count($wrong) ? $shown . ' — ' . implode('; ', $parts) : $shown . ' balances'];
        }
        return $out;
    }

    /* ---------- bounds ---------- */

    public static function section(string $md, string $emoji): string
    {
        $re = '/##\s*' . preg_quote($emoji, '/') . '[^\n]*\n([\s\S]*?)(?=\n##\s|$)/u';
        return preg_match($re, $md, $m) ? $m[1] : '';
    }

    private static function values(string $txt): array
    {
        $out = [];
        if (!preg_match_all('/-?\d[\d,]*(?:\.\d+)?/', $txt, $ms, PREG_SET_ORDER)) return $out;
        foreach ($ms as $m) {
            $n = Checks::toNum($m[0]);
            if (!is_finite($n)) continue;
            $out[] = ['n' => $n, 'raw' => $m[0]];
        }
        return $out;
    }

    /* The one number a student would copy: the first that is not a step number,
       a year, or a bare 0/1. */
    private static function headline(string $txt): ?array
    {
        foreach (self::values($txt) as $x) {
            $isInt = (abs($x['n'] - round($x['n'])) < 1e-12);
            if (abs($x['n']) <= 1 && $isInt) continue;
            if ($x['n'] >= 1500 && $x['n'] <= 2100 && $isInt && strpos($x['raw'], '.') === false) continue;
            return $x;
        }
        return null;
    }

    public static function bounds(string $question, string $md): array
    {
        if (!preg_match('/\bprobabilit|\bప్రాబబిలిటీ|\bप्रायिकता/iu', $question . $md)) return [];
        $ans = self::section($md, '✅');
        if ($ans === '') return [];
        $p = null; $fRaw = null;
        if (preg_match('/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/', $ans, $f)) {
            $fRaw = $f[0];
            $den = (float)$f[2];
            $p = $den == 0.0 ? INF : (float)$f[1] / $den;
        } else {
            $h = self::headline($ans);
            if ($h === null || strpos($ans, '%') !== false) return [];
            $p = $h['n'];
        }
        if (!is_finite($p)) return [];
        $ok = ($p >= -1e-9 && $p <= 1 + 1e-9);
        return [['kind' => 'bound', 'ok' => $ok,
            'text' => $ok ? 'the probability is inside 0…1'
                          : 'a probability of ' . ($fRaw !== null ? $fRaw : Algebra::round6($p)) .
                            ' is impossible — it must be between 0 and 1']];
    }

    /* ---------- divisibility ---------- */

    private const STOP = ['so','is','of','in','to','we','it','as','at','by','or',
        'if','no','on','an','be','do','he','my','up','us',
        'and','the','for','all','any','let','has','its','not',
        'that','this','then','thus','note','here','also','since',
        'hence','every','which','where','therefore'];

    private static function isWordToken(string $tok): bool
    {
        if (!preg_match('/^[a-zA-Z]+$/', $tok)) return false;   // has a digit or symbol → not a word
        $w = strtolower($tok);
        if (Algebra::isFunctionName($w) || Algebra::isConstName($w)) return false;
        return strlen($w) >= 3 || in_array($w, self::STOP, true);
    }

    private static function isMathToken(string $tok): bool
    {
        if ($tok === '') return false;
        if (!preg_match('/^[0-9a-zA-Z^²³⁴*\/+\-−–—().|]+$/u', $tok)) return false;
        return !self::isWordToken($tok);
    }

    /** The longest run of maths tokens at one end of a fragment, parsed. */
    private static function grabExpr(string $frag, bool $fromEnd): ?array
    {
        $clean = preg_replace('/^[.,;:]+|[.,;:]+$/', '', trim($frag));
        $words = array_values(array_filter(preg_split('/\s+/', $clean), static fn($x) => $x !== ''));
        if (!count($words)) return null;
        $taken = [];
        if ($fromEnd) {
            for ($i = count($words) - 1; $i >= 0; $i--) {
                if (!self::isMathToken($words[$i])) break;
                array_unshift($taken, $words[$i]);
            }
        } else {
            foreach ($words as $w) {
                if (!self::isMathToken($w)) break;
                $taken[] = $w;
            }
        }
        if (!count($taken)) return null;
        /* Shed tokens from the far end until what is left actually parses — a
           trailing "|" or a stray bracket should not lose the whole claim. */
        for ($k = count($taken); $k > 0; $k--) {
            $cand = trim(implode(' ', $fromEnd ? array_slice($taken, count($taken) - $k) : array_slice($taken, 0, $k)));
            if ($cand === '') continue;
            $ast = Algebra::parse($cand);
            if ($ast !== null && count(Algebra::varsOf($ast)) <= 3) return ['ast' => $ast, 'src' => $cand];
        }
        return null;
    }

    private const DIV_PATTERNS = [
        ['re' => '/([^.,;\n]{1,60}?)\s+does\s+not\s+divide\s+([^.,;\n]{1,60})/iu', 'want' => false, 'swap' => false],
        ['re' => '/([^.,;\n]{1,60}?)\s*∤\s*([^.,;\n]{1,60})/u',                    'want' => false, 'swap' => false],
        ['re' => '/([^.,;\n]{1,60}?)\s+divides\s+([^.,;\n]{1,60})/iu',             'want' => true,  'swap' => false],
        ['re' => '/([^.,;\n]{1,60}?)\s+is\s+divisible\s+by\s+([^.,;\n]{1,60})/iu', 'want' => true,  'swap' => true],
    ];

    public static function divisibilityClaims(string $text): array
    {
        $out = []; $seen = [];
        foreach (self::DIV_PATTERNS as $p) {
            if (!preg_match_all($p['re'], $text, $ms, PREG_SET_ORDER)) continue;
            foreach ($ms as $m) {
                if (count($out) >= 6) break;
                /* The divisor sits before the keyword, so it is read backwards from
                   its right edge; the dividend sits after it and is read forwards. */
                $A = $p['swap'] ? self::grabExpr($m[2], false) : self::grabExpr($m[1], true);
                $B = $p['swap'] ? self::grabExpr($m[1], true)  : self::grabExpr($m[2], false);
                if ($A === null || $B === null) continue;
                $key = $A['src'] . '|' . $B['src'] . '|' . ($p['want'] ? '1' : '0');
                if (isset($seen[$key])) continue;
                $seen[$key] = 1;
                $out[] = ['divisor' => $A, 'dividend' => $B, 'want' => $p['want']];
            }
        }
        return $out;
    }

    /** JS-compatible non-negative remainder. */
    private static function mod(int $n, int $d): int
    {
        return (($n % $d) + $d) % $d;
    }

    public static function checkDivisibility(string $text): array
    {
        $out = [];
        foreach (self::divisibilityClaims($text) as $c) {
            $vars = Algebra::varsOf($c['dividend']['ast'], Algebra::varsOf($c['divisor']['ast'], []));
            $vs = array_keys($vars);
            $label = $c['divisor']['src'] . ($c['want'] ? ' divides ' : ' does not divide ') . $c['dividend']['src'];

            if (!count($vs)) {
                $d = Algebra::evalAt($c['divisor']['ast'], []);
                $n = Algebra::evalAt($c['dividend']['ast'], []);
                if (!is_finite($d) || !is_finite($n) || $d == 0.0) continue;
                if (abs($d - round($d)) > 1e-9 || abs($n - round($n)) > 1e-9) continue;
                $D = (int)round($d); $N = (int)round($n);
                $divides = ($N % $D === 0);
                $out[] = ['kind' => 'divis', 'ok' => ($divides === $c['want']),
                    'text' => $label . ' — ' . $N . ' mod ' . $D . ' = ' . self::mod($N, $D) .
                              ($divides === $c['want'] ? ', as claimed' : ', so the claim is wrong')];
                continue;
            }
            if (count($vs) !== 1) continue;                 // more than one variable → no verdict

            /* A variable divisibility is tested over a range. A single failure
               disproves a universal claim outright; passing everywhere is reported
               as what it is — evidence over the range tried, not a proof. */
            $v = $vs[0]; $bad = null; $tested = 0; $held = 0;
            for ($n = -20; $n <= 60 && $bad === null; $n++) {
                $env = [$v => (float)$n];
                $dv = Algebra::evalAt($c['divisor']['ast'], $env);
                $nv = Algebra::evalAt($c['dividend']['ast'], $env);
                if (!is_finite($dv) || !is_finite($nv) || abs($dv) < 1e-9) continue;
                if (abs($dv - round($dv)) > 1e-6 || abs($nv - round($nv)) > 1e-6) continue;
                $tested++;
                $r = self::mod((int)round($nv), (int)round($dv));
                if ($r === 0) $held++;
                elseif ($c['want']) $bad = ['n' => $n, 'rem' => $r, 'dv' => (int)round($dv), 'nv' => (int)round($nv)];
            }
            if ($tested < 5) continue;
            if ($c['want']) {
                $out[] = $bad !== null
                    ? ['kind' => 'divis', 'ok' => false,
                       'text' => '“' . $label . '” fails at ' . $v . ' = ' . $bad['n'] . ' — ' . $bad['nv'] .
                                 ' mod ' . $bad['dv'] . ' = ' . $bad['rem']]
                    : ['kind' => 'divis', 'ok' => true, 'holdsForAll' => true,
                       'expr' => $c, 'variable' => $v,
                       'text' => '“' . $label . '” holds for all ' . $tested . ' integer values tried'];
            } else {
                /* a "does not divide" claim about a variable expression is only
                   false if it divides everywhere — anything else is a domain
                   question */
                if ($held === $tested) {
                    $out[] = ['kind' => 'divis', 'ok' => false,
                        'text' => '“' . $label . '” is wrong — it divides for every value tried'];
                }
            }
        }
        return $out;
    }

    /* ---------- conditionCheck ---------- */

    public static function conditionCheck(string $question, string $md): array
    {
        $conds = [];
        foreach (self::divisibilityClaims($question) as $c) if ($c['want']) $conds[] = $c;
        if (!count($conds)) return [];
        $c = $conds[0];
        $vs = array_keys(Algebra::varsOf($c['dividend']['ast'], Algebra::varsOf($c['divisor']['ast'], [])));
        if (count($vs) !== 1) return [];
        $v = $vs[0];

        /* values the answer puts forward */
        $ans = self::section($md, '✅');
        if ($ans === '') $ans = substr($md, 0, 400);
        $vals = []; $seen = [];
        if (preg_match_all('/\b' . preg_quote($v, '/') . '\s*=\s*(-?\d+)\b/i', $ans, $ms, PREG_SET_ORDER)) {
            foreach ($ms as $m) {
                $n = (int)$m[1];
                if (!isset($seen[$n])) { $seen[$n] = 1; $vals[] = $n; }
                if (count($vals) >= 6) break;
            }
        }
        if (!count($vals)) return [];

        $out = [];
        foreach ($vals as $n) {
            $env = [$v => (float)$n];
            $dv = Algebra::evalAt($c['divisor']['ast'], $env);
            $nv = Algebra::evalAt($c['dividend']['ast'], $env);
            if (!is_finite($dv) || !is_finite($nv) || abs($dv) < 1e-9) continue;
            if (abs($dv - round($dv)) > 1e-6 || abs($nv - round($nv)) > 1e-6) continue;
            $D = (int)round($dv); $N = (int)round($nv);
            $rem = self::mod($N, $D);
            $out[] = ['kind' => 'condition', 'ok' => ($rem === 0),
                'text' => $v . ' = ' . $n . ' in the question’s own condition (' . $c['divisor']['src'] .
                          ' divides ' . $c['dividend']['src'] . ') gives ' . $N . ' mod ' . $D . ' = ' . $rem .
                          ($rem === 0 ? ' ✓' : ', so it is not a solution')];
        }
        return $out;
    }
}
