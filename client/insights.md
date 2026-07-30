# Insights — client

Findings about this package specifically. Cross-package findings go in
[../insights.md](../insights.md).

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](../.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

## What Doesn't Work

## Codebase Patterns

### Run-level data reaches the review-run header by joining on `run_id` in FindingsTab — not by extending `ReviewRecord`
**Symptom:** the REVIEW RUNS accordion header needed the run's cost, but `ReviewRecord`
(`src/vendor/shared/contracts/review-api.ts`) carries no tokens/cost/duration at all, so extending
that contract *and* the server's reviews route looked unavoidable — and would have meant editing
both diverged `vendor/shared` copies.
**Rule:** `FindingsTab` already receives both `prRuns: RunSummary[]` (which does carry run usage)
and `runs: ReviewRecord[]`, and `ReviewRecord.run_id` is already used there for scroll-targeting.
Build a `Map<run_id, …>` from `prRuns` and pass the value down as a prop — zero contract or server
change. See `costByRunId` in
`src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx`.
_2026-07-30_

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions
