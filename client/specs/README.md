# client/specs

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

A spec here covers: the screens and routes involved, states (loading / empty / error / success),
interactions, what the UI shows while a value is missing or stale, and what "done" means. It does
**not** cover component structure — that's the code, and the reasoning behind it goes in
[../docs/](../docs/).

Three repo facts make a client spec more explicit than it looks:

- There is **no `loading.tsx`, `error.tsx` or `not-found.tsx`** — those states render inline from
  query state. Loading, empty and error are not free framework behavior; each is a state the spec
  has to require, or it will not exist.
- **View state lives in the URL** — tab, filter, deep link, drawer. A criterion about a filter is
  also a criterion about a shareable link surviving a reload.
- **API responses are typed, not validated** — `@devdigest/shared` is type-only here. A criterion
  about an unexpected response shape is specifying behavior that does not exist yet.

Sources for all three, plus the i18n rule that every user-facing string comes from a next-intl
namespace, are in
[../.claude/skills/spec-creator/references/repo-constraints.md](../../.claude/skills/spec-creator/references/repo-constraints.md).
Accessibility and performance have **no repo convention** — see
[nfr-checklist.md](../../.claude/skills/spec-creator/references/nfr-checklist.md) before writing
either as a criterion.

## Index

_Empty. Add a link here when you add a spec._
