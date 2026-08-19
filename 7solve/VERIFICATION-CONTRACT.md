# 7Solve — verification state contract

Two engines decide whether an answer is trustworthy: the JavaScript in
`index.html` (what a student sees) and `verify.php` (what `/v1` returns). They
do not use the same vocabulary, and that is deliberate. This is the record of
which words are a promise to somebody outside the codebase and which are not.

Enforced by `stateContract()` in `parity.js`, on every corpus case.

## The three canonical outcomes

Everything either engine can say collapses to exactly one of these. This is the
only classification any caller — student, customer, dashboard — should reason
about.

| Canonical | Meaning |
|---|---|
| `verified` | A mathematical check ran and passed. The answer is asserted correct. |
| `disputed` | A mathematical check ran and **failed**. The answer is asserted wrong. |
| `unverified` | Nothing decisive could be checked. **This is not a pass.** |

## PHP — public, frozen

`verify.php` states are a **published API field**. `/v1` returns them three
ways: `state` verbatim, `status` uppercased, and a `verified` boolean. They are
documented in `docs/api.html` and a customer may be branching on them today.

| PHP state | Canonical | Contract |
|---|---|---|
| `checked` | `verified` | public, frozen |
| `disputed` | `disputed` | public, frozen |
| `stepfail` | `disputed` | public, frozen |
| `invalid_question` | `disputed` | public, frozen |
| `unverified` | `unverified` | public, frozen |

**`unverified` is preserved for backward compatibility and must not be
renamed.** It is the honest outcome for a question no checker could decide, and
`/v1` already tells the caller in words that it is not a pass.

## Browser — internal, but not free to rename

The browser splits `unverified` four ways so the badge can say *what it looked
at* rather than only that it could not decide. None of the four claims
verification.

| JS state | Canonical | Contract |
|---|---|---|
| `checked` | `verified` | internal |
| `disputed` | `disputed` | internal |
| `stepfail` | `disputed` | internal |
| `invalid_question` | `disputed` | internal |
| `worked` | `unverified` | internal — "worked step by step" |
| `explained` | `unverified` | internal — "explained in steps" |
| `plain` | `unverified` | internal — nothing to check |
| `partial` | `unverified` | internal — only advisory checks ran |

These never reach `/v1`. They are **not** purely cosmetic, though: `Verify.run`'s
state is posted to `api.php?action=quality` as the `verify` field, so the four
names are already written into the quality-dashboard history. Renaming them
would silently split historical telemetry, and would change badge wording a
student reads. Neither is a test-harness decision.

## The invariant

> No answer is ever `verified` in one engine and `disputed` or `unverified` in
> the other.

The engines may disagree about *how* to describe a not-verified answer. They may
never disagree about whether the mathematics was proved. `stateContract()` fails
the build on any violation, and prints the case that broke it.

## Known, accepted divergence

The site and the API label the same unverified answer differently — the browser
might say `plain` where `/v1` says `unverified`. This is visible to anyone
comparing the two surfaces directly. It is accepted rather than fixed because
both sides of a fix are worse than the divergence: renaming in the browser
changes the badge and splits telemetry, renaming in PHP breaks a published API
field. Unifying them is a product decision, not a refactor.

## Adding a state

1. Decide its canonical class and add it to the table above.
2. Add it to `CANONICAL` in `parity.js`. An unmapped state fails the build
   rather than being guessed — a state nobody classified is a state nobody can
   reason about.
3. If it is a PHP state, it is public from the moment it ships. Document it in
   `docs/api.html` first.


---

# Phase 1 — Evidence, certification and API capability

Everything above describes *which words* each engine uses. This part describes
*what has to be true* before the strongest word may be used, and what `/v1`
must say when it simply does not have the checker.

## The governing rule

> AI proposes → mathematics checks → verifier decides → UI reports.

Never *AI proposes → AI says correct → UI says verified*. Model prose is input
to the renderer, never to the verdict. A section a model titles "Verification"
is retitled "Verification steps"; only the engine may use the bare word.

## Evidence is not certification

Two different claims, routinely confused, and the confusion reached production:

| | Claim | Example |
|---|---|---|
| **Evidence** | the values offered are genuine | `x = 1, 2, 3` all satisfy the equation |
| **Certification** | the requested result is established | those are *all* the roots |

`Solve x³−6x²+11x−6 + x(x−1)…(x−7) = 0` answered `x = 1, 2, 3` is the case
that made this explicit. Every value checks out. The equation is degree 8. Five
roots go unmentioned — and the badge read "Verified by 7Solve", because
substitution alone was enough to reach `checked`.

Substitution of claimed roots is therefore marked `needsComplete: true`. It
remains in the receipt as evidence; it no longer carries authority on its own.

## What may produce `checked`

`checked` requires **at least one passing PROOF-level check that is not
evidence-only**, and no failing answer-level check. Concretely:

```
completeProved = some passing check has kind 'roots'
evidenceOnly   = passing proofs exist, completeness was NOT proved,
                 and every passing proof is flagged needsComplete
checked        = proofs passed AND NOT evidenceOnly
```

Checks that may certify on their own: `roots`, `deriv`, `integral`,
`system`, `identity`, `primality`, `units`, `arith`, `question`,
`integrity`, `contradiction`, `trace`, `truncated`, and the multivariable
branch of `subst` (a claimed tuple answers "find a solution", not "find all").

Checks that may never certify alone: the single-variable root branch of
`subst`. Tier-3 advisory checks (`agree`) never certify at all.

**Consequence, accepted deliberately:** an equation whose solution set this
engine cannot establish returns `plain` even when the answer is right.
`exp(x)−1=0 → x=0`, `sqrt(x)=3 → x=9` and `1/(x−2)=1 → x=3` are all correct
and all read "unable to verify". Fewer green badges, every remaining one earned.

## Badge authority

Exactly one state may render the green badge:

| State | Class | Text |
|---|---|---|
| `checked` | `verif` | ✓ Verified by 7Solve |
| `disputed` | `verif disputed` | ✗ Verification failed |
| `stepfail` | `verif unchecked` | ⚠ A step does not hold |
| `invalid_question` | `verif unchecked` | ⚠ This question has no answer |
| `partial` / `worked` / `explained` / `plain` | `verif unchecked` | ⚠ … |

The badge names its authority — "by 7Solve" — precisely because an AI answer
writes the word "verified" about itself. `checkBadgeContract()` and
`checkVerificationAuthority()` fail the build if any non-`checked` state
reaches the bare `verif` class, or if a model-authored section is titled with
the certification word.

## Sampling authority

Any checker deciding equivalence by evaluation must take its points from
`samplePoints(key)`, keyed on the question **and** the claim. A fixed grid is
discoverable and therefore forgeable: that single flaw produced five separate
wrong→green vulnerabilities before it was made structural.

Exempt: checkers evaluating at the student's *own claimed values*
(`substitution`, `transformCheck`, `uniqueness`, `conditionCheck`,
`checkDivisibility`, `systemCheck`). Those points are the answer under test,
not a grid an attacker can aim at.

`checkSampling()` fails the build if a PROOF-capable checker builds its own
grid, or if a sample array is not actually assigned from `samplePoints`.

## API capability reporting

`/v1` runs 13 of the 29 checkers. Today a derivative question returns
`unverified` — the same word used when a checker ran and could not decide.
Those are different facts and a customer cannot distinguish them.

Three outcomes, not two:

| `state` | `capability` | Meaning |
|---|---|---|
| `checked` | `supported` | a checker ran and certified |
| `disputed` | `supported` | a checker ran and refuted |
| `unverified` | `supported` | a checker ran, could not establish the result |
| `unverified` | `not_supported_by_api` | **no checker for this subject exists in the API** |

`not_supported_by_api` must never be read as a pass, and must never be
confused with a checked answer. The subject list is derived from
`checks.json`, so a checker added to PHP updates the capability automatically.

## `samplePoints` — cross-language contract

PHP must reproduce the JS output **exactly**. Not approximately, not
statistically — the same doubles, in the same order, for the same key.

```
seed    FNV-1a 32-bit, offset 0x811c9dc5
        hsh ^= charCodeAt(i)
        hsh = (hsh + ((hsh<<1)+(hsh<<4)+(hsh<<7)+(hsh<<8)+(hsh<<24))) >>> 0
grid    xorshift32, st = seed || 0x9E3779B9
        st ^= st<<13 ; st ^= st>>>17 ; st ^= st<<5   (each step >>> 0)
        point = 0.35 + (st % 1000003) / 1000003 * 9.15
points  samplePoints(key) = grid(seed, 8) ++ grid(seed ^ 0x5bf03635, 8)
keys    derivative  'd|' + truth.expr + '|' + claim
        integral    'i|' + integrand + '|' + claim
        identity    'id|' + line
        polyOf      'p|' + variable + '|' + coefficients.join(',')
        system      's|' + equations.join(';') + '|' + variables.join(',')
```

Two hazards worth naming: JS `charCodeAt` is UTF-16 code units, so PHP must
walk the same units rather than bytes; and `>>> 0` is unsigned 32-bit, which
PHP must emulate with `& 0xFFFFFFFF` on a 64-bit int.

### Golden vectors are binding

`sample-vectors.json` is the **single authority** for sampling. Both engines are
tested against the file, never against each other, so a shared misreading of the
algorithm cannot cancel itself out.

**A sampling mismatch between JS and PHP is a parity FAILURE, not an acceptable
implementation difference.** There is no tolerance and no "close enough": these
numbers are hashed into a key, and a hash has no near-misses. One differing
digit in one point sends the two engines to different sample sets, and they can
then reach different verdicts on an answer they both actually agree about — the
website calling an answer verified while the API disputes it, for reasons no
one can see in the mathematics.

Concretely:

* Both `sample_seed` and `sample_points` must reproduce every vector in the
  file **exactly**, for every key, including non-ASCII keys, embedded null
  bytes and long keys.
* `parity-phase1.js` compares by strict equality (`!==`), not by epsilon. A
  test that passed on tolerance would be worthless here.
* If a vector fails, the correct response is to fix the implementation that
  drifted — never to regenerate the vectors so the suite goes green. The file
  changes only when the sampling contract changes deliberately, and such a
  change alters how every equivalence decision in the product is made.
* Any future engine (another language, a worker, a mobile port) is bound by the
  same file before it may certify anything.

Two hazards are already known to break a naive port and are covered by the
vectors: JS `charCodeAt` yields UTF-16 code units, so an implementation walking
bytes diverges on the first non-ASCII character; and `>>> 0` is an unsigned
32-bit coercion, so a 64-bit language must mask every step or the high bits
leak into the next round.
