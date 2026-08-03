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

## Recurring Errors & Fixes

## Session Notes

## Open Questions
