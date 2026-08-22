<?php
/* ============================================================
   7Solve — PHASE 1 CHECKERS (PHP side)
   ------------------------------------------------------------
   Systems of equations and algebraic identities, ported from the
   JavaScript that ships in index.html so that /v1 gives the same
   verdict as the website.

   Ported, not reinvented. Every safety property the JS side
   earned the hard way is reproduced here on purpose:

     * a system is checked against EVERY equation, because
       x = 5, y = 5 satisfies x + y = 10 perfectly and fails
       x - y = 2 — a one-equation check would CONFIRM the wrong
       answer rather than miss it;

     * satisfaction is not uniqueness, so a non-linear system is
       never certified;

     * probe and sample points come from sample_points(), keyed
       on the claim, because a fixed grid is forgeable.

   See VERIFICATION-CONTRACT.md.
   ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/sampling.php';

final class Phase1
{
    /* ---------- every equation in the question, deduplicated ---------- */
    public static function equationsOf(string $q): array
    {
        $parts = preg_split('/\n|[,;]|\band\b/i', $q) ?: [];
        $out = []; $seen = [];
        foreach ($parts as $p) {
            $p = trim(preg_replace('/[?.]+\s*$/', '', $p));
            if (strpos($p, '=') === false) continue;

            /* Strip lead-in words one token at a time and keep the DEEPEST
               candidate that still parses. Greedy stripping eats "xy" — a
               product of two variables is an English word by shape — and
               leaves "= 6", which parses as nothing. A candidate starting with
               a binary operator is the tail of an expression whose first term
               was just eaten; a leading minus is legitimate unary. */
            $lead = '/^(?:[A-Za-z](?=\s+[A-Za-z]{2,})[^0-9a-zA-Z(+\-]*|[A-Za-z]{2,}(?!\s*\()[^0-9a-zA-Z(+\-]*)/';
            $eq = null; $src = null; $cand = $p; $guard = 0;
            while ($guard++ < 9) {
                $trial = trim(preg_replace('/^[^0-9a-zA-Z(+\-]+/', '',
                         preg_replace('/^[A-Za-z]\s*:\s*/', '', $cand)));
                if (strpos($trial, '=') !== false && !preg_match('/^[+*\/^]/', $trial)) {
                    $e = Algebra::parseEquation($trial);
                    if ($e !== null) { $eq = $e; $src = $trial; }
                }
                if (!preg_match($lead, $cand)) break;
                $cand = preg_replace($lead, '', $cand);
            }
            if ($eq === null) continue;
            $key = preg_replace('/\s+/', '', $src);
            if (isset($seen[$key])) continue;          // a repeated equation is one equation
            $seen[$key] = 1;
            $out[] = ['src' => $src, 'eq' => $eq];
        }
        return $out;
    }

    /* ---------- linear? unique? — probes from the central sampler ---------- */
    public static function systemShape(array $eqs, array $vars): ?array
    {
        $n = count($vars);
        $base = static function () use ($vars) {
            $e = []; foreach ($vars as $v) $e[$v] = 0.0; return $e;
        };
        $f = static function (array $E, array $env) {
            $a = Algebra::evalAt($E['L'], $env);
            $b = Algebra::evalAt($E['R'], $env);
            if (is_nan($a) || is_nan($b) || is_infinite($a) || is_infinite($b)) return null;
            return $a - $b;
        };

        $srcs = [];
        foreach ($eqs as $E) $srcs[] = $E['src'];
        $PB = sample_points('s|' . implode(';', $srcs) . '|' . implode(',', $vars));

        $rows = [];
        for ($i = 0; $i < count($eqs); $i++) {
            $E = $eqs[$i]['eq'];
            $f0 = $f($E, $base());
            if ($f0 === null) return null;
            $row = [];
            for ($j = 0; $j < $n; $j++) {
                $t1 = $PB[($i * $n + $j) % count($PB)];
                $t2 = $PB[($i * $n + $j + 7) % count($PB)];
                if (abs($t1 - $t2) < 1e-6) $t2 = $t1 + 1.7;
                $e1 = $base(); $e1[$vars[$j]] = $t1;
                $e2 = $base(); $e2[$vars[$j]] = $t2;
                $f1 = $f($E, $e1); $f2 = $f($E, $e2);
                if ($f1 === null || $f2 === null) return null;
                $s1 = ($f1 - $f0) / $t1; $s2 = ($f2 - $f0) / $t2;
                /* Slopes, not a second difference: the test must not depend on
                   the probe spacing now that the probes move. */
                if (abs($s1 - $s2) > 1e-9 * max(1.0, abs($s1), abs($s2))) return ['linear' => false];
                $row[] = $s1;
            }
            for ($j = 0; $j < $n; $j++) for ($k = $j + 1; $k < $n; $k++) {
                $u = $PB[($i + $j) % count($PB)];
                $w = $PB[($i + $k + 3) % count($PB)];
                $ej = $base(); $ej[$vars[$j]] = $u; $ej[$vars[$k]] = $w;
                $ea = $base(); $ea[$vars[$j]] = $u;
                $eb = $base(); $eb[$vars[$k]] = $w;
                $fj = $f($E, $ej); $fa = $f($E, $ea); $fb = $f($E, $eb);
                if ($fj === null || $fa === null || $fb === null) return null;
                if (abs($fj - $fa - $fb + $f0) > 1e-9 * max(1.0, abs($fj))) return ['linear' => false];
            }
            $row[] = -$f0;
            $rows[] = $row;
        }

        $rank = static function (array $m, int $cols) {
            $a = array_map(static fn($r) => array_slice($r, 0, $cols), $m);
            $rk = 0;
            for ($c = 0; $c < $cols && $rk < count($a); $c++) {
                $piv = -1; $best = 1e-9;
                for ($r = $rk; $r < count($a); $r++)
                    if (abs($a[$r][$c]) > $best) { $best = abs($a[$r][$c]); $piv = $r; }
                if ($piv < 0) continue;
                $t = $a[$rk]; $a[$rk] = $a[$piv]; $a[$piv] = $t;
                for ($r2 = 0; $r2 < count($a); $r2++) {
                    if ($r2 === $rk || abs($a[$r2][$c]) < 1e-12) continue;
                    $fct = $a[$r2][$c] / $a[$rk][$c];
                    for ($c2 = $c; $c2 < $cols; $c2++) $a[$r2][$c2] -= $fct * $a[$rk][$c2];
                }
                $rk++;
            }
            return $rk;
        };
        $rA = $rank($rows, $n); $rAb = $rank($rows, $n + 1);
        return ['linear' => true, 'consistent' => $rA === $rAb,
                'unique' => $rA === $rAb && $rA === $n];
    }

    public static function systemCheck(string $question, string $md): array
    {
        $eqs = self::equationsOf($question);
        if (count($eqs) < 2) return [];            // one equation is substitution's job

        $vars = []; $seenV = [];
        foreach ($eqs as $E) foreach (($E['eq']['vars'] ?? []) as $v)
            if (!isset($seenV[$v])) { $seenV[$v] = 1; $vars[] = $v; }
        if (count($vars) < 2 || count($vars) > 4) return [];

        $zone = preg_replace('/\*\*|__/', '', Checks::claimZone($md));
        $env = []; $missing = [];
        foreach ($vars as $v) {
            $val = null;
            if (preg_match('/(?:^|[^0-9a-zA-Z])' . preg_quote($v, '/') . '\s*=\s*([^\n,;=]{1,40})/i', $zone, $m)) {
                $t = trim(preg_replace('/[.]+\s*$/', '', preg_replace('/\band\b[\s\S]*$/i', '', $m[1])));
                $val = Checks::constOf($t);
            }
            if ($val === null) $missing[] = $v; else $env[$v] = $val;
        }
        /* A partial assignment is never verified: certifying "x = 6" against a
           system in x and y would tell a student their half-answer is whole. */
        if (count($missing)) return [];

        $failed = [];
        foreach ($eqs as $E) {
            $h = Algebra::holdsAt($E['eq'], $env);
            if ($h === null) return [];            // cannot evaluate one → no verdict
            if (!$h) $failed[] = $E['src'];
        }

        $shown = [];
        foreach ($vars as $v) {
            $r = round($env[$v], 6);
            $shown[] = $v . ' = ' . str_replace('-', '−',
                (abs($r - round($r)) < 1e-9) ? (string)(int)round($r) : (string)$r);
        }
        $shown = implode(', ', $shown);

        if (count($failed)) {
            return [['kind' => 'system', 'ok' => false,
                'text' => 'with ' . $shown . ', ' . count($failed) . ' of the ' . count($eqs)
                        . ' equations does not hold — ' . implode('; ', $failed)]];
        }

        /* One positive gate. Written as two negative bails first, and sabotage
           proved the first was DEAD — a non-linear shape has no `unique` key
           and the second caught it by accident. `=== true` is literal: an
           absent or unknown property must not read as permission. */
        $shape = self::systemShape($eqs, $vars);
        $proven = is_array($shape) && ($shape['linear'] ?? null) === true
                                   && ($shape['unique'] ?? null) === true;
        if (!$proven) {
            $why = (!is_array($shape) || ($shape['linear'] ?? null) !== true)
                ? 'this system is not linear and this engine cannot show that it is the only '
                . 'solution — the answer may well be correct, it is simply not verified'
                : 'this system does not have a single solution — the answer is one of '
                . 'infinitely many, so it is not verified as the solution';
            return [['kind' => 'system', 'ok' => false, 'soft' => true,
                'text' => 'every equation is satisfied by ' . $shown . ', but ' . $why]];
        }
        return [['kind' => 'system', 'ok' => true,
            'text' => 'all ' . count($eqs) . ' equations hold at ' . $shown]];
    }

    /* ---------- algebraic identities ---------- */
    public static function identityCheck(string $md): array
    {
        $out = []; $seen = [];
        foreach (preg_split('/\n+/', $md) ?: [] as $line) {
            if (count($out) >= 4) break;
            /* Strip the markdown wrapper from BOTH ends. The leading strip has
               always been here; the trailing one had not, so `**(x-3)(x-4) =
               x^2-7x+12**` arrived as `… + 12**` and failed to parse — and the
               answer template this product ships instructs the model to put the
               answer in **bold**, so the app's own output format was the one
               form identityCheck could never read.

               Only markdown emphasis is stripped. The leading class keeps its
               digits and brackets for list markers; the trailing class does
               not, because `)` and digits are ordinary and load-bearing at the
               end of an expression. Mirrors index.html. */
            $line = trim(preg_replace('/[\s*_]+$/u', '',
                    preg_replace('/^[\s>*_\-–—•\d.)]+/u', '', $line)));
            if (strpos($line, '=') === false) continue;
            if (preg_match('/^##/', $line)) continue;
            if (count(explode('=', $line)) !== 2) continue;
            if (!preg_match('/[a-z]/i', $line)) continue;
            if (preg_match('/[:;?!]|\b(is|are|the|and|so|then|we|if|let|where|answer|option)\b/i', $line)) continue;
            /* Only the shape that is unambiguously an identity claim: a product
               of brackets, or a bracket raised to a power. An equation being
               SOLVED holds only at its roots and would fail here. */
            if (!preg_match('/\)\s*\(|\)\s*\^|\d\s*\([^)]*\)\s*\(|^\s*\(?[^=]*\)\s*\(/', $line)) continue;

            $eq = Algebra::parseEquation($line);
            if ($eq === null || !count($eq['vars'])) continue;
            if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) continue;
            if (!count(Algebra::varsOf($eq['L'])) || !count(Algebra::varsOf($eq['R']))) continue;
            if (($eq['L']['t'] ?? '') === 'v' || ($eq['R']['t'] ?? '') === 'v') continue;
            $key = preg_replace('/\s+/', '', $line);
            if (isset($seen[$key])) continue;
            $seen[$key] = 1;

            /* Points keyed on this very line. The grid used to be fixed, and a
               false factorisation built to agree at those twelve points took a
               green badge while being wrong everywhere else. */
            $IPTS = sample_points('id|' . $line);
            $agree = 0; $tested = 0;
            for ($k = 0; $k < count($IPTS); $k++) {
                $env = [];
                $vi = 0;
                foreach ($eq['vars'] as $v) {
                    /* every variable a DIFFERENT value, or a = b collapses a
                       false claim into 0 = 0 and it passes */
                    $env[$v] = ($k % 2 ? 1 : -1) * $IPTS[($k + $vi * 5) % count($IPTS)];
                    $vi++;
                }
                $h = Algebra::holdsAt($eq, $env);
                if ($h === null) continue;
                $tested++;
                if ($h) $agree++;
            }
            if ($tested < 6) continue;
            if ($agree === $tested) {
                $out[] = ['kind' => 'identity', 'ok' => true,
                    'text' => '“' . $line . '” holds for every value tried'];
            } elseif ($agree === 0) {
                $out[] = ['kind' => 'identity', 'ok' => false,
                    'text' => '“' . $line . '” is not an identity — the two sides differ at every value tried'];
            }
        }
        return $out;
    }
}
