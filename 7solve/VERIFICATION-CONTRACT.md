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

**Tightened 2026-08-23, from a real production answer.** The rule read:

```js
passedProofs.every(function(c){ return c.needsComplete === true; })
```

so certification was blocked only when **every** passed proof needed
completeness. A worked answer to `1/(x−2) = 1` also produces passing `arith`
and `integrity` checks, and those do not need completeness — so they defeated
the guard and the answer came back `checked`, on an equation whose solution set
the engine explicitly declines to establish because a pole splits the domain.

A bare `## ✅ x = 3` was always refused. Adding correct working is what bought
the badge, which is precisely backwards.

"Your arithmetic is right" and "the value satisfies the equation" are not a
completeness proof, and neither is "the question is well formed". The rule is
now `some`: **if any passed proof needed completeness and completeness was not
established, nothing certifies.** All 971 parity cases still pass, so this
withdrew no badge that was previously earned — it only closed the hole.

`parity.js` pins it as *F pole, worked answer*, and that fixture must keep its
worked steps: the bare-answer version never exercised the bug.

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
`system`, `identity`, `primality`, `units`, `arith`, `chem`, `bound`,
`divis`, `unique`, `condition`, `extremum`, `transform`, `claim`, and the
multivariable branch of `subst` (a claimed tuple answers "find a solution",
not "find all").

Checks that may never certify alone: the single-variable root branch of
`subst`; the **corroborating** kinds below. Tier-3 advisory checks (`agree`)
never certify at all.

### Corroborating is not certifying

Added 2026-08-23, from a real production answer. `question`, `integrity`,
`contradiction`, `trace` and `truncated` used to certify on their own. They
must not, because what a *pass* means for each of them is **"nothing wrong
found here"**, never "the answer is established":

| kind | a PASS proves |
|---|---|
| `integrity` | the answer discusses the same relation as the question |
| `question` | the question itself is well posed |
| `truncated` | the answer is finished, not cut off |
| `trace` | the working reaches the answer it claims |
| `contradiction` | the answer does not contradict its own working |

Every one of those is true of a completely wrong answer. The case that proved
it: a model answered `x + eˣ = 0` with **"no real solution"**, which is false —
the root is −0.567143, and the same model found it on another attempt. Nothing
in that answer could be checked except `integrity`, which passed. The badge read
**✓ Verified by 7Solve** on a mathematically false claim.

They are now `authority: "corroborating"` in `capabilities.json`, emitted into
`index.html` as `PROOF[kind] === 2` and read in PHP through
`Capability::corroboratingKinds()`. **The set is not written by hand in either
engine** — a hand-written list is the fourth copy Release A removed.

They keep their full power to **dispute**: a failing `integrity` still makes an
answer `disputed`. Only the ability to certify alone was withdrawn.

`parity.js` pins both halves — *I corroborating alone* (must not certify) and
the mismatched-restatement case (must still dispute).

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

**Corrected 2026-08-23.** This section first said an edit to the prompt's
emoji would leave every suite green while students silently stopped getting
badges. That was wrong. `claimZone` falls back to `String(md).slice(0, 400)`
when no heading matches, so the engine verifies an answer with **no headings
at all**, with prose only, and with a completely alien format; breaking
`claimZone` outright moves no verdicts. Format drift is survivable by design.

The real exposure is a **window**, not a format. An answer whose value sits
past the first 400 characters with no recognised `✅` or `🎯` heading returns
`plain` — correct, unbadged. That is what the headings are actually for: they
rescue exactly the case the fallback cannot reach. The live format opens with
`## 📌 Understood as` before the answer, so the margin is real but not large.
Lengthen that preamble, move the answer below Method and Verification, and
lose heading recognition, and badges go.

`tools/gate-answer-format.js` reads the section markers **out of the prompt**,
composes answers in exactly that shape, and runs them through the shipping
`Verify.run`. Correct answers must reach `checked` and wrong ones `disputed` —
the second half matters, or the gate would prove only that the engine reads
headings. It then pins two further things: the shape production **actually**
sends, and both sides of the fallback window.

**The transport half is now closed.** A real signed-in answer from production
on 2026-08-23 was put through both engines and reached `checked`
(`integrity+, subst+, roots+, trace+`), so model → text → verifier → badge is
proven end to end rather than by inspection.

That capture also showed the model does **not** answer in the shape the prompt
asks for:

| prompt instructs | production sent |
|---|---|
| `## ✅ Final Answer` | `## ✅ Answer` |
| `## 📖 Step-by-Step Solution` | `## 📝 Steps` |
| `## 🧭 Method`, `## 🔍 Verification` | absent |
| — | `## 📌 Understood as`, leading |

It verifies because the readers key on the **emoji**, not the heading words,
and `hasSteps` accepts `📝` alongside `📖`. Testing only the prompt's template
would have left the shape students actually receive unguarded, so that exact
answer is now a fixture.

---

# Phase 3 — ingestion, domain, and what "all solutions" may mean

Added 2026-08-23 after a student pasted a rendered equation into the box.

## The clipboard is part of the verifier

`x² + xy + y² = 3^(x+y)` copied off a rendered page arrives as `text/plain`
in seven stacked lines:

```
x
2
+xy+y
2
=3
x+y
.
```

which reads as `x·2 + xy + y·2 = 3x + y`. **A different problem.** The reported
"the solver changed the equation" was not the solver: the equation was already
wrong when it reached the box, and every check downstream agreed with it,
because `integrity` compares the answer against the QUESTION and the question
itself was corrupt.

No verifier can recover from this. `MathPaste` in `index.html` reads the
clipboard's HTML flavour first (LaTeX in `<annotation encoding="…x-tex">`,
then MathML, then `<sup>`/`<sub>`), and falls back to a stacked-lines reader
that fires only on that exact shape. `solve()` runs the same reader again,
because OCR, a shared `?q=` link and the example chips never pass through a
paste event. **Every repair is announced with the reading it produced**, in the
box, where a student can edit it. A guess nobody can see is the same failure as
the shredding.

## Two new answer-level kinds

| kind | meaning | engines |
|---|---|---|
| `domain` | a claimed value satisfies the equation but not the domain the question set | both |
| `exhaust` | the solution set is complete over a region **proved** to contain every solution | both |
| `sequence` | a named sequence really does satisfy the recurrence and indexing claimed | both |
| `direction` | advisory: a one-directional step was used and no candidate was substituted back | JS only |

`domain` reads positive / non-negative / integer / prime / distinct, and an
ordering between two variables. One reader — `domainBreak` — judges the
answer's claims AND filters the engine's own enumeration and sweeps, because
two readers would let the engine demand a solution its own rules reject.

## "Found" and "proven complete" are different states

Substitution proves a value genuine. It cannot prove there are no others. For a
question that asks for **all** solutions, passing substitutions alone therefore
carry `needsComplete` and cannot reach `checked` — the browser shows
`worked`/`plain`, `/v1` shows `unverified`, and the receipt still says the
values were checked. This already held for the single-variable root branch; it
now holds for multi-variable tuples too, which is where three verified pairs of
`x² + y² + 1 = 3xy` used to earn a green badge on an equation with infinitely
many solutions.

Only `roots` or `exhaust` discharge the flag. **Nothing else may**, and in
particular a bounded search that found no more is not a proof that there are no
more.

## The one bound the engine can prove

`exhaust` fires only for `P(x₁…x_k) = c^L`, with `P` a polynomial, `c ≥ 2`
an integer, `L` a linear form with every coefficient ≥ 1, over integers bounded
below. With `s = Σxᵢ`, `M = Σ|coefficients of P|` and `d = deg P`:

```
|P|  ≤ M·s^d     every xᵢ ≤ s, so every monomial ∏xᵢ^eᵢ ≤ s^(Σeᵢ) ≤ s^d for s ≥ 1
c^L  ≥ c^s       every coefficient of L is ≥ 1
```

and `c^s > M·s^d` for every `s ≥ S₀` **by induction**, not by asymptotics:

```
base   c^S₀ > M·S₀^d
step   (s+1)^d ≤ c·s^d for s ≥ s₁, hence c^(s+1) = c·c^s > c·M·s^d ≥ M·(s+1)^d
```

Both are decided in exact integers — `BigInt` in the browser, a small
decimal-limb `Bignum` in PHP, because `bcmath` cannot be assumed on a shared
host and `c^s` overflows a float long before `S₀` is reached. Every solution
then has `s < S₀`, a finite region, which is enumerated whole. Outside that
family the checker emits **nothing**.

`adversarial.js` re-derives both halves of that induction in exact integers
itself, rather than trusting the code that produced them.

## Descent is not a magic word

`PROOF_RE` accepts "vieta" and "descent" as evidence that an argument is
present, and for every other technique on that list the word comes with the
argument. Descent is the exception: *"by Vieta jumping, all solutions follow"*
is a complete sentence that says nothing. Where descent is the ONLY argument
named, the answer must also show that the second root is an integer, that it is
smaller under the ordering used, and that the descent terminates. Naming none of
them fails the `claim` check.

## The third harness

```
node parity.js            do the two engines agree
node negative-control.js  is every checker actually wired
node adversarial.js       IS THE VERDICT RIGHT
```

The first two can both be green while the product is wrong, and were. Every
case in `adversarial.js` is an attack, and every family carries a control — an
honest answer of the same shape that must survive untouched, because a checker
that disputes everything passes an attack suite perfectly.

**A known limit of negative-control.** It reports a JS-only checker as
load-bearing, but it reaches that verdict through parity's registry-conformance
check, which proves the wiring LINE is present rather than that the checker does
anything. `PARITY_NO_REGISTRY=1` no longer disables that check — it only
removes it from the case count — so the comment in `negative-control.js` that
says conformance is off is stale. JS-only checkers are therefore pinned by
direct assertion in `adversarial.js` instead.

---

# Phase 4 — the ingestion invariant, counterexamples, two more completeness routes

## The invariant, stated once

> **original problem ≡ parsed problem ≡ solved problem**

Held by `Ingest.read()` in `index.html`, **before** the model is asked and
before `Detect` reads anything, because a wrong reading of the question is the
one error no later check can catch — every later check compares the answer
against the question, so a corrupt question is one the answer agrees with.

Three outcomes:

| | meaning |
|---|---|
| CLEAN | the text is what the student meant; solve it |
| REPAIRED | recoverable — stacked exponents, LaTeX — so it is repaired, the reading is **shown in the box**, then solved |
| FATAL | it cannot be read with confidence. **Stop.** Say what is unreadable and ask |

FATAL is the point. An engine that always produces an answer will, on a bad
transcription, produce a confident answer to a question nobody asked, and a
student will write it in an exam. Today FATAL means an `[unclear]` /
`[illegible]` / `???` marker left by a transcriber, or brackets that do not
close in text that is mathematical. Prose is not judged for brackets.

The reading is rendered into `#qRead` under the composer — one line, silent
when the reading is exactly what was typed, red when it is a refusal.

## A photo is read before it is solved, not while

A photo used to go straight to the model with *"read the question in the
attached photo and solve it fully"*. Transcription and solution happened in one
invisible step, so when the transcription was wrong the student never saw the
question that was answered — **and neither did the verifier**, which was handed
the empty typed box, so `integrity` had nothing to compare and every check that
needs the question went quiet. A misread photo produced a confident answer with
no badge to warn of it.

The pipeline is now split, which is what makes each stage checkable:

```
photo → transcribe → reconstruct → confidence → SHOW → solve
```

The transcription lands in the confirm box that already existed; the difference
is that it is no longer opt-in. It costs one extra model call per photo. The
confirm button **declines** while an `[unclear]` marker is still in the text —
filling that gap is the one thing only the student can do.

## The counterexample engine

`counter`, in both engines. A universal claim is refuted by one value, which is
the cheapest decisive mathematics there is, and nothing looked. An answer could
assert *"n² + n + 41 is prime for all n"* — Euler's polynomial, prime for
n = 0…39 and composite at 40 — and no check would open it.

Three shapes: a primality asserted for every n, a sign or parity asserted
always, and an inequality asserted for every value.

**It can only ever FAIL.** Searching a range and finding nothing is not a proof,
and this must never turn "I looked" into "it is true" — the exact confusion the
completeness gate exists to stop. A clean search emits nothing and the claim is
left to `unproved`, which asks whether an *argument* was given.

Silent on purpose: a sentence that already denies or qualifies the claim,
trigonometry, equalities (`identityCheck` reads those), and anything that does
not parse. A near-zero value is not a counterexample: `e^x is always positive`
is true, and a plain `> 0` test on a float calls `e^−50 = 2·10⁻²²` "not
positive". The sign tests carry the same margin the inequality shape does, and
inside it the point is **undecidable**, not false.

## Two more ways to prove a solution set complete

`exhaust` had one route. It now has three, tried in this order:

1. **A modular obstruction.** If L(x) − R(x) is never ≡ 0 (mod m) for *any*
   residue tuple, it is never 0 over the integers, so there are no integer
   solutions at all — a finite exhaustive sweep, not a search, and the only
   route that works over the unbounded integers. `x² − 3y² = 2` is the standard
   case: squares are 0 or 1 mod 3. The sweep is exhaustive over (ℤ/m)^k, so the
   cap is on m — 200 for one variable, 60 for two, 24 for three.
2. **The growth lemma** (Phase 3), for the P = c^L family.
3. **A bound the question itself stated** — "find all n with 1 ≤ n ≤ 100" hands
   over the finite region, so enumerating it *is* the proof. **One variable
   only**: "x ≤ 100" in a two-variable question might bound one variable or
   both, and guessing the generous way means missing a solution and then calling
   the list complete, which is the worst failure this module can produce.

Finding no route means the checker says **nothing** about completeness. A Pell
equation still returns `unverified`, correctly.
---

# Phase 5 — the machine calculates, the chain is walked, the PDF is read

## `Calc` — arithmetic is not a language task

> the model reasons; the machine calculates.

7Solve already carried an exact parser, an exact root finder, a symbolic
differentiator and a primality test, and used every one of them **only to mark
the model's homework**. The model was still doing the arithmetic. Asking a
language model for 17 × 23 + 45 is strictly worse than computing it, because
the answer is decidable and guessing at a decidable thing is never justified.

So before the question is sent, everything in it that can be settled exactly is
settled exactly, and the values go into the prompt as given facts under a block
the model is told not to recompute. Today that covers: closed numeric
expressions written in prose, the exact real roots of the question's own
equation (including *no real solutions*), gcd/lcm, primality, and the symbolic
derivative. Nothing is a guess — every fact comes from the same engine that
checks the answer afterwards, so the prompt and the verifier can never disagree.

**Algebra contributes no arithmetic facts.** `Solve x² − 5x + 6 = 0` contains
the run "2 − 5", and offering "2 − 5 = −3" as a computed fact would hand the
model a true statement about nothing and invite it to use the number. A sentence
carrying an algebra signature — a variable with a power, a coefficient stuck to
a letter — is skipped entirely; its **roots** are the fact worth having.

## The second arithmetic pass

`evalFlat` reads digits and four operators, deliberately, so that it can never
guess. The cost was that everything else went unchecked: `2^10 = 1024`,
`√144 = 12`, `(3+4)² = 49`, `3/4 + 1/8 = 7/8` and `15% of 200 = 30` were all
invisible — and a model gets those wrong far more often than it gets 12 × 3
wrong.

`closedForm` turns the exact algebra parser on any line whose two sides are both
**closed numeric expressions**. A variable surviving on either side means it is
algebra and the pass says nothing. It only reads lines `evalFlat` could not have
read — one carrying a power, a root, a bracket, a superscript or a percentage —
so nothing is ever reported twice under two names. The percent rewrite is for
the parser; the receipt shows the line the student actually wrote.

## `step` — the derivation chain

Every other checker judges the answer. This one walks the working and asks, at
each line: does this follow from the one before it?

```
2x² = 6x
2x  = 6      ← divided by x
x   = 3
```

Every line after the division is true. `x = 3` substitutes back perfectly, so
`subst` passes it, and **x = 0 has silently disappeared**. The step that lost it
is step 2, and nothing said so.

Consecutive equations are compared by **solution set**, not by text. A step may
legitimately GAIN solutions — squaring does, and `direction` speaks to that —
but may never LOSE one. The first line where a root disappears is the first line
that is wrong; the rest are downstream of it, so only the first is reported.

Declines: more than one variable, residuals whose roots cannot be found exactly,
a root outside the domain the question set (it was never a solution to lose), a
root the answer states somewhere (the working split a case), and bare
`x = 3` answer statements — those are `solutionCompleteness`'s verdict under a
name that already exists.

**Corroborating, never certifying.** A flawless derivation of the wrong thing is
still wrong.

## Backtracking, not carrying on

Re-solving used to be triggered only by a **disputed answer**. A derivation that
loses a root on line two and then reaches a value that substitutes back
perfectly is corrupted reasoning with a correct-looking conclusion — and it
teaches the method that produced it. `stepfail` now sends the question back too,
with the step named.

The re-solve also picks its winner by **rank** now
(`checked` < unverified < `stepfail` < `disputed`, then fewer failures) instead
of by "did the second attempt avoid being disputed" — which could accept an
outright disputed second answer after a step-level retry.

## A fourth completeness route: the equation bounds its own variables

`ax + by = c`, `x² + y² = 25`, `xy = 12`, `x + 2y + 3z = 20` — most of what a
school Diophantine question actually looks like. None needs a growth lemma or a
stated range, because the equation already pins every variable.

Write it as `P(x) = C` with every coefficient of `P` positive and `C > 0`, over
integers `xᵢ ≥ 1`. Every term is then positive, so each term is at most the whole
sum; and since every `xⱼ ≥ 1`, dropping the other factors only makes it smaller:

```
a·xᵢ^eᵢ ≤ a·∏xⱼ^eⱼ ≤ C     so    xᵢ ≤ (C/a)^(1/eᵢ)
```

taking the smallest such bound over the monomials containing `xᵢ`. A finite box,
proved rather than assumed, then enumerated whole.

`xᵢ ≥ 1` is load-bearing, which is why a **non-negative** domain is declined:
with `xⱼ = 0` allowed, `xy = 12` puts no bound on `x` at all.

## A PDF that holds a question goes to the solver

The PDF tab sent everything to the chapter reader, so a student with a PDF of
one question was handed a study tool and left to copy the question out by hand.
The split is by length, because that is what actually distinguishes a chapter
from a worksheet, and the short branch goes through exactly the gate a photo
does: read it, reconstruct the mathematics, show it, and only then solve.

## Steps the student can follow

The prompt now specifies what a step *is*: (a) what you are about to do and why
that is the right move here, (b) the line of mathematics in full, (c) the
result. A step showing only (b) is a step a stuck student cannot follow, because
(a) is the thing they are stuck on. Plus: split a line that changes more than
one thing; carry the state forward so no value appears from nowhere; and say
what you divided by, because that is where solutions get lost.

## An operational note

`negative-control.js` rewrites `index.html` 34 times. On Windows that fails with
`UNKNOWN (errno -4094)` if the preview dev server is holding the file. **Stop the
preview before running it.** It leaves `.negative-control-restore.json` behind
when it dies; the next run restores from it, and the files were byte-identical to
the sidecar when this happened, so nothing was lost.
---

# Phase 6 — units, with magnitude

`Units`/`units.php` answers one question: **is the answer the right KIND of
thing?** It knows km and m are both lengths and deliberately knows nothing
about how many of one make the other. That is correct for what it does, and
blind to the two errors a physics answer actually makes:

```
60 km/h = 21 m/s              a conversion done wrong
F = 5 kg × 2 m/s² = 10 J      units that do not follow from the working
```

Both are silent. Both are decidable. Neither was checked.

## The quantity engine

`Q_UNITS` / `Qty` carries **magnitude as well as dimension**: every unit knows
its factor to SI, and temperature knows its **offset**, because 25 °C is not
25 × something K and treating it as one is its own classic error.

Everything goes to SI, **dimension is compared first and magnitude second**, and
the tolerance for the magnitude comes from the decimals the student wrote —
`60 km/h = 16.67 m/s` is right to the two places it claims, and failing it would
be pedantry rather than verification.

It refuses: a unit it does not know; more than one slash without brackets; an
offset scale inside a product (25 °C × 2 is not a temperature); and any line
where only one side carries a unit, because that is a definition, not a
calculation.

Two parsing rules earn their place:

- **A slash is division only when it is spaced.** `m/s` is one unit and
  `120 km / 2 h` is a division. Splitting on every slash tore `5 kg × 2 m/s²`
  into pieces and the flagship case of the whole checker went silent.
- **The unit must consume the whole segment.** `0.5 mol / 2 L` read as *0.5 mol*
  with `/ 2 L` quietly dropped turns a concentration into an amount. A reader
  that discards what it did not understand is a reader that invents quantities.

**Scientific notation is one number.** `3.0 × 10^8` is normalised before
anything else looks at the line — its `×` is not a multiplication, and reading
it as one turns the speed of light into 3 metres times a hundred million.

## Why there are two unit tables, and what stops them drifting

`Units::DIM` is a **published contract** — `/v1` has returned its verdicts for
months — and it stores dimension only, over five base quantities. `Q_UNITS`
stores dimension, factor and offset over **six**, because amount of substance is
a base quantity and concentration cannot be expressed without it. Widening the
frozen table would change a shipped API for a new checker's benefit.

So the duplication is made safe by **two invariants in `adversarial.js`** rather
than by trust:

1. every unit named in **both** tables must agree about its dimension;
2. every **prefixed** unit must agree with its base about dimension *and*
   factor — kJ is a thousand J and nothing else. A table of eighty units written
   by hand will contain a typo, and a wrong factor here is a wrong verdict on a
   student's physics.

   (`min` is excluded by name: it is a minute, not a milli-inch. It is the only
   name in the table where the prefix reading is a coincidence.)

## A pre-existing false positive this exposed

`answerUnit` took the **first** number-with-a-unit in the claim zone. That was
right while answers were written `a = 25 N`, and wrong the moment one showed its
working on the same line: `F = 5 kg × 2 m/s² = 10 N` was read as **5 kg**, a
mass, and a correct force answer was disputed for being a mass. The answer is
what follows the **last** equals sign. Fixed in both engines.

## Significant figures

`sigfig`, **advisory**. An answer quoted to nine figures from data measured to
one is not wrong, it is over-claimed, and it costs marks in every board exam in
the country. It is also the one check here that depends on how the *question*
was written rather than on mathematics, so it belongs in the receipt and must
never touch the badge.

Conservative by construction: it reads only numbers that **carry units** — a
coefficient in an equation is not a measurement — and needs three more figures
than the data before it says anything. Trailing zeros after a decimal point are
significant (2.40 is three figures) and before one are not (2400 does not say
whether the hundreds were measured); getting that backwards would make the whole
check nonsense.
## The fifth completeness route, and the first that reaches an infinite set

Every route above works the same way: find a region, prove it holds every
solution, enumerate it. A growth bound, a modular obstruction, a
positive-coefficient box, a range the question stated. That is the whole
toolkit, and none of it can touch a question whose solution set is infinite:

    x² + y² + z² = xyz          infinitely many triples
    x² + y² = k(xy + 1)         an infinite ladder
    x² − Dy² = 1                infinitely many, by Pell

So for those the engine could only REFUTE — find one solution the answer left
out — and never certify. `descent` and `pell` are the two routes that can.

### `descent`

Applies when the equation is quadratic in each variable, carries a genuine
cross term, is symmetric under swapping variables, and the domain is the
positive integers. Two or three variables.

1. Fixing all but one variable leaves `A·xᵢ² + B·xᵢ + C = 0`. A solution is one
   root; the other is the Vieta partner, an integer when `A = ±1`. It is
   computed and then substituted back — verified, not assumed.
2. Jump whichever coordinate the jump lowers. Positive integers cannot fall
   forever, so every solution descends to a TERMINAL: one no jump lowers. This
   is well-ordering, not a search.
3. Order `x₁ ≤ … ≤ x_k`. At a terminal the largest is the SMALLER root of its
   own quadratic, and an upward parabola is non-negative at or left of its
   smaller root, so `P(x₁, …, x_{k−1}, x_{k−1}) ≥ 0`. The other way to be
   terminal is for the partner to leave the domain, and since `xₖ·xₖ' = C`
   that means `C ≤ 0`. Both regions are bounded by the sign of a leading
   coefficient.
4. The solution set is the union of the orbits of the terminals.

Step 3 has a gap the code closes explicitly. The bound `F(x) < 0` only confines
`x` where the leading coefficient of `Q(x, ·)` in `y` is negative; where it is
not, the strip is unbounded and `F` says nothing about it. Those strips are
closed separately, by showing the discriminant of `P` in the last variable is
negative for every `y ≥ x` — recovered exactly by finite differences, then
bounded the same way. **If any strip cannot be closed, the checker returns
nothing at all.** It never reports an unproved box as a proof.

For `x² + y² + z² = xyz`: `F(x) = 3x² − x³` is negative beyond `x = 3`, the
strips `x = 1` and `x = 2` have negative discriminant, and `(3,3,3)` is the
only terminal. So the solution set is exactly its orbit — and `(3,3,3) is the
only triple` is wrong in one nameable way: it is where the descent STOPS, not
what the descent CLASSIFIES.

`x² + y² − 5xy = 25` has three terminals, `(1,8)`, `(3,16)` and `(5,25)`. An
answer that jumps from one of them is correct in every line and has a third of
the solutions. That is the case nothing else here could see.

### `pell`

`x² − Dy² = N` has no cross term, so the partner of `x` is `−x` and `descent`
declines it by design. Its families come from the fundamental unit of
`x² − Dy² = 1`, taken from the continued fraction of `√D`. Every class has a
representative with

    0 ≤ y ≤ y₁√N / √(2(x₁+1))       for N > 0
    0 ≤ y ≤ y₁√(−N) / √(2(x₁−1))    for N < 0

(Nagell), so searching that range and taking each representative together with
its conjugate `(x, −y)` gives every ladder there is. The conjugate is
load-bearing: `x² − 2y² = 7` splits into `3,13,75,437…` and `5,27,157,915…`,
and the second is reached only by climbing from `(3,−1)`.

Both engines decline above 3·10⁷ so every product stays an exact integer in
PHP as well as in JavaScript. `x² − 61y² = 1` has a fundamental solution of
1766319049; an engine that quietly lost precision there would be worse than
one that says nothing.

### What they may and may not decide

`descent` and `pell` join `roots` and `exhaust` as the kinds that can discharge
the completeness flag, and they are the only two that reach an infinite set. A
bounded search still may not: both return nothing unless the region came out of
the leading-coefficient argument and every open strip was closed.

When either certifies, two weaker findings are superseded, because under those
conditions they are not merely redundant but wrong:

* the `claim` complaint that a descent was named without its obligations — the
  engine supplied them, computed rather than read. It survives as an advisory
  `method` note, so the student is still told the lines are missing; it just no
  longer decides the badge.
* a failing `exhaust` witness. Its generative rule is textual: a solution below
  the answer's largest listed value is treated as a hole. Against "every
  solution is obtained from (3,3,3) by the jumps … (6,15,87)" it offered
  `(3,15,39)`, which is in that orbit. If the classification is proved, every
  witness a bounded search finds is a member of the set.

Neither supersession fires unless `descent` or `pell` came back `ok`.

## Superscripts that are not digits

`x²` and `x⁴` parse. `2ⁿ⁺¹`, `3ˣ⁺ʸ` and `10⁻³` never did — superscript letters
and the superscript plus and minus were not decoded anywhere, so the equation
was dropped entirely: no integrity check, no substitution, no completeness, and
nothing on the page saying the question had not been read.

Decoded in `deLatex`, which exists in both engines, rather than in the paste
handler — a shared link, an OCR read and the API all reach the tokeniser
without passing the clipboard, and `/v1` has no clipboard at all. Digit-only
runs are left exactly as written: they parse already, and rewriting `x²` as
`x^(2)` would change text the student is looking at for no gain.

The decoder is nested INSIDE `deLatex` on purpose. The harnesses cut that
function out of the file by its own boundaries to run it in a sandbox, so a
sibling helper would not be there and the tests would pass against a `deLatex`
that never decoded anything.

## The paste that cannot be repaired, only reported

`x2 + xy + y2 = 3x+y` has no structure left to recover from. It could be
`x² + xy + y² = 3^(x+y)`; it could be a sequence question. Rewriting it would
invent a problem the student never set, which `MathPaste` refuses to do — so it
is reported instead, and the report is narrow: a letter followed straight by a
digit, where the SAME letter also appears on its own. Mathematics writes
coefficients in front, so a bare `x2` beside a bare `x` is a lost exponent far
more often than anything else. `a1 + a2 + a3 = 6` does not trip it, because `a`
never appears alone.

The clipboard BUTTON also went through none of this. `Ctrl+V` read through
`MathPaste`; the button assigned the clipboard straight to the box — same
clipboard, two different questions depending on which the student used, and the
button is the one on the screen. Both routes read the same way now.
