<?php
/* ============================================================
   7Solve — DOMAIN AND CERTIFIED EXHAUSTION (PHP side)
   ------------------------------------------------------------
   The PHP twin of exhaustion() in index.html. Ported, not
   reinvented: every regex, cap, bound and bail-out is the one
   the browser uses, because parity is tested by running both
   engines over one corpus and comparing the check kinds they
   emit. A cleverer PHP version is a divergence, not an
   improvement.

   TWO THINGS IT DOES.

   1. CONSTRAINT PRESERVATION. "Find all POSITIVE integers n
      with n² − 4 = 0" answered "n = 2 and n = −2" used to reach
      `checked`. Both values satisfy the equation and the root
      count is right; the answer is still wrong, because −2 is
      not a positive integer. Nothing in either engine had ever
      read the word "positive".

   2. COMPLETENESS, PROVED RATHER THAN SEARCHED FOR. A "find
      all" question answered with three verified pairs went
      green on substitution alone, and for x² + y² + 1 = 3xy
      there are infinitely many pairs. Substitution proves each
      pair genuine and says nothing about the rest.

   WHAT IS DELIBERATELY NOT DONE. A bounded search that finds
   nothing more is not a proof that there is nothing more, and
   this file will never report one as if it were. Completeness
   is claimed only for the shape

       P(x₁…x_k) = c^E

   with P a polynomial, c ≥ 2 an integer and E a linear form
   with every coefficient ≥ 1, over integers x_i ≥ 0 or ≥ 1.
   There, with s = Σx_i, M = Σ|coefficients of P| and d = deg P:

       |P|  ≤ M·s^d      every x_i ≤ s, so every monomial
                         ∏x_i^(e_i) ≤ s^(Σe_i) ≤ s^d for s ≥ 1
       c^E  ≥ c^s        every coefficient of E is ≥ 1

   and c^s > M·s^d for every s ≥ S₀ BY INDUCTION:

       base   c^S₀ > M·S₀^d
       step   (s+1)^d ≤ c·s^d for s ≥ s₁, hence
              c^(s+1) = c·c^s > c·M·s^d ≥ M·(s+1)^d

   Every solution therefore has s < S₀, which is a finite region,
   and that region is then enumerated whole.

   ON ARITHMETIC. The two inequalities above are the load-bearing
   step, so they are decided in exact integers — c^s overflows a
   float long before S₀ is reached, and a completeness proof
   settled by a rounding error is worse than no proof. index.html
   uses BigInt. There is no BigInt here and bcmath cannot be
   assumed on a shared host, so Bignum below is a small
   decimal-string integer: multiply and compare, which is all
   this needs. It agrees with BigInt exactly, which parity
   checks by running both engines over the same corpus.
   ============================================================ */
declare(strict_types=1);

/** Just enough arbitrary-precision integer arithmetic for the growth lemma. */
final class Bignum
{
    /** @return int[] little-endian base-10⁷ limbs */
    public static function of(int $n): array
    {
        if ($n === 0) return [0];
        $out = [];
        while ($n > 0) { $out[] = $n % 10000000; $n = intdiv($n, 10000000); }
        return $out;
    }

    /** @param int[] $a @param int[] $b @return int[] */
    public static function mul(array $a, array $b): array
    {
        $na = count($a); $nb = count($b);
        $out = array_fill(0, $na + $nb, 0);
        for ($i = 0; $i < $na; $i++) {
            $carry = 0;
            for ($j = 0; $j < $nb; $j++) {
                $cur = $out[$i + $j] + $a[$i] * $b[$j] + $carry;
                $out[$i + $j] = $cur % 10000000;
                $carry = intdiv($cur, 10000000);
            }
            $k = $i + $nb;
            while ($carry > 0) {
                $cur = $out[$k] + $carry;
                $out[$k] = $cur % 10000000;
                $carry = intdiv($cur, 10000000);
                $k++;
            }
        }
        while (count($out) > 1 && $out[count($out) - 1] === 0) array_pop($out);
        return $out;
    }

    /** @param int[] $a @param int[] $b  -1, 0 or 1 */
    public static function cmp(array $a, array $b): int
    {
        if (count($a) !== count($b)) return count($a) < count($b) ? -1 : 1;
        for ($i = count($a) - 1; $i >= 0; $i--) {
            if ($a[$i] !== $b[$i]) return $a[$i] < $b[$i] ? -1 : 1;
        }
        return 0;
    }

    /** @return int[] base^e, e ≥ 0 */
    public static function pow(int $base, int $e): array
    {
        $r = self::of(1);
        $b = self::of($base);
        for ($i = 0; $i < $e; $i++) $r = self::mul($r, $b);
        return $r;
    }
}

final class Exhaustion
{
    /* Public because Checks::substitution needs the same reading of "find
       all": a tuple offered against that question is evidence, not a proved
       solution set. One regex, one place. */
    public const ALL_ASKED_RE =
        '/\bfind all\b|\ball (?:the )?(?:integers?|values?|solutions?|pairs?|n)\b|\bfor which\b|\bdetermine all\b|\bhow many\b/i';
    private const NONE_CLAIMED =
        '/\bno\s+(?:such\s+)?(?:positive\s+|non-?negative\s+)?(?:integer\s+)?(?:solutions?|pairs?|triples?|values?)\b|\bthere\s+are\s+no\b|\bnone\s+exist\b|\bno\s+solutions?\s+exist\b|\bempty\b/i';
    private const UPTO_ORDER =
        '/\b(symmetr|permutation|up to order|in some order|wlog|without loss of generality|and its\s+permutation)/i';

    /* ---------- what the question says the variables are ---------- */
    /** @return array{low:?int,distinct:bool,label:string}|null */
    public static function domainOf(string $question): ?array
    {
        $q = mb_strtolower($question, 'UTF-8');
        $low = null; $label = '';
        if (preg_match('/\b(?:positive|natural)\s+(?:integer|whole\s+number|number)s?\b|\bin\s+positive\s+integers\b|\bnatural\s+numbers?\b/', $q)) {
            $low = 1; $label = 'positive integers';
        } elseif (preg_match('/\bnon-?negative\s+integers?\b|\bwhole\s+numbers?\b/', $q)) {
            $low = 0; $label = 'non-negative integers';
        } elseif (preg_match('/\bintegers?\b/', $q)) {
            $low = null; $label = 'integers';        // may be negative: no bound is provable
        } elseif (preg_match('/\bprimes?\b|\bprime\s+numbers?\b/', $q)) {
            /* "Find all primes p with …" states an integer domain without using
               the word, and it is bounded below at 2 — which is what lets the
               growth bound apply to a prime question at all. */
            $low = 2; $label = 'primes';
        } else {
            return null;
        }
        /* PRIMES narrow the domain exactly as "positive" does, and an ordering
           between two of the variables — "with x > y" — is a constraint the
           answer must satisfy. Only letter-against-letter is read: "x < 100" is
           a bound the equation itself already carries. Mirrors index.html. */
        $order = null;
        if (preg_match('/\b([a-z])\s*(>=|<=|≥|≤|>|<)\s*([a-z])\b/u', $q, $om)) {
            $order = ['a' => $om[1], 'op' => str_replace(['>=', '<='], ['≥', '≤'], $om[2]), 'b' => $om[3]];
        }
        return ['low' => $low, 'distinct' => (bool)preg_match('/\bdistinct\b/', $q),
                'prime' => (bool)preg_match('/\bprimes?\b|\bprime\s+numbers?\b/', $q),
                'order' => $order, 'label' => $label];
    }

    /* Which constraint, if any, this tuple breaks. One reader, used both to
       judge what the answer claimed and to filter what the enumeration finds —
       two readers would let the engine demand a solution its own domain rules
       would have rejected. Mirrors domainBreak() in index.html. */
    public static function domainBreak(array $dom, array $vars, array $tp): ?array
    {
        for ($i = 0; $i < count($tp); $i++) {
            if (abs($tp[$i] - round($tp[$i])) > 1e-9) return ['i' => $i, 'why' => 'is not an integer'];
            if ($dom['low'] !== null && $tp[$i] < $dom['low']) {
                return ['i' => $i, 'why' => $dom['low'] === 1 ? 'is not positive' : 'is negative'];
            }
            if (!empty($dom['prime']) && !Checks::isPrime((int)round($tp[$i]))) {
                return ['i' => $i, 'why' => 'is not prime'];
            }
        }
        if (!empty($dom['distinct']) && count($tp) > 1) {
            for ($a = 0; $a < count($tp); $a++) {
                for ($b = $a + 1; $b < count($tp); $b++) {
                    if ($tp[$a] === $tp[$b]) {
                        return ['i' => $b, 'why' => 'repeats a value the question asked to be distinct'];
                    }
                }
            }
        }
        if (!empty($dom['order'])) {
            $ia = array_search($dom['order']['a'], $vars, true);
            $ib = array_search($dom['order']['b'], $vars, true);
            if ($ia !== false && $ib !== false && $ia < count($tp) && $ib < count($tp)) {
                $va = $tp[$ia]; $vb = $tp[$ib];
                switch ($dom['order']['op']) {
                    case '>': $ok = $va >  $vb; break;
                    case '<': $ok = $va <  $vb; break;
                    case '≥': $ok = $va >= $vb; break;
                    default:  $ok = $va <= $vb; break;
                }
                if (!$ok) {
                    return ['i' => (int)$ia, 'why' => 'breaks the condition ' . $dom['order']['a'] . ' '
                                                    . $dom['order']['op'] . ' ' . $dom['order']['b']];
                }
            }
        }
        return null;
    }

    /* ---------- an AST as a multivariate polynomial ----------
       Null for anything that is not one — a function call, a variable
       exponent, a division by an expression. Null means "cannot speak". */
    /** @return array<string,float>|null */
    public static function polyExpand(?array $ast, array $vars): ?array
    {
        $K = count($vars);
        /* Exponent vectors are keys, and a key must stay a STRING. PHP casts a
           numeric-string array key to an integer, so the one-variable case —
           keys "0", "1", "2" — came back as ints and explode() threw on them.
           The 'e' prefix keeps every key non-numeric in both engines. */
        $zero = 'e' . implode(',', array_fill(0, $K, 0));

        $constP = static function (float $c) use ($zero): array {
            return $c === 0.0 ? [] : [$zero => $c];
        };
        $varP = static function (int $i) use ($K): array {
            $e = array_fill(0, $K, 0); $e[$i] = 1;
            return ['e' . implode(',', $e) => 1.0];
        };
        $combine = static function (array $a, array $b, int $sign): array {
            $o = $a;
            foreach ($b as $k => $v) {
                $o[$k] = ($o[$k] ?? 0.0) + $sign * $v;
                if (abs($o[$k]) < 1e-9) unset($o[$k]);
            }
            return $o;
        };
        $mul = static function (array $a, array $b) use ($K): array {
            $o = [];
            foreach ($a as $ka => $va) {
                $ea = explode(',', substr((string)$ka, 1));
                foreach ($b as $kb => $vb) {
                    $eb = explode(',', substr((string)$kb, 1));
                    $e = [];
                    for ($i = 0; $i < $K; $i++) $e[] = ((int)$ea[$i]) + ((int)$eb[$i]);
                    $k = 'e' . implode(',', $e);
                    $o[$k] = ($o[$k] ?? 0.0) + $va * $vb;
                }
            }
            foreach ($o as $k => $v) if (abs($v) < 1e-9) unset($o[$k]);
            return $o;
        };
        $onlyConst = static function (array $p) use ($zero): bool {
            $ks = array_keys($p);
            return count($ks) === 0 || (count($ks) === 1 && $ks[0] === $zero);
        };

        $go = static function (?array $node) use (&$go, $vars, $constP, $varP, $combine, $mul, $onlyConst, $zero): ?array {
            if ($node === null) return null;
            $t = $node['t'] ?? '';
            if ($t === 'n') {
                $v = (float)$node['v'];
                return is_finite($v) ? $constP($v) : null;
            }
            if ($t === 'v') {
                $i = array_search(mb_strtolower((string)$node['v'], 'UTF-8'), $vars, true);
                return $i === false ? null : $varP((int)$i);
            }
            if ($t === 'u') {
                $u = $go($node['a'] ?? null);
                return $u === null ? null : $combine([], $u, -1);
            }
            if ($t === 'c') return null;              // sin, sqrt, ln — not a polynomial
            if ($t === 'b') {
                $a = $go($node['a'] ?? null);
                if ($a === null) return null;
                $b = $go($node['b'] ?? null);
                if ($b === null) return null;
                $op = $node['op'] ?? '';
                if ($op === '+') return $combine($a, $b, 1);
                if ($op === '-') return $combine($a, $b, -1);
                if ($op === '*') return $mul($a, $b);
                if ($op === '/') {
                    if (!$onlyConst($b)) return null;
                    $c = $b[$zero] ?? 0.0;
                    if ($c == 0.0) return null;
                    $o = [];
                    foreach ($a as $k => $v) $o[$k] = $v / $c;
                    return $o;
                }
                if ($op === '^') {
                    if (!$onlyConst($b)) return null;  // x^y — not a polynomial
                    $n = $b[$zero] ?? 0.0;
                    if ($n != round($n) || $n < 0 || $n > 8) return null;
                    $r = $constP(1.0);
                    for ($j = 0; $j < (int)$n; $j++) $r = $mul($r, $a);
                    return $r;
                }
            }
            return null;
        };
        return $go($ast);
    }

    /** @return array{M:float,d:int} */
    public static function polyStats(array $p): array
    {
        $M = 0.0; $d = 0;
        foreach ($p as $k => $v) {
            $M += abs($v);
            $tot = 0;
            foreach (explode(',', substr((string)$k, 1)) as $e) $tot += (int)$e;
            if ($tot > $d) $d = $tot;
        }
        return ['M' => $M, 'd' => $d];
    }

    /* ---------- c^(linear) on one side ---------- */
    /** @return array{base:int,mult:int}|null */
    public static function expSideOf(?array $ast, array $vars): ?array
    {
        $node = $ast; $mult = 1;
        if (is_array($node) && ($node['t'] ?? '') === 'b' && ($node['op'] ?? '') === '*') {
            $la = $node['a'] ?? null; $lb = $node['b'] ?? null;
            if (is_array($la) && ($la['t'] ?? '') === 'n' && $la['v'] >= 1 && $la['v'] == round($la['v'])) {
                $mult = (int)$la['v']; $node = $lb;
            } elseif (is_array($lb) && ($lb['t'] ?? '') === 'n' && $lb['v'] >= 1 && $lb['v'] == round($lb['v'])) {
                $mult = (int)$lb['v']; $node = $la;
            }
        }
        if (!is_array($node) || ($node['t'] ?? '') !== 'b' || ($node['op'] ?? '') !== '^') return null;
        $base = $node['a'] ?? null;
        if (!is_array($base) || ($base['t'] ?? '') !== 'n') return null;
        $c = $base['v'];
        if ($c != round($c) || $c < 2) return null;
        $e = self::polyExpand($node['b'] ?? null, $vars);
        if ($e === null) return null;
        $st = self::polyStats($e);
        if ($st['d'] !== 1) return null;              // the exponent must be LINEAR
        $zero = 'e' . implode(',', array_fill(0, count($vars), 0));
        foreach ($e as $k => $v) {
            if ($k === $zero) { if ($v < 0) return null; continue; }
            if ($v < 1 || $v != round($v)) return null;   // every coefficient ≥ 1
        }
        return ['base' => (int)$c, 'mult' => $mult];
    }

    /* ---------- the growth lemma, proved in exact integers ---------- */
    /** @return array{S0:int,s1:int,M:int,d:int,c:int}|null */
    public static function growthBound(float $M, int $d, int $c): ?array
    {
        $Mi = (int)max(1, (int)ceil($M - 1e-9));
        $MB = Bignum::of($Mi);
        /* s₁: from here on, multiplying by c covers (s+1)^d / s^d */
        $s1 = null;
        for ($s = 1; $s <= 400; $s++) {
            $lhs = Bignum::pow($s + 1, $d);
            $rhs = Bignum::mul(Bignum::of($c), Bignum::pow($s, $d));
            if (Bignum::cmp($lhs, $rhs) <= 0) { $s1 = $s; break; }
        }
        if ($s1 === null) return null;
        /* S₀: the base case of the induction */
        $S0 = null;
        for ($s = $s1; $s <= 400; $s++) {
            $lhs = Bignum::pow($c, $s);
            $rhs = Bignum::mul($MB, Bignum::pow($s, $d));
            if (Bignum::cmp($lhs, $rhs) > 0) { $S0 = $s; break; }
        }
        if ($S0 === null) return null;
        return ['S0' => $S0, 's1' => $s1, 'M' => $Mi, 'd' => $d, 'c' => $c];
    }

    /** every tuple of k integers ≥ low summing to exactly s */
    public static function compositions(int $k, int $s, int $low, array &$out, int $cap): void
    {
        $cur = array_fill(0, $k, 0);
        $rec = static function (int $i, int $left) use (&$rec, &$cur, &$out, $k, $low, $cap): void {
            if (count($out) >= $cap) return;
            if ($i === $k - 1) {
                if ($left < $low) return;
                $cur[$i] = $left;
                $out[] = $cur;
                return;
            }
            for ($v = $low; $left - $v >= $low * ($k - 1 - $i); $v++) {
                $cur[$i] = $v;
                $rec($i + 1, $left - $v);
                if (count($out) >= $cap) return;
            }
        };
        $rec(0, $s);
    }

    private static function fmtTuple(array $vars, array $tp): string
    {
        $nums = array_map(static function ($x) { return (string)(int)round($x); }, $tp);
        return count($vars) === 1
            ? $vars[0] . ' = ' . $nums[0]
            : '(' . implode(',', $vars) . ') = (' . implode(',', $nums) . ')';
    }

    /* ---------- a polynomial with INTEGER coefficients, or nothing ----------
       Modular arithmetic is only meaningful over the integers, and a rounded
       coefficient would make a "proof" out of a rounding error. */
    private static function intPoly(array $p): ?array
    {
        $out = [];
        foreach ($p as $k => $c) {
            if (abs($c - round($c)) > 1e-9) return null;
            if (abs($c) > 1e12) return null;
            $e = array_map('intval', explode(',', substr((string)$k, 1)));
            $out[] = ['e' => $e, 'c' => (int)round($c)];
        }
        return $out;
    }

    private static function evalPolyMod(array $terms, array $xs, int $m): int
    {
        $total = 0;
        foreach ($terms as $t) {
            $v = (($t['c'] % $m) + $m) % $m;
            foreach ($t['e'] as $j => $power) {
                for ($p = 0; $p < $power; $p++) $v = ($v * $xs[$j]) % $m;
            }
            $total = ($total + $v) % $m;
        }
        return $total;
    }

    /* ---------- NO SOLUTIONS, BY A MODULAR OBSTRUCTION ----------
       The completeness route that needs no bound at all. If L(x) - R(x) is
       never congruent to 0 mod m for ANY residue tuple, it is never 0 over the
       integers, so the equation has no integer solutions whatever — a finite
       exhaustive check, not a search. x^2 - 3y^2 = 2 is the standard case:
       squares are 0 or 1 mod 3, so x^2 = 2 mod 3 is impossible.

       The sweep is exhaustive over (Z/m)^k, so the cap is on m and not on the
       confidence. Finding nothing means the route did not apply, never that
       solutions exist. Mirrors modulusObstruction() in index.html. */
    public static function modulusObstruction(array $eq, array $vars, string $src): ?array
    {
        $pD = self::polyExpand(['t' => 'b', 'op' => '-', 'a' => $eq['L'], 'b' => $eq['R']], $vars);
        if ($pD === null) return null;
        $terms = self::intPoly($pD);
        if ($terms === null || !count($terms)) return null;   // an identity, or not integral
        $k = count($vars);
        $maxM = $k === 1 ? 200 : ($k === 2 ? 60 : 24);
        for ($m = 2; $m <= $maxM; $m++) {
            $xs = array_fill(0, $k, 0);
            $hit = false;
            $rec = static function (int $i) use (&$rec, &$xs, &$hit, $terms, $k, $m): void {
                if ($hit) return;
                if ($i === $k) { if (self::evalPolyMod($terms, $xs, $m) === 0) $hit = true; return; }
                for ($v = 0; $v < $m && !$hit; $v++) { $xs[$i] = $v; $rec($i + 1); }
            };
            $rec(0);
            if (!$hit) {
                return ['m' => $m,
                    'why' => 'there are no integer solutions at all: ' . trim($src) .
                             ' rearranges to a polynomial that is never ≡ 0 (mod ' . $m . '), and every one of the ' .
                             ((int)pow($m, $k)) . ' residue ' . ($k === 1 ? 'classes' : 'tuples') . ' mod ' . $m .
                             ' was checked — so no integer can satisfy it, whatever its size'];
            }
        }
        return null;
    }

    /* ---------- A BOUND THE QUESTION ITSELF STATES ----------
       "Find all n with 1 <= n <= 100" makes enumeration a PROOF rather than a
       search, because the question handed over the finite region.

       ONE VARIABLE ONLY, deliberately: "x <= 100" in a two-variable question
       might bound one variable or both, and guessing the generous way means
       missing a solution and then calling the list complete, which is the worst
       failure this module can produce. Mirrors statedBound() in index.html. */
    public static function statedBound(string $question, array $vars, array $dom): ?array
    {
        if (count($vars) !== 1) return null;
        $q = preg_replace('/\s+/u', ' ', mb_strtolower($question, 'UTF-8'));
        $v = preg_quote($vars[0], '/');
        $hi = null; $lo = null; $src = '';
        $take = static function (?int $cand, string $text) use (&$hi, &$src): void {
            if ($cand === null) return;
            if ($hi === null || $cand < $hi) { $hi = $cand; $src = $text; }
        };
        if (preg_match('/(-?\d{1,9})\s*(?:≤|<=|<)\s*' . $v . '\s*(?:≤|<=)\s*(\d{1,9})/u', $q, $m)) {
            $lo = (int)$m[1]; $take((int)$m[2], $m[0]);
        }
        if (preg_match('/\b' . $v . '\s*(?:≤|<=)\s*(\d{1,9})/u', $q, $m)) $take((int)$m[1], $m[0]);
        if (preg_match('/\b' . $v . '\s*<\s*(\d{1,9})/u', $q, $m))       $take((int)$m[1] - 1, $m[0]);
        if (preg_match('/\bbetween (\d{1,9}) and (\d{1,9})\b/u', $q, $m)) {
            if ($lo === null) $lo = (int)$m[1];
            $take((int)$m[2], $m[0]);
        }
        if (preg_match('/\b(?:at most|no more than|not exceeding|up to|no greater than) (\d{1,9})\b/u', $q, $m)) {
            $take((int)$m[1], $m[0]);
        }
        if (preg_match('/\bless than (\d{1,9})\b/u', $q, $m)) $take((int)$m[1] - 1, $m[0]);
        if (preg_match('/\btwo[- ]digit\b/u', $q))   { if ($lo === null) $lo = 10;  $take(99, 'two-digit'); }
        if (preg_match('/\bthree[- ]digit\b/u', $q)) { if ($lo === null) $lo = 100; $take(999, 'three-digit'); }

        if ($hi === null) return null;
        $floor = $dom['low'] !== null ? $dom['low'] : $lo;
        if ($floor === null) return null;                     // no floor: not a finite region
        if ($lo !== null && $lo > $floor) $floor = $lo;
        if ($hi < $floor || $hi - $floor > 200000) return null;
        return ['lo' => $floor, 'hi' => $hi, 'src' => $src];
    }

    /* ---------- AN EQUATION THAT BOUNDS ITS OWN VARIABLES ----------
       Covers most of what a school Diophantine question actually looks like:
       ax + by = c, x^2 + y^2 = 25, xy = 12. None of those needs a growth lemma
       or a stated range, because the equation already pins every variable.

       Write it as P(x) = C with every coefficient of P positive and C > 0, over
       integers x_i >= 1. Every term is then positive, so each term is at most
       the whole sum; and since every x_j >= 1, dropping the other factors only
       makes it smaller. So a*x_i^e <= C and x_i <= (C/a)^(1/e), taking the
       smallest such bound over the monomials containing x_i. A finite box,
       proved rather than assumed.

       x_i >= 1 is load-bearing, which is why a non-negative domain is declined:
       with x_j = 0 allowed, xy = 12 puts no bound on x at all. Mirrors
       positiveBound() in index.html. */
    public static function positiveBound(array $diff, array $vars, array $dom): ?array
    {
        if ($dom['low'] === null || $dom['low'] < 1) return null;
        $K = count($vars);
        $zero = 'e' . implode(',', array_fill(0, $K, 0));
        $C = -($diff[$zero] ?? 0.0);
        if (!($C > 0)) return null;
        $hi = array_fill(0, $K, null);
        foreach ($diff as $k => $a) {
            if ($k === $zero) continue;
            if (!($a > 0)) return null;                    // a negative term breaks the bound
            $e = array_map('intval', explode(',', substr((string)$k, 1)));
            for ($i = 0; $i < $K; $i++) {
                if (!$e[$i]) continue;
                $b = (int)floor(pow($C / $a, 1.0 / $e[$i]) + 1e-9);
                if (!is_finite((float)$b) || $b < $dom['low']) $b = $dom['low'] - 1;
                if ($hi[$i] === null || $b < $hi[$i]) $hi[$i] = $b;
            }
        }
        foreach ($hi as $h) if ($h === null) return null;  // a variable nothing bounds
        return ['hi' => $hi, 'C' => $C];
    }

    /** Every tuple in the box low_i … hi_i, or null if that is too large. */
    public static function boxTuples(array $lows, array $his, int $cap): ?array
    {
        $K = count($lows);
        $total = 1;
        for ($i = 0; $i < $K; $i++) {
            $n = $his[$i] - $lows[$i] + 1;
            if ($n <= 0) return [];
            $total *= $n;
            if ($total > $cap) return null;
        }
        $out = [];
        $cur = array_fill(0, $K, 0);
        $rec = static function (int $d) use (&$rec, &$cur, &$out, $K, $lows, $his): void {
            if ($d === $K) { $out[] = $cur; return; }
            for ($v = $lows[$d]; $v <= $his[$d]; $v++) { $cur[$d] = $v; $rec($d + 1); }
        };
        $rec(0);
        return $out;
    }

    /* An answer that describes a PROCESS is not claiming its examples are the
       whole set. "All solutions arise from (1,1,1) by the Vieta jump" lists one
       triple and means infinitely many, and refuting it with a second triple
       would be answering something it never said. Only a closed list is judged
       against a witness. Mirrors GENERATIVE in index.html. */
    /* AN ANSWER CAN CLAIM COMPLETENESS THE QUESTION NEVER ASKED FOR. Every
       completeness gate read ALL_ASKED — "find all" — out of the QUESTION, so
       the identical false answer was caught or missed purely on phrasing:

         "Find all positive integers x,y,z with x^2+y^2+z^2=xyz"  disputed
         "Solve x^2+y^2+z^2=xyz in positive integers"             VERIFIED

       and the answer in both was "the only positive integer triple is (3,3,3)",
       which is false: (3,3,6) gives 54 = 54. A green badge on that is the worst
       thing this engine can produce.

       The answer said "the ONLY triple" either way. An answer claiming its list
       is everything has made a completeness claim of its own and is held to it.
       Kept tight: the phrase must be followed within one clause by something a
       solution could be, so "the only way to solve this" is not read as a claim
       about a solution set. Mirrors CLAIMS_ALL in index.html. */
    public const CLAIMS_ALL =
        '/\b(?:the\s+only|is\s+the\s+only|are\s+the\s+only|the\s+unique|no\s+other|precisely\s+the|'
      . 'these\s+are\s+all|no\s+further|and\s+no\s+others?)\b[^.!?\n]{0,60}'
      . '\b(?:solutions?|triples?|pairs?|values?|answers?|integers?|numbers?|roots?)\b/iu';
    private const GENERATIVE =
        '/\b(arise[sn]? from|obtained (?:from|by)|generated (?:from|by)|generates? (?:all|every|the rest)|'
      . 'recurrence|and so on|infinitely many|unboundedly many|famil(?:y of|ies)|this family|of the form|'
      . 'iterat\w+|continu\w+)\b|…|\.\.\./iu';

    /* Is the equation unchanged when two variables trade places? A PROPERTY,
       tested, not a phrase read out of the prose — and for the witness search it
       matters more than what the answer said. Offering (1,2,1) against an answer
       that already listed (1,1,2) is pedantry.

       Used ONLY for refutation. Certifying a list as complete stays strict:
       (4,3) really is a different ordered pair from (3,4). Being generous about
       what counts as already-listed makes a refutation more convincing; being
       generous the same way when certifying would let an incomplete answer
       through. Mirrors isSymmetric() in index.html. */
    public static function isSymmetric(array $eq, array $vars): bool
    {
        if (count($vars) < 2) return false;
        $resid = ['t' => 'b', 'op' => '-', 'a' => $eq['L'], 'b' => $eq['R']];
        for ($t = 0; $t < 4; $t++) {
            $base = [];
            foreach ($vars as $i => $v) $base[$v] = 1.31 + $t * 0.77 + $i * 1.13;
            $v0 = Algebra::evalAt($resid, $base);
            if (!is_finite($v0)) return false;
            for ($a = 0; $a < count($vars); $a++) {
                for ($b = $a + 1; $b < count($vars); $b++) {
                    $sw = $base;
                    $sw[$vars[$a]] = $base[$vars[$b]];
                    $sw[$vars[$b]] = $base[$vars[$a]];
                    $v1 = Algebra::evalAt($resid, $sw);
                    if (!is_finite($v1)) return false;
                    if (abs($v1 - $v0) > max(1.0, abs($v0)) * 1e-9) return false;
                }
            }
        }
        return true;
    }

    /* ---------- A WITNESS REFUTES; ONLY A BOUND CAN PROVE ----------
       Proving a solution set complete needs a region proved to contain every
       solution. Refuting a claim of completeness needs no bound at all: ONE
       solution the answer left out settles it, verified exactly by substitution.
       A search can never certify a set; it can always break one.

       The case that made this necessary: x^2 + y^2 + z^2 = xyz answered "the
       only positive integer triple is (3,3,3)", with a clean Vieta descent and a
       correct verification of (3,3,3). Every check passed, the badge read "not
       checked", and (3,3,6) sat two seconds of searching away. Mirrors
       witness() in index.html. */
    public static function witness(array $eq, array $vars, array $dom, array $claims, bool $upto, int $ceiling = 0): ?array
    {
        $k = count($vars);
        $hi = $ceiling > 0 ? $ceiling : ($k === 1 ? 5000 : ($k === 2 ? 300 : 60));
        $low = $dom['low'] === null ? 1 : $dom['low'];
        $keyOf = static function (array $tp) use ($upto): string {
            $t = array_map(static fn($x) => (int)round($x), $tp);
            if ($upto) sort($t);
            return implode(',', $t);
        };
        $have = [];
        foreach ($claims as $tp) $have[$keyOf($tp)] = true;

        $cur = array_fill(0, $k, 0);
        $found = null;
        $seen = 0;
        $rec = static function (int $i) use (&$rec, &$cur, &$found, &$seen, $k, $hi, $low, $upto,
                                             $eq, $vars, $dom, $have, $keyOf): void {
            if ($found !== null || $seen > 300000) return;
            if ($i === $k) {
                $seen++;
                $tp = $cur;
                if (isset($have[$keyOf($tp)])) return;
                if (self::domainBreak($dom, $vars, $tp) !== null) return;
                $env = [];
                for ($j = 0; $j < $k; $j++) $env[$vars[$j]] = (float)$tp[$j];
                if (Algebra::holdsAt($eq, $env) === true) $found = $tp;
                return;
            }
            /* ordered search when permutations do not count, so the witness shown
               is the one a student would have written */
            $from = ($upto && $i > 0) ? $cur[$i - 1] : $low;
            for ($v = $from; $v <= $hi && $found === null; $v++) { $cur[$i] = $v; $rec($i + 1); }
        };
        $rec(0);
        return $found;
    }

    public static function check(string $question, string $md): array
    {
        /* The DOMAIN may also come from the answer. "x^2 + y^2 + z^2 = xyz"
           states no domain, and the answer says "the only positive integer
           triple" — it has scoped its own claim, and judging that claim inside
           the scope it chose is fair. It is the answer being checked. */
        $dom = self::domainOf($question);
        if ($dom === null) $dom = self::domainOf(Checks::answerClaimZone($md));
        if ($dom === null) return [];
        $found = Checks::findEquation($question);
        if ($found === null) return [];
        $eq = $found['eq'];
        $vars = $eq['vars'] ?? [];
        if (!count($vars) || count($vars) > 3) return [];
        if (Algebra::hasTrig($eq['L']) || Algebra::hasTrig($eq['R'])) return [];

        $out = [];
        $zone = Checks::answerClaimZone($md);

        /* ---- what the answer puts forward ---- */
        $claims = [];
        if (count($vars) === 1) {
            foreach (Checks::claimedRoots($zone, $vars[0]) as $n) $claims[] = [(float)$n];
        } else {
            $claims = Checks::claimedTuples($md, count($vars), $vars, $eq);
        }

        /* ---- 1. CONSTRAINT PRESERVATION ---- */
        foreach ($claims as $tp) {
            $brk = self::domainBreak($dom, $vars, $tp);
            if ($brk === null) continue;
            $out[] = ['kind' => 'domain', 'ok' => false,
                'text' => 'the question asks for ' . $dom['label'] . ', and ' . self::fmtTuple($vars, $tp) .
                          ' gives ' . $vars[$brk['i']] . ' = ' . (string)(int)round($tp[$brk['i']]) . ', which ' .
                          $brk['why'] . ' — it satisfies the equation but not the question'];
        }
        if (count($out)) return $out;      // a domain failure settles it; do not also enumerate

        /* ---- 2. CERTIFIED COMPLETENESS ---- */
        /* "find all" in the question, OR "the only ..." in the answer. Either is
           a claim that the list is everything. */
        $wantsAll = preg_match(self::ALL_ASKED_RE, $question) || preg_match(self::CLAIMS_ALL, $zone);
        if (!$wantsAll) return $out;

        $k = count($vars); $cap = 300000;
        $truth = null; $why = '';

        /* ---- route (a): a MODULAR OBSTRUCTION ----
           Proves the solution set empty without any bound, and works over the
           unbounded integers where no growth argument can. Tried first because
           when it applies it is the strongest thing available. */
        $obst = self::modulusObstruction($eq, $vars, (string)$found['src']);
        if ($obst !== null) { $truth = []; $why = $obst['why']; }

        /* ---- route (b): a REGION provable to hold every solution ---- */
        if ($truth === null) {
            if ($dom['low'] === null) return $out;    // unbounded below: no region is provable
            $tuples = [];

            /* Before any bounded route: if the answer put forward a list and the
               domain contains a solution it left out, that is decided already and
               no bound is needed.

               A GENERATIVE answer — "all solutions are the permutations of the
               family (3, a_n, a_n+1)" — is not claiming its examples are
               everything, so a solution BIGGER than anything it listed may be the
               next term and must never be held against it. A solution INSIDE the
               range it has already reached is not a next term; it is a hole.

               x^2 + y^2 + z^2 = xyz came back answered with exactly that family,
               every listed triple correct and a descent argued in fifteen steps.
               It is still incomplete: (6, 15, 87) gives 7830 = 7830 and contains
               no 3, so it is in no permutation of the family — and the answer's
               own largest triple already reaches 102. The Markov tree branches.
               Mirrors index.html. */
            if (count($claims)) {
                $gen = (bool)preg_match(self::GENERATIVE, $md);
                $reach = 0;
                foreach ($claims as $tp) foreach ($tp as $v) if ($v > $reach) $reach = (int)$v;
                $ceil = $gen ? min($reach, 300) : 0;
                $upto = (bool)preg_match(self::UPTO_ORDER, $md) || self::isSymmetric($eq, $vars);
                $miss = ($gen && $reach < 2) ? null : self::witness($eq, $vars, $dom, $claims, $upto, $ceil);
                if ($miss !== null) {
                    $env0 = [];
                    foreach ($vars as $i => $vn) $env0[$vn] = (float)$miss[$i];
                    $lhs = Algebra::round6(Algebra::evalAt($eq['L'], $env0));
                    $rhs = Algebra::round6(Algebra::evalAt($eq['R'], $env0));
                    $out[] = ['kind' => 'exhaust', 'ok' => false,
                        'text' => ($gen
                            ? 'the answer describes a family and claims it is every solution, but ' .
                              self::fmtTuple($vars, $miss) . ' also satisfies ' . trim((string)$found['src']) .
                              ' — ' . $lhs . ' = ' . $rhs . ' — and is not in that family. It is not a later ' .
                              'term either: the answer already lists a solution reaching ' . $reach .
                              ', so this one sits inside the range it claims to cover'
                            : 'the answer presents its list as complete, but ' . self::fmtTuple($vars, $miss) .
                              ' also satisfies ' . trim((string)$found['src']) . ' — ' . $lhs . ' = ' . $rhs .
                              ' — and is not in it') .
                            '. One solution left out settles a claim of completeness; this is a ' .
                            'counterexample, not a search for more'];
                    return $out;
                }
            }

            /* (b1) the growth lemma: |polynomial| <= M*s^d < c^s beyond S0 */
            $pL = self::polyExpand($eq['L'], $vars);
            $pR = self::polyExpand($eq['R'], $vars);
            $poly = null; $exp = null;
            if ($pL !== null && $pR === null) { $poly = $pL; $exp = self::expSideOf($eq['R'], $vars); }
            elseif ($pR !== null && $pL === null) { $poly = $pR; $exp = self::expSideOf($eq['L'], $vars); }
            $bound = null;
            if ($poly !== null && $exp !== null) {
                $st = self::polyStats($poly);
                $bound = self::growthBound($st['M'], $st['d'], $exp['base']);
            }
            if ($bound !== null) {
                for ($s = $k * $dom['low']; $s < $bound['S0']; $s++) {
                    self::compositions($k, $s, $dom['low'], $tuples, $cap);
                    if (count($tuples) >= $cap) return $out;
                }
                $why = 'over ' . $dom['label'] . ', every solution of ' . trim((string)$found['src']) . ' has ' .
                       implode('+', $vars) . ' < ' . $bound['S0'] . ' — because |' .
                       ($k === 1 ? 'LHS' : 'the polynomial side') . '| ≤ ' . $bound['M'] . '·s^' . $bound['d'] .
                       ' while ' . $exp['base'] . '^s > ' . $bound['M'] . '·s^' . $bound['d'] .
                       ' for every s ≥ ' . $bound['S0'] . ' (base case checked exactly; the step holds because ' .
                       '(s+1)^' . $bound['d'] . ' ≤ ' . $exp['base'] . '·s^' . $bound['d'] . ' for s ≥ ' . $bound['s1'] .
                       ') — and all ' . count($tuples) . ' tuples below that bound were tested';
            } else {
                /* (b2) the equation bounds its OWN variables: every term positive
                   and every variable ≥ 1, so no term can exceed the total */
                $diff = self::polyExpand(['t' => 'b', 'op' => '-', 'a' => $eq['L'], 'b' => $eq['R']], $vars);
                $pb = $diff !== null ? self::positiveBound($diff, $vars, $dom) : null;
                $got = null;
                if ($pb !== null) {
                    $lows = array_fill(0, $k, $dom['low']);
                    $got = self::boxTuples($lows, $pb['hi'], $cap);
                    if ($got !== null) {
                        $tuples = $got;
                        $caps = [];
                        foreach ($vars as $i => $vn) $caps[] = $vn . ' ≤ ' . $pb['hi'][$i];
                        $why = 'over ' . $dom['label'] . ', ' . trim((string)$found['src']) .
                               ' bounds its own variables: every term is positive and every variable ' .
                               'is at least 1, so no term can exceed the total ' . $pb['C'] . ' — giving ' .
                               implode(', ', $caps) . '. All ' . count($tuples) . ' tuples in that box ' .
                               'were tested, which is the whole of the region the inequality allows';
                    }
                }
                if ($got === null) {
                    /* (b3) a bound the QUESTION stated: enumeration is then a proof,
                       because the question handed over the finite region itself */
                    $box = self::statedBound($question, $vars, $dom);
                    if ($box === null) return $out;   // no provable region → say nothing at all
                    for ($b = $box['lo']; $b <= $box['hi']; $b++) $tuples[] = [$b];
                    if (count($tuples) > $cap) return $out;
                    $why = 'the question itself restricts the search to ' . $box['lo'] . ' ≤ ' . $vars[0] .
                           ' ≤ ' . $box['hi'] . ' (' . $box['src'] . '), so every one of those ' . count($tuples) .
                           ' values was tested — this is exhaustion over the whole stated range, not a sample';
                }
            }

            $truth = [];
            foreach ($tuples as $tp) {
                if (self::domainBreak($dom, $vars, $tp) !== null) continue;  // the same reader, so the two agree
                $env = [];
                for ($j = 0; $j < $k; $j++) $env[$vars[$j]] = (float)$tp[$j];
                if (Algebra::holdsAt($eq, $env) === true) $truth[] = $tp;
                if (count($truth) > 60) return $out;
            }
        }

        $upto = (bool)preg_match(self::UPTO_ORDER, $md);
        $keyOf = static function (array $tp) use ($upto): string {
            $t = array_map(static function ($x) { return (int)round($x); }, $tp);
            if ($upto) sort($t);
            return implode(',', $t);
        };
        $have = [];
        foreach ($claims as $tp) $have[$keyOf($tp)] = 1;
        $missing = [];
        foreach ($truth as $tp) if (!isset($have[$keyOf($tp)])) $missing[] = $tp;

        $saysNone = (bool)preg_match(self::NONE_CLAIMED, $zone);
        /* An answer that puts nothing forward is not disputed here — a
           truncated derivation has made no claim about the solution set, and
           `truncated` is the check that speaks to a reply which stops early. */
        if (!count($claims) && !$saysNone) return $out;

        if (!count($truth)) {
            $ok = $saysNone && !count($claims);
            $out[] = ['kind' => 'exhaust', 'ok' => $ok,
                'text' => $ok
                    ? 'there are no solutions at all, and the answer says so — ' . $why
                    : 'there are NO solutions in ' . $dom['label'] . ': ' . $why];
            return $out;
        }
        if (count($missing)) {
            $shown = array_map(static function ($tp) use ($vars) { return self::fmtTuple($vars, $tp); },
                               array_slice($missing, 0, 4));
            $out[] = ['kind' => 'exhaust', 'ok' => false,
                'text' => 'the solution set is incomplete — ' . implode(', ', $shown) .
                          (count($missing) > 4 ? ' and ' . (count($missing) - 4) . ' more' : '') .
                          ' also ' . (count($missing) > 1 ? 'satisfy' : 'satisfies') . ' the question, and ' .
                          (count($missing) > 1 ? 'are' : 'is') . ' missing from the answer. ' . $why];
            return $out;
        }
        $out[] = ['kind' => 'exhaust', 'ok' => true,
            'text' => 'these are ALL the solutions, and that is proved rather than searched for: ' . $why];
        return $out;
    }
}
