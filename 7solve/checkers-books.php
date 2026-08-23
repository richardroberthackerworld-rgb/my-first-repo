<?php
/* ============================================================
   7Solve — DOUBLE ENTRY (PHP side)
   ------------------------------------------------------------
   The PHP twin of bookkeeping() in index.html. Ported, not
   reinvented, because parity is tested by running both engines
   over one corpus and comparing what they emit.

   Accounting has been marked covered_not_verifiable since the
   capability manifest existed, and this product aims itself at
   CA, CMA and B.Com students. So its largest single audience has
   been getting answers that could never earn a badge — the same
   "unable to verify" a broken parse gets.

   Most of accounting genuinely is not checkable here: whether
   the right account was debited, whether a policy applies,
   whether an estimate is reasonable. But the law the whole
   system rests on is arithmetic and absolute:

       every entry debits exactly what it credits.

   A journal entry whose columns do not agree is wrong before
   anyone asks which account it hit, and that is provable without
   knowing any accounting at all.

   A TOTAL is a claim, not an entry: a row whose particulars say
   "Total" is taken out of the sum and checked AGAINST it, so an
   answer that adds its own column up wrongly is caught
   separately from one whose entries do not balance.
   ============================================================ */
declare(strict_types=1);

final class Books
{
    private const CONTEXT = '/\bA\/c\b|\bDr\.?\b|\bCr\.?\b|\bjournal\b|\bledger\b|\btrial balance\b|\bbalance sheet\b|\bdebit\b|\bcredit\b/iu';
    private const TOTAL   = '/\btotals?\b|\bgrand total\b|\bb\/?f\b|\bc\/?d\b/iu';

    /** Rs 1,50,000 — Indian grouping, a currency mark, or neither. */
    public static function money(string $t): ?float
    {
        $m = trim(preg_replace('/[₹$€£]|Rs\.?|INR/iu', '', $t));
        if (!preg_match('/^-?[\d,]+(?:\.\d{1,2})?$/u', $m)) return null;
        $n = (float)str_replace(',', '', $m);
        return is_finite($n) ? $n : null;
    }

    /** The LAST figure on a line is the amount; anything earlier is a folio,
        a date or an account number. */
    private static function moneyIn(string $t): ?float
    {
        if (!preg_match_all('/-?(?:₹|Rs\.?|INR)?\s*[\d,]+(?:\.\d{1,2})?/iu', $t, $ms)) return null;
        $all = $ms[0];
        for ($i = count($all) - 1; $i >= 0; $i--) {
            $v = self::money($all[$i]);
            if ($v !== null && abs($v) >= 1) return $v;
        }
        return null;
    }

    /** A markdown table naming both columns; rows read by position. */
    private static function fromTable(array $lines): ?array
    {
        $hdr = -1; $dCol = -1; $cCol = -1;
        foreach ($lines as $i => $line) {
            if ($hdr >= 0) break;
            if (strpos($line, '|') === false) continue;
            $cells = array_map(static fn($x) => mb_strtolower(trim($x), 'UTF-8'), explode('|', $line));
            $d = -1; $c = -1;
            foreach ($cells as $j => $x) {
                if ($d < 0 && preg_match('/^debit|dr\.?$|debit \(/u', $x)) $d = $j;
                if ($c < 0 && preg_match('/^credit|cr\.?$|credit \(/u', $x)) $c = $j;
            }
            if ($d >= 0 && $c >= 0 && $d !== $c) { $hdr = $i; $dCol = $d; $cCol = $c; }
        }
        if ($hdr < 0) return null;

        $dr = 0.0; $cr = 0.0; $n = 0; $claimD = null; $claimC = null;
        for ($r = $hdr + 1; $r < count($lines); $r++) {
            $row = $lines[$r];
            if (strpos($row, '|') === false) break;                 // the table ended
            if (preg_match('/^[\s|:\-]+$/u', $row)) continue;        // the ---|--- rule
            $cs = explode('|', $row);
            if (count($cs) <= max($dCol, $cCol)) continue;
            $dv = self::moneyIn($cs[$dCol]);
            $cv = self::moneyIn($cs[$cCol]);
            if ($dv === null && $cv === null) continue;
            if (preg_match(self::TOTAL, $row)) {                     // a claim, not an entry
                if ($dv !== null) $claimD = $dv;
                if ($cv !== null) $claimC = $cv;
                continue;
            }
            if ($dv !== null) { $dr += $dv; $n++; }
            if ($cv !== null) { $cr += $cv; $n++; }
        }
        return $n >= 2
            ? ['dr' => $dr, 'cr' => $cr, 'n' => $n, 'claimD' => $claimD, 'claimC' => $claimC,
               'how' => 'the debit and credit columns']
            : null;
    }

    /** The prose form every Indian textbook uses. */
    private static function fromProse(array $lines): ?array
    {
        $dr = 0.0; $cr = 0.0; $n = 0;
        foreach ($lines as $line) {
            if (strpos($line, '|') !== false) continue;              // tables are the other reader's job
            if (preg_match(self::TOTAL, $line)) continue;
            $amt = self::moneyIn($line);
            if ($amt === null) continue;
            $isCredit = (bool)preg_match('/^\s*(?:\*|-)?\s*To\s+/iu', $line) || (bool)preg_match('/\bCr\.?(?:\s|$)/u', $line);
            $isDebit  = (bool)preg_match('/\bDr\.?(?:\s|$)/u', $line) || (bool)preg_match('/^\s*(?:\*|-)?\s*By\s+/iu', $line);
            if ($isCredit && !$isDebit) { $cr += $amt; $n++; }
            elseif ($isDebit) { $dr += $amt; $n++; }
        }
        return $n >= 2
            ? ['dr' => $dr, 'cr' => $cr, 'n' => $n, 'claimD' => null, 'claimC' => null, 'how' => 'the entries']
            : null;
    }

    /** Indian grouping: the last three digits, then twos. */
    public static function rupee(float $n): string
    {
        $neg = $n < 0;
        $a = abs($n);
        $t = (abs($a - round($a)) < 1e-9) ? (string)(int)round($a) : number_format($a, 2, '.', '');
        $parts = explode('.', $t);
        $whole = $parts[0];
        if (strlen($whole) > 3) {
            $last3 = substr($whole, -3);
            $rest = substr($whole, 0, -3);
            $whole = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest) . ',' . $last3;
        }
        return ($neg ? '−' : '') . '₹' . $whole . (isset($parts[1]) ? '.' . $parts[1] : '');
    }

    private static function sameMoney(float $a, float $b): bool
    {
        return abs($a - $b) <= max(1.0, abs($a), abs($b)) * 1e-9;
    }

    public static function check(string $question, string $md): array
    {
        $text = Checks::deLatex($md);
        if (!preg_match(self::CONTEXT, $text)) return [];
        $lines = preg_split('/\r?\n/u', $text) ?: [];
        $out = [];

        $t = self::fromTable($lines);
        if ($t === null) $t = self::fromProse($lines);
        if ($t !== null) {
            $ok = self::sameMoney($t['dr'], $t['cr']);
            $out[] = ['kind' => 'books', 'ok' => $ok,
                'text' => $ok
                    ? 'the entry balances — ' . $t['how'] . ' both come to ' . self::rupee($t['dr']) .
                      ' across ' . $t['n'] . ' figures, which is the one thing double entry requires'
                    : 'the entry does not balance — debits come to ' . self::rupee($t['dr']) .
                      ' and credits to ' . self::rupee($t['cr']) . ', a difference of ' .
                      self::rupee(abs($t['dr'] - $t['cr'])) .
                      '. Every entry must debit exactly what it credits, whichever accounts were chosen'];
            if ($t['claimD'] !== null && !self::sameMoney($t['claimD'], $t['dr'])) {
                $out[] = ['kind' => 'books', 'ok' => false,
                    'text' => 'the debit column is totalled as ' . self::rupee($t['claimD']) .
                              ' but its entries add to ' . self::rupee($t['dr'])];
            }
            if ($t['claimC'] !== null && !self::sameMoney($t['claimC'], $t['cr'])) {
                $out[] = ['kind' => 'books', 'ok' => false,
                    'text' => 'the credit column is totalled as ' . self::rupee($t['claimC']) .
                              ' but its entries add to ' . self::rupee($t['cr'])];
            }
        }

        /* ---- the balance sheet, when both sides are stated ---- */
        $assets = null; $equity = null;
        if (preg_match('/total\s+assets?\b[^\n\d]{0,40}((?:₹|Rs\.?|INR)?\s*[\d,]+(?:\.\d{1,2})?)/iu', $text, $am)) {
            $assets = self::money($am[1]);
        }
        if (preg_match('/total\s+(?:liabilit\w+(?:\s+and\s+(?:capital|equity))?|equity\s+and\s+liabilit\w+|capital\s+and\s+liabilit\w+)\b[^\n\d]{0,40}((?:₹|Rs\.?|INR)?\s*[\d,]+(?:\.\d{1,2})?)/iu', $text, $lm)) {
            $equity = self::money($lm[1]);
        }
        if ($assets !== null && $equity !== null) {
            $ok = self::sameMoney($assets, $equity);
            $out[] = ['kind' => 'books', 'ok' => $ok,
                'text' => $ok
                    ? 'the balance sheet balances — total assets ' . self::rupee($assets) .
                      ' equals total liabilities and capital'
                    : 'the balance sheet does not balance — total assets ' . self::rupee($assets) .
                      ' against total liabilities and capital ' . self::rupee($equity) . ', out by ' .
                      self::rupee(abs($assets - $equity))];
        }
        return array_slice($out, 0, 4);
    }
}
