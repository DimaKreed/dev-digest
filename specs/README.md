# specs

The intended behavior of a **cross-module** feature, written **before** it is implemented, then
kept as the acceptance reference. A spec belongs here only when the behavior it states cannot be
owned by a single package — otherwise it goes in that package's own `specs/`:
[server/specs/](../server/specs/), [client/specs/](../client/specs/),
[reviewer-core/specs/](../reviewer-core/specs/), [mcp/specs/](../mcp/specs/).

Convention: one file per feature, `NN-feature-name.md`. The number is a **single counter shared
by all five specs directories**, so `SPEC-07` identifies one spec repo-wide and `Supersedes:`
can point at it without qualification. The directory says the scope; the number says the
identity.

A spec covers: the problem and the user, goals and non-goals, acceptance criteria in
[EARS](../.claude/skills/spec-creator/SKILL.md) form with a stable `AC-NN` id each, edge cases,
non-functional requirements, where every input comes from, and which inputs are untrusted. It
does not cover implementation structure — that's the plan and the code, and the reasoning behind
them goes in [docs/](../docs/).

Those `AC-NN` ids are load-bearing: `implementation-planner` cites them per work item,
`test-writer` names one per assertion, and `plan-verifier` builds one traceability row per
criterion — `AC → work item → test → commit`. **Never renumber a criterion.**

`Status:` runs `draft → approved → implemented`. Nothing downstream may plan against a `draft`;
`approved` is a human gate, and `implemented` is set only once verification comes back with no
`missing` row. Correct a stale spec in place in the same change; when the *decision itself* is
replaced rather than clarified, write a new spec with the next number and a `Supersedes:` line
back to it. The `spec-writer` agent only ever creates, so in-place corrections are made in the
main session on purpose.

An end-to-end flow requirement is cross-module and belongs here. [e2e/specs/](../e2e/specs/) is
not a sibling of this directory — it holds the executable `.flow.json` flows, not prose.

## Index

_Empty. Add a link here when you add a spec._
