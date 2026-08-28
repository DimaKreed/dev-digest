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

**Counterpart — the feature may be pre-wired FORWARD rather than stripped, and `git log` will not
show it.** Project Context looked like greenfield work. It was not: `## Project context` was already
a live section in `reviewer-core/src/prompt.ts:150` fed by `ReviewInput.specs?: string[]`,
`PromptAssembly.specs` and `RunTrace.specs_read` already existed in **both** `vendor/shared` copies,
and the trace drawer already rendered both. Only the producer was missing —
`server/src/modules/reviews/run-executor.ts` never passed `specs` and hardcoded `specs_read: []`.
Unlike the parent entry's case there is no removal commit to read: `git log -S "Project context" --
reviewer-core/src/prompt.ts` returns only the initial squashed snapshot, so history is silent.
**Rule:** before designing an L01–L08 feature, read the engine's input type
(`reviewer-core/src/review/run.ts` `ReviewInput`) and the trace contract end to end, not just the
module you expect to edit. A dormant slot changes the work from "add a section" to "fill a seam" —
and it is what makes a byte-identical-when-empty criterion writable at all, because the omit-when-
empty spread already exists.
_2026-08-27_


### Running a review tool on its own uncommitted diff finds what the test suite structurally cannot
**Symptom:** `devdigest review` was green on 83 hermetic tests and a manual `--help`. Run
against its own working tree it immediately reported a CRITICAL: `mcp/package.json` declared
`"bin": "./bin/devdigest.mjs"` while that file was untracked, so it was absent from
`git diff HEAD` and would break on install. A second run found `blockers`/`fail_on` reachable
as `undefined` in the response schema the exit code reads. Neither is findable by a test —
the first is a fact about the *repository state*, not the code.
**Rule:** for any tool that consumes a repo (a reviewer, a linter, an indexer), the last
verification step is pointing it at this repo's own pending diff, before the commit. Two
non-obvious details: it needs the API running (`./scripts/dev.sh`), and `git add` the new
files first or the tool reviews everything *except* what you just wrote — which is exactly
the blind spot that produced the CRITICAL above.
_2026-08-14_

## What Doesn't Work

### A plan's done-when can name symbols that do not exist in the package it assigns the test to
**Symptom:** a Development Plan required a server helper's counts to "agree with
`countBySeverity(latestRunPerAgent(reviews))` on the same data" and assigned the check to the
server unit lane. Both functions live only in `client/src/lib/severity.ts` (no occurrence anywhere
under `server/src`), so no server test can reach them. The condition was not merely hard — it was
unsatisfiable in its own lane, and the test that shipped compared against `rollupSeverities` plus a
re-derivation written inside the test file, which `plan-verifier` correctly scored `partial`.
**Rule:** when a done-when names a symbol, grep for it in the package that owns the assigned lane
*before* writing the condition. For the severity formula specifically, the two copies are split by
language and cannot be imported across (see the tally entry below): a parity assertion between them
belongs in an integration test that hits the endpoint, or in a client test — never in a server unit
test. `server/test/smart-diff.test.ts:125`
_2026-08-08_

**Counterpart — a done-when is also unsatisfiable when the command it names fails on the empty
state its own work item creates.** A scaffold item read "`cd mcp && npm install && npm run
typecheck && npm test` exits 0 on an empty `src/`". It cannot: with the globs matching nothing,
`tsc --noEmit -p tsconfig.json` exits non-zero with `error TS18003: No inputs were found in
config file ... Specified 'include' paths were '["src/**/*.ts","test/**/*.ts"]'`. Vitest has the
mirror-image quirk and needs `--passWithNoTests`, which the repo's npm packages already pass —
so only half the command was ever going to be green.
**Rule:** check a scaffold item's done-when against the state that item actually leaves behind,
which for a package skeleton is zero source files. Either move the typecheck condition to the
first item that writes a `.ts` file, or have the scaffold ship one. The generic form: a
done-when naming a command needs the command run against the *expected* state, not merely
against a plausible one. `mcp/package.json`
_2026-08-13_

## Codebase Patterns

### `pull_requests` has no merge timestamp and no author avatar, so a "prior PRs" contract cannot be filled from it as written
**Symptom:** `PrHistoryItem` (`contracts/brief.ts:65-72`) declares `merged_at`, which reads as
a column and is not one. `src/db/schema/pulls.ts:5-34` has `status` (default `'needs_review'`)
and `updated_at`, and nothing else about merging; there is no avatar column either, so a
`author_avatar` field added to a response is permanently null.
**Rule:** derive "merged" from `status = 'merged'` and carry `updated_at` as `merged_at`, with
a comment saying so at the contract — the name outlives the explanation otherwise. Before
adding a display field to a PR-shaped contract, grep the schema for the column: a field that
can never be non-null is worse than an absent one, because the client branches on it forever.
`server/src/modules/reviews/repository/pull.repo.ts` (`getPriorPrs`)
_2026-08-14_

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

**Update:** it is now computed **three** times. `server/src/modules/smart-diff/helpers.ts:32`
(`latestLiveFindings`) is the third, added because Smart Diff annotates file rows with the live
findings' line numbers and `no-cross-module` forbids importing `pulls/status.ts`. Its header names
the other two copies. Two things that third copy learned the hard way: `Array.prototype.sort` is
stable, so two runs sharing a `created_at` leak the caller's row order into the output — the
comparator needs a review-`id` tiebreak to be a total order; and the parity assertion the plan
wanted against the *client* copy is not writable in a server unit test (see *What Doesn't Work*).
Changing the rule is now a three-file edit. _2026-08-08_

### The `.claude/` governance layer enumerates the five packages by hand in five places, and `mcp/` was missing from three of them
**Symptom:** `mcp/` has its own `CLAUDE.md`, its own `insights.md` (3.9 KB, full section skeleton)
and its own `specs/`, yet `.claude/skills/feature-workflow/SKILL.md` mentioned it **zero** times —
its stage-0 trigger read "two or more packages (`server/`, `client/`, `reviewer-core/`, `e2e/`)",
so an `mcp/` + `server/` change could never trip the gate that decides whether a change earns the
agent chain at all. `insight-curator.md`'s "The five files" table and
`engineering-insights/SKILL.md`'s routing table both omitted `mcp/insights.md` too, so the one
agent whose entire value is reading every `insights.md` at once was reading five of six and
nothing about `mcp/` had a legal destination. The two lists that *were* correct —
`skill-routes.md` § *Types* and `spec-writer.md`'s scope table — show this is drift, not a design
decision.
**Rule:** adding a package is not done when root `CLAUDE.md` lists it. Every hand-maintained
package list in this repo names `reviewer-core`, so `grep -rln 'reviewer-core' .claude/ TESTING.md`
enumerates the places that need the new name. Nothing validates them:
`scripts/check-agent-frontmatter.mjs` checks frontmatter only, and neither `skill-routes.md` nor
`pr-self-review/routing.md` covers `.claude/**` at all. While closing such a gap, do **not** also
"fix" `mcp/`'s absent cross-package CI edge — root `CLAUDE.md` § *Cross-module wiring* makes that
isolation deliberate.
_2026-08-26_

**Addendum:** `.claude/**` is not the only uncovered path. **`server/test/**` matches no row in
either router** — `skill-routes.md` § *Types* lists `server/src/**` paths under `backend`, and
`pr-self-review/routing.md`'s `arch-onion` lane matches `server/src/modules/**`. So an agent
writing or reviewing a server test derives *no* skill and has to fall back to the plan's typing
of the work item; the governing material it needs (`onion-architecture` § *Test seams* — no
`vi.mock`, the container seam, the `.it.test.ts` split) is reachable only by guessing. Note the
client side does not have this hole: `ui-tests` covers `client/src/**/*.test.tsx`. When adding a
router row, check the test paths of every package, not just its source paths.
_2026-08-28_

## Tool & Library Notes

### `tsconfig.json`'s `include` differs per package, so `pnpm typecheck` proves nothing about tests in `server/` or `reviewer-core/`
**Symptom:** adding a required field to a shared Zod contract left 14 test fixtures incomplete.
`cd server && pnpm typecheck` passed clean, and all 14 surfaced as runtime `AssertionError`s from
vitest instead — with messages about empty arrays rather than about a missing property.
**Rule:** `server/tsconfig.json` and `reviewer-core/tsconfig.json` set
`"include": ["src/**/*.ts"]`; `mcp/` adds `"test/**/*.ts"` and `client/` includes everything. So a
green typecheck in server or reviewer-core says nothing about their `test/` trees. After any
contract or interface change, run the suite — the typecheck is not a proxy for it. When a new
required field would touch many fixtures, add a factory in the test file that fills a sensible
default (see `test/blast.test.ts`'s `blastRead` deriving `viaFile` from the changed symbols) so
tests unrelated to the field stay silent about it while tests about it must state it.
_2026-08-25_

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

**Counterpart — that "always use `corepack pnpm`" habit corrupts `reviewer-core/` and `e2e/`, which are
npm packages.** Running `corepack pnpm exec tsx some-script.ts` with the shell's cwd left in
`reviewer-core/` triggers pnpm's dependency-status check, which decides the npm-installed
`node_modules` is foreign and starts relocating it: `[WARN] Moving openai that was installed by a
different package manager to "node_modules/.ignored"` for `openai`, `zod`, `tsx`, `typescript`,
`vitest` and `@types/node`, then dying half-way on `[EPERM] EPERM: operation not permitted, rename
'...\reviewer-core\node_modules\openai' -> '...\.ignored\openai'`. It leaves the package unbuildable
— `tsc` and `vitest` simply gone.
**Rule:** the per-directory package manager in root `CLAUDE.md` is not only about installs — it
governs `exec` too. Always pin the directory in the same command (`cd server && corepack pnpm exec …`)
rather than relying on the shell's inherited cwd, which drifts across calls. Recovery is
non-destructive and does not need a reinstall: move each entry back out of `node_modules/.ignored/`
(including `@types/node`, which is nested), `rmdir` `.ignored`, then confirm with
`cd reviewer-core && npm run typecheck && npm test`. `git status` should show no `node_modules` churn
— it is gitignored, so the damage is invisible to git and will only surface as a mysteriously broken
package.
_2026-08-04_

### A new `.claude/agents/*.md` is not invocable in the session that created it
**Symptom:** `.claude/agents/researcher.md` was written, then invoking it in the same session
failed with `Agent type 'researcher' not found. Available agents: claude, claude-code-guide,
Explore, general-purpose, Plan, statusline-setup` — which is also what a malformed file would
produce, so it reads as a frontmatter bug and invites rewriting a file that is already correct.
**Rule:** don't chase the frontmatter — validate it out-of-band first.
`node scripts/check-agent-frontmatter.mjs` does it: it finds the YAML parser `pnpm install` already
put in `server/node_modules/yaml`, and confirms both that the `---` block parses and that no tool
you meant to withhold leaked into `tools`. An unquoted `file:line` inside `description` is safe;
only `: ` (colon-space) breaks a bare YAML scalar. See the counterpart below on the registry — the
"re-check in a fresh session" half of this rule no longer applies.
_2026-08-07_

**Counterpart — the frontmatter schema has two traps, and both fail the same undiagnosable way.**
`tools` is a comma-separated string (`tools: Read, Grep, Glob`) but **`skills` is a YAML block
sequence** — `skills:` followed by one `  - name` per line. Assuming symmetry with `tools` and
writing `skills: a, b` produces a plain string where an array is expected. Separately,
`allowed-tools` and `disable-model-invocation` are **Skill-only** fields with no subagent
equivalent, so copying them out of `.claude/skills/*/SKILL.md` — three skills here carry
`allowed-tools` — silently does nothing instead of erroring.
**Rule:** extend the out-of-band check above to assert `Array.isArray(d.skills)` and that every
entry resolves to a real `.claude/skills/<name>/SKILL.md`. `.claude/agents/implementation-planner.md:6-8` is the
worked example. Field list verified against https://code.claude.com/docs/en/sub-agents.
_2026-08-07_

**Counterpart — `skills:` preloads bodies, not references, and never replaces the `Skill` tool.**
It injects each named skill's full `SKILL.md` at startup but none of its sibling files, so
preloading `pr-self-review` yields the review pipeline and *not* `routing.md`. Reaching a reference
file still needs `Skill` in the `tools` allowlist — and without `Skill` listed there a subagent
cannot load any skill at all, at any point in its run.
**Rule:** budget from the real numbers before preloading broadly, and re-measure rather than
quoting a figure — these move. `node scripts/check-agent-frontmatter.mjs` prints each agent's
preload total as an advisory suffix, which is the cheapest way to see it. As of 2026-08-07 the 14
`SKILL.md` here total ~144 KB, spread from 962 B (`fastify-best-practices`) to 26.6 KB
(`react-testing-library`, the one skill no agent preloads — it alone would blow the 25 KB budget).
`implementation-planner` sits at 24.8 KB against that budget and is the house maximum; the four newer agents
preload one skill each or none.
_2026-08-07_

**Counterpart — the registry now refreshes mid-session, but the parent's rule survives it.**
Four agent files were written in a single session and the harness announced all four as available
agent types **in that same session**, with no restart; `plan-verifier` and `architecture-reviewer`
were then invoked through the `Agent` tool and returned full reports. The parent entry's symptom no
longer reproduces on this version of Claude Code.
**Rule:** stop planning around "verify it in a fresh session" — a smoke invocation is available
immediately, which makes it cheap enough that there is no excuse for skipping it. Keep the
out-of-band YAML check as the *first* move on any `Agent type '<name>' not found` anyway: a
malformed file and a registry that has not caught up still fail identically, and the check is the
only thing that separates them.
_2026-08-07_

**Counterpart — the mid-session refresh is real for skills and unreliable for agents.** In one
session `.claude/skills/feature-workflow/SKILL.md` was written and announced as available
immediately, while five agent files written in the same session were **not**: `brainstorm` and
`refactor-planner` both failed with `Agent type '<name>' not found` listing the seven pre-existing
agents, after `node scripts/check-agent-frontmatter.mjs` had already returned `PASS` on all twelve
with exit 0. So the counterpart above is half right — the two registries do not refresh together,
and the agent one is the one that lags.
**Rule:** keep the smoke invocation in the plan, but do not treat it as a same-session gate for
agents. The sequence that actually discriminates is: validator green ⇒ the file is correct ⇒ a
`not found` is the registry, not the frontmatter ⇒ re-invoke in the next session. Reading a
same-session `not found` as a file defect is what sends you rewriting a file that already passes.
_2026-08-07_

**Counterpart — agent files cite each other by `file:line`, and nothing checks those anchors.**
`plan-verifier.md` keys its whole §1 extraction to the plan template's fixed section names and
cited `.claude/agents/implementation-planner.md:132-218` for it, twice. The range had rotted: the
template runs `141-237`, and `:132` lands inside `## Rules`, so a reader following the anchor reads
the wrong contract and the extraction table looks unsupported by the document it claims to key off.
Its `implementer.md:114-151` was off by two the same way — while all four of its *single-line*
anchors (`:140`, `:144`, `:135`, `:125`) were still correct. Ranges rot; single lines mostly
survive.
**Rule:** `scripts/check-agent-frontmatter.mjs` validates frontmatter only and will never catch
this. After editing any agent that others cite, run
`grep -n '<that-file>.md:' .claude/agents/*.md` and re-check every range. When *reading* such an
anchor, confirm it by section name (`grep -n '^## ' <file>`) instead of jumping to the line number:
the section name is the durable identifier here, the number is not.
_2026-08-26_

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

### A grep probe returning zero hits may mean the pattern never compiled, not that the code is clean
**Symptom:** an onion audit ran the six probes from
`.claude/skills/onion-architecture/SKILL.md:148-157` and four returned `0 matches`, which reads as
a pass. They were not a pass. `rg` is not on PATH here, rtk falls back to plain `grep`, and
`/usr/bin/grep: Unmatched ( or \(` went to stderr while the empty match list looked exactly like a
genuine clean result. Re-running the same four ripgrep-backed turned the same diff into one
CRITICAL and two HIGH findings.
**Rule:** a `0 matches` from any pattern containing `(`, `|`, `\s` or `?` is unconfirmed until you
have read stderr. Prefer the `Grep` tool — it is ripgrep and surfaces a bad pattern as an error
rather than as an empty result — or pass `grep -E` explicitly. The banner `rtk: Failed to resolve
'rg' via PATH, falling back to direct exec` is the signal that this is in play, and it appears on
stderr where a piped command will hide it.
_2026-08-07_

**Counterpart — a probe can compile cleanly, write nothing to stderr, and still be a false
negative, because the call site does not spell the identifier the way the probe does.**
`fetch\(` over `mcp/src` returned `0 matches` while `mcp/src/adapters/http-client.ts` held two
live references: the call reads `doFetch(`, and `fetch(` is not a substring of `doFetch(` under
ripgrep's default case-sensitive matching. Neither half of the parent entry catches this — the
pattern was valid and the tool was ripgrep.
**Rule:** anchor an identifier probe on a word boundary rather than on a punctuation suffix —
`\bfetch\b`, not `fetch\(`. Then prove the probe is live by checking it DOES hit the file that
legitimately owns the call, not only that it misses everywhere else. A probe never observed to
match anything has never been tested, and a `0` from it means nothing. The corrected set for
that package is in `mcp/README.md`.
_2026-08-13_

**Third counterpart — the pattern compiled, the identifier matched, and the file was never
searched at all, because ripgrep classified it as binary.**
`server/src/modules/repo-intel/service.ts` contains a literal NUL byte inside a `${a}\0${b}`
composite map key. `rg` treats a NUL as the binary sentinel and skips the file, so the `Grep`
tool returns `0 matches` for a symbol that is demonstrably there. Nothing on stderr, no banner,
no "binary file matches" line — the result is indistinguishable from a clean sweep of a searched
file.
**Rule:** when a probe over a specific known-populated file returns zero, confirm the file was
searched before concluding anything — `grep -c '' <file>` reports a line count for a text file
and `rg --files <file>` lists it only if ripgrep will read it. For a file already known to carry
a NUL, read it through Python or `sed -n` instead. This is the third distinct way a `0` lies in
this repo, and the only one that leaves no trace anywhere.
_2026-08-27_

### A grep probe used as an acceptance criterion counts comment prose, so a header comment must not spell the identifier it forbids
**Symptom:** a plan shipped probes like `grep -nE "container\.llm|openrouter|reviewPullRequest"
server/src/modules/smart-diff/*.ts` → expect 0, as the mechanical form of "makes no model call". The
files were clean, but the probes returned non-zero: the header comments *explained* the constraint
by naming `container.llm`, `process.env` and `db/` in prose. The probe cannot tell an explanation
from a violation.
**Rule:** when a grep probe is a durable acceptance criterion, write the comment to *describe*
rather than to quote — "this slice reaches no LLM adapter" instead of naming `container.llm`. Same
for the ring-0 purity probes (`process.env`, `Date.now`, `fetch(`). If the identifier genuinely must
appear in prose, the plan owns the fix: the probe needs a `--` exclusion or a `^[^/*]` anchor, and
saying so beats quietly rewording it later. `server/src/modules/smart-diff/service.ts:1`
_2026-08-08_

### `.claude/skills/pr-self-review/invariants.md:36`'s `ci-filter-gap` WARNING is stale
**Symptom:** that row asserts `.github/workflows/server-integration.yml` has no `reviewer-core/**`
path filter, so a reviewer-core change could merge without the integration lane running. Acting on
it means editing a workflow that is already correct.
**Rule:** the filter is present under **both** `push.paths` (`server-integration.yml:24`) and
`pull_request.paths` (`:29`), with a header comment at `:12-16` explaining why — verified
independently by two agents on 2026-08-08. Do not edit the workflow. The invariants row is what
needs correcting; until it is, treat a `ci-filter-gap` hit on the integration lane as noise and
check the file. Row 37 makes a similar claim about `reviewer-core.yml` and
`client/src/vendor/shared/**` that was **not** verified — check it before trusting either way.
_2026-08-08_

### `server/package.json` is not under `skip-worktree`, whatever TESTING.md says
**Symptom:** `TESTING.md:83-86` states the file is `skip-worktree` ("a local variant diverges from
the committed file") and that CI therefore inlines the vitest lanes. `git ls-files -v
server/package.json` returns `H`, not `S` — the flag is not set in this checkout — and
`git diff HEAD -- server/package.json` is empty.
**Rule:** the *rule* that claim protects is still live: `.github/workflows/server-unit.yml` and
`server-integration.yml` invoke `pnpm exec vitest run …` directly, so do not add `test:unit` /
`test:integration` scripts and make CI depend on them. Only the stated mechanism is stale — do not
go hunting for the flag when a `package.json` edit shows up in `git status`, and do not "restore"
it.
_2026-08-07_

**Update — the stale half is now gone from the files themselves.** `TESTING.md` § *Conventions* no
longer claims the flag: it states the live rule (the split lives in CI, `test:unit` /
`test:integration` do not exist and must not be added) and records that the mechanism was never
real. The same claim sat in three workflow comments — `server-unit.yml:96`,
`server-integration.yml:68`, `e2e-web.yml:87` — and all three now explain why the command is
inlined without invoking the flag. This entry stays as the reason not to reintroduce the
explanation; it is no longer a live contradiction to work around. _2026-08-26_


### A brace-expanded `ls` glob reports "no matches" in Git Bash while the files are on disk
**Symptom:** `ls {,server/,client/,reviewer-core/,mcp/}specs/[0-9][0-9]-*.md 2>/dev/null || echo
"no specs yet"` — the exact command
[.claude/skills/spec-creator/SKILL.md](.claude/skills/spec-creator/SKILL.md) prescribes for
picking the next spec number — printed `no specs yet` while `specs/01-project-context-documents.md`
existed and was staged. `Glob **/specs/[0-9][0-9]-*.md` found it instantly. The failure is silent:
`ls` exits non-zero, the `||` branch fires, and the fallback message reads exactly like a true
empty result.
**Rule:** never derive a repo-wide count or a next-free-number from a brace-expanded shell glob
here — use the `Glob` tool, which does not go through the shell. This one matters more than a
normal tooling quirk because the wrong answer is not an error but a **collision**: two specs
claiming the same `NN`, which the whole `AC-NN` traceability chain assumes is unique. The
`spec-writer` agent caught it only because it re-derives the number itself instead of trusting
the briefing handed to it — that redundancy is load-bearing, not belt-and-braces.
_2026-08-27_

## Recurring Errors & Fixes

## Session Notes

## Open Questions

### Why did the extractor's anchor-verification rate collapse mid-session, and is it purely provider-side?
On 2026-08-04 a scan of dev-digest returned `verified: 6, dropped_no_snippet: 0`. Hours later, the
same repo and the same code returned `verified: 2/1/0` with **8–11** evidence items failing
`verifyEvidence`. Ruled out: the prompt — two scans on the committed prompt dropped 8 and 11, two on
the reworded one dropped 11 and 6, indistinguishable. The remaining suspect is which upstream
OpenRouter routes to (see `reviewer-core/insights.md`), since a provider that paraphrases rather than
copies a line fails every anchor. `ExtractionStats` records `provider: 'openrouter'` but **not the
upstream** that served the call, so this cannot currently be confirmed from a scan's own output.
Threading OpenRouter's response `provider` field into `ExtractionStats` would make the correlation
measurable — worth doing before tuning the prompt or the gate in response to a low yield.
_2026-08-04_

### Will corepack's vendored `fastlist-*.exe` hit the same Smart App Control block as `@pnpm/exe` did?
`%LOCALAPPDATA%\node\corepack\v1\pnpm\<version>\dist\vendor\fastlist-0.3.0-{x64,x86}.exe` are both
`NotSigned`, so they carry the same exposure that blocked `@pnpm/exe`. Nothing in `dev.sh`
(`install`, `db:migrate`, `db:seed`, `dev`) reached them and the full stack came up clean, but pnpm
shells out to fastlist for Windows process enumeration — so a command that lists or kills child
processes may still trip it. If a second Device Guard block ever names `fastlist`, that is the
source, not pnpm itself.
_2026-08-03_

### Three run-trace fields are persisted but never rendered — is the drawer or the contract wrong?
`RunTrace.context_docs`, `RunTrace.context_skipped` (`server/src/vendor/shared/contracts/trace.ts:122,127`)
and `PromptAssembly.specs_tokens` (`:53`) are written on both the success and the failure path, and
mirrored in the client copy — but `TraceBody.tsx` reads only `trace.specs_read` (`:41,:44`). So
SPEC-01's per-document token sizes and its skip reasons reach a human only from the raw trace JSON
or as run-log lines, which is thinner than the criteria that motivated them intended.
Either the drawer gains three rows, or the contract is carrying data nobody consumes. Worth deciding
before a fourth field is added on the same assumption. Surfaced by `doc-writer` while writing
`server/docs/project-context.md`.
_2026-08-27_
