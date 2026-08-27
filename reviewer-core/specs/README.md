# reviewer-core/specs

The intended behavior of an engine change, written **before** it is implemented, then kept
as the acceptance reference.

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

A spec here covers: inputs (diff shape, config), the expected findings / verdict / score behavior,
degenerate cases (empty diff, provider error, ungrounded output), and what "done" means.

Because this package is pure, a spec here should be **expressible as a test** — if it isn't, it
probably belongs in [../../server/specs/](../../server/specs/). Purity is enforced, not aspirational:
ring 0 may not touch `fs`, `node:*`, `process.env`, `Date.now()`, `new Date()`, `Math.random()` or
`fetch(`, so the engine's output is a function of its inputs alone. A criterion that needs the
current time or a random sample is specifying that the value be **passed in**. Source:
[../.claude/skills/spec-creator/references/repo-constraints.md](../../.claude/skills/spec-creator/references/repo-constraints.md).

The output vocabulary is closed — severity `CRITICAL | WARNING | SUGGESTION`, verdict
`request_changes | approve | comment`. A criterion inventing a further value is proposing a
contract change in both `vendor/shared/` copies, and says so.

## Index

_Empty. Add a link here when you add a spec._
