<?php
/* ============================================================
   7Solve — UNIT ARITHMETIC (PHP side)
   ------------------------------------------------------------
   The PHP twin of unitmath() and the quantity engine in
   index.html. Ported, not reinvented, because parity is tested
   by running both engines over one corpus and comparing what
   they emit.

   Units.php answers exactly one question: is the answer the
   right KIND of thing? It knows km and m are both lengths and
   deliberately knows nothing about how many of one make the
   other. That is right for what it does, and useless for the
   two errors a physics answer actually makes:

       60 km/h = 21 m/s          a conversion done wrong
       F = 5 kg x 2 m/s^2 = 10 J units that do not follow

   Both silent, both decidable, neither checked before this.

   So this carries MAGNITUDE as well as dimension: every unit
   knows its factor to SI, and temperature knows its offset,
   because 25 C is not 25 times something K and treating it as
   one is its own classic error.

   WHY THERE ARE TWO UNIT TABLES. Units::DIM is a published
   contract — /v1 has returned its verdicts for months — and it
   stores dimension only, over five base quantities. This one
   stores dimension, factor and offset over SIX, because amount
   of substance is a base quantity and concentration cannot be
   expressed without it. Widening the frozen table would change
   a shipped API for a new checker's benefit. The two are held
   together by a test instead: every unit in both must agree
   about its dimension, asserted in adversarial.js.
   ============================================================ */
declare(strict_types=1);

final class Qty
{
    /* [M, L, T, I, K, N] — mass, length, time, current, temperature, amount */
    private const NAMES = ['M', 'L', 'T', 'I', 'K', 'N'];

    /** @return array{0:int,1:int,2:int,3:int,4:int,5:int} */
    private static function d(int $m = 0, int $l = 0, int $t = 0, int $i = 0, int $k = 0, int $n = 0): array
    {
        return [$m, $l, $t, $i, $k, $n];
    }

    /** name => [dim, factor to SI, offset or null]. Case-sensitive: K and k,
        mm and Mm are different units and guessing between them is worse than
        refusing. Mirrors Q_UNITS in index.html. */
    private static function units(): array
    {
        static $u = null;
        if ($u !== null) return $u;
        $u = [
            /* length */
            'm' => [self::d(0,1), 1.0, null],        'km' => [self::d(0,1), 1e3, null],
            'cm' => [self::d(0,1), 1e-2, null],      'mm' => [self::d(0,1), 1e-3, null],
            'um' => [self::d(0,1), 1e-6, null],      'µm' => [self::d(0,1), 1e-6, null],
            'nm' => [self::d(0,1), 1e-9, null],      'in' => [self::d(0,1), 0.0254, null],
            'ft' => [self::d(0,1), 0.3048, null],    'yd' => [self::d(0,1), 0.9144, null],
            'mile' => [self::d(0,1), 1609.344, null],
            /* mass */
            'kg' => [self::d(1), 1.0, null],         'g' => [self::d(1), 1e-3, null],
            'mg' => [self::d(1), 1e-6, null],        'ug' => [self::d(1), 1e-9, null],
            'µg' => [self::d(1), 1e-9, null],        'tonne' => [self::d(1), 1e3, null],
            'lb' => [self::d(1), 0.45359237, null],
            /* time */
            's' => [self::d(0,0,1), 1.0, null],      'ms' => [self::d(0,0,1), 1e-3, null],
            'us' => [self::d(0,0,1), 1e-6, null],    'µs' => [self::d(0,0,1), 1e-6, null],
            'ns' => [self::d(0,0,1), 1e-9, null],    'min' => [self::d(0,0,1), 60.0, null],
            'h' => [self::d(0,0,1), 3600.0, null],   'hr' => [self::d(0,0,1), 3600.0, null],
            'day' => [self::d(0,0,1), 86400.0, null],
            /* current */
            'A' => [self::d(0,0,0,1), 1.0, null],    'mA' => [self::d(0,0,0,1), 1e-3, null],
            'kA' => [self::d(0,0,0,1), 1e3, null],
            /* temperature — an OFFSET scale, the whole reason this exists */
            'K' => [self::d(0,0,0,0,1), 1.0, 0.0],
            '°C' => [self::d(0,0,0,0,1), 1.0, 273.15],
            'degC' => [self::d(0,0,0,0,1), 1.0, 273.15],
            /* amount, and the concentrations built on it */
            'mol' => [self::d(0,0,0,0,0,1), 1.0, null],
            'mmol' => [self::d(0,0,0,0,0,1), 1e-3, null],
            /* force, energy, power, pressure */
            'N' => [self::d(1,1,-2), 1.0, null],     'kN' => [self::d(1,1,-2), 1e3, null],
            'mN' => [self::d(1,1,-2), 1e-3, null],
            'J' => [self::d(1,2,-2), 1.0, null],     'kJ' => [self::d(1,2,-2), 1e3, null],
            'MJ' => [self::d(1,2,-2), 1e6, null],    'cal' => [self::d(1,2,-2), 4.184, null],
            'kcal' => [self::d(1,2,-2), 4184.0, null],
            'eV' => [self::d(1,2,-2), 1.602176634e-19, null],
            'kWh' => [self::d(1,2,-2), 3.6e6, null],
            'W' => [self::d(1,2,-3), 1.0, null],     'kW' => [self::d(1,2,-3), 1e3, null],
            'MW' => [self::d(1,2,-3), 1e6, null],    'mW' => [self::d(1,2,-3), 1e-3, null],
            'Pa' => [self::d(1,-1,-2), 1.0, null],   'kPa' => [self::d(1,-1,-2), 1e3, null],
            'MPa' => [self::d(1,-1,-2), 1e6, null],  'bar' => [self::d(1,-1,-2), 1e5, null],
            'atm' => [self::d(1,-1,-2), 101325.0, null],
            /* electricity */
            'Hz' => [self::d(0,0,-1), 1.0, null],    'kHz' => [self::d(0,0,-1), 1e3, null],
            'MHz' => [self::d(0,0,-1), 1e6, null],   'GHz' => [self::d(0,0,-1), 1e9, null],
            'C' => [self::d(0,0,1,1), 1.0, null],    'mC' => [self::d(0,0,1,1), 1e-3, null],
            'µC' => [self::d(0,0,1,1), 1e-6, null],
            'V' => [self::d(1,2,-3,-1), 1.0, null],  'mV' => [self::d(1,2,-3,-1), 1e-3, null],
            'kV' => [self::d(1,2,-3,-1), 1e3, null],
            'ohm' => [self::d(1,2,-3,-2), 1.0, null], 'Ω' => [self::d(1,2,-3,-2), 1.0, null],
            'kohm' => [self::d(1,2,-3,-2), 1e3, null],
            'F' => [self::d(-1,-2,4,2), 1.0, null],  'µF' => [self::d(-1,-2,4,2), 1e-6, null],
            'nF' => [self::d(-1,-2,4,2), 1e-9, null],
            /* volume, as a unit in its own right */
            'L' => [self::d(0,3), 1e-3, null],       'mL' => [self::d(0,3), 1e-6, null],
            'litre' => [self::d(0,3), 1e-3, null],
        ];
        return $u;
    }

    /** Spellings unambiguous once lowercased. Anything genuinely ambiguous —
        c, k, f, t, n, w, v — is NOT here: written the SI way or not read. */
    private const LOWER = [
        'metre'=>'m','meter'=>'m','metres'=>'m','meters'=>'m','km'=>'km','cm'=>'cm','mm'=>'mm',
        'kg'=>'kg','gram'=>'g','grams'=>'g','gm'=>'g','mg'=>'mg','tonne'=>'tonne','tonnes'=>'tonne',
        'sec'=>'s','secs'=>'s','second'=>'s','seconds'=>'s','ms'=>'ms','min'=>'min','mins'=>'min',
        'minute'=>'min','minutes'=>'min','hour'=>'h','hours'=>'h','hr'=>'h','hrs'=>'h','h'=>'h',
        'day'=>'day','days'=>'day','mole'=>'mol','moles'=>'mol','mol'=>'mol','litre'=>'L',
        'litres'=>'L','liter'=>'L','liters'=>'L','joule'=>'J','joules'=>'J','newton'=>'N',
        'newtons'=>'N','watt'=>'W','watts'=>'W','pascal'=>'Pa','pascals'=>'Pa','volt'=>'V',
        'volts'=>'V','ohm'=>'ohm','ohms'=>'ohm','amp'=>'A','amps'=>'A','ampere'=>'A',
        'amperes'=>'A','kelvin'=>'K','celsius'=>'°C','atm'=>'atm','bar'=>'bar','cal'=>'cal',
        'kcal'=>'kcal','ev'=>'eV','kwh'=>'kWh',
    ];

    private static function lookup(string $tok): ?array
    {
        $u = self::units();
        if (isset($u[$tok])) return $u[$tok];
        $low = mb_strtolower($tok, 'UTF-8');
        if (isset(self::LOWER[$low]) && isset($u[self::LOWER[$low]])) return $u[self::LOWER[$low]];
        return null;
    }

    private static function dAdd(array $a, array $b, int $sign): array
    {
        for ($i = 0; $i < 6; $i++) $a[$i] += $sign * $b[$i];
        return $a;
    }
    private static function dScale(array $a, int $k): array
    {
        for ($i = 0; $i < 6; $i++) $a[$i] *= $k;
        return $a;
    }
    public static function same(array $a, array $b): bool { return $a === $b; }

    public static function render(array $d): string
    {
        $sup = ['-'=>'⁻','0'=>'⁰','1'=>'¹','2'=>'²','3'=>'³','4'=>'⁴','5'=>'⁵','6'=>'⁶','7'=>'⁷','8'=>'⁸','9'=>'⁹'];
        $parts = [];
        for ($i = 0; $i < 6; $i++) {
            if (!$d[$i]) continue;
            $t = self::NAMES[$i];
            if ($d[$i] !== 1) {
                foreach (str_split((string)$d[$i]) as $ch) $t .= $sup[$ch] ?? $ch;
            }
            $parts[] = $t;
        }
        return $parts ? '[' . implode(' ', $parts) . ']' : '[dimensionless]';
    }

    /** A unit string as factor + dimension, or null on any token not known. */
    public static function unit(string $u): ?array
    {
        $t = trim($u);
        if ($t === '') return null;
        $t = preg_replace('/[·⋅×]/u', ' ', $t);
        $t = str_replace('^', '', $t);
        $t = strtr($t, ['⁻'=>'-','⁰'=>'0','¹'=>'1','²'=>'2','³'=>'3','⁴'=>'4']);
        $halves = explode('/', $t);
        if (count($halves) > 2) return null;
        $dim = self::d();
        $factor = 1.0;
        $offset = null;
        $only = 0;
        foreach ($halves as $hi => $half) {
            $sign = $hi === 0 ? 1 : -1;
            foreach (preg_split('/\s+/u', trim($half), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $tok) {
                if (!preg_match('/^([A-Za-zµΩ°]+)(-?\d+)?$/u', $tok, $mm)) return null;
                $def = self::lookup($mm[1]);
                if ($def === null) return null;
                $e = (isset($mm[2]) && $mm[2] !== '') ? (int)$mm[2] : 1;
                $dim = self::dAdd($dim, self::dScale($def[0], $e), $sign);
                $factor *= pow($def[1], $e * $sign);
                $only++;
                if ($def[2] !== null && $e === 1 && $sign === 1) $offset = $def[2];
            }
        }
        if (!$only) return null;
        /* An offset means something only for a bare temperature: °C/s is a rate
           and adding 273.15 to it would be nonsense. */
        return ['dim' => $dim, 'factor' => $factor,
                'offset' => ($only === 1 && $offset !== null) ? $offset : null, 'src' => trim($u)];
    }

    /** "3.0 x 10^8" is ONE number, and its x is not a multiplication. */
    public static function sci(string $t): string
    {
        $t = preg_replace('/(\d(?:\.\d+)?)\s*[×x*]\s*10\s*\^?\s*\(?\s*(-?\d{1,3})\s*\)?/iu', '$1e$2', $t);
        return preg_replace_callback('/(\d(?:\.\d+)?)\s*[×x*]\s*10\s*([⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)/u',
            static function (array $m): string {
                $map = ['⁻'=>'-','⁰'=>'0','¹'=>'1','²'=>'2','³'=>'3','⁴'=>'4','⁵'=>'5','⁶'=>'6','⁷'=>'7','⁸'=>'8','⁹'=>'9'];
                $e = '';
                foreach (preg_split('//u', $m[2], -1, PREG_SPLIT_NO_EMPTY) as $c) $e .= $map[$c] ?? $c;
                return $m[1] . 'e' . $e;
            }, $t);
    }

    private const NUM = '-?\d[\d,]*(?:\.\d+)?(?:e-?\d{1,3})?';

    /** "9.8 m/s²" as a value in SI. The unit must consume the WHOLE segment. */
    public static function one(string $text): ?array
    {
        $t = self::sci(trim($text));
        if (!preg_match('/^\s*(' . self::NUM . ')\s*([A-Za-zµΩ°\/^\s\d⁻⁰¹²³⁴·]*)$/u', $t, $m)) return null;
        $v = (float)str_replace(',', '', $m[1]);
        if (!is_finite($v)) return null;
        $raw = trim($m[2] ?? '');
        if ($raw === '') return null;                    // a bare number is not a quantity
        $words = preg_split('/\s+/u', $raw, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        for ($n = count($words); $n > 0; $n--) {
            $cand = implode(' ', array_slice($words, 0, $n));
            $u = self::unit($cand);
            if ($u === null) continue;
            /* THE WHOLE SEGMENT, or nothing: "0.5 mol / 2 L" read as 0.5 mol
               with "/ 2 L" dropped turns a concentration into an amount. */
            $ok = true;
            foreach (array_slice($words, $n) as $w) {
                if (preg_match('/\d/u', $w) || self::unit($w) !== null || strpos($w, '/') !== false) { $ok = false; break; }
            }
            if (!$ok) continue;
            $si = $u['offset'] !== null ? $v + $u['offset'] : $v * $u['factor'];
            return ['v' => $v, 'si' => $si, 'dim' => $u['dim'], 'unit' => $cand,
                    'offset' => $u['offset'], 'written' => trim($m[1])];
        }
        return null;
    }

    /** A product or quotient of quantities: "5 kg × 2 m/s²", "120 km / 2 h".
        A slash counts as division only when it is SPACED; "m/s" is one unit. */
    public static function expr(string $text): ?array
    {
        $t = self::sci(trim($text));
        if ($t === '') return null;
        $raw = preg_split('/\s*([×÷*])\s*|\s+(\/)\s+/u', $t, -1, PREG_SPLIT_DELIM_CAPTURE);
        $parts = [];
        foreach ($raw as $p) if ($p !== '' && $p !== null) $parts[] = $p;
        if (!count($parts) || count($parts) % 2 === 0) return null;
        $dim = self::d();
        $val = 1.0;
        $sawUnit = false;
        for ($i = 0; $i < count($parts); $i += 2) {
            $piece = trim($parts[$i]);
            $sign = $i === 0 ? 1 : (($parts[$i - 1] === '÷' || $parts[$i - 1] === '/') ? -1 : 1);
            $q = self::one($piece);
            if ($q !== null) {
                if ($q['offset'] !== null) return null;  // an offset scale cannot be multiplied
                if ($sign < 0 && $q['si'] == 0.0) return null;
                $sawUnit = true;
                $val = $sign > 0 ? $val * $q['si'] : $val / $q['si'];
                $dim = self::dAdd($dim, $q['dim'], $sign);
                continue;
            }
            $plain = str_replace(',', '', $piece);
            if (!preg_match('/^-?\d+(?:\.\d+)?(?:e-?\d{1,3})?$/u', $plain)) return null;
            $n = (float)$plain;
            if (!is_finite($n) || ($sign < 0 && $n == 0.0)) return null;
            $val = $sign > 0 ? $val * $n : $val / $n;
        }
        if (!$sawUnit) return null;                      // pure arithmetic: not this checker's job
        return ['si' => $val, 'dim' => $dim, 'src' => trim($text)];
    }

    /** The checker. Mirrors unitmath() in index.html. */
    public static function check(string $question, string $md): array
    {
        $text = Checks::deLatex($md);
        $out = [];
        $seen = [];
        foreach (preg_split('/\r?\n/u', $text) as $line) {
            if (count($out) >= 6) break;
            if (strpos($line, '=') === false) continue;
            if (preg_match('/[≠≈≤≥<>]/u', $line)) continue;
            if (strpos($line, '`') !== false) continue;
            $body = preg_replace('/^\s*[-*•]\s+|^\s*\d+[.)]\s+/u', '',
                     preg_replace('/\*\*|__/u', '', $line));
            $parts = explode('=', $body);
            if (count($parts) < 2 || count($parts) > 4) continue;
            for ($p = 0; $p + 1 < count($parts) && count($out) < 6; $p++) {
                $lseg = preg_split('/[,;:]/u', $parts[$p]);
                $rseg = preg_split('/[,;:]/u', $parts[$p + 1]);
                $lhs = rtrim(trim(end($lseg)), '.,;:');
                $rhs = rtrim(trim($rseg[0]), '.,;:');
                if ($lhs === '' || $rhs === '') continue;

                $R = self::one($rhs);
                if ($R === null) continue;               // the result must carry a unit
                $L = self::one($lhs);
                $isConversion = $L !== null;
                $E = $L !== null ? $L : self::expr($lhs);
                if ($E === null) continue;               // nothing with units on the left

                $key = 'u' . preg_replace('/\s+/u', '', $lhs) . '=' . preg_replace('/\s+/u', '', $rhs);
                if (isset($seen[$key])) continue;
                $seen[$key] = true;

                $lsi = $E['si'];
                $ldim = $E['dim'];
                if (!is_finite($lsi) || !is_finite($R['si'])) continue;

                if (!self::same($ldim, $R['dim'])) {
                    $out[] = ['kind' => 'unitconv', 'ok' => false,
                        'text' => $isConversion
                            ? $lhs . ' and ' . $rhs . ' are not the same quantity — ' . self::render($ldim) .
                              ' against ' . self::render($R['dim']) . ', so this is not a conversion'
                            : 'the units do not follow: ' . $lhs . ' works out to ' . self::render($ldim) .
                              ' but the answer is written in ' . $R['unit'] . ' ' . self::render($R['dim']) .
                              ' — the number may be right and the quantity is not'];
                    continue;
                }
                $agree = Checks::near($lsi, $R['si'], $R['written']);
                $out[] = ['kind' => 'unitconv', 'ok' => $agree,
                    'text' => $agree
                        ? $lhs . ' = ' . $rhs . ' checks out in SI (' . Algebra::round6($lsi) . ' ' .
                          ($R['offset'] !== null ? 'K' : 'base units') . ')'
                        : $lhs . ' = ' . $rhs . ' does not hold: the left side is ' . Algebra::round6($lsi) .
                          ' in SI base units and ' . $rhs . ' is ' . Algebra::round6($R['si']) .
                          ($isConversion ? ' — the conversion is wrong' : ' — the arithmetic does not give that')];
            }
        }
        return $out;
    }
}
