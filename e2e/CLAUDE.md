# @devdigest/e2e — deterministic browser flows

## Stack

`tsx run.ts` driving the external **agent-browser** CLI over CDP. ESM · **npm**.
No Playwright, no Cypress, **no LLM in the loop** — runs must be deterministic.

## Commands

```bash
npm i -g agent-browser && agent-browser install   # one-time, external dep
npm test                                          # needs a stack already running
npm run e2e:hermetic                              # ../scripts/e2e.sh — own isolated stack
npm run typecheck
```

Hermetic mode uses ports 5433 (pg) / 3101 (api) / 3100 (web) and its own container
`devdigest-e2e-postgres`, so it never touches your dev data. Prefer it.

## Map

`run.ts` — the runner: loads specs, substitutes `{BASE}`, reports
`lib/assert.ts` — assertion helpers
`specs/NN-name.flow.json` — the tests themselves
`agent-browser.json` — CLI config

## Conventions (non-default)

- **Tests are declarative JSON flow specs, not code.** To cover something new, add a
  `specs/NN-name.flow.json` — don't write a new TS test script.
- `{BASE}` in a spec is substituted with the target origin at runtime; never hardcode a host.
- A `wait` step **is** an assertion — if the wait times out, the test fails. That's the
  intended way to assert a state was reached.
- **No AI `chat` command.** That is the ban: `chat` drives the browser with a model, so
  the run stops being reproducible and key-free. Every other locator is fair game, and
  the specs use `wait --url`, `wait --text`, `wait --load networkidle`,
  `find text "…" click` and `find role button click --name "…"`.
- **Prefer `role` + accessible name over `--text` where one exists.** User-facing
  strings are next-intl-driven, so a copy change breaks a `--text` locator. That is a
  preference with a real cost behind it, not a prohibition — most assertions here *are*
  rendered copy: `specs/04-pr-findings.flow.json` opens the tab with
  `find role button click --name "Agent runs"`, then asserts the seeded run with
  `wait --text "request changes"`.

## Gotchas

- Specs `02`, `04`, `05` assume the seeded fixture (repo `acme/payments-api`, PR **#482**)
  is the *only* repo in the database. Running them against a dev stack you've imported
  repos into will fail — that's why the hermetic runner exists.
- Never run `docker compose down -v` against the dev stack to "reset for e2e": it deletes
  all imported repos and reviews. Use `npm run e2e:hermetic` instead.
- CI starts the API with `tsx src/server.ts`, not `pnpm start`, because `start` expects a
  `dist/` build.
- Env knobs: `E2E_BASE_URL`, `AGENT_BROWSER_BIN`, `E2E_STEP_TIMEOUT` (default 60000).
- `tsconfig.json` here is slimmer than the other packages (no `noUncheckedIndexedAccess`).

## Docs

- [README.md](README.md) — flow-spec format, hermetic vs dev-stack runs, per-spec coverage
- [../TESTING.md](../TESTING.md) — where this suite sits in the overall strategy
- [docs/](docs/) — design decisions, flows, ADRs
- [specs/](specs/) — **note:** this dir holds the flow specs themselves, not prose
- [insights.md](insights.md) — hard-won findings in fixed sections; **read it before you
  edit here**, append at the end of a task via `/engineering-insights`
