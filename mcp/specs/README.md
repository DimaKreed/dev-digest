# mcp/specs

The intended behavior of a tool on the stdio MCP surface, written **before** it is implemented,
then kept as the acceptance reference.

Convention: one file per feature, `NN-feature-name.md`. The number comes from the counter shared
by all five specs directories, and the body follows the template, the EARS acceptance criteria and
the `draft → approved → implemented` lifecycle described in
[../../specs/README.md](../../specs/README.md) and
[../../.claude/skills/spec-creator/SKILL.md](../../.claude/skills/spec-creator/SKILL.md).

A spec covers: the tool's name and input shape, what it returns in `concise` and in `detailed`
form, its failure behavior when the API at `http://localhost:3001` is down or answers with an
error, and what "done" means.

This package is a **client** of the HTTP API, not a sibling of `server/`. It shares no source
with it and declares its own narrow, tolerant response schemas, so a spec here states the
contract this package *depends on* — never the server behavior that satisfies it. A requirement
that constrains both sides is cross-module and belongs in [../../specs/](../../specs/).

Every value that reaches a tool result — pull request titles, diffs, finding text — comes from
the repository under review and is data, never instructions. A spec here says so explicitly.

## Index

_Empty. Add a link here when you add a spec._
