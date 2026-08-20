<?php
/* ============================================================
   7Solve — PROVENANCE  (Phase 2 / Release A)
   ------------------------------------------------------------
   The verifier must know WHAT IT IS LOOKING AT. A question the
   student typed and a question read off a blurred scan are not
   the same evidence, and a checker that cannot tell them apart
   will certify an answer to a question nobody read.

   Four origins, per the P0 specification:

     typed          the student wrote it
     extracted      pulled from a PDF text layer
     transcribed    read from pixels by OCR or a vision model
     reconstructed  assembled from layout analysis

   Question and answer carry SEPARATE records, because they
   routinely differ — a student photographs a textbook question
   and types their own answer. Collapsing them into one number
   would either wrongly cap a typed answer or wrongly certify a
   misread question.

   THE CAP MAY ONLY LOWER A VERDICT.

     * it never raises one
     * it never manufactures `disputed` — low confidence in the
       QUESTION says nothing about whether the ANSWER is wrong,
       and claiming otherwise would be the same category error
       the verification contract exists to prevent, pointed at
       the input instead of the output
     * it is applied strictly OUTSIDE the frozen Phase 1 state
       machine, which is not modified by Phase 2 at all

   RELEASE A SHIPS THIS INERT, AND THAT IS PROVABLE RATHER THAN
   PROMISED: no code path in this build produces an extraction
   origin, because nothing transcribes a question into the
   verifier yet. `origin_of()` returns `typed` for every caller
   that exists today, and cap() returns its input unchanged for
   `typed`. The structure lands before the pipeline that needs
   it, so the trust boundary is never retrofitted around a live
   verdict path.
   ============================================================ */
declare(strict_types=1);

final class Provenance
{
    /** Origins that mean a machine read the text rather than a person writing it. */
    private const EXTRACTION_ORIGINS = ['extracted', 'transcribed', 'reconstructed'];

    private const ORIGINS = ['typed', 'extracted', 'transcribed', 'reconstructed'];

    /* Below this, a transcription is not good enough to certify an answer
       against. It is deliberately NOT a tunable that a caller can pass in:
       a per-request floor would let the caller decide how trustworthy its own
       input is, which is the whole thing being guarded against. */
    public const FLOOR = 0.98;

    /**
     * Build a record. Unknown or malformed input degrades to the SAFE end
     * (an extraction with no confidence), never to `typed`.
     */
    public static function of(?array $raw): array
    {
        $one = static function ($r): array {
            if (!is_array($r)) return ['origin' => 'typed', 'confidence' => 1.0,
                                       'method' => null, 'round_trip' => null, 'region' => null];
            $origin = (string)($r['origin'] ?? 'typed');
            if (!in_array($origin, self::ORIGINS, true)) $origin = 'transcribed';   // unknown → cautious
            $conf = $r['confidence'] ?? null;
            $conf = is_numeric($conf) ? max(0.0, min(1.0, (float)$conf)) : ($origin === 'typed' ? 1.0 : 0.0);
            return [
                'origin'     => $origin,
                'confidence' => $conf,
                'method'     => isset($r['method']) ? (string)$r['method'] : null,
                'round_trip' => isset($r['round_trip']) ? (bool)$r['round_trip'] : null,
                'region'     => isset($r['region']) ? (string)$r['region'] : null,
            ];
        };
        return [
            'question' => $one($raw['question'] ?? null),
            'answer'   => $one($raw['answer'] ?? null),
        ];
    }

    /** True when the question reached us through a machine reading pixels or a file. */
    public static function isExtracted(array $prov): bool
    {
        return in_array($prov['question']['origin'] ?? 'typed', self::EXTRACTION_ORIGINS, true);
    }

    /**
     * Lower a verdict the ingestion cannot support. Returns the state unchanged
     * in every case except one: a `checked` reached from a question that was
     * machine-read without clearing the floor and a parse round trip.
     *
     * `plain` is the canonical `unverified`, which is the honest report — we
     * are declining to certify, not disputing the answer.
     */
    public static function cap(string $state, array $prov): string
    {
        if (!self::isExtracted($prov)) return $state;      // typed — nothing to doubt
        if ($state !== 'checked')      return $state;      // only certification is capped
        $q = $prov['question'];
        if (($q['confidence'] ?? 0.0) >= self::FLOOR && ($q['round_trip'] ?? false) === true) return $state;
        return 'plain';
    }

    /** What the response should say about why a verdict was held back. */
    public static function explain(string $before, string $after, array $prov): ?string
    {
        if ($before === $after) return null;
        return 'The answer passed its checks, but the question was read from a ' .
               $prov['question']['origin'] . ' source that did not clear the transcription floor, ' .
               'so 7Solve is not certifying it. This says nothing about whether the answer is right.';
    }
}
