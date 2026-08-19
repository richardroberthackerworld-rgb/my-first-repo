<?php
/* ============================================================
   7Solve — SAMPLE POINTS (PHP side of a cross-language contract)
   ------------------------------------------------------------
   Any checker that decides equivalence by evaluating at points
   must take those points from here. A fixed grid is discoverable
   and therefore forgeable: that one flaw produced five separate
   wrong-answer-goes-green vulnerabilities in the JavaScript
   engine before it was made structural.

   This is a PORT, not a re-implementation. The JS in index.html
   is the reference, and sample-vectors.json is the authority —
   both engines are tested against the FILE rather than against
   each other, so a shared misreading cannot cancel out.

   Two hazards that make an "obvious" port wrong:

     * charCodeAt() in JS yields UTF-16 code units. Walking PHP
       bytes would diverge on the first non-ASCII character, and
       these keys carry ², ³, √ and student text in Telugu or
       Hindi. mb_convert_encoding to UTF-16LE and read pairs.

     * >>> 0 is an unsigned 32-bit coercion. PHP ints are 64-bit
       and signed, so every step masks with 0xFFFFFFFF or the
       high bits leak into the next round.

   See VERIFICATION-CONTRACT.md for the full contract.
   ============================================================ */
declare(strict_types=1);

/* FNV-1a over UTF-16 code units, matching JS charCodeAt exactly. */
function sample_seed(string $s): int
{
    $hsh = 0x811c9dc5;
    /* UTF-16LE gives the same code units JS iterates, including the
       surrogate pairs JS would yield for astral characters. */
    $u16 = mb_convert_encoding($s, 'UTF-16LE', 'UTF-8');
    $len = strlen($u16);
    for ($i = 0; $i < $len; $i += 2) {
        $code = ord($u16[$i]) | (ord($u16[$i + 1]) << 8);
        $hsh ^= $code;
        /* JS: hsh + ((hsh<<1)+(hsh<<4)+(hsh<<7)+(hsh<<8)+(hsh<<24)) >>> 0.
           Each shift is a 32-bit operation in JS; mask after every one. */
        $sum = ($hsh
            + ((($hsh << 1) & 0xFFFFFFFF)
             + (($hsh << 4) & 0xFFFFFFFF)
             + (($hsh << 7) & 0xFFFFFFFF)
             + (($hsh << 8) & 0xFFFFFFFF)
             + (($hsh << 24) & 0xFFFFFFFF)));
        $hsh = $sum & 0xFFFFFFFF;
    }
    return $hsh & 0xFFFFFFFF;
}

/* xorshift32. Strictly positive range (0.35, 9.5): sqrt and ln are only
   defined there, and a negative probe would silently drop every sample for
   those and leave the check with nothing to say. */
function sample_grid(int $seed, int $n): array
{
    $st = $seed & 0xFFFFFFFF;
    if ($st === 0) $st = 0x9E3779B9;
    $out = [];
    for ($i = 0; $i < $n; $i++) {
        $st ^= ($st << 13) & 0xFFFFFFFF; $st &= 0xFFFFFFFF;
        $st ^= ($st >> 17);              $st &= 0xFFFFFFFF;   // >>> on a masked value
        $st ^= ($st << 5) & 0xFFFFFFFF;  $st &= 0xFFFFFFFF;
        $out[] = 0.35 + ($st % 1000003) / 1000003 * 9.15;
    }
    return $out;
}

function sample_points(string $key): array
{
    $s = sample_seed($key);
    return array_merge(sample_grid($s, 8), sample_grid(($s ^ 0x5bf03635) & 0xFFFFFFFF, 8));
}
