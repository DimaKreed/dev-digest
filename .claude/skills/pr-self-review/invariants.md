# Invariants — the mechanical pre-pass

Deterministic checks. No model judgement, no subagent. These are the findings most likely to
actually fire on a real diff, and the reason the gate is worth having at all: a generic reviewer
cannot know any of them.

Run every check whose trigger the diff touches. Record each as a `Finding` with
`category: 'bug'` unless noted, `confidence: 1.0` (they are mechanical), and a
`blocking[].reason` from the slug column.

## CRITICAL — these block

| Trigger in diff | Check | reason slug |
|---|---|---|
| `server/src/vendor/shared/**` or `client/src/vendor/shared/**` | the same file changed in **one** copy only ⇒ the contract diverged | `contract-copies-diverged` |
| `**/tsconfig.json` `paths` changed | the alias is **not** mirrored in that package's `vitest.config.ts` — tsconfig paths are not honoured by vitest, so tests resolve differently from `tsc` | `alias-not-mirrored` |
| `**/vendor/shared/contracts/findings.ts` | a value added to or removed from `Severity`, `FindingCategory`, `FindingKind` or `Verdict` | `output-vocabulary-changed` |
| `server/src/db/schema/{ci,eval,knowledge,skills,context,ops}.ts` | a **deletion** — this is lesson scaffolding per root `CLAUDE.md` § *Do not touch* | `do-not-touch-deleted` |
| `client/messages/en/*.json` | a namespace key **removed** from `blast`, `brief`, `conformance`, `conventions`, `eval`, `memory`, `skills`, `compose` | `do-not-touch-deleted` |
| any `server/test/**` or `server/src/**/*.test.ts` | the file imports `test/helpers/pg.ts` but its name lacks `.it.test.ts` — the CI lanes split on that exact substring, so it would run in the unit lane with no Postgres | `test-lane-mismatch` |
| any new config or script | an ESLint / Biome / Prettier config appears, or a `lint` script is added to any `package.json` | `lint-tooling-introduced` |
| `reviewer-core/src/**` | an import of `fs`, `node:*`, `postgres`, `octokit`, `drizzle-orm`, or a use of `process.env`, `Date.now()`, `new Date()`, `Math.random()`, `fetch(` — ring 0 must stay pure (onion `C5`) | `ring-0-impure` |
| `server/src/modules/*/routes.ts` | an import of `drizzle-orm` or `db/schema`, or a use of `container.db` — SQL in a transport handler (onion `C1`) | `onion-c1` |
| `server/**` or `reviewer-core/**` | **`cd server && pnpm arch`** reports anything — a *new* dependency-cruiser violation | `new-arch-violation` |
| `server/.dependency-cruiser-known-violations.json` | the file was regenerated, or its violation count went **up**. The baseline only ever shrinks | `arch-baseline-regenerated` |
| `client/**` | `@devdigest/shared` imported **without** `import type` — a runtime import pulls `vendor/shared/index.ts` into the bundle and its `./contracts/*.js` re-exports break the Next build | `shared-runtime-import` |
| `client/**` | a deep import of `src/vendor/ui/{primitives,kit,charts,shell}` instead of the `@devdigest/ui` barrel | `ui-barrel-bypassed` |
| `.claude/agents/*.md` | the out-of-band YAML check fails: `tools` is not a string, `skills` is present but not an array, a `skills` entry has no `.claude/skills/<name>/SKILL.md`, a Skill-only key (`allowed-tools`, `disable-model-invocation`) is present, or a tool that agent's README documents as withheld appears in `tools` | `agent-frontmatter-invalid` |
| touched packages | `typecheck` fails | `does-not-typecheck` |

## WARNING

| Trigger | Check | reason slug |
|---|---|---|
| `server/src/db/migrations/meta/*` | hand-edited — these are drizzle-kit generated snapshots | `generated-file-edited` |
| `reviewer-core/**` changed | `.github/workflows/server-integration.yml` has no `reviewer-core/**` path filter, so the integration lane will not run | `ci-filter-gap` |
| `client/src/vendor/shared/**` changed | `.github/workflows/reviewer-core.yml` filters only `server/src/vendor/shared/**` | `ci-filter-gap` |
| `server/src/modules/*/service.ts` | signature mentions `Db`, `PostgresJsDatabase`, `$inferSelect` or `db/rows` (onion `H8`), or the constructor takes `Container` (onion `H7`) | `onion-high` |
| `client/src/app/<a>/_components/**` | imported from a different route's tree — routes may not reach sideways | `cross-route-import` |
| `client/src/**` | a new `src/hooks/`, `src/utils/`, `src/types/`, `src/styles/`, `src/store/` or `src/services/` folder — the six-folder layout is fixed | `forbidden-folder` |
| typecheck | skipped because `node_modules` is absent. **Never** record this as a pass | `typecheck-skipped` |

## Commands

```bash
# the architecture gate — exits non-zero only on a NEW violation (--ignore-known)
cd server && pnpm arch

# typecheck, only for packages the diff touches. Note the package manager per directory.
cd client        && pnpm typecheck
cd server        && pnpm typecheck
cd reviewer-core && npm run typecheck
cd e2e           && npm run typecheck
```

Agent frontmatter, when the diff touches `.claude/agents/*.md`. One `PASS`/`FAIL` line per agent,
non-zero exit on any failure. Run it from the repo root; it finds the YAML parser in
`server/node_modules/yaml` itself, so no `cd` and no package manager are involved:

```bash
node scripts/check-agent-frontmatter.mjs
```

It fails an agent file when: the frontmatter does not parse as YAML; `name` differs from the
filename stem; `description` is missing or 120 characters or shorter (a `: ` inside an unquoted
scalar truncates it silently); `tools` is anything other than a comma-separated string; `skills` is
present but not an array, or present at all on `plan-verifier`; a `skills` entry has no
`.claude/skills/<name>/SKILL.md`; a Skill-only key (`allowed-tools`, `disable-model-invocation`) is
present; a tool name is unknown, or `Write`/`Edit` appears in `architecture-reviewer` or
`plan-verifier`; or `model` is not one of `opus | sonnet | haiku | inherit`. The preloaded
`SKILL.md` byte total it prints per agent is advisory and does not affect the exit code.

[.claude/agents/README.md](../../agents/README.md) § *Authoring a new agent* carries the reasoning
behind each trap; the script at
[scripts/check-agent-frontmatter.mjs](../../../scripts/check-agent-frontmatter.mjs) is the single
copy of the logic, so this section and that one cannot drift apart.

Grep probes, from the repo root — intersect every hit with the changed-file list before reporting:

```bash
rg -n "container\.db|from 'drizzle-orm'|db/schema" server/src/modules/*/routes.ts
rg -n "process\.env|Date\.now|Math\.random|new Date\(|fetch\(" reviewer-core/src
rg -n "from '@devdigest/shared'" client/src            # every hit must be `import type`
rg -n "vendor/ui/(primitives|kit|charts|shell)" client/src
rg -n "test/helpers/pg" server/test server/src
rg -n "eslint|prettier|biome" --glob '**/package.json' --glob '!**/node_modules/**'
```

Contract-copy divergence, given the changed-file list:

```bash
# for each changed path under either vendor/shared, the mirror must also be in the list
diff -q server/src/vendor/shared/contracts/<f>.ts client/src/vendor/shared/contracts/<f>.ts
```

`adapters.ts`, `eval-ci.ts`, `knowledge.ts`, `productionize.ts` and `trace.ts` **already differ** —
so `diff -q` alone proves nothing. The finding is *"this diff changed one copy and not the other"*,
computed from the changed-file list, not from comparing the files.

## Reporting

Record `checks.arch` and `checks.typecheck` in the report as structured status **and** emit a
CRITICAL finding for each failure, so the gate holds even if one path is missed. Set
`checks.tests.status` to `"not-run"` — tests are deliberately not run here, CI runs them, and a pass
must never read as a green suite.

For a change under `.claude/agents/**`, record the script above as the evidence. It is a
*frontmatter* check: a clean run proves the file parses and grants what it should, never that the
agent behaves. Say which in the report.

The registry does pick up a new agent mid-session, so a smoke invocation is available and is worth
running — but it is a judgement call about behaviour, not a mechanical check, and it does not
belong in this pre-pass. If `Agent type '<name>' not found` still comes back, the script is what
separates a malformed file from a registry that has not caught up. Do not edit frontmatter that
the script just passed.

A clean pre-pass is the normal outcome. Say `no invariant violations` rather than manufacturing one.
