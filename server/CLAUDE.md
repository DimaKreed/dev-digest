# @devdigest/api — Fastify API, Postgres persistence, repo indexer

## Stack

Fastify 5 · Drizzle ORM 0.38 + `postgres` 3 on Postgres 16 + pgvector · zod 3 via
`fastify-type-provider-zod` · SSE via `fastify-sse-v2` · vitest 2 (+ testcontainers) ·
tsx in dev · ESM (`"type": "module"`) · **pnpm 10.34.5** · Node ≥ 22.

## Commands

```bash
pnpm dev                                          # tsx watch, :3001
pnpm test                                         # everything
pnpm exec vitest run --exclude '**/*.it.test.ts'  # unit lane (CI)
pnpm exec vitest run .it.test                     # integration lane (needs Docker)
pnpm typecheck
pnpm arch                                         # onion boundary check; 0 unless NEW violation
pnpm arch:all                                     # + the 27 baselined known violations
pnpm db:generate                                  # drizzle-kit → src/db/migrations
pnpm db:migrate                                   # apply; NOT automatic on boot
pnpm db:seed                                      # idempotent demo data
```

CI inlines the two vitest lanes rather than using scripts — keep the lane commands working
even if `package.json` drifts locally.

## Map

`src/adapters/` — all I/O behind ports (github, llm, git, embedder, secrets, astgrep, …)
`src/modules/<domain>/` — routes + service + repository per domain
`src/platform/` — config, DI container, prompts, sse, resilience, model-router, run-logger
`src/db/` — `schema/` (split per domain) + `migrations/` + `client.ts`
`src/vendor/shared/` — **canonical** `@devdigest/shared` Zod contracts
`test/` — flat; `*.it.test.ts` = DB-backed

## Conventions (non-default)

- **Ports and adapters.** Every external call lives in `src/adapters/`, is wired through
  [src/platform/container.ts](src/platform/container.ts), and is swapped for
  [src/adapters/mocks.ts](src/adapters/mocks.ts) in hermetic tests. Never import
  octokit / openai / simple-git from a module.
- **Onion layering** is defined in
  [.claude/skills/onion-architecture/SKILL.md](../.claude/skills/onion-architecture/SKILL.md) —
  rings, repository ports, narrow DI, transaction boundaries. Read it before adding a route,
  service or repository. `pnpm arch` enforces the import-direction subset via
  [.dependency-cruiser.cjs](.dependency-cruiser.cjs); it is an architecture check, **not** a
  linter (this repo still has no ESLint/Biome/Prettier) and adds no dependency —
  `dependency-cruiser` was already here for `adapters/depgraph`.
- Modules are registered **statically** in [src/modules/index.ts](src/modules/index.ts)
  (not autoloaded by filename) — a new module isn't live until it's listed there.
- Plugins register **before** modules in [src/app.ts](src/app.ts).
- Validation is schema-first: declare zod route schemas and let the type provider reject
  (422 before your handler runs). Never hand-roll validation in a handler.
- **`*.it.test.ts` suffix is mandatory** for any test importing
  [test/helpers/pg.ts](test/helpers/pg.ts) — the CI lanes split on that exact string.
- Secrets are **not** in `AppConfig`. Single read chokepoint
  [src/adapters/secrets/local.ts](src/adapters/secrets/local.ts) →
  `~/.devdigest/secrets.json` (mode 0600), with `process.env` fallback. `GITHUB_TOKEN` is
  canonical, `GITHUB_PAT` accepted.

## Gotchas

- Migrations don't run on boot. `relation "…" does not exist` ⇒ you forgot `pnpm db:migrate`.
- `docker compose down -v` destroys the `devdigest_pgdata` volume — all imported repos,
  reviews and cloned working copies. There are two identical `docker-compose.yml` files
  (root and `server/`) aliasing the same container.
- Integration tests **self-skip** when Docker is absent. The 120 s timeouts are testcontainers
  startup budget, not a hang.
- `LOG_LEVEL` is empty in `.env.example` and must stay tolerated. `EMBEDDINGS_ENABLED=false`
  and `REPO_INTEL_ENABLED=false` silently degrade behavior rather than erroring.
  `WEB_PORT` doubles as the allowed CORS origin. `NODE_ENV=test` silences logs and
  disables the global rate limit.
- Grounding is a hard gate: findings that don't map to real diff lines are dropped, not
  flagged. A review returning fewer findings than the model emitted is working as designed.
- Orphaned `running` runs are reaped at boot.

## Docs

- [README.md](README.md) — env table, request/DI flow, API map
- [src/modules/repo-intel/README.md](src/modules/repo-intel/README.md) — indexer internals
- [../TESTING.md](../TESTING.md) — suite map and CI lanes
- [../docs/agent-prompts/README.md](../docs/agent-prompts/README.md) — reviewer prompt authoring
- [docs/](docs/) — design decisions, flows, ADRs
- [docs/smart-diff.md](docs/smart-diff.md) — why `smart-diff` ships no `repository.ts`, and the
  three files that each restate the "last review" formula
- [docs/project-context.md](docs/project-context.md) — why an attachment stores paths and never
  text, why the per-file limit stops at attachment, and why `listFiles` went on `GitClient`
- [docs/onboarding-generator.md](docs/onboarding-generator.md) — why the tour generates on a
  blocking POST (the shared `JobRunner`'s 120 s / `retries: 2` would break "exactly one model
  call"), why the precondition reads the edge counter and never `repo_index_state.status`, and
  why the four new tour fields are `.nullish()` inside the existing jsonb
- [docs/pr-brief-card.md](docs/pr-brief-card.md) — why the brief's cost lives in the stored
  document and never in `agent_runs.cost_usd`, why `modules/brief/` reaches blast radius
  through its own two-method `BriefIntelReads` port instead of `modules/blast/service.ts`, and
  why `REPO_INTEL_ENABLED=false` is read off the config rather than recovered from the facade
- [specs/](specs/) — intended behavior, written before implementation
- [insights.md](insights.md) — hard-won findings in fixed sections; **read it before you
  edit here**, append at the end of a task via `/engineering-insights`
