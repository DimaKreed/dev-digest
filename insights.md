# Insights — repo-wide

Cross-module findings only: package wiring, shared contracts, CI, tooling, local setup.
Anything scoped to one package belongs in that package's `insights.md`.

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

### Before building an L01–L08 feature, check whether it already existed and was deliberately stripped
**Symptom:** the "Run Cost Badge" looked like greenfield work, but three commits had removed it as
course scaffolding — `58c6ac7` (per-run usage line in the Agent Runs timeline), `e07efea` (PR-list
column cleanup), `d45ab0d` (`agent_runs.cost_usd`, both trace contracts, the trace COST tile,
`formatCost`, the i18n key). Those commits are precise, reversible specs for the feature.
**Rule:** `git log --oneline` here is short (squashed snapshot, ~12 commits). Read the removal
commit — or `git log -p -S<symbol>` — before designing: it hands you the exact file set, field
names and formatting the lesson expects. Two traps: the removals span BOTH `vendor/shared` copies,
and one of them dropped a DB column, so restoring needs a NEW migration, not a revert.
_2026-07-30_

## What Doesn't Work

## Codebase Patterns

### A Zod field parsed back out of a jsonb column must be `.nullish()`, never `.nullable()`
**Symptom:** re-adding `cost_usd` to `RunStats` as `.nullable()` typechecks and passes fresh tests,
but then `GET /runs/:id/trace` fails to parse every trace written before the field existed —
`run_traces.trace` holds a whole document, so older rows have no such key, and `.nullable()` still
requires the key to be *present*.
**Rule:** for any contract field that round-trips through jsonb, use `.nullish()` so absent-key
documents keep parsing; reserve `.nullable()` for contracts built from real columns, where a new
NULL column is safe. `server/src/vendor/shared/contracts/trace.ts:60` + its client copy; regression
guard: `server/test/contracts.test.ts` → "RunStats accepts a legacy trace with no cost_usd key".
_2026-07-30_

### reviewer-core often already computes a per-run metric that the server drops on the floor
**Symptom:** no run cost was stored anywhere, yet `ReviewOutcome.costUsd` was fully populated the
whole time — the engine returns it (OpenRouter's real `usage.cost` when the provider reports one,
else the injected price-book estimate) and `run-executor.ts` simply destructured it away.
**Rule:** before adding plumbing for a new per-run number, read the `ReviewOutcome` shape at
`reviewer-core/src/review/run.ts:100-120` and its aggregation at `:156-218`. The engine is pure and
generous; the gap is usually only persistence + contract + UI, with no reviewer-core change at all.
_2026-07-30_

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
