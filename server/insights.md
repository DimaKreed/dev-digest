# Insights — server

Findings about this package specifically. Cross-package findings go in
[../insights.md](../insights.md).

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](../.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

## What Doesn't Work

## Codebase Patterns

### `db:seed` creates no `agent_runs`, so every run-derived surface is empty on a fresh DB
**Symptom:** with cost wired end-to-end, the PR list's COST column still showed `—` on every row and
the Agent Runs timeline was empty — which reads as a broken feature but is correct: `src/db/seed.ts`
inserts through `agents` and stops, never touching `agentRuns` or `runTraces`.
**Rule:** don't debug an empty cost/tokens/duration/timeline surface on a freshly seeded DB — there
are no runs to show. Trigger one: `POST /pulls/:id/review {"agentId":…}` is fire-and-forget, so poll
`GET /pulls/:id/runs` until `status !== "running"`. For a check that survives the session, extend
`test/reviews.it.test.ts` → "runs a review: map-reduce + grounding…", which drives the real executor
on mock adapters (they report `costUsd`) and already reads the `agent_runs` row back.
_2026-07-30_

### Declaring Drizzle row types in `repository.ts` creates a pure-helper → repository import cycle
**Symptom:** `pnpm arch:all` reports
`no-circular: src/modules/agents/helpers.ts → src/modules/agents/repository.ts → src/modules/agents/helpers.ts`.
The helper is meant to be pure and only wants a type —
`import type { AgentRow, AgentVersionRow } from './repository.js'` — while `repository.ts` imports
the helper's mappers back.
**Rule:** put row/domain types in `modules/<domain>/ports.ts`, not in the repository that also holds
the query code. Both files then depend inward and the cycle disappears. `src/modules/agents/helpers.ts:3`
_2026-08-01_

**Update — the other half: `db/rows.ts` is closed to a helper too, and depcruise counts a
`import type` as an edge.** Routing the row type *around* the cycle by importing it straight from
the schema side — `import type { SkillRow } from '../../db/rows.js'` — just swaps one error for
another: `error c5-pure-helpers: src/modules/skills/helpers.ts → src/db/rows.ts`. That rule's `to`
is `^src/(db|adapters)/`, which `db/rows.ts` matches exactly as `db/schema` does, and a type-only
import erases at runtime but is still an import edge to dependency-cruiser. So for any module whose
`helpers.ts` needs a row type, `ports.ts` is not the tidier option — it is the only legal one:
`ports.ts` re-exports from `db/rows.ts`, and `helpers.ts` and `repository.ts` both import inward
from it. `src/modules/skills/ports.ts` _2026-08-03_

## Tool & Library Notes

### A dependency-cruiser rule cannot see a type that arrives through the `Container` God object
**Symptom:** `h8-no-db-handle-above-repository` in `.dependency-cruiser.cjs` reports 0 hits even
though every service is typed against the Drizzle handle — because no service imports
`db/client.js`. `Db` arrives as `Container['db']`, and `platform/container.ts` is the only file with
the import edge.
**Rule:** depcruise validates *import edges*, so any rule about a type flowing through one injected
object is structurally blind and will pass while the violation is everywhere. Enforce those with
grep — `rg -n '\$inferSelect|PostgresJsDatabase|db/rows' src/modules/*/service.ts`. Keep the
depcruise rule anyway; it catches the day someone imports the handle directly.
`src/modules/reviews/service.ts:33`
_2026-08-01_

### Drizzle's `text(col, { enum: [...] })` is a TypeScript union only — no CHECK reaches Postgres
**Symptom:** widening the skills `source` enum with `'imported_file'` looked like it needed a
migration, but `pnpm db:generate` emitted nothing for it — which reads like drizzle-kit failing to
notice the change.
**Rule:** it did notice; there is nothing to emit. The generated DDL is a bare
`"source" text NOT NULL` (`src/db/migrations/0000_init.sql:322`), so the allowed set lives entirely
in TypeScript. Widening one is a no-migration, three-file edit: the `enum:` array in
`src/db/schema/<table>.ts` plus the matching `z.enum` in **both** `vendor/shared` copies. The
converse is the trap — *narrowing* one also generates no migration, so rows keep values the types
now claim are impossible, and the next `Zod.parse` on read throws on real data.
_2026-08-03_

## Recurring Errors & Fixes

## Session Notes

## Open Questions
