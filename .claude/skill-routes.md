# Skill routes — task type to skill set

The forward-direction router: **what am I about to build** → **which skills govern it**. Read by
`implementation-planner` (to build a plan that cannot contradict those rules) and by `implementer`
(to load them before writing code).

This is level 1. Level 2 is [pr-self-review/routing.md](skills/pr-self-review/routing.md), which
routes by *changed path* rather than by task type.

- Use **this** file when you know what kind of work you are doing but not yet every file.
- Use **routing.md** once the concrete file list exists, to catch what the type bucket missed.
- **Where the two disagree, `routing.md` wins** — it is the table the PR gate itself applies —
  and the disagreement goes in the report so this file gets corrected.

Take the **union** of every type that applies. A work item that adds an endpoint *and* a schema
column is `backend` + `backend-data`.

## Types

| Type | Applies when the work is in | Load |
|---|---|---|
| `backend` | `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `server/src/app.ts`, `server/src/server.ts` | `onion-architecture` · `fastify-best-practices` · `zod` |
| `backend-data` | `server/src/db/**`, `server/drizzle.config.ts`, migrations | `onion-architecture` · `drizzle-orm-patterns` · `postgresql-table-design` |
| `frontend` | `client/src/**` | `frontend-ui-architecture` · `react-best-practices` · `next-best-practices` |
| `frontend-tests` | `client/src/**/*.test.{ts,tsx}`, `client/vitest.config.ts`, `client/src/test/**` | `react-testing-library` · `frontend-ui-architecture` |
| `core` | `reviewer-core/src/**` | `onion-architecture` · `zod` |
| `mcp` | `mcp/src/**`, `mcp/test/**`, `.mcp.json` | `onion-architecture` · `zod` — the rings apply, but `pnpm arch` does **not** cover this package; its boundaries are grep probes (`mcp/README.md`) |
| `contracts` | `server/src/vendor/shared/**`, `client/src/vendor/shared/**` | `zod` |
| `e2e` | `e2e/**` | **no skill exists.** Follow [e2e/CLAUDE.md](../e2e/CLAUDE.md) and `e2e/docs/`, and say in the report that the lane had no skill. Never substitute an adjacent skill to fill the gap |
| `docs` | any `*.md` under `<pkg>/docs/` or `docs/`, any `README.md`, `TESTING.md` | `mermaid-diagram` · then follow the routing table in [doc-writer.md](agents/doc-writer.md) for **which** directory owns the document |
| `specs` | any `*.md` under `<pkg>/specs/` or the root `specs/` | `spec-creator` — it owns the EARS form, the global `NN` counter and the `draft → approved` gate, and delegates the writing to [spec-writer.md](agents/spec-writer.md). Do **not** route a spec to `doc-writer`: it documents what was built, a spec states what must be. `e2e/specs/` is not in this lane — those are executable `.flow.json` flows and belong to the `e2e` type |
| `always` | any item that writes TypeScript | `typescript-expert` — `strict` + `noUncheckedIndexedAccess` are repo-wide, so indexing yields `T \| undefined` everywhere |
| `conditional` | the item introduces an endpoint, an auth check, a secret, a file upload, or a new path from request input to a query, a shell, or the filesystem | `security` |

`security` is conditional rather than always because
[`security-reviewer`](agents/security-reviewer.md) owns that judgement, and because `routing.md`
already defines exactly these trigger surfaces. Loading the skill here is for *writing* code on one
of those surfaces; deciding whether what got written is exploitable is a separate agent, in a fresh
context, after the fact. The two do not substitute for each other — the skill is a checklist while
you build, and the agent requires a taint path and an exploit scenario before it will call anything
a finding.

`engineering-insights` is deliberately not here. Agents *read* `insights.md` with `Read` during
orientation; appending happens in the main session after review, not inside an agent.
[`insight-curator`](agents/insight-curator.md) is the one agent that reads all five at once, and it
has no `Write` either, for the same reason.

## Rules that travel with a type

These are not skill rules — they are repo facts the skill cannot know. Apply them whenever the
matching type is in play.

- **`contracts`** — `@devdigest/shared` is duplicated: canonical in `server/src/vendor/shared/`,
  an already-diverged copy in `client/src/vendor/shared/`. Changing a contract means changing
  both, or deciding not to **on purpose and saying so**. Silence is the failure mode.
- **`backend`** — a new module is not live until it is listed in `server/src/modules/index.ts`.
  Plugins register before modules in `server/src/app.ts`.
- **`backend-data`** — migrations do not run on boot. `pnpm db:generate` then `pnpm db:migrate`.
- **`always`** — tsconfig path aliases are **not** honoured by vitest. A new alias means editing
  both `tsconfig.json` and that package's `vitest.config.ts`.
- **`always`** — CI is path-filtered per package and cross-package edges are hand-encoded in
  `.github/workflows/`. A new edge means editing the `paths:` filter too.
- **`specs`** — the `NN` prefix is one counter shared by all five specs directories, so `SPEC-07`
  identifies one spec repo-wide. The `AC-NN` ids inside are cited by `implementation-planner`
  (per work item), `test-writer` (per assertion) and `plan-verifier` (one traceability row each):
  **never renumber a criterion** — supersede the spec instead. `e2e/specs/` is not part of this
  and holds executable `.flow.json` flows.
- **Any test hitting a real database** must be named `*.it.test.ts`. The CI lanes split on that
  exact string.

## Package managers

Load-bearing, and the most common mistake in this repo. Always pin the directory in the same
command; never rely on the shell's inherited cwd.

| Directory | Command form |
|---|---|
| `server/` | `cd server && corepack pnpm …` |
| `client/` | `cd client && corepack pnpm …` |
| `reviewer-core/` | `cd reviewer-core && npm …` |
| `e2e/` | `cd e2e && npm …` |

Running pnpm inside an npm package makes pnpm treat the existing `node_modules` as foreign and
start relocating it to `node_modules/.ignored`, which leaves the package unbuildable.

## When this file is wrong

If `routing.md` routes a path to a skill this table does not list for the matching type, that is
a gap in **this** file. Report it; do not silently follow only one of the two.

The known inversion: **neither this table nor `routing.md` covers `.claude/**` at all** — agent,
skill and hook files are governed by [.claude/agents/README.md](agents/README.md) § *Authoring a
new agent* and root [insights.md](../insights.md) § *Tool & Library Notes*, not by a skill.
