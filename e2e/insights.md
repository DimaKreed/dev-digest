# Insights — e2e

Findings about this package specifically — flaky-step causes, agent-browser quirks,
locator strategies that held up. Cross-package findings go in [../insights.md](../insights.md).

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](../.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions

### Does `find role button --name` match the accessible name exactly, or as a prefix/substring?
`specs/08-pr-severity-filter.flow.json` locates the severity chips with `--name "CRITICAL"`,
but the chip's accessible name is `"CRITICAL 1"` — `Chip` renders its count in a trailing
`<span class="tnum">`. That this matches is **inferred, not verified**: `specs/04-pr-findings.flow.json:10`
uses `--name "Agent runs"` against a `Tabs` button whose accessible name is `"Agent runs 2"`
(the tab count is appended the same way) and passes in CI. If spec 08 fails at the "select the
CRITICAL counter" step, this is the cause — switch to the full `"CRITICAL 1"`, or give `Chip`
an explicit `aria-label`. Settle it once and note the answer here.
_2026-07-30_

**Update:** `specs/09-pr-list-findings.flow.json` now depends on the same assumption — its
`--name "CRITICAL"` targets a PR-list chip whose accessible name is `"1 CRITICAL findings"`
(`list.findingsChip` in `client/messages/en/prReview.json`). Both 08 and 09 fail or pass together,
so one hermetic run settles it for both. _2026-07-30_
