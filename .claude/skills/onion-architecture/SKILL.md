---
name: onion-architecture
description: Forces onion layering on backend work in server/ and reviewer-core/ — ring model, repository ports, narrow dependency injection, transaction boundaries, and the container test seam. Use before adding or editing anything under server/src/modules/ (routes.ts, service.ts, repository.ts), server/src/adapters/, server/src/platform/container.ts, server/src/db/, or reviewer-core/src/ — and whenever a change would put SQL in a route handler, an SDK outside adapters/, or a Drizzle type in a service signature. Also use when the user invokes /onion-architecture or asks to audit backend layering, check architecture boundaries, review dependency direction, or run pnpm arch. Trigger terms: onion architecture, clean architecture, hexagonal, ports and adapters, layering, repository pattern, dependency direction, container.db, depcruise, new endpoint, new module, new service, new repository.
argument-hint: "[optional: module name, or \"audit\" to review the current diff]"
---

# Onion architecture (backend)

Applies to `server/`, `reviewer-core/` and `mcp/`. Two modes:

`mcp/` is in scope for the **rules** but not for the mechanical check: `pnpm arch` runs
`depcruise src` from `server/` and `.dependency-cruiser.cjs` is scoped to `server/src`, so it
never sees that package. Its ring boundaries are held by the grep probes in `mcp/README.md`
instead, and its ring map lives in `mcp/CLAUDE.md`. Two readings settled there and worth
carrying: an MCP SDK is transport framework (rings 4–5, as Fastify is here), while a raw
`fetch` is a true adapter; and C2/C3/H8/H9/M12 simply do not apply to a package with no
database.


- **Design** — before writing backend code, place each new file in a ring and obey the rule
  catalog. Read this first; it overrides habit.
- **Audit** — on `/onion-architecture` or before a commit, run the procedure below and report
  violations with severity.

## The one rule

> All code can depend on layers more central, but code cannot depend on layers further out from
> the core. — Palermo, 2008

Two corollaries that do the actual work here: **inner rings declare interfaces, outer rings
implement them**, and **the database is not the center — it is external**. Sources and rationale:
[references.md](references.md).

## Rings — mapped onto this repo

| Ring | Lives in | May import |
|---|---|---|
| 0 · Domain core (pure) | `reviewer-core/src/{prompt,grounding,review,output}`, `modules/*/{helpers,constants,status}.ts` | ring 0, plus type-only contracts |
| 1 · Ports & contracts | `vendor/shared/adapters.ts`, `vendor/shared/contracts/`, `modules/*/ports.ts` | ring 0, `zod` |
| 2 · Application (use cases) | `modules/*/service.ts`, `reviews/run-executor.ts`, `repo-intel/pipeline/*` | rings 0–1 |
| 3 · Infrastructure | `adapters/**`, `db/**`, `modules/*/repository.ts`, `modules/*/repository/*.repo.ts` | rings 0–2 |
| 4 · Transport | `modules/*/routes.ts` | rings 0–2 — never ring 3 |
| 5 · Composition root | `app.ts`, `server.ts`, `platform/container.ts` | everything |

Three things the table doesn't carry:

- **The repository is ring 3, not ring 2.** It *implements* a port declared inward. Persistence is
  infrastructure like any other adapter — that framing is the piece currently missing.
- **`modules/<domain>/ports.ts` is where a repository port and its domain row types belong.** Not
  `vendor/shared/` — that directory is duplicated into `client/src/vendor/shared/` and repository
  ports are server-only. Putting row types here instead of in `repository.ts` is also what breaks
  the `helpers.ts → repository.ts` cycle that exists today in `agents`.
- **Vertical before horizontal.** A module is a slice that owns its own rings top to bottom. Never
  reach into a sibling slice; go through the container or `vendor/shared`.

## CRITICAL — boundaries (C1–C6)

These block. A diff that introduces one is not done.

- **C1** `routes.ts` never imports `drizzle-orm` or `db/schema`, and never touches `container.db`.
  A handler resolves context, calls **one** service method, and returns — 2–5 lines, as in
  [reviews/routes.ts](../../../server/src/modules/reviews/routes.ts). SQL in a handler is how
  `pulls/routes.ts` reached 390 lines with write-on-GET inside a read endpoint.
- **C2** Every DB read/write goes through `modules/<domain>/repository.ts`. One repository owns a
  table, and says so in its header comment ("the ONLY place that touches `x`") — the existing
  charter in `repos` and `reviews` is the model.
- **C3** Every repository has a port interface in `modules/<domain>/ports.ts`; the service depends
  on the interface. Without it, substitution is impossible and tests resort to
  `(svc as unknown as {repo: …}).repo = …` — which is what `repo-intel` tests do today.
- **C4** No third-party SDK import outside `src/adapters/` — `octokit`, `openai`,
  `@anthropic-ai/sdk`, `simple-git`, `postgres`, `@ast-grep/napi`, `@vscode/ripgrep`. This one
  rule is why the whole test suite runs with zero API keys and zero module mocking.
- **C5** Ring 0 is pure: no `fetch`, `fs`, `node:*`, `process.env`, `Date.now()`, `new Date()`,
  `Math.random()`, no DB, no SDK. Take data in, return data out. `reviewer-core/CLAUDE.md` states
  this as a contract — an import that breaks it is the one change to push back on.
- **C6** `adapters/**` and `platform/**` never import `modules/**`. `platform/container.ts` is the
  single exception, because it *is* the composition root. An adapter that needs a module's
  constant means the constant is in the wrong place — move it inward.

## HIGH — injection, types, atomicity (H7–H11)

- **H7** A service constructor takes a **narrow deps object typed by ports**, not `Container`.
  `Container` is a composition-root concern; passing it hands every service the whole world and
  makes its real dependencies invisible.

      constructor(private deps: { pulls: PullRepositoryPort; github: () => Promise<GitHubClient> }) {}

- **H8** `Db`, `PostgresJsDatabase`, `typeof t.X.$inferSelect` and the `db/rows.ts` aliases
  (`PullRow`, `AgentRow`, `FindingRow`) must not appear in a signature at ring 2 or above. A
  service typed in persistence terms cannot outlive a schema change.
- **H9** A use case that writes more than once wraps the writes. Declare a port, implement it over
  `db.transaction`, and let repository methods take an optional handle:

      // ports.ts (ring 1) — the application layer never names a Drizzle type
      export interface UnitOfWork { withTransaction<T>(fn: (tx: TxHandle) => Promise<T>): Promise<T> }

  Repositories default to their own handle when no `tx` is passed, so they still work standalone.
  `server/` has **one** `.transaction(` call today — `ConventionsRepository.rescanForRepo`
  (`src/modules/conventions/repository.ts`), which wraps read-existing / delete-pending /
  insert-fresh and is the shape to copy. At least four other multi-write sequences are still
  non-atomic; do not add a fifth.
- **H10** Validation is schema-first: declare Zod `params` / `body` / `response` on the route and
  let the type provider reject with 422 before the handler runs. No hand-rolled `.parse()` in a
  handler.
- **H11** Ports stay narrow — one role, one interface. `LLMProvider` has four methods of which
  `reviewPullRequest` uses one, so every fake must stub three dead methods and one test hand-rolls
  a recorder to get around it. Split by role rather than growing a port.

## MEDIUM — model purity (M12–M15)

Advice. Apply when already touching the file; don't open a refactor for these.

- **M12** Prefer a domain type plus an explicit row→domain mapper over passing Drizzle rows
  upward. Row→DTO mappers already exist in `*/helpers.ts` — extend that habit inward.
- **M13** **Data-in beats port-in for the pure core.** Hand `reviewPullRequest` a materialized
  `UnifiedDiff` and pre-resolved strings, not a `GitClient` or a DB handle. This is the best
  decision already in the codebase — `run-executor.ts` resolves everything, then calls the engine.
- **M14** No module-level mutable singletons. `platform/sse.ts` exports a live `runBus`, so run
  state is shared across every app instance including tests. Construct in the container.
- **M15** No external presentation format inside the core — GitHub markdown and severity emoji in
  `reviewer-core/src/output/to-review.ts` is knowledge of another system's wire format sitting in
  ring 0.

## Test seams

- Substitute at the container seam — `buildApp({ overrides })` / `ContainerOverrides` plus
  `adapters/mocks.ts` — and drive HTTP with `app.inject()`. **Never `vi.mock`.** There is no module
  mocking anywhere in this repo and it must stay that way; the DI seam replaces it.
- `ContainerOverrides` currently covers adapters only. **Adding repository-port keys is what makes
  C3 pay off** — a service then becomes unit-testable with no Docker and no casts.
- Fakes implement the port by hand and validate their fixtures through the real Zod schema, the way
  `MockLLMProvider` does. A fixture that can't parse is a broken fake, not a passing test.
- `*.it.test.ts` is mandatory for any test importing `test/helpers/pg.ts` — the CI lanes split on
  that exact string.

## The mechanical check — `pnpm arch`

`server/.dependency-cruiser.cjs` encodes C1, C2, C4, C5, C6 and H8 as `forbidden` rules, plus
`no-cross-module` and `no-circular`. Rule ids there map one-to-one to the ids above; **changing a
rule in one place means changing it in the other**. C3, H7, H9–H11 and M12–M15 are not structurally
detectable — they are the grep probes and review judgement below. It adds no dependency — `dependency-cruiser` is already a runtime
dependency of `server/` (`adapters/depgraph` uses it as a library). It is not a linter, and this
repo still has no ESLint/Biome/Prettier.

```bash
cd server
pnpm arch        # gate: exits 0 unless the diff adds a NEW violation
pnpm arch:all    # the full debt list — 27 known violations, see the table below
```

The 27 pre-existing violations are baselined in `.dependency-cruiser-known-violations.json`, so
`pnpm arch` is silent on them and loud on anything new. **Never regenerate that baseline to make a
failure go away** — fix the import direction instead. It is regenerated only when debt is genuinely
paid down, with `pnpm exec depcruise src --config .dependency-cruiser.cjs --output-type baseline
--output-to .dependency-cruiser-known-violations.json`, and the count in this file goes down.

C3 and C5-in-`reviewer-core` cannot be expressed structurally. Grep probes, run from `server/`:

```bash
rg -n 'container\.db' src/modules/*/routes.ts                                    # C1
rg -n 'export (interface|type) \w*Repository' src/modules/*/ports.ts             # C3 — should exist
rg -n 'process\.env|Date\.now|Math\.random|new Date\(|fetch\(' ../reviewer-core/src  # C5
rg -n 'constructor\(\s*(private |readonly )?\w*container' src/modules/*/service.ts   # H7
rg -n '\$inferSelect|PostgresJsDatabase|db/rows' src/modules/*/service.ts        # H8
rg -n '\.transaction\(' src              # H9 — every hit must be a repository boundary, not 0
```

## Audit mode — procedure

1. Scope the diff: `git diff --name-only` against the base. Only changed files are in scope.
2. Run `pnpm arch`. Any output is a new violation — report it.
3. Run the grep probes above, then intersect the hits with the changed files.
4. Classify each hit against the catalog: CRITICAL / HIGH / MEDIUM.
5. Report one line per finding: `SEVERITY · rule-id · file:line · what to do instead`. Report
   CRITICAL and HIGH always. Report MEDIUM only when the diff already touches that file.
6. Skip anything wholly inside the known-debt table below, unless the diff touches it — then the
   rule applies to the changed lines.

A clean diff is a valid and common result. Say `no onion violations in this diff` rather than
manufacturing a MEDIUM to look thorough.

## Known debt — anti-examples, do not copy

`pnpm arch:all` reports **27 violations** today. Every one is real; none is a mis-written rule.
Read these files as counter-examples, never as templates.

| Location | Violation | Rule | Count |
|---|---|---|---|
| `modules/{pulls,polling,settings,workspace}/routes.ts` | direct `drizzle-orm` + `db/schema`; no service, no repository. `pulls` alone: 18 `container.db` calls, GitHub sync and delete+reinsert inside GET handlers | C1 | 8 |
| ↳ plus `settings/feature-models.ts`, `reviews/run-executor.ts`, `reviews/diff-loader.ts`, `repos/helpers.ts` | reach `db/schema` from outside a repository | C2 | 8 |
| `modules/repos/helpers.ts` | a "pure functions only" file importing `db/schema` | C5 | 1 |
| `adapters/{depgraph,astgrep}/index.ts` | adapter imports `modules/repo-intel/constants` | C6 | 2 |
| `adapters/auth/local.ts` | adapter imports `db/seed.ts` (a seed script) and queries Drizzle directly | C6 | 2 |
| `modules/repos/service.ts` | reaches into the `repo-intel` slice for constants | no-cross-module | 1 |
| `platform/container.ts` ↔ `modules/repo-intel/*` | composition root imported back by the slice — 4 cycles | no-circular | 4 |
| `modules/agents/helpers.ts` ↔ `repository.ts` | pure helper imports row types from the repository | no-circular, H8 | 1 |

Not machine-detectable, equally load-bearing:

- **Every** repository is a concrete class with no port; `Db` and `$inferSelect` are in their
  signatures (C3, H8).
- **Every** service is `constructor(private container: Container)` and `new`s its repositories
  internally, so they cannot be substituted (H7).
- **Zero** `.transaction(` calls package-wide; at least four multi-write sequences are non-atomic,
  worst in `pulls/routes.ts` where a mid-sequence failure leaves a PR with no files (H9).
- `reviewer-core/src/llm/openrouter.ts` is a live HTTP adapter with a raw `fetch` inside the pure
  core, exported from its barrel — and `platform/container.ts` imports it back out, inverting the
  dependency (C4, C5).

## Hard rules

- NEVER put `container.db`, `drizzle-orm` or `db/schema` in a `routes.ts`. There is no "just this
  one query" exception — that is exactly how all four debt modules started.
- NEVER import a third-party SDK outside `src/adapters/`. Add a port to
  `vendor/shared/adapters.ts`, an implementation in `adapters/`, and a mock in `adapters/mocks.ts`.
- EVERY new repository ships with a port in `ports.ts` and a service that depends on the port.
- NEVER pass `Container` into a new service, pipeline function, or use case. Declare the deps.
- NEVER add a dependency from `adapters/` or `platform/` into `modules/` — `container.ts` excepted.
- NEVER regenerate `.dependency-cruiser-known-violations.json` to silence a failure. The baseline
  only ever shrinks.
- A rule id in `.dependency-cruiser.cjs` and its entry here are one artifact in two files. Edit
  both or neither.
- When a task requires breaking a CRITICAL rule, say so and stop rather than doing it silently —
  the boundary is the deliverable, not the obstacle.
