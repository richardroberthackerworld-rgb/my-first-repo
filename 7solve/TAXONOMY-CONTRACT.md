# 7Solve — Academic Taxonomy Contract

*Schema `7solve.taxonomy/1` · Phase 2 Release A · baseline build 2026-08-20.2*

This file is for anyone adding a course, a branch, a subject or a topic to
7Solve — us, future developers, trusted contributors, or an import pipeline.

**Adding academic coverage is a data operation. It must never require a code
change.** If you find yourself editing `index.html` to add a subject, stop:
either the schema is missing something (say so) or the change belongs
somewhere else.

---

## The one rule that matters

> **Coverage is not capability.**
>
> Listing a course, subject or topic here says 7Solve will *help* with it.
> It says nothing about whether 7Solve can *independently verify* an answer.
> Nothing you write in this directory can grant a verification capability.

That is enforced, not requested. `tools/gate-taxonomy.js` fails the build if a
node names a `problem_type` that no subject in `capabilities.json` declares.
The worst a taxonomy contributor can do is name something that does not exist,
and the build stops.

Whether a problem type can be certified is decided in `capabilities.json`, and
authority there lives on the *check kind* — so a subject cannot grant itself
certifying power either. See `VERIFICATION-CONTRACT.md`.

---

## Shape

Every tier is the same record with a different `kind`. There is one node table,
not nine nested schemas, because syllabi genuinely differ in depth: school has
no program or branch tier, polytechnic has semesters but no years, BCA has no
branch at all. A rigid tier list would force empty placeholder nodes, and
placeholder nodes are how a taxonomy starts lying.

```json
{
  "schema":  "7solve.taxonomy/1",
  "version": "2026-08-21",
  "source":  "7solve-core",
  "nodes": [
    { "id": "in.ug.btech",
      "kind": "program",
      "parent": "in.ug",
      "label": "B.Tech / BE",
      "aliases": ["b.tech", "btech", "be", "bachelor of engineering"],
      "match": ["\\bb\\.?\\s?tech\\b", "\\bb\\.?e\\.?\\b"] }
  ]
}
```

### Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Globally unique, dotted, stable **forever** — it is referenced from `capabilities.json` and will be referenced from saved student work. Renaming one is a breaking change. |
| `kind` | yes | One of `country` `level` `program` `branch` `year` `semester` `class` `subject` `unit` `topic` `exam`. |
| `parent` | yes (`null` only at the root) | Must resolve to another node. Cycles are rejected. |
| `label` | yes | What a student sees. |
| `aliases` | no | Other names for **this same thing**. |
| `match` | no | Regex patterns for detecting this node in question text. |
| `problem_types` | no | Only on `subject`, `unit` or `topic`. Must already exist in `capabilities.json`. |

### Shard header

`schema` is the format contract — the loader refuses a major version it does
not implement. `version` is the content date of the shard. `source` is
provenance: `7solve-core` ships in the package; anything contributed or
imported carries its own origin, so a bad import can be identified and pulled
without touching the rest.

---

## Aliases

One canonical node, many spellings. **B.Tech**, **BE** and **Bachelor of
Engineering** are three aliases on `in.ug.btech`, not three definitions. Adding
a fourth spelling is a one-line data edit that no code has to know about.

Aliases are for *the same thing under another name*. They are not for related
things, abbreviations of child nodes, or search keywords. If two names should
resolve to different syllabi, they are different nodes.

---

## Adding a course — the whole procedure

1. Pick the shard, or add one under `taxonomy/<country>/` and list it in
   `taxonomy/index.json`.
2. Add nodes down to the depth you actually know. Stopping at `subject` is
   fine; inventing units you have not checked is not.
3. Put `problem_types` on topics **only where a problem type already exists**.
   If the right one does not exist yet, leave it off — an absent problem type
   reports honestly as unknown, while a wrong one misroutes a student.
4. Run the gate:

```bash
node tools/gate-taxonomy.js
```

5. If the topic needs a problem type that does not exist, that is a
   `capabilities.json` change and a separate conversation — it is the file that
   decides what may be certified, and every addition there needs a checker and a
   negative control.

---

## What Release A ships

A **representative** seed set, chosen for structural variety rather than volume:
114 nodes proving the model bends the right ways.

| Program | What it proves |
|---|---|
| School (6, 9, 10, 11, 12) | No program or branch tier — subject sits under a class |
| Diploma / Polytechnic | Branch but no year; semester-first |
| B.Tech / BE | Full depth; alias-heavy; three branches |
| M.Tech / ME | PG reusing UG branch labels — the id-collision case |
| BCA / MCA | No branch tier at all |
| B.Sc / M.Sc | Branch-as-specialisation |
| B.Com / M.Com | Band B — checkable numerics in a non-maths subject |
| BBA / MBA | **Band D** — exercises `covered_not_verifiable` |
| BA / MA | **Band D** — humanities, plus economics as the mixed case |

The Indian universe is deliberately **not** enumerated here. The point of
Release A is proving that enumerating it later is data entry.

---

## Verifiability bands

Useful when deciding whether a topic should carry a problem type at all.

| Band | Example subjects | Verifiable? |
|---|---|---|
| **A — decidable** | Algebra, calculus, linear systems, number theory | Yes, by proof |
| **B — checkable core** | Physics dimensions, stoichiometry, circuits, accounting balance, TVM | Yes, on the numeric core |
| **C — partially** | Code, SQL, proofs | Evidence only |
| **D — not checkable** | Essays, law, management, literature, history | No — `covered_not_verifiable` |

Band D is not a failure. It is the honest half of the product, and it is the
reason the badge means something in bands A and B.

---

## Internationalisation

The country tier exists and is exercised (`in`). Adding `us`, `gb` or any other
country is new shards under `taxonomy/<country>/` plus an index entry — no
schema change and no code change. It has not been done yet only because nobody
has asked for it; the tier is there so that when they do, it is data.

## Who consumes this tier — and who does not

Measured 2026-08-23, because it decides what is worth building next.

`capabilityOf()` has exactly two consumers: `GET /v1/taxonomy` and
`POST /v1/classify`. **No student-facing surface reads the taxonomy at all.**
`index.html` never fetches `taxonomy/index.json`, `taxonomy.php`, or either
endpoint. The eight occurrences of the word "taxonomy" in the page are
`Checks::taxonomy`, a presentation check, and unrelated to this tier.

The honesty a student actually sees — the green badge, and the
"⚠ AI answer — not verified" line for a Band D subject — runs entirely
through `capabilities.json` → `subjectOf7` → the badge. That path does not
touch the taxonomy and does not need it.

**So adding `problem_types` to the generated shards would reach API clients
and no students.** It is not wrong; it is simply not the lever it looks like.

The surface that WOULD put this tier in front of a student is a course
picker, and a picker is ruled out by an explicit logged decision — DESIGN.md,
2026-08-16: *"remove both options completely, keep only Ask your doubt, and
say which course or which subject class or exam automatically"*. The premise
there was that an inventory task in front of someone who arrived with one
doubt is the wrong trade. That reasoning has not changed. **Do not rebuild
the picker to give this tier a consumer.** If the taxonomy is ever to reach
a student, it has to arrive through automatic detection, not a menu.

## How much of the tree can answer for itself

31 of 1,695 nodes carry `problem_types`. The other 1,664 — 98.2%, every
generated node — return capability `unknown`. That is honest, and it is also
most of the tree.

`tools/gate-taxonomy-capability.js` puts that ratio on the record and pins a
floor under it, so the tree can gain honesty and never quietly lose it:
bulk-importing another 500 courses would otherwise grow the node count while
shrinking the share that can say anything true, with every gate still green.

The same gate refuses `problem_types` inside a `legacy-*` shard. Those files
belong to `gen-legacy-taxonomy.js`, which does not emit capability, so a
hand-edit there would survive review and then be destroyed by the next
regeneration. Failing the build is kinder than losing the work.

