<?php
/* ============================================================
   7Solve — DIMENSIONAL ANALYSIS
   ------------------------------------------------------------
   The verifier could read algebra and arithmetic and nothing
   else, so a physics question returned UNVERIFIED almost every
   time — honest, but useless to a physics customer.

   This closes the most catchable physics error there is: an
   answer given in the wrong KIND of unit. "Find the
   acceleration" answered with "25 N" is wrong before any
   arithmetic is checked, because force is not acceleration, and
   that is provable from the dimensions alone without knowing
   the right number.

   WHAT IT DELIBERATELY DOES NOT DO
   --------------------------------
   It does not check magnitudes — 9.8 m/s² and 980 m/s² are
   dimensionally identical and this says nothing about either.
   It is a sieve for one error class, not a physics engine, and
   claiming more would make it dangerous.

   It also stays silent whenever the question does not name one
   unambiguous quantity, or the answer carries no unit. Rule 1:
   no verdict beats a wrong verdict, and telling a student their
   correct answer is wrong is the failure this whole product
   exists to avoid.
   ============================================================ */
declare(strict_types=1);


final class Units
{
    /* Dimensions as exponents of [M, L, T, I, K].
       Mass, length, time, current, temperature — enough for school and
       first-year physics, which is what this product sees. */
    private const DIM = [
        // base
        'kg' => [1,0,0,0,0],  'g'  => [1,0,0,0,0],  'mg' => [1,0,0,0,0],
        'tonne' => [1,0,0,0,0],
        'm'  => [0,1,0,0,0],  'cm' => [0,1,0,0,0],  'mm' => [0,1,0,0,0],
        'km' => [0,1,0,0,0],
        's'  => [0,0,1,0,0],  'ms' => [0,0,1,0,0],  'min' => [0,0,1,0,0],
        'h'  => [0,0,1,0,0],  'hr' => [0,0,1,0,0],
        'a'  => [0,0,0,1,0],
        'k'  => [0,0,0,0,1],

        // derived, named
        'n'   => [1,1,-2,0,0],    // newton
        'j'   => [1,2,-2,0,0],    // joule
        'w'   => [1,2,-3,0,0],    // watt
        'pa'  => [1,-1,-2,0,0],   // pascal
        'hz'  => [0,0,-1,0,0],    // hertz
        'c'   => [0,0,1,1,0],     // coulomb
        'v'   => [1,2,-3,-1,0],   // volt
        'ohm' => [1,2,-3,-2,0],
        'f'   => [-1,-2,4,2,0],   // farad
        't'   => [1,0,-2,-1,0],   // tesla
    ];

    /* What a question asks for. Longest phrases first so "potential energy"
       is not read as "potential". */
    private const QUANTITY = [
        'kinetic energy'      => [1,2,-2,0,0],
        'potential energy'    => [1,2,-2,0,0],
        'work done'           => [1,2,-2,0,0],
        'moment of inertia'   => [1,2,0,0,0],
        'angular momentum'    => [1,2,-1,0,0],
        'surface tension'     => [1,0,-2,0,0],
        'electric field'      => [1,1,-3,-1,0],
        'magnetic field'      => [1,0,-2,-1,0],
        'specific heat'       => [0,2,-2,0,-1],
        'acceleration'        => [0,1,-2,0,0],
        'displacement'        => [0,1,0,0,0],
        'wavelength'          => [0,1,0,0,0],
        'resistance'          => [1,2,-3,-2,0],
        'capacitance'         => [-1,-2,4,2,0],
        'frequency'           => [0,0,-1,0,0],
        'momentum'            => [1,1,-1,0,0],
        'impulse'             => [1,1,-1,0,0],
        'pressure'            => [1,-1,-2,0,0],
        'velocity'            => [0,1,-1,0,0],
        'density'             => [1,-3,0,0,0],
        'current'             => [0,0,0,1,0],
        'voltage'             => [1,2,-3,-1,0],
        'charge'              => [0,0,1,1,0],
        'energy'              => [1,2,-2,0,0],
        'weight'              => [1,1,-2,0,0],
        'tension'             => [1,1,-2,0,0],
        'thrust'              => [1,1,-2,0,0],
        'power'               => [1,2,-3,0,0],
        'period'              => [0,0,1,0,0],
        'volume'              => [0,3,0,0,0],
        'speed'               => [0,1,-1,0,0],
        'force'               => [1,1,-2,0,0],
        'work'                => [1,2,-2,0,0],
        'heat'                => [1,2,-2,0,0],
        'area'                => [0,2,0,0,0],
        'mass'                => [1,0,0,0,0],
        'emf'                 => [1,2,-3,-1,0],
    ];

    private const NAMES = ['M', 'L', 'T', 'I', 'K'];

    private static function zero(): array { return [0,0,0,0,0]; }

    private static function add(array $a, array $b, int $sign = 1): array
    {
        foreach ($a as $i => $_) $a[$i] += $sign * $b[$i];
        return $a;
    }
    private static function scale(array $a, int $k): array
    {
        foreach ($a as $i => $_) $a[$i] *= $k;
        return $a;
    }
    private static function same(array $a, array $b): bool { return $a === $b; }
    private static function isZero(array $a): bool { return $a === self::zero(); }

    /* Render a dimension the way a physics textbook does: [M L T⁻²]. */
    public static function render(array $d): string
    {
        $sup = ['-' => '⁻', '0' => '⁰', '1' => '¹', '2' => '²', '3' => '³',
                '4' => '⁴', '5' => '⁵', '6' => '⁶', '7' => '⁷', '8' => '⁸', '9' => '⁹'];
        $parts = [];
        foreach ($d as $i => $e) {
            if ($e === 0) continue;
            $s = self::NAMES[$i];
            if ($e !== 1) {
                $t = '';
                foreach (str_split((string)$e) as $ch) $t .= $sup[$ch] ?? $ch;
                $s .= $t;
            }
            $parts[] = $s;
        }
        return $parts ? '[' . implode(' ', $parts) . ']' : '[dimensionless]';
    }

    /* Parse a unit string — "m/s^2", "kg m/s", "N", "m s⁻²" — into a
       dimension, or null when any token is unrecognised. Unrecognised means
       silence, never a guess. */
    public static function parseUnit(string $u): ?array
    {
        $s = trim($u);
        if ($s === '') return null;
        $s = str_replace(['·', '×', '⋅'], ' ', $s);
        $s = str_replace(['Ω', 'ohms', 'Ohm'], 'ohm', $s);
        $s = strtr($s, ['⁻' => '-', '⁰' => '0', '¹' => '1', '²' => '2', '³' => '3',
                        '⁴' => '4', '⁵' => '5', '⁶' => '6']);
        $s = preg_replace('/\^/', '', $s);

        /* Split on / into numerator and denominator halves. More than one
           slash is ambiguous without brackets, so refuse it. */
        $halves = explode('/', $s);
        if (count($halves) > 2) return null;

        $dim = self::zero();
        foreach ($halves as $hi => $half) {
            $sign = $hi === 0 ? 1 : -1;
            foreach (preg_split('/\s+/u', trim($half), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $tok) {
                if (!preg_match('/^([a-zA-Zµ]+)(-?\d+)?$/u', $tok, $m)) return null;
                $name = strtolower($m[1]);
                if (!isset(self::DIM[$name])) return null;
                $exp = isset($m[2]) && $m[2] !== '' ? (int)$m[2] : 1;
                $dim = self::add($dim, self::scale(self::DIM[$name], $exp * $sign));
            }
        }
        return self::isZero($dim) ? null : $dim;
    }

    /* The quantity a question ASKS FOR, or null.

       Merely appearing in the text is not enough. "Calculate the force on the
       mass" names two words from the table, and an earlier version called that
       ambiguous and gave up — but "mass" is the setup there, not the question.
       Only a quantity in an ASKED position counts: straight after an
       interrogative ("find the force"), or after a conjunction that adds a
       second request ("and the acceleration").

       That second pattern is what still catches genuine ambiguity: "find the
       force and the acceleration" wants two different answers, and checking
       the reply against either one would be a coin toss. */
    public static function askedFor(string $question): ?array
    {
        $q = ' ' . strtolower(preg_replace('/\s+/u', ' ', $question)) . ' ';

        /* Longest phrase first, so "potential energy" is never read as "energy". */
        $words = array_keys(self::QUANTITY);
        usort($words, static fn($a, $b) => strlen($b) <=> strlen($a));
        $alt = implode('|', array_map(static fn($w) => preg_quote($w, '/'), $words));

        $ask = '(?:find|calculate|determine|compute|obtain|evaluate|what\s+is|what\s+are|'
             . 'how\s+much\s+is|and|also)\s+(?:the\s+|its\s+|a\s+)?';
        $re = '/\b' . $ask . '(' . $alt . ')s?\b/u';

        if (!preg_match_all($re, $q, $ms)) return null;

        $hits = [];
        foreach ($ms[1] as $w) {
            $dim = self::QUANTITY[$w] ?? null;
            if ($dim === null) continue;
            $hits[self::render($dim)] = ['word' => $w, 'dim' => $dim];
        }
        return count($hits) === 1 ? array_values($hits)[0] : null;
    }

    /* The unit the ANSWER is given in. Read from the claim zone, so a unit
       appearing mid-working is not mistaken for the final answer. */
    public static function answerUnit(string $answer): ?array
    {
        $zone = Checks::claimZone(Checks::deLatex($answer));
        /* THE ANSWER IS AFTER THE LAST EQUALS SIGN, not at the start of the
           line. Reading the first number-with-a-unit was right while answers
           were written "a = 25 N" and wrong the moment one showed its working
           on the same line: "F = 5 kg x 2 m/s^2 = 10 N" was read as 5 kg, a
           mass, and a correct force answer was disputed for being a mass.
           Mirrors uAnswerUnit() in index.html. */
        $lastEq = strrpos($zone, '=');
        if ($lastEq !== false && trim(substr($zone, $lastEq + 1)) !== '') {
            $zone = substr($zone, $lastEq + 1);
        }
        /* A number, then a unit: "25 m/s²", "= 9.8 m s⁻²", "3.5 N". */
        if (!preg_match_all('/(-?\d[\d,]*(?:\.\d+)?)\s*([a-zA-ZΩµ][a-zA-ZΩµ\s\/\^\-\d²³⁻¹·]{0,14})/u',
                            $zone, $ms, PREG_SET_ORDER)) return null;
        foreach ($ms as $m) {
            $raw = trim($m[2]);
            /* Trim trailing prose: "25 m/s and then" -> "m/s". Try the longest
               run first and shorten until something parses. */
            $words = preg_split('/\s+/u', $raw, -1, PREG_SPLIT_NO_EMPTY) ?: [];
            for ($n = count($words); $n > 0; $n--) {
                $cand = implode(' ', array_slice($words, 0, $n));
                $d = self::parseUnit($cand);
                if ($d !== null) return ['unit' => $cand, 'dim' => $d, 'value' => $m[1]];
            }
        }
        return null;
    }

    /* The check itself. Returns [] — no verdict — far more often than it
       returns a result, and that is the intended behaviour. */
    public static function check(string $question, string $answer): array
    {
        $asked = self::askedFor($question);
        if ($asked === null) return [];
        $given = self::answerUnit($answer);
        if ($given === null) return [];

        $ok = self::same($asked['dim'], $given['dim']);
        return [[
            'kind' => 'units',
            'ok'   => $ok,
            'text' => $ok
                ? 'the question asks for ' . $asked['word'] . ' ' . self::render($asked['dim'])
                  . ' and the answer is in ' . $given['unit'] . ' ' . self::render($given['dim'])
                : 'the question asks for ' . $asked['word'] . ' ' . self::render($asked['dim'])
                  . ' but the answer is given in ' . $given['unit'] . ' '
                  . self::render($given['dim']) . ', which is a different quantity',
        ]];
    }
}
