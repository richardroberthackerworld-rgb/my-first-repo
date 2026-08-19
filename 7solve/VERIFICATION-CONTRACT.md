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
