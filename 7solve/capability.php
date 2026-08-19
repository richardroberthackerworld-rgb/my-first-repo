<?php
/* ============================================================
   7Solve — API CAPABILITY REPORTING
   ------------------------------------------------------------
   /v1 runs a subset of the checkers the website runs. Until now a
   derivative question and an unsolvable one both came back
   `unverified`, and a customer could not tell which had happened:

     * a checker ran and could not establish the result, versus
     * no checker for this subject exists in the API at all.

   Those are different facts and only one of them is about the
   student's answer. `capability` separates them.

   The subject list is DERIVED from checks.json, so porting a
   checker to PHP updates the capability automatically — nobody
   has to remember to edit a second list. That mattered: a
   hand-kept list is exactly how four checkers came to be missing
   from the harness without anyone noticing.

   `not_supported_by_api` must never be read as a pass. See
   VERIFICATION-CONTRACT.md.
   ============================================================ */
declare(strict_types=1);

final class Capability
{
    /* Which checker owns which subject. Only entries whose checker is present
       in the PHP engine can report `supported`. */
    private const SUBJECT_CHECKER = [
        'derivative'        => 'derivativeCheck',
        'integral'          => 'integralCheck',
        'system'            => 'systemCheck',
        'identity'          => 'identityCheck',
        'equation_roots'    => 'substitution',
        'root_completeness' => 'solutionCompleteness',
        'arithmetic'        => 'arithmetic',
        'primality'         => 'primality',
        'units'             => 'units',
        'question_integrity'=> 'questionCheck',
    ];

    private static ?array $phpCheckers = null;

    private static function phpCheckers(): array
    {
        if (self::$phpCheckers !== null) return self::$phpCheckers;
        $out = [];
        $f = __DIR__ . '/checks.json';
        if (is_readable($f)) {
            $j = json_decode((string)file_get_contents($f), true);
            foreach (($j['checks'] ?? []) as $c) {
                if (!empty($c['php'])) $out[$c['name']] = true;
            }
        }
        return self::$phpCheckers = $out;
    }

    /** Subjects this API build can verify, derived from the registry. */
    public static function supportedSubjects(): array
    {
        $php = self::phpCheckers();
        $out = [];
        foreach (self::SUBJECT_CHECKER as $subject => $checker) {
            if (isset($php[$checker])) $out[] = $subject;
        }
        return $out;
    }

    /** Subjects the site verifies but this API does not. */
    public static function unsupportedSubjects(): array
    {
        $php = self::phpCheckers();
        $out = [];
        foreach (self::SUBJECT_CHECKER as $subject => $checker) {
            if (!isset($php[$checker])) $out[] = $subject;
        }
        return $out;
    }

    /* Which subject a question is asking about, by the same triggers the
       checkers themselves use. Best-effort and deliberately conservative: an
       unrecognised question reports no subject rather than guessing one. */
    public static function subjectOf(string $question): ?string
    {
        $q = $question;
        if (preg_match('/(?:d\s*\/\s*d[a-z]|differentiate|derivative)/i', $q)) return 'derivative';
        if (preg_match('/(?:\x{222B}|integrate|integral\s+of|antiderivative)/iu', $q)) return 'integral';
        if (preg_match('/\bis\s+\d+\s+prime\b|\bprime\s+number\b/i', $q)) return 'primality';
        $eqs = preg_match_all('/=/', $q);
        if ($eqs >= 2 && preg_match('/\band\b|,|;|\n/', $q)) return 'system';
        if ($eqs >= 1) return 'equation_roots';
        return null;
    }

    /**
     * The capability field for a response.
     *   supported            — a checker for this subject exists and ran
     *   not_supported_by_api — no checker for this subject exists in the API
     *   unknown_subject      — the subject could not be identified
     */
    public static function forQuestion(string $question, string $state): array
    {
        $subject = self::subjectOf($question);
        $supported = self::supportedSubjects();

        if ($subject === null) {
            return ['subject' => null, 'capability' => 'unknown_subject',
                    'means' => 'This API could not identify the mathematical subject of the question. '
                             . 'A verdict of "unverified" here says nothing about the answer.'];
        }
        if (!in_array($subject, $supported, true)) {
            return ['subject' => $subject, 'capability' => 'not_supported_by_api',
                    'means' => 'This API has no checker for ' . $subject . '. The answer was NOT '
                             . 'examined — this is not a pass and not a failure.'];
        }
        return ['subject' => $subject, 'capability' => 'supported',
                'means' => $state === 'unverified'
                    ? 'A checker for ' . $subject . ' ran and could not establish the result. '
                    . 'This is NOT a pass.'
                    : 'A checker for ' . $subject . ' ran and reached a verdict.'];
    }
}
