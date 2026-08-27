# server/specs

The intended behavior of a feature, written **before** it is implemented, then kept as the
acceptance reference.

Convention: one file per feature, `NN-feature-name.md`. The `NN` prefix is **one counter shared by
all five specs directories** — this one, [../specs/](../../specs/) at the repo root, and the other
three packages — so `SPEC-07` identifies one spec repo-wide and a `Supersedes:` line needs no
qualification. The directory carries the scope; the number carries the identity.

Write it, get it agreed, then build against it. The body follows the template and the section order
in [../.claude/skills/spec-creator/SKILL.md](../../.claude/skills/spec-creator/SKILL.md), which is
also what produces one: `/spec-creator` interrogates and analyses, the `spec-writer` agent writes
the file.

Two things that template fixes, because three other agents depend on them:

- **Acceptance criteria are written in [EARS](../../.claude/skills/spec-creator/SKILL.md)** — one of
  `shall` / `WHEN` / `WHILE` / `IF…THEN` / `WHERE`. If you cannot imagine a failing test for a
  sentence, it is not a criterion.
- **Every criterion carries a stable `AC-NN` id.** `implementation-planner` cites them per work
  item, `test-writer` derives one assertion per criterion, and `plan-verifier` builds one
  traceability row each — `AC → work item → test → commit`. **Never renumber a criterion.**

`Status:` runs `draft → approved → implemented`. Nothing downstream may plan against a `draft`;
`approved` is a human gate, and `implemented` is set only once verification comes back with no
`missing` row.

When behavior changes: **correct a stale spec in the same change** — a stale spec is worse than
none. But when the *decision itself* is replaced rather than clarified, write a new spec with the
next number and a `Supersedes:` line pointing back. The `spec-writer` agent only ever creates, so
in-place corrections are made in the main session on purpose.

A spec here covers: the endpoints and contracts involved, the states and transitions, error and
edge cases, what every input's provenance is, which inputs are untrusted, and what "done" means. It
does **not** cover implementation structure — no ring placement, no file layout, no library choice.
That is the plan's, and the reasoning behind it goes in [../docs/](../docs/).

Two constraints bite most often here and belong in the spec rather than being discovered later:
validation rejects with **422 before the handler runs**, and most multi-write sequences are **not
atomic**, so a spec that writes twice has to say what a reader observes when the second write
fails. Both are sourced in
[../.claude/skills/spec-creator/references/repo-constraints.md](../../.claude/skills/spec-creator/references/repo-constraints.md).

## Index

_Empty. Add a link here when you add a spec._
