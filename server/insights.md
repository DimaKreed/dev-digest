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

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
