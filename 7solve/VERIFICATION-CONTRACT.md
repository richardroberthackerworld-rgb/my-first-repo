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
engine cannot establish returns `plain` even when the answer is right. Fewer
green badges, every remaining one earned.

That consequence is now *narrower*, not weaker. `exp(x)−1=0 → x=0`,
`sqrt(x)=3 → x=9`, `ln(x)=0 → x=1`, `2^x=8 → x=3` and `x+eˣ=0 → x=−0.567` all
certify, because monotonicity establishes their solution sets — see **The
monotonicity argument** below. `1/(x−2)=1 → x=3` is still correct and still
reads "unable to verify": it has a pole, and the argument is refused rather
than stretched. The rule did not move; the set of equations the engine can
establish did.

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

---

# Phase 2 — Release A additions

Phase 1 is **frozen**. Nothing above this line changed. Everything below is
additive, and none of it may authorise a verification.

## Capability authority lives on the check KIND

`capabilities.json` is the single source of truth for what 7Solve can check.
`checks.json` and the `PROOF` set in `index.html` are **generated** from it;
`capability.php` reads it at runtime. There is no second hand-maintained copy
of any of these facts, and `tools/gate-capabilities.js` fails the build if a
generated artifact drifts from the manifest.

Each check kind declares one of three authorities:

| Authority | In `PROOF`? | Can reach `checked` |
|---|---|---|
| `proof` | yes | Yes — settles the claim on its own |
| `evidence` | yes | Only alongside a proof (the existing `evidenceOnly` rule) |
| `advisory` | no | Never |

**Authority is a property of the kind, never of the subject or the checker.**
A subject cannot grant itself certifying power by declaring it, and a new
checker inherits the authority of the kind it emits. Creating a new certifying
kind is a manifest edit that the negative-control suite immediately demands a
control for.

This exists because release `.2` shipped an identity checker that was wired,
correct and certifying in both engines while `capability.php` had no branch
that could name it — so `/v1` reported `unknown_subject` about questions it had
just verified. Four hand-kept lists, one forgotten. Gate C3 catches that
directly and C8 catches it from the other side.

## Capability states

| State | Means | Verdicts reachable |
|---|---|---|
| `supported` | A checker exists in this engine and ran | `verified` `disputed` `unverified` |
| `covered_not_verifiable` | 7Solve answers this and cannot independently check it | `unverified` **only** |
| `not_supported_by_api` | The site can check this; this API build cannot | `unverified` only |
| `unknown_subject` | The subject could not be identified | `unverified` only |

**Only `supported` can reach `checked`,** and this needs no new enforcement: a
`covered_not_verifiable` subject declares no checkers, so it emits no
proof-kind checks, so `passedProofs.length` is 0 and the frozen state machine
cannot select `checked`. Gate S2 asserts it anyway.

`covered_not_verifiable` must never be read as a pass. It is the state that
lets 7Solve answer an MBA or BA question honestly: *we can help with this, and
we cannot verify it.*

## Coverage never authorises verification

The academic taxonomy under `taxonomy/` is contributor-facing data. A taxonomy
node may **name** a problem type; it may not **invent** one. `gate-taxonomy.js`
rejects any `problem_type` that no subject in `capabilities.json` declares.

Nothing in this list can put a check kind into `PROOF`:

* AI prose
* the taxonomy
* course coverage
* extraction confidence
* `covered_not_verifiable`
* a subject existing in the manifest

Only an explicitly registered proof or evidence kind participates in
certification.

## Provenance — the ingestion trust boundary

The verifier must know **what it is looking at**. Four origins:

| Origin | Meaning |
|---|---|
| `typed` | The student wrote it |
| `extracted` | Pulled from a PDF text layer |
| `transcribed` | Read from pixels by OCR or a vision model |
| `reconstructed` | Assembled from layout analysis |

Question and answer carry **separate** records, because they routinely differ —
a student photographs a textbook question and types their own answer.

The cap (`provenance.php`, and `Prov` in `index.html`) obeys three rules, each
with a property test over all 360 origin × confidence × round-trip × state
combinations:

1. **It only lowers.** Output is the input state or `plain`.
2. **It never manufactures `disputed`.** Low confidence in the *question* says
   nothing about whether the *answer* is wrong. Claiming otherwise would be the
   same category error this contract exists to prevent, aimed at the input.
3. **It is exactly inert for `typed`.** All 965 regression cases are unchanged.

It runs strictly **outside** the Phase 1 state machine, which is not modified.

Release A ships the cap **provably inert**: no code path in this build produces
an extraction origin, because nothing transcribes a question into the verifier
yet. The contract lands before the pipeline that needs it, so the trust
boundary is never retrofitted around a live verdict path.

---

# Phase 2 — Release B: the five false negatives

Release B closes five confirmed coverage gaps and the photo-question
provenance hole. **No safety invariant was relaxed to do it.** Every fix widens
what the engine will *look at*; none widens what it will *accept*. Each carries
a negative control, and `parity-release-b.js` refuses to report success if any
fix lacks one — a positive without a control is not a fix, it is a liability.

## The declared numerical accuracy policy

`holdsAt` asks *"is the residual ~0?"*. That is the right question for an exact
root and the wrong one for a decimal. `x + eˣ = 0` has no closed form; its root
is −0.56714…, and a student who writes `x = −0.567` has given a **correct**
answer to three decimal places. The residual there is about 3e-4, so the
universal relative `1e-9` called it wrong.

**The fix is not a bigger epsilon.** A looser tolerance accepts a near-miss,
which is the exact failure the contract exists to prevent. Instead the notation
is read as what it means:

| Policy | Applies when | Test |
|---|---|---|
| **exact** | integer or exact rational claim | `holdsAt`, unchanged relative `1e-9` |
| **algebraic** | surd or symbolic claim | `holdsAt`, unchanged |
| **numeric** | decimal claim to *d* places | a root is **proved** to lie in `[v − ½·10⁻ᵈ, v + ½·10⁻ᵈ]` |

Proved, not estimated. A sign change of a continuous *f* across the interval
proves a root exists in it; a small residual is only evidence of one. **The
precision comes from the student's own notation**, so the checker never chooses
how forgiving to be.

Two guards make this safe:

* The interval test runs **only where the strict test already said no**. It can
  turn a false into a true and never the reverse, so every answer that verified
  before still verifies on exactly the same grounds.
* A **pole** also changes sign, and `1/(x−2)` has no root at 2. The interval is
  bisected to locate the crossing and `|f|` must actually collapse there —
  measured against the endpoint magnitudes, because at a pole `|f|` at the
  crossing is enormous and would excuse itself.

Boundary controls sit on both sides of the rounding interval: `−0.567` is
certified, `−0.568` and `−0.566` are disputed.

## `log` is deliberately not differentiable

In Indian textbooks `log` means log₁₀ in algebra and ln in calculus, and the
notation does not say which. Guessing would either certify a wrong answer or
dispute a right one, so a bare `log()` falls through to null and the claim gets
**no verdict** — the same rule every other checker follows when it cannot parse
its input. `log10` and `log2` are explicit and are checked; `ln` always was.

## A parity divergence this release exposed

PHP's state machine had **no `evidenceOnly` rule**. The completeness authority
shipped in release `.7` was applied to `index.html` only.

It never showed up in parity because a passing `subst` was always accompanied
by a passing `roots` on the polynomial corpus, so both engines said `checked`
for the same reason. The precision policy made substitution pass on a
*transcendental* equation, where completeness cannot run — and the divergence
appeared at once: JS declined, PHP certified.

**PHP was the one that was wrong**, and `/v1` would have certified on evidence
alone. Putting `x = −0.567` back into `x + eˣ = 0` proves that value is *a*
root; it says nothing about whether it is *the* solution set. The rule is now
in both engines, and PHP reads its certifying kinds from `capabilities.json`
rather than carrying a hand-copied list.

## The monotonicity argument

*(This section supersedes "Why a correct transcendental root is `unverified`",
which reasoned from `1 + eˣ > 0` and then said "that is a monotonicity argument
this engine does not make". It makes it now.)*

`roots` established a complete solution set by reconstructing a polynomial.
When `realRootsOf` returned null there was no completeness verdict at all, so
`evidenceOnly` refused the badge and a correct answer read "unable to verify".

A strictly monotonic function crosses zero at most once. That is a completeness
argument of the same strength as counting a polynomial's roots, and it reaches
the transcendental cases. It composes with the declared precision policy into a
proof rather than an estimate:

* monotonicity gives **at most one** root;
* a sign change across the student's own rounding interval gives **at least
  one** root inside it;
* together, **exactly one** — and it is the claimed one.

`monotoneCompleteness` therefore emits the existing `roots` kind. No new
certification authority was created: the kind that could already certify is
simply reachable by a second sound technique.

**The design is the default.** `monotone()` returns null for everything it has
not been explicitly taught. `sin`, `cos`, `tan`, `abs`, `floor`, `round`, even
powers, products of two moving factors and anything with a pole all fall
through to "cannot tell" and are refused. Over a 6,765-expression sweep it
refuses 90%.

Poles are refused as firmly as folds, and for a reason worth stating: **"at most
one root" is a claim about ONE interval.** A function with two branches can have
a root in each. So `c/f` is refused even though `1/(x−2)=1` happens to have a
single root — the engine will not reason about branches, so it declines.

`monotone-soundness.js` is what makes this safe to trust, and it must pass
before any release:

| | |
|---|---|
| 1. numeric soundness | every claimed-monotone expression is verified over a dense grid; a claim that folds anywhere fails |
| 2. connected domain | every claimed-monotone function is checked for a single interval — sampling alone cannot see this, because a gap in the samples looks like a gap in the domain |
| 3. cross-engine | the JS and PHP provers are compared expression by expression, so the badge and `/v1` cannot drift apart |
| 4. whitelist | `MONO_FN` is asserted against the function table in both engines — adding `sin` is a one-word edit that would certify `sin(x)=0` as having exactly one root |

Adding `sin` to the whitelist is caught by **numeric soundness**, not merely by
the name check: it is mathematics that refuses it, not a naming rule.

## The photo-question hole, closed

A photographed question with nothing typed reaches the verifier as the literal
placeholder `(photo question)`. Most checks find nothing to read — but
**arithmetic reads only the answer**, so a self-contained correct calculation
like `2/3 + 1/3 = 1` reached `checked` with the question never having been read.
The arithmetic really is right; the badge is not earned, because *"✓ Verified by
7Solve"* is a claim about the student's answer **to their question**.

`Prov.forQuestion()` now declares an image with no typed text for what it is: a
transcription that never happened, confidence 0. The cap declines to certify —
and only to decline. It cannot dispute, so a student is never told a correct
calculation is wrong. Typing a question alongside the photo restores `typed`.

## Caps raised together

`polyOf` was capped at degree 6, `claimedRootsOf` accepted comma-lists of at
most 4, and `substitution` refused more than 6 roots. Those three disagreed, and
the disagreement had a hole in it: an answer listing 7+ roots with one of them
**wrong** got no verdict from anyone — completeness bails when a claimed value
is not a root, and substitution refused to run at all. All three are now 12,
chosen by arithmetic: reconstruction samples at x = 0…13, and 13¹² ≈ 2.3e13 is
inside the range where a double still represents every integer exactly.

## The answer-format contract

`buildSystemPrompt()` tells the model to head its sections `## ✅`, `## 📖`,
`## 🎯`, and to bold the answer. Every checker then finds the answer through
exactly those markers — `claimZone()` reads `withHead(md,'✅')` and
`withHead(md,'🎯')`, `hasSteps` tests for `## 📖` or `## 📝`, and
`claimedRootsOf` strips the `**` the prompt asks for.

Nothing enforced that. Every suite in this repo supplies its own answer text,
so an edit to the prompt's emoji would leave all of them green while live
answers stopped matching and every student saw "unable to verify" on correct
work. The engine would be intact; the pipe into it would be cut.

`tools/gate-answer-format.js` reads the section markers **out of the prompt**,
composes answers in exactly that shape, and runs them through the shipping
`Verify.run`. Correct answers must reach `checked` and wrong ones `disputed` —
the second half matters, or the gate would prove only that the engine reads
headings. Because the fixtures are built from the prompt rather than typed
into the test, a prompt that drifts drifts the fixtures with it and the
verdicts collapse.

This covers the format half of the model→engine link. The transport half —
`getAnswer` actually returning text — remains untested here, because it sits
behind `aiGate()` and needs a signed-in account with credits.

