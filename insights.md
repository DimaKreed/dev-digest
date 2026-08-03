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

### The per-severity findings tally is computed TWICE, in two languages, with no shared code — change one, change the other
**Symptom:** the PR list's FINDINGS column and the PR detail header's counter chips show the same
three numbers, and the list chips link straight to the detail page filtered by the level clicked —
so any drift reads as a bug ("it said 2 WARNING, the page shows 3"). But one is a Drizzle rollup in
`server/src/modules/pulls/routes.ts` (`GET /repos/:id/pulls`) and the other is
`latestRunPerAgent` + `countBySeverity` in **`client/src/lib/severity.ts`** (they started in the
detail route's `SeverityFilterBar/helpers.ts` and moved once the PR list needed them too).
There is no shared helper and there cannot be: `rollupSeverities`
(`server/src/modules/pulls/status.ts:23`) is server-only, and the list endpoint ships counts while
the detail page ships whole `ReviewRecord[]`.
**Rule:** the formula is *newest review per `agent_id` (null agent ⇒ its own bucket), dismissed
findings excluded*. Touching either side means porting the change to the other. The one guard that
fails loudly is the PR-list assertion in `server/test/reviews.it.test.ts` (next to the `cost_usd`
one) — it is the only place the two definitions are checked against real data. Note the SCORE
column deliberately keeps a different notion of "latest" (single newest review per PR).
_2026-07-30_

## Tool & Library Notes

### A skill in `.claude/skills/` can confidently describe a codebase this repo does not have
**Symptom:** `react-best-practices/SKILL.md` told agents to use "the project's
`useApiQuery`/`useApiMutation` core hooks" and to style with Tailwind utility classes, preferring
`components/ui/`. None of that exists here: data access is `src/lib/hooks/*` over
`src/lib/api.ts`, `client/` has **zero** Tailwind utility classes (538 inline `style={}` vs 58
`className`, and every `className` is one of `mono`/`tnum`/`skeleton`/`dd-md`), and the design
system is the `@devdigest/ui` barrel. Worse, that skill is *absent* from `skills-lock.json`, so
"hand-authored" cannot be inferred from the lock file — it was copied in and never reconciled.
**Rule:** before following a skill's concrete claims, grep for the symbols and folders it names.
Fix it in place when it is not hash-locked; add a "this repo does X instead" note when it is.
Frontend structure claims now belong to `.claude/skills/frontend-ui-architecture/`, which is
grounded in verified invariants — `fetch(` appears exactly once in the client
(`client/src/lib/api.ts:24`), zero deep imports past the `@devdigest/ui` barrel, zero non-type
imports from `@devdigest/shared`, zero hex literals in any `styles.ts`, zero `"use client"` in
`client/src/vendor/ui/`.
_2026-08-01_

### `skills-lock.json` is not the skill inventory — it is stale in both directions
**Symptom:** it locks `architecture-patterns` and `github-workflow-automation`, neither of which
has a directory on disk, while `engineering-insights`, `react-best-practices`,
`react-testing-library`, `security` and `mermaid-diagram` appear nowhere in it.
**Rule:** treat `skills-lock.json` as provenance for *vendored* skills only (source repo +
`computedHash`) — never as the answer to "what skills exist". For that, list
`.claude/skills/*/SKILL.md`, and keep the catalog table in `.claude/skills/README.md` in sync:
adding a skill means adding a row there too. That table is edited concurrently by parallel
sessions, so re-read it immediately before editing.
_2026-08-01_

### pnpm self-management fetches an artifact matching its own distribution kind — the exe variant pulls an *unsigned* binary that Smart App Control blocks
**Symptom:** `./scripts/dev.sh` died at once with `...\pnpm\store\v11\links\@pnpm\exe\10.34.5\...
\pnpm.exe' was blocked by your organization's Device Guard policy`. Chain: `server/package.json`
and `client/package.json` pin `packageManager: pnpm@10.34.5`; the pnpm on PATH was the
**standalone-exe** distribution, so to honor that pin it downloaded `@pnpm/exe@10.34.5` into
`%LOCALAPPDATA%\pnpm\store\` — and that binary is `NotSigned`. Smart App Control
(`VerifiedAndReputablePolicyState = 1` under `HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy`,
policy `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`) blocks unsigned binaries that have no
Intelligent Security Graph reputation yet — so the failure is **transient but recurring**: the
identical exe ran fine ~2.5 h later once reputation resolved, and it returns on every version bump.
**Rule:** don't wait out the reputation race and don't touch the policy — run pnpm as JS under the
already-trusted, `Valid`-signed `node.exe`. `corepack pnpm` does exactly that and honors the same
pin (verified `10.34.5` in `server/` and `client/`, `11.18.0` where no pin exists), so it is a
drop-in for every `pnpm` call in `scripts/dev.sh`. pnpm's **JS** distribution — the `npm i -g pnpm`
that `scripts/dev.sh:38` itself suggests — also works, because self-management then fetches the JS
`pnpm` package instead of `@pnpm/exe`. Confirm any block with
`Get-WinEvent -LogName Microsoft-Windows-CodeIntegrity/Operational | ? Message -match 'pnpm'`
(events 3033 + 3077).
_2026-08-03_

### A repo script that shells out to a unix-only binary silently excludes the Windows dev box
**Symptom:** `scripts/make-skill-sample.sh` died with `zip: command not found`. Git Bash ships no
`zip`, and Windows is a first-class dev environment in this repo — the PR gate itself
(`.claude/hooks/*.ps1`) is PowerShell-only — so a bash script assuming GNU userland is broken for
the primary platform, not an edge case.
**Rule:** build archives (and anything similar) in Node against a dependency that `pnpm install`
already put on disk, rather than a system binary. `scripts/make-skill-sample.mjs` walks the
directory and calls `zipSync` from `server/node_modules/fflate`, and behaves identically on all
three platforms. When writing a repo script, assume only `node`, `git` and POSIX shell builtins.
_2026-08-03_

## Recurring Errors & Fixes

## Session Notes

## Open Questions

### Will corepack's vendored `fastlist-*.exe` hit the same Smart App Control block as `@pnpm/exe` did?
`%LOCALAPPDATA%\node\corepack\v1\pnpm\<version>\dist\vendor\fastlist-0.3.0-{x64,x86}.exe` are both
`NotSigned`, so they carry the same exposure that blocked `@pnpm/exe`. Nothing in `dev.sh`
(`install`, `db:migrate`, `db:seed`, `dev`) reached them and the full stack came up clean, but pnpm
shells out to fastlist for Windows process enumeration — so a command that lists or kills child
processes may still trip it. If a second Device Guard block ever names `fastlist`, that is the
source, not pnpm itself.
_2026-08-03_
