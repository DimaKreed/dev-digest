# Testing & CI strategy

DevDigest is five independent packages (no workspace), so testing is organised
as **one suite per package**, each with its own CI workflow, runner, and path
filter. A package's suite runs only when that package (or a package it depends
on at type-check time) changes.

## Philosophy — typological, not exhaustive

We do **not** chase line coverage. Each suite covers the *kinds* of things that
can break in that layer — one happy path plus the edge that actually matters per
workflow — and deliberately skips the rest. Concretely:

- **Test behaviour at the seams**, not implementation details. Routes, adapters,
  contracts, the review pipeline, the rendered component.
- **Mock the outside world.** LLMs, GitHub, and git are stubbed via
  `server/src/adapters/mocks.ts` so unit tests are hermetic and key-free.
- **One real integration per data-backed workflow**, against a real Postgres —
  not a mock DB — because the bugs there live in SQL, migrations, and wiring.
- **A few end-to-end browser flows** over the *main* user journeys, on seeded
  data, with no LLM in the loop.

If a test wouldn't catch a class of regression we care about, we don't write it.

## Suite map

| Suite | Package | Kind | Runner | Workflow | Docker? |
|-------|---------|------|--------|----------|---------|
| client | `client/` | component / unit (jsdom) | vitest | `client.yml` | no |
| server-unit | `server/` | unit (hermetic) | vitest | `server-unit.yml` | no |
| server-integration | `server/` | integration (real Postgres) | vitest | `server-integration.yml` | **yes** |
| reviewer-core | `reviewer-core/` | unit (engine) | vitest | `reviewer-core.yml` | no |
| e2e web | `e2e/` | browser e2e (deterministic) | agent-browser + `run.ts` | `e2e-web.yml` | yes (stack) |
| mcp | `mcp/` | unit (hermetic, faked HTTP) | vitest | `mcp.yml` | no |

## What each suite covers

**client** — components render and react to interaction (React Testing Library
+ jsdom). `fetch` is mocked; no API, DB, or browser. Covers the PR-review
surface (list, diff, findings, run controls) and the agent editor.

**server-unit** — the DB-free majority: adapters, prompt assembly, grounding,
repo-intel ranking & indexing, pricing, route smoke. The `typecheck` job also
runs on Windows, which doubles as the `@ast-grep/napi` prebuilt gate (install
fails there if the win32 prebuilt is missing).

**server-integration** — the `*.it.test.ts` files. Each starts a real Postgres
(pgvector) via testcontainers, builds the Fastify app, migrates + seeds, and
drives routes end-to-end: reviews + run lifecycle (incl. grounding), agents CRUD,
repo-intel symbol clamping, pulls comments, settings models, blast radius, diff
review. They self-skip when Docker is unavailable.

Two of those files carry invariants only a real DB can prove, and both are worth
keeping green rather than rewriting:

- `blast.it.test.ts` installs a `CodeIndex` whose every method rejects, so a 200
  proves the answer came from the persisted index and not the ripgrep fallback;
  counts `symbols`/`references`/`file_edges` and `repo_index_state.updated_at`
  across the request to prove nothing was re-indexed; and installs a counting
  `MockLLMProvider` to prove the map path reaches no model. That last one matters
  because the module *does* have an LLM path (history notes) one import away.
- `diff-review.it.test.ts` proves `POST /reviews/diff` resolves a real seeded
  agent and persists nothing — the route has no pull request to attach a review
  to, so a row written there would be unreachable.

**reviewer-core** — the pure engine: `toReview` selection, prompt construction,
and a `run` with a stubbed model → grounded findings. No DB / GitHub / FS.

**mcp** — the five MCP tools' use cases plus the `devdigest review` CLI, with the
DevDigest HTTP API replaced by a hand-written fake behind the `DevDigestApi` port,
git replaced by a fake behind `GitClient`, and time replaced by a fake clock. No
server, no Postgres, no git repository, no keys. The CLI's exit-code contract is
pinned here: 0 clean, 1 blocking, 2 could-not-review — including that an empty
working tree exits 2 rather than 0, since nothing was examined. The lane exists mainly for the blocking
wait loop: a run that never finishes must give up at exactly the 120 s cap and
hand back the `run_id`, and that assertion runs in milliseconds because the
clock is injected rather than read. Fixtures are parsed through the package's
own narrow schemas, so a fixture that drifts from the API's real shape fails as
a broken fake instead of passing quietly.

**e2e web** — see `e2e/README.md`. Deterministic agent-browser flows over the
main journeys (boot → PR list → PR detail; agents) against a real seeded stack.
No `chat`, no model key.

## Running locally

```sh
# per package
cd client        && pnpm test           # + pnpm typecheck
cd reviewer-core && npm test
cd mcp           && npm test            # + npm run typecheck

# server — the unit/integration split (see note below)
cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit, no Docker
cd server && pnpm exec vitest run .it.test                      # integration, needs Docker
cd server && pnpm test                                          # both

# browser e2e (needs the full stack + agent-browser CLI)
./scripts/dev.sh
npm i -g agent-browser && agent-browser install
cd e2e && npm install && npm test
```

## Conventions

- **Integration tests end in `*.it.test.ts`.** The unit lane excludes that glob
  (`vitest run --exclude '**/*.it.test.ts'`); the integration lane selects only
  it (`vitest run .it.test`). A DB-backed test that imports `test/helpers/pg.ts`
  must use the `.it.test.ts` suffix.
- **The unit/integration split lives in CI, not in `package.json`.** There are no
  `test:unit` / `test:integration` scripts and none should be added: both lanes
  invoke `pnpm exec vitest run …` directly, so the split cannot be broken by an
  edit to `server/package.json`. (`pnpm test` in `server/` is bare `vitest run`, which
  pulls in the DB-backed files too — it is not the unit lane.) Earlier revisions of this
  file explained the rule by saying `server/package.json` is `skip-worktree`; it is
  not — `git ls-files -v server/package.json` returns `H`. The rule stands, the
  mechanism was never real, so do not go looking for the flag when that file shows
  up in `git status` and do not "restore" it.
- **Hermetic by default.** Reach for `src/adapters/mocks.ts` (MockLLMProvider,
  MockGitClient) rather than real network/keys.
- **E2E specs are deterministic batch JSON** (`e2e/specs/*.flow.json`) using
  only `--url` / `--text` / `find` locators — never the AI `chat` command.
- **CI is path-filtered per package.** Cross-package source aliases are encoded
  in each workflow's `paths:` (e.g. `reviewer-core/**` triggers `server-unit`
  because the server type-checks against `../reviewer-core/src`).
- **`server/clones/**` is runtime data** (git-ignored) and never collected by
  any suite.
