# Insights — server

Findings about this package specifically. Cross-package findings go in
[../insights.md](../insights.md).

Fixed sections below — append inside the matching one, never overwrite. Each entry: the claim,
the symptom that led to it, and a concrete anchor (`file:line`, a command, or an error string).
Maintained by the [engineering-insights](../.claude/skills/engineering-insights/SKILL.md) skill.

## What Works

## What Doesn't Work

### A module that reads a pull request cannot be tested hermetically — `reviewRepo` is not a `ContainerOverrides` key, so its criteria land in the Docker lane
**Symptom:** a plan put nine of `modules/brief`'s criteria in the hermetic
`server/test/brief.test.ts` and they could not go there. Anything reading a pull request, its
intent, its files or its workspace settings goes through `container.reviewRepo`, which is built
from `db` and has no override slot: `ContainerOverrides` (`src/platform/container.ts:60-77`)
exposes `llm`, `repoIntel`, `depgraph`, `tokenizer`, `httpFetcher`, `conventions`, `context`,
`onboarding` and `brief` — the four repository ports there are the ones somebody needed, and
`reviewRepo` was never added. `vi.mock` is banned in this package, so there is no way round it.
`brief.test.ts` ended up holding 1 of the 20 criteria its plan assigned it; the other 19 run
only in `brief.it.test.ts`.
**Rule:** when planning a new slice's test split, check `ContainerOverrides` *first* and assume
every criterion needing a pull-request row is integration-only. Two ways to keep coverage on a
Docker-less runner: keep the real logic in ring-0 helpers and test those directly with no
container at all (`fitToBudget`, `verifyRefs`, `summariseBlast` are tested this way in
`server/test/brief.test.ts`), or add the missing override key — one line, matching the four
already there. Until one of them happens, a green `server-unit.yml` says nothing about whether
the slice ever calls its model. `src/platform/container.ts:60-77`
_2026-08-28_

### `repo_index_state.status` means "nothing threw", not "the data is there" — never branch a UI state on it
**Symptom:** `status: 'full'`, `files_indexed: 548`, and `file_edges` empty. Every consumer that
depends on the graph — `decl_file` resolution, `file_rank`, blast radius — returned nothing, and
blast reported `state: 'ok'`, i.e. a confident "nothing calls this code" over a measurement that
never happened.
**Rule:** `buildEdges` is deliberately un-throwing (it degrades to `[]` on any cruise failure), so
the pipeline stamps `full` on a run that produced no graph. Branch on the observable count instead:
`stats.edgesWritten === 0` over a non-empty `files_indexed` is `degraded`, and that outranks
whatever `status` claims — see `src/modules/blast/helpers.ts:104`. Zero files stays `ok`; an empty
repository is not a broken index. The same shape applies to any future consumer of
`repo_index_state`: read the counter the pipeline already writes, not its self-assessment.
_2026-08-25_

### A cap applied BEFORE grouping turns other groups into zeros that read as measurements
**Symptom:** `MAX_CALLERS_PER_SYMBOL = 20` was applied as `callers.slice(0, 20)` over the flat
rank-sorted array. On a 130-symbol pull request 77 real callers across 45 symbols became 20 rows
covering 13, and the other 32 rendered "0 callers" — indistinguishable from a symbol nothing calls.
**Rule:** if the question is per-group, cap per group and add a separate total ceiling; the name of
the constant is not the enforcement. Then report what was cut — `cappedSymbols` on the facade
result turns into `state: 'partial'`, `reason: 'callers_capped'`
(`src/modules/repo-intel/service.ts:490`). A budget-produced zero handed over as a complete answer
is the same masking as an empty array standing in for missing data, and it is invisible: nothing
throws and no count looks wrong.
_2026-08-25_

### De-duplicating model output by its TEXT does not work here — the model rewords the same claim every call
**Symptom:** re-scan preservation keyed "already triaged" on `normalizeRule` (lowercase, collapse
whitespace, strip trailing punctuation). Against the real extractor it suppressed **0 of 4** triaged
rules and `stats.suppressed` read 0 while 4 of 6 new `pending` rows were re-wordings of rules the
user had already accepted or rejected — including a **rejected** one coming back as pending:

- accepted `Import shared types using \`import type\` from \`@devdigest/shared\`.`
  → returned as `Import shared types with \`import type\` from the \`…\` package.`
- rejected `UI text should be retrieved via the \`useTranslations\` hook…`
  → returned as `Use \`useTranslations\` from \`next-intl\` for all user-facing strings…`

`temperature: 0` is not the guarantee it looks like: OpenRouter routes each scan to a different
upstream, so wording drifts between runs even at fixed inputs.
**Rule:** key on something the model derives from the CODE, not on its prose. `suppressionKeys`
(`src/modules/conventions/helpers.ts`) matches on either the normalised rule text **or** the verified
evidence anchor `path:line`, which was byte-identical across re-scans in all four cases. Include the
LINE, not just the path or the file set: an `import type` rule and a `useTranslations` rule both cited
`AgentEditor.tsx` + `ConfigTab.tsx`, so a fileset-only key silently merges two distinct rules and
drops one. This generalises to any "did the model already tell me this?" check in this repo.
Regression guard: `test/conventions.it.test.ts` → "a rejected rule stays suppressed when the model
rephrases it" — note the older sibling case passes either way because its mock re-proposes
byte-identical text, which is exactly the case that does not occur in practice.
_2026-08-04_

## Codebase Patterns

### `no-cross-module` blocks reading another module's helper, so a per-feature model override is read from the `settings` TABLE instead
**Symptom:** `modules/conventions/service.ts` needs the workspace's `feature_models.conventions`
override, which `modules/settings/feature-models.ts` already resolves — but importing it trips
depcruise's `no-cross-module` rule (`.dependency-cruiser.cjs:83`), verified by probe.
**Rule:** a new module needing a per-feature model duplicates the resolution against its own
repository rather than importing the settings helper: read the `settings` row, `safeParse` it with
`FeatureModelChoice`, fall back to the `FEATURE_MODELS` registry default. See `resolveModel` in
`src/modules/conventions/service.ts:349` — the duplication is deliberate and commented as such.
_2026-08-04_

### `no-cross-module` fires on a sibling module's *constant* and on its *helper* alike — budget one probe per new module, not one per import
**Symptom:** the entry above records this for `modules/settings/feature-models.ts`. It is not
specific to that file: a new `modules/blast` tripped
`error no-cross-module: src/modules/blast/routes.ts → src/modules/settings/feature-models.ts`,
and a new `modules/diff-review` then tripped
`error no-cross-module: src/modules/diff-review/service.ts → src/modules/reviews/constants.ts`
— a one-line `export const REVIEW_STRATEGY = 'single-pass'`. Two different modules, two
different sibling files, same rule, in one session.
**Rule:** assume every reach into `modules/<other>/` fails, including a bare constant and
including a type-only import, and plan the duplication up front. The three legal shapes are:
read the underlying table through this module's own port (what `blast` does for
`feature_models` via `reviewRepo.settingValue`), restate the constant locally with a comment
naming the file it must stay equal to (what `diff-review` does for the strategy), or restate
the row shape in `ports.ts`. Run `pnpm arch` immediately after writing `ports.ts` and
`routes.ts`, before the rest of the slice — the violation is cheap to fix then and expensive
once the service is typed against the import.
`src/modules/diff-review/service.ts` · `src/modules/blast/notes-service.ts`
_2026-08-14_

**Addendum:** the same rule bites when the thing you want is a sibling's *derived* value rather
than a constant or a row. `modules/brief` needed the blast-radius summary that
`modules/blast/service.ts` already renders; importing it is blocked, so the fourth legal shape
is to re-derive it — declare a narrow port over the shared facade (`BriefIntelReads` names two
of `container.repoIntel`'s eleven methods, `src/modules/brief/ports.ts:120`) and render the
summary again in your own ring-0 helper (`summariseBlast`, `src/modules/brief/helpers.ts`).
The duplication is the rule working, not a smell — but the two renderings can now drift, so say
in the helper's docblock which sibling it parallels.
_2026-08-28_

### `attachCountsByPath` is "attached by any AGENT", not the repository's whole attached set — skill attachments are invisible to it
**Symptom:** a consumer wanting "the project-context documents attached in this repository"
reaches for `ContextRepository.attachCountsByPath(repoId)` and the port comment
(`src/modules/context/ports.ts:87`) is accurate — "How many AGENTS attach each path". The
implementation selects from `agentContextFiles` alone
(`src/modules/context/repository.ts:134-140`); `skillContextFiles` is never unioned in. So a
document attached only to a skill is silently missing, and any caller reasoning about "the
repository's attached documents" is reasoning about a subset.
**Rule:** if you need the full set, union both tables — do not assume this method is it. If a
subset is acceptable, say so in your own port's docblock rather than repeating the broader
phrase, or the next reader inherits the wrong mental model. `modules/brief` takes the subset
deliberately and records why in `src/modules/brief/ports.ts`. Note SPEC-01's injection path
reads *both* (agent attachments then each enabled skill's), so the two readings of "attached"
already coexist in this codebase.
_2026-08-28_

### `server/` now has its own first `db.transaction()`, so the onion skill's "expect 0 today" probe is stale
**Symptom:** `.claude/skills/onion-architecture/SKILL.md` states "There are currently **zero**
`.transaction(` calls in `server/`" and its H9 grep probe reads `rg -n '\.transaction\(' src` —
**expect 0 today**. That is no longer true: `ConventionsRepository.rescanForRepo`
(`src/modules/conventions/repository.ts:164`) wraps its read-existing / delete-pending / insert-fresh
sequence in one, which is the correct call for a multi-write use case (H9).
**Rule:** treat that probe as "every hit must be a deliberate transaction boundary in a repository",
not as "any hit is a violation". When adding one, keep it in the repository and let the service stay
unaware of the handle — `rescanForRepo` takes a pure key function and returns rows, so no Drizzle type
reaches ring 2.
_2026-08-04_

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

### A delegating facade makes a symbol NAME a non-identity, so anything keyed on it merges two declarations
**Symptom:** the blast radius listed `getPull` twice with the same five callers, and `getIntent`,
`getRepo`, `upsertIntent`, `getPrFiles`, `markReviewed` the same way — 19 phantom caller rows in a
list of 136.
**Rule:** `ReviewRepository` forwards every method to `repository/pull.repo.ts`
(`src/modules/reviews/repository.ts:24`), so both files declare the name and `symbols` holds two
rows for it. Key on `(name, decl_file)` wherever symbols are grouped, capped, deduped or sorted —
`references.decl_file` already carries it per row, so no new data is needed, only returning it
(`src/modules/repo-intel/repository.ts:529`). The self-reference guard has to move to the same key:
a reference inside `repository.ts` is not a downstream caller of ITS `getPull` but IS one of the
delegate's. Sorting needs the file as a third key or two rows sharing a name order themselves by
whatever Postgres returned. Reference COUNTS stay keyed on the name alone — "how often does this
repo say `getPull`" is a fact about the name, and a reference tied to neither declaration cannot be
attributed to one.
_2026-08-25_

### A new module whose tables another repository already owns ships NO `repository.ts` — a port the container's existing repo satisfies structurally
**Symptom:** the onion skill's C1–C3 read as "a slice is `routes.ts` → `service.ts` → `repository.ts`
+ `ports.ts`", so a new `smart-diff` module looks like it needs a repository. Writing one puts a
second repository over `pr_files`, `reviews` and `findings` — tables `ReviewRepository` already owns
— which is exactly what C2 forbids. Both readings of the catalog cannot hold.
**Rule:** C3 requires that a repository have a port and that the service depend on the interface; it
does not require the slice to *contain* a repository. Declare the narrow read port in the new
module's `ports.ts`, restating the row shapes structurally (never `db/rows.ts` — that is an import
edge, see the entry above), and hand in the existing repo from the container at the route:
`new SmartDiffService({ reads: app.container.reviewRepo })`. `reviewRepo` satisfies
`SmartDiffReads` with no `implements`, no adapter and no mapper — `tsc` is the only thing that
checks it, and `pnpm arch` is blind to the relationship for the same reason it is blind to `Db`
arriving through `Container`. Reviewed and ruled compliant, not merely tolerated.
`src/modules/smart-diff/ports.ts:51` · `src/modules/smart-diff/routes.ts:24`
_2026-08-08_


### Config normalisation in `platform/config.ts` does not validate containment — the adapter does, so a bad root fails per-request, not at boot
**Symptom:** `DEVDIGEST_CONTEXT_ROOTS=../..` is accepted by `parseContextRoots`
(`server/src/platform/config.ts:75-81`): it trims, strips a leading `./` and trailing slashes, and
drops empties — but nothing rejects a `..` segment or an absolute path. The server boots clean and
the misconfiguration surfaces later as a 500 on `GET /repos/:id/context`, thrown by
`SimpleGitClient.listFiles`'s `path escapes the repo clone` guard.
**Rule:** this is the house split, not an oversight — `config.ts` normalises shape, adapters own
containment, and the guard is deliberately the single enforcement point so it cannot exist twice.
So when adding a path-shaped env var, do **not** add a second containment check in `config.ts`;
instead expect the failure at first use and say so in `.env.example`. If you want it to fail at boot
you are adding a *new* rule, and it belongs next to the adapter's guard rather than duplicating it.
_2026-08-27_


### `DegradedReason` declares `flag_off`, but nothing in `server/src` ever produces it
**Symptom:** a new module needed to tell "repo-intel is switched off" apart from "the index
failed", and `DegradedReason` (`src/modules/repo-intel/types.ts:27`) offers exactly that value.
Branching on it never fired. Grepping `'flag_off'` across `server/src` returns the declaration
and consumers — no producer. The read methods short-circuit on the flag before they reach the
point where they would stamp a reason, so the disabled case arrives looking like empty data.
**Rule:** a consumer that must distinguish the disabled flag has to be handed
`config.repoIntelEnabled` directly; it cannot recover it from the facade's own degradation
signal. Keep the `degradedReason === 'flag_off'` branch as well — it costs nothing and becomes
correct the day the pipeline starts emitting it — but never let it be the only path.
Generalisation worth carrying: a union member that no code path constructs is not a contract,
it is a comment, and `tsc` will never tell you which is which.
_2026-08-27_

### `seed.ts`'s insert-if-absent guards mean a field ADDED to a seeded row never reaches an existing dev database
**Symptom:** PR #482's `pr_files` gained real `patch` values so a finding could be frozen into an
eval case. On a fresh database that worked; on the dev database that already had #482 it did
nothing, because the whole block is inside `if (!pr) { … }` (`src/db/seed.ts:108`) and the same
shape guards agents, skills and the control-experiment PRs. The feature then failed with "no
stored patch" on exactly the data the demo is built around.
**Rule:** a seed change that ENRICHES an existing row has to go in a pass placed *after* the
guard, written to be idempotent on its own terms (`if (row.x) continue;` per row) — not inside the
creation branch. The eval block at the end of `seed()` is the worked example: it back-fills the
review's `agent_id` and the findings' accept/dismiss stamps, then inserts cases keyed on
`(owner, name)`. Judge every seed edit by "what does this do to a database that already ran the
old seed", because that is the only database a person actually has.
_2026-08-29_

### A seeded PR patch's `@@` lengths are unchecked by this repo's parser, and three of the four shipped fixtures disagreed with their own bodies
**Symptom:** adding PR #485 to `CONTROL_EXPERIMENT_PULLS` and asserting the fixtures against
`parseUnifiedDiff` failed on code nobody had touched: `#483 src/lib/discount.test.ts` declared
`@@ -0,0 +1,9 @@` over 8 added lines, and both of #484's files were off by two. Nothing had ever
surfaced it, because `parseUnifiedDiff` (`src/adapters/git/diff-parser.ts:47-58`) seeds its cursor
from `newStart` and counts the body itself — the declared lengths are stored on the hunk and never
read again.
**Rule:** when hand-authoring a seed patch, treat the lengths as documentation that must still be
true: `git apply` and every non-toy parser reject a mismatch, and the `additions`/`deletions` next
to them go onto the `pull_requests` row and into the UI. `newStart` is the field that actually
matters — get it wrong and every finding on that file is cited at a line the grounding gate then
drops. `test/seed-pulls.test.ts` now pins header-vs-body, counters-vs-body, one-file-per-patch,
and "no `diff --git` inside the patch" for every fixture.
_2026-08-30_

### `enabled: false` on an agent blocks "Run all" but NOT an explicit run — which is what makes a seeded experiment fixture safe
**Symptom:** seeding a fifth agent ("Security Reviewer (control)") looked like a choice between
polluting every "Run all" with an extra billed agent, or seeding it disabled and hoping it could
still be run at all.
**Rule:** `ReviewService.resolveTargets` (`src/modules/reviews/service.ts:65-75`) checks the flag
on ONE branch only — `all: true` resolves through `agents.listEnabled`, while `agentId` goes
through `getById` with no flag check. The eval pipeline's `requireAgent` likewise only checks
existence. So a disabled agent is invisible to fan-out and to the dashboard's enabled list, yet
still appears in the Run Review dropdown (which lists agents regardless of the flag) and still
runs its eval set. That combination is the right shape for any fixture agent you want available
but never automatic.
_2026-08-30_

### A skill survives blanking the system prompt, so a prompt-ablation experiment on an agent with skills measures the wrong thing
**Symptom:** the obvious way to test "does the system prompt matter" is to clear the prompt on the
built-in Security Reviewer and re-run. That agent has `secret-leakage-gate` and `lethal-trifecta`
linked (`src/db/seed-skills.ts:186-188`), and both keep instructing the model after the prompt is
gone.
**Rule:** skills are resolved independently of `systemPrompt` and rendered as their own
`## Skills / rules` section in the USER message (`run-executor.ts` → `reviewer-core/src/prompt.ts`),
so nothing about clearing the system prompt removes them. An ablation agent must have zero skills
attached, or the arm you think is "no guidance" still carries the guidance that matters most.
The seeded `Security Reviewer (control)` is deliberately absent from `SEED_AGENT_SKILLS` for
this reason.
_2026-08-30_

## Tool & Library Notes

### A model schema handed to `completeStructured` may not carry `.default()` or `.transform()` — its Zod input and output types must be identical
**Symptom:** mirroring the persisted contract into the model contract looked obvious and would
not compile. `StructuredRequest<T>` types its schema as `ZodType<T, ZodTypeDef, T>`
(`src/vendor/shared/adapters.ts:55-70`), so input and output must be the same type. A
`z.array(...).default([])` makes the input optional and the output required, the two `T`s stop
matching, and the schema is rejected at the call site rather than at the schema definition —
so the error points at `completeStructured`, not at the field that caused it.
**Rule:** keep the two schemas separate on purpose. The **model** schema is strict, every field
required, no defaults — which also matches OpenAI's `strict: true` json_schema mode, where
optional keys are forbidden anyway (`src/adapters/llm/openai.ts:103-106`). Absent-key tolerance
belongs on the **persisted** contract instead, where a document round-tripping through jsonb
needs `.nullish()` and `.default([])` to parse older rows (root `insights.md:97-106`). Writing
one schema for both jobs is the mistake. See `PrBriefGeneration` beside `PrBrief`,
`src/modules/brief/ports.ts`.
_2026-08-28_

### dependency-cruiser hides `import type` unless `tsPreCompilationDeps` is on, and that is how DI calls go unresolved
**Symptom:** `file_edges` had 977 rows and none of them type-only. `pipeline/full.ts` calls
`repository.getRepoBasics()` and imports `RepoIntelRepository` from `../repository.js`, yet no
`full.ts → repository.ts` edge existed, so `references.decl_file` stayed NULL and blast radius
reported 0 callers for 22 real methods.
**Rule:** the default output is *post-compilation* dependencies, and `import type` does not survive
compilation. In this codebase a typed parameter IS the dependency — narrow DI passes the object in
and only the annotation names its module — so without the flag every call through an injected
object is unresolvable. Set `tsPreCompilationDeps: true` in the adapter's cruise options
(`src/adapters/depgraph/index.ts:66`); it needs no tsconfig, which matters because this repo has no
root one. `.dependency-cruiser.cjs:114` has carried the flag for `pnpm arch` from the start, so the
two were measuring different graphs. Measured: 977 → 1130 edges, resolved references 1103 → 1308.
`enhancedResolveOptions` changes nothing here — don't add it.
_2026-08-25_

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


### Windows refuses unprivileged FILE symlinks but allows directory junctions — gate the case, never absorb it
**Symptom:** a containment test that must prove a symlink pointing outside the clone is neither read
nor listed cannot create its fixture: `symlink(target, link)` fails `EPERM` on this box, while
`symlink(dir, link, 'junction')` succeeds. The tempting repair is to fold the two cases into one
assertion — `expect(fileLinked || dirLinked).toBe(true)` — which turns a case that never executed
into a green tick.
**Rule:** probe the capability once at module scope and gate with `canFileSymlink ? it : it.skip`
plus a `console.warn`, so the runner prints `[adapters] file symlinks unavailable (EPERM) — the
symlinked-FILE case is SKIPPED` and the skip is visible in the lane summary. Keep the
directory-junction case separate and unconditional — it exercises the same
`if (entry.isSymbolicLink()) continue;` guard, which does not branch on file-vs-directory, so local
coverage stays real while the file case runs on Linux CI. `server/test/adapters.test.ts:114-135`
(the gate) and `:265-268` (the junction fixture, which is a plain symlink on Linux).
_2026-08-27_


### `pnpm typecheck` never looks at `server/test/` — a type error there ships silently
**Symptom:** `tsconfig.json`'s `include` is `src/**/*.ts` only, so `tsc --noEmit` compiles no test
file. vitest transpiles rather than type-checks, so nothing in either CI lane reads test types
either. There is already a live example: `MockLLMProvider`'s constructor is typed
`'openai' | 'anthropic'` (`src/adapters/mocks.ts`) while `test/conventions.it.test.ts` passes
`'openrouter'` — an error that has never been reported because no tool is looking.
**Rule:** a green `pnpm typecheck` says nothing about the tests. When a test needs a shape it
does not yet have — a wider provider union, a new override key — the compiler will not stop you
and the suite will still pass; the mismatch surfaces later as a runtime surprise in an unrelated
change. Either widen the mock deliberately as its own change, or route around it and say so.
Do not read a passing typecheck as coverage of `test/`.
_2026-08-27_

### Folding a late change into the migration you just generated means rolling back THREE drizzle-kit files
**Symptom:** `pnpm db:generate` had already emitted `0017_bouncy_exodus.sql` for the new
`eval_cases` / `eval_runs` columns. Declaring two indexes in the schema and regenerating produced
a *second* migration holding only the `CREATE INDEX` lines — drizzle-kit diffs the schema against
`meta/<NNNN>_snapshot.json`, never against the previous `.sql`.
**Rule:** to fold the change into the migration you just made, delete all three of
`src/db/migrations/<tag>.sql`, `src/db/migrations/meta/<NNNN>_snapshot.json` **and** the matching
object in `entries[]` of `meta/_journal.json`, then regenerate. Deleting only the `.sql` is the
trap: the snapshot still claims the columns exist, so the next generate emits *nothing* and the
columns silently never migrate. Two migrations is the correct answer once one has been applied
anywhere — this rollback is only for a generate that has not left the working tree.
`server/src/db/migrations/meta/_journal.json`
_2026-08-29_

## Recurring Errors & Fixes

## Session Notes

## Open Questions
