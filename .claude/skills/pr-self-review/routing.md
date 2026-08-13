# Routing — changed path to review lane

One lane per skill grouping. A lane runs **only if it matched at least one changed file**;
`invariants` always runs. Match against the path as git reports it, repo-relative, forward slashes.

| Lane | Matches | Loads |
|---|---|---|
| `ui-react` | `client/src/**/*.tsx`, `client/src/**/styles.ts` | `react-best-practices` |
| `ui-structure` | any `client/**` file added, moved, or renamed; a new folder under `src/app/**/_components/` or `src/components/`; any change to a barrel `index.ts`; any new import of `@devdigest/ui` or `@devdigest/shared` | `frontend-ui-architecture` |
| `ui-next` | `client/src/app/**/{layout,page,route,loading,error,not-found,template}.{ts,tsx}`, `client/next.config.mjs`, `client/middleware.ts`, any file gaining or losing `'use client'` | `next-best-practices` |
| `ui-tests` | `client/src/**/*.test.{ts,tsx}`, `client/vitest.config.ts`, `client/src/test/**` | `react-testing-library` |
| `api-fastify` | `server/src/modules/*/routes.ts`, `server/src/app.ts`, `server/src/server.ts`, `server/src/modules/index.ts`, `server/src/platform/**` | `fastify-best-practices` |
| `arch-onion` | anything under `server/src/modules/**`, `server/src/adapters/**`, `server/src/platform/**`, `server/src/db/**`, `reviewer-core/src/**` | `onion-architecture` |
| `arch-mcp` | `mcp/src/**` | `onion-architecture` — same rings, but `pnpm arch` does not cover `mcp/`; verify with the grep probes in `mcp/README.md` |
| `data-drizzle` | `server/src/db/schema/*.ts`, `server/src/db/schema.ts`, `server/drizzle.config.ts`, `server/src/db/{client,rows,migrate,seed}.ts`, `server/src/db/migrations/*.sql` | `drizzle-orm-patterns`, `postgresql-table-design` |
| `contracts-zod` | `{server,client}/src/vendor/shared/**/*.ts` | `zod` |
| `security` | `server/src/adapters/**`, `mcp/src/adapters/**`, `server/src/modules/*/routes.ts`, plus any diff introducing an endpoint, auth check, secret, file upload, or a new path from request input to a query, a shell, or the filesystem | `security` |
| `types` | `**/tsconfig.json`, `**/vitest.config.ts`, and any diff adding a generic, conditional type, `as` cast, or non-null `!` | `typescript-expert` |
| `invariants` | always | no skill — [invariants.md](invariants.md) |

Not reviewed at all: `server/clones/**`, `**/node_modules/**`, `pnpm-lock.yaml`,
`package-lock.json`, `**/migrations/meta/*.json`.

`e2e/**` has no governing skill. Route `e2e/specs/*.flow.json` and `e2e/run.ts` to `invariants`,
which reads `e2e/CLAUDE.md`. Say in the report that e2e had no skill lane.

## What each lane is told

Every brief carries, in this order:

1. **Your skill(s).** Load them before reading the diff. Their rules are the ones you apply.
2. **Your slice only.** The changed files matched to your lane, with their per-file diff. Do not
   review files outside it — another lane owns them.
3. **The `insights.md` of the module you are reviewing** (`client/`, `server/`, `reviewer-core/`,
   `e2e/`, or root for cross-package). Treat entries as high-confidence rules. A finding that
   contradicts one is itself worth reporting.
4. **The severity policy** — Step 5 of [SKILL.md](SKILL.md). You propose a severity; the merge step
   caps it. Never invent a scale of your own.
5. **The do-not-flag list**, below.
6. **The output contract.** `Finding[]` per
   [findings.ts](../../../server/src/vendor/shared/contracts/findings.ts): `id`, `severity`,
   `category`, `title`, `file`, `start_line`, `end_line`, `rationale`, `suggestion`, `confidence`.
   `start_line`/`end_line` must be **new-side** line numbers inside a real hunk — ungrounded
   findings are dropped, so a guessed line number is a wasted finding.

## Do not flag — this repo, specifically

Each of these is a deliberate decision. Reporting one is a false positive that costs the gate its
credibility.

- The empty tables in `server/src/db/schema/{ci,eval,knowledge,skills,context,ops}.ts` and the
  unused namespaces in `client/messages/en/*.json` (`blast`, `brief`, `conformance`, `conventions`,
  `eval`, `memory`, `skills`, `compose`) are **intentional scaffolding** for lessons L01–L08, per
  root `CLAUDE.md` § *Do not touch*. Never "dead code", never "unused", never propose deleting them.
- **No lint or format tooling exists repo-wide, on purpose.** Never propose ESLint, Biome or
  Prettier, and never report formatting as a finding. `pnpm arch` is dependency-cruiser, not a
  linter.
- **pnpm in `server/` and `client/`, npm in `reviewer-core/` and `e2e/`** is correct, not an
  inconsistency. There is no root `package.json` and no workspace tool; that too is deliberate.
- The **duplicated `vendor/shared/` copies are deliberate**, and `adapters.ts`, `eval-ci.ts`,
  `knowledge.ts`, `productionize.ts` and `trace.ts` are **already diverged today**. Only a diff that
  *newly* changes one copy without the other is a finding.
- `client/src/**/styles.ts` export **Tailwind class strings**, not CSS-in-JS. There is no
  styled-components, emotion or runtime style engine here.
- `client/` has **no route handlers, no server actions, no middleware, and no
  `loading`/`error`/`not-found` files**; data goes through `client/src/lib/api.ts`. Their absence is
  the pattern. A *new* one is worth reviewing; the absence is not.
- `@devdigest/shared` is **type-only on the client** by necessity, and `client/src/vendor/ui/`
  carries no `'use client'` directive by design. Both are recorded decisions, not oversights.
- The 27 pre-existing onion violations baselined in
  `server/.dependency-cruiser-known-violations.json` are known debt. `pnpm arch` already hides them.
  Do not re-report them unless the diff touches those exact lines.
- Reviewers are **read-only**. Never edit, never stage, never commit.

## The bar

A finding qualifies only if all four hold:

1. It is caused by **this diff**, on a line inside a real hunk.
2. It states what to do instead, not merely that a hazard exists.
3. Its `confidence` is honest. Below 0.5, drop it; a CRITICAL below 0.8 will be downgraded anyway.
4. A named rule backs it — a skill rule, an `insights.md` entry, a `CLAUDE.md` contract, or a
   concrete failure you can describe. Never cite a rule id you did not read.

If a lane finds nothing, say `no findings in <lane>`. An invented finding is worse than an empty
lane, and padding a lane to look thorough is the one failure that makes the whole gate untrustworthy.
