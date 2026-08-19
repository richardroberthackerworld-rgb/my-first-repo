<?php
/* ============================================================
   7Solve — CALCULUS CHECKERS (PHP): derivative and indefinite integral
   ------------------------------------------------------------
   Ports of the JS checkers so /v1 gives the same verdict as the site.

   The integral checker deliberately owns no integrator. An
   antiderivative is exactly the function whose derivative is the
   integrand, so the claim verifies itself under Deriv. Two things
   fall out of that rather than needing code: "+ C" is free, because
   a constant differentiates away; and the FORM is free, because an
   unfamiliar-looking antiderivative is confirmed without the engine
   knowing any integration technique.

   Both key their sample points on the question AND the claim, and
   both sample every point before judging — an early break once left
   too few samples and discarded the very disagreement it had found.
   ============================================================ */
declare(strict_types=1);

require_once __DIR__ . '/sampling.php';
require_once __DIR__ . '/deriv.php';

final class Phase1Calculus
{
    private static function deLatexSafe(string $s): string
    {
        try { return Algebra::deLatex($s); } catch (\Throwable $e) { return $s; }
    }

    public static function derivativeCheck(string $question, string $md): array
    {
        $q = self::deLatexSafe($question);
        $body = null; $wrt = null;
        if (preg_match('/(?:d\s*\/\s*d([a-z])|differentiate|derivative\s+of)\s*[:\s]*(.+)$/i', $q, $dm)) {
            $body = $dm[2];
            $wrt = strtolower($dm[1] ?? '') ?: null;
        } else {
            /* A question can name the function instead of the expression:
               "f(x) = 3x sin x, find f'(x)". Without this branch the check
               returned no verdict and a WRONG derivative escaped undisputed. */
            if (!preg_match('/\bf\s*\x27|\by\s*\x27|d\s*y\s*\/\s*d\s*[a-z]|derivative|differentiat/i', $q)) return [];
            if (!preg_match('/(?:^|[\s,;(])(?:y|f\s*\(\s*[a-z]\s*\))\s*=\s*([^,;\n]+)/i', $q, $def)) return [];
            $body = preg_replace('/\s+(?:find|determine|calculate|evaluate|compute|what|obtain)\b[\s\S]*$/i', '', $def[1]);
        }
        $body = trim(preg_replace('/\s+with\s+respect\s+to\s+[a-z]\s*$/i', '',
                     preg_replace('/[?.]+$/', '', trim((string)$body))));
        $body = trim(preg_replace('/^(?:y|f\s*\(\s*[a-z]\s*\))\s*=\s*/i', '', $body));
        if (preg_match('/^\(.*\)$/s', $body)) {
            $inner = mb_substr($body, 1, mb_strlen($body, 'UTF-8') - 2, 'UTF-8');
            $d = 0; $ok = true;
            $len = mb_strlen($inner, 'UTF-8');
            for ($i = 0; $i < $len; $i++) {
                $ch = mb_substr($inner, $i, 1, 'UTF-8');
                if ($ch === '(') $d++;
                elseif ($ch === ')' && --$d < 0) { $ok = false; break; }
            }
            if ($ok && $d === 0) $body = $inner;
        }

        $truth = Deriv::of($body, $wrt);
        if ($truth === null) return [];                 // cannot compute it → no verdict

        $zone = preg_replace('/\*\*|__/', '', Checks::claimZone(self::deLatexSafe($md)));
        $v0 = $truth['variable'];
        $line = null; $claimed = null;
        foreach (preg_split('/\r?\n/', $zone) ?: [] as $L) {
            if ($line !== null) break;
            $t = trim(preg_replace('/^d\s*\/\s*d[a-z]\s*=?\s*/i', '',
                 preg_replace('/^[\s#>\x{2705}\x{1F3AF}*]+/u', '', $L)));
            if ($t === '' || !preg_match('/[a-z0-9]/i', $t)) continue;
            $ast = Algebra::parse(Deriv::normalise($t));
            if ($ast === null) continue;
            /* Anything mentioning another variable is prose that happens to
               parse — the heading "Answer" reads as a.n.s.w.e.r and, being
               first, once won over the real answer line below it. */
            $vs = array_keys(Algebra::varsOf($ast));
            $other = false;
            foreach ($vs as $x) if ($x !== $v0) { $other = true; break; }
            if (count($vs) && $other) continue;
            $line = $t; $claimed = $ast;
        }
        if ($line === null || $claimed === null) return [];

        $actual = Algebra::parse(Deriv::normalise($truth['result']));
        if ($actual === null) return [];

        $PTS = sample_points('d|' . $truth['expr'] . '|' . $line);
        $seen = 0; $same = true;
        foreach ($PTS as $p) {
            $env = [$v0 => $p];
            $A1 = Algebra::evalAt($claimed, $env);
            $A2 = Algebra::evalAt($actual, $env);
            if (is_nan($A1) || is_nan($A2) || is_infinite($A1) || is_infinite($A2)) continue;
            $seen++;
            if (abs($A1 - $A2) > max(1.0, abs($A1), abs($A2)) * 1e-7) $same = false;
        }
        if ($seen < 3) return [];                        // too little evidence to speak

        return [['kind' => 'deriv', 'ok' => $same,
            'text' => $same
                ? 'differentiating ' . $truth['expr'] . ' independently gives ' . $truth['result'] . ', which matches the answer'
                : 'differentiating ' . $truth['expr'] . ' independently gives ' . $truth['result'] . ', but the answer states ' . $line]];
    }

    public static function integralCheck(string $question, string $md): array
    {
        $q = self::deLatexSafe($question);
        if (!preg_match('/(?:\x{222B}|integrate|integral\s+of|antiderivative\s+of|find\s+the\s+integral\s+of)\s*[:\s]*(.+)$/iu', $q, $m)) return [];
        $body = trim((string)$m[1]);
        $body = preg_replace('/[?.]+$/', '', $body);
        $body = preg_replace('/\s*d\s*[a-z]\s*$/i', '', $body);          // trailing "dx"
        $body = preg_replace('/\s+with\s+respect\s+to\s+[a-z]\s*$/i', '', $body);
        $body = preg_replace('/\s+(?:find|determine|calculate|evaluate|compute)\b[\s\S]*$/i', '', $body);
        $body = trim(preg_replace('/^(?:y|f\s*\(\s*[a-z]\s*\))\s*=\s*/i', '', trim($body)));
        if ($body === '') return [];

        $integrand = Algebra::parse(Deriv::normalise($body));
        if ($integrand === null) return [];
        $iv = array_keys(Algebra::varsOf($integrand));
        /* Several variables is a partial-derivative question in disguise. NONE
           is different: integral of 5 dx is an ordinary question, so the
           variable comes from the antiderivative rather than the check
           refusing outright. */
        if (count($iv) > 1) return [];
        $v0 = count($iv) === 1 ? $iv[0] : null;

        $zone = preg_replace('/\*\*|__/', '', Checks::claimZone(self::deLatexSafe($md)));
        $line = null; $claimed = null;
        foreach (preg_split('/\r?\n/', $zone) ?: [] as $L) {
            if ($line !== null) break;
            $t = preg_replace('/^[a-z]\s*\(\s*[a-z]\s*\)\s*=\s*/i', '',
                 preg_replace('/^\x{222B}[^=]*=\s*/u', '',
                 preg_replace('/^[\s#>\x{2705}\x{1F3AF}*]+/u', '', $L)));
            /* "+ C" is notation for the family, not a term, and does not parse */
            $t = trim(preg_replace('/\s*[+\-]\s*(?:C|K|constant)\b\s*$/i', '', trim($t)));
            if ($t === '' || !preg_match('/[a-z0-9]/i', $t)) continue;
            $ast = Algebra::parse(Deriv::normalise($t));
            if ($ast === null) continue;
            $vs = array_keys(Algebra::varsOf($ast));
            if ($v0 === null) {
                if (count($vs) !== 1) continue;          // constant integrand
                $line = $t; $claimed = $ast; $v0 = $vs[0];
                continue;
            }
            $other = false;
            foreach ($vs as $x) if ($x !== $v0) { $other = true; break; }
            if (count($vs) && $other) continue;
            $line = $t; $claimed = $ast;
        }
        if ($line === null || $claimed === null || $v0 === null) return [];

        $back = Deriv::of($line, $v0);
        if ($back === null) return [];                   // cannot differentiate it back
        $got = Algebra::parse(Deriv::normalise($back['result']));
        if ($got === null) return [];

        $PTS = sample_points('i|' . $body . '|' . $line);
        $seen = 0; $same = true;
        foreach ($PTS as $p) {
            $env = [$v0 => $p];
            $A1 = Algebra::evalAt($got, $env);
            $A2 = Algebra::evalAt($integrand, $env);
            if (is_nan($A1) || is_nan($A2) || is_infinite($A1) || is_infinite($A2)) continue;
            $seen++;
            if (abs($A1 - $A2) > max(1.0, abs($A1), abs($A2)) * 1e-7) $same = false;
        }
        if ($seen < 3) return [];

        return [['kind' => 'integral', 'ok' => $same,
            'text' => $same
                ? 'differentiating ' . $line . ' gives back ' . $body . ', so it is an antiderivative'
                : 'differentiating ' . $line . ' gives ' . $back['result'] . ', not ' . $body
                  . ' — so it is not an antiderivative of the integrand']];
    }
}
