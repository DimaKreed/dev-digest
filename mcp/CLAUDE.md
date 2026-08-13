# @devdigest/mcp — local stdio MCP server over the DevDigest HTTP API

## Stack

TypeScript ESM · `@modelcontextprotocol/sdk` + `zod` as the **only** runtime deps · vitest 2 ·
tsx in dev · **npm** (`package-lock.json`) — *not* pnpm, unlike server/client · Node ≥ 22.

## Commands

```bash
npm run typecheck
npm test            # vitest run --passWithNoTests — hermetic, no server, no Docker
npm run -s start    # stdio server; -s matters, see below
```

## Map

`src/server.ts` — stdio entry point + the `instructions` string (ring 5)
`src/container.ts` — the only file that reads configuration (ring 5)
`src/transport/tools.ts` — the five tool registrations; this package's `routes.ts` (ring 4)
`src/adapters/` — `http-client.ts` (the only I/O), `clock.ts`, `mocks.ts` (ring 3)
`src/usecases/` — one file per tool + `resolve-target.ts` (ring 2)
`src/ports.ts`, `src/contracts.ts` — the `DevDigestApi`/`Clock` ports and narrow schemas (ring 1)
`src/domain/` — `format.ts`, `limits.ts`, `errors.ts`; pure (ring 0)
`test/` — flat; plain `*.test.ts` only

## Conventions (non-default)

- **This package is a CLIENT of the API.** It never imports `server/src`, never touches
  Postgres, never imports Drizzle. Everything arrives over HTTP through the `DevDigestApi`
  port.
- **Nothing may be written to stdout except JSON-RPC.** Stdout is the protocol channel; a
  stray `console.log` corrupts framing and the client fails to parse the first message.
  Diagnostics go to `console.error`. This is also why `.mcp.json` runs npm with `--silent`:
  without it, `npm run`'s own banner lands on stdout.
- **The tool descriptions and every error string are contract, not prose.** They live in
  `src/transport/tools.ts` and `src/domain/errors.ts`, are sized against the 2 KB truncation a
  client applies to each description and to `instructions`, and lead with the load-bearing
  sentence because truncation cuts from the end. Rewording one changes behaviour.
- **`get_blast_radius` must keep returning `isError: true` when the index is not `ok` and it
  found nothing.** An empty success from a tool with that name reads to a model as a measured
  "no impact". The stub errored on every input for this reason; implemented, it errors on
  exactly the inputs where the emptiness is meaningless (`empty_reason: 'not_indexed'`, which
  covers `partial` as well as `degraded`). Softening that branch to a success is the one
  change this tool must not take. See README for the three-way split.
- **Onion layering** applies here as it does in `server/`, with the ring map above. Two
  readings are deliberate: the MCP SDK is transport framework (rings 4–5, as Fastify is for
  the server), while a raw `fetch` is a true adapter and lives only in
  `src/adapters/http-client.ts`. `pnpm arch` does **not** cover this package — see below.
- **Substitute at the port seam, never `vi.mock`.** `src/adapters/mocks.ts` holds a
  hand-written `DevDigestApi` fake and a controllable `Clock`; fixtures are parsed through the
  narrow schemas so a broken fixture fails loudly.
- Narrow schemas are tolerant on purpose: `.nullish()` (never `.nullable()`) and unknown keys
  stripped, so a field added on the server side is a no-op here.

## Gotchas

- **`pnpm arch` does not see this package.** `server/.dependency-cruiser.cjs` is scoped to
  `server/src`. The ring boundaries here are held by grep probes instead — see
  `README.md`. Note the probe `fetch\(` is useless here: the call site reads `doFetch(`, so
  the substring never matches. Use `\bfetch\b`.
- The 120 s cap is honoured **exactly** because the last sleep is clamped to what remains of
  the budget. Removing the clamp overshoots by up to one poll interval.
- `GET /repos/:id/pulls` — which target resolution depends on — syncs from GitHub inside a GET
  handler, so it can be slow and can reach the network. That latency sits inside the 120 s
  budget. It is inherited server-side debt; do not fix it from here.
- Whether Claude Code picks up a newly written `.mcp.json` mid-session is unverified. If
  `/mcp` does not list `devdigest`, try a fresh session before debugging the file.

## Docs

- [README.md](README.md) — the five tools, the wait loop, the verification probes
- [../CLAUDE.md](../CLAUDE.md) — cross-package wiring; why this package has no alias
- [../TESTING.md](../TESTING.md) — suite map and CI lanes
- [insights.md](insights.md) — hard-won findings in fixed sections; **read it before you
  edit here**, append at the end of a task via `/engineering-insights`
