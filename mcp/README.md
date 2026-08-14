# @devdigest/mcp

A local [MCP](https://modelcontextprotocol.io) server that exposes DevDigest's code review to
any MCP client, over **stdio**, plus the `devdigest review` pre-push CLI. Both are thin
clients of the DevDigest HTTP API on `http://localhost:3001` — no database, no Drizzle, no
shared source with `server/`.

## Run it

```sh
./scripts/dev.sh --no-client     # the API on :3001
```

`.mcp.json` at the repository root registers the server, so a client in this repo picks it up
with no further setup. To drive it by hand:

```sh
cd mcp && npm install
npm run -s start                 # speaks JSON-RPC on stdin/stdout
```

`DEVDIGEST_API_URL` overrides the API location; it defaults to `http://localhost:3001`.

## `devdigest review` — review before you push

Blast radius and the reviewer both work on a pull request, which means the first feedback on
a change arrives after it is already pushed. This command moves the same review earlier, onto
the working copy.

```sh
cd mcp && npm run -s review          # or: node bin/devdigest.mjs review
```

It reads `git diff HEAD` — staged and unstaged changes to tracked files — and POSTs the patch
to `POST /reviews/diff`, which runs **the same engine, the same prompt assembly, the same
grounding gate and the same scoring** a pull-request review runs. Nothing about the review
lives in this package; a second implementation here would drift from the first one the day
either changed.

### Untracked files are not reviewed

`git diff HEAD` cannot see a file git has never been told about, so a brand-new file is
invisible to this command. Any that exist are listed under `NOT reviewed` in the output, so
their absence is stated rather than assumed — the case where silence would most easily be
read as approval. `git add` them to include them.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Reviewed. Nothing meets the agent's gate — safe to push. |
| 1 | Reviewed. Blocking findings were reported. |
| 2 | **Could not** review: git failed, nothing to review, or the API was unreachable. |

2 is never a verdict about the code, which is why it is kept apart from 1 — a hook must not
be able to read "could not review" as "clean". For the same reason an empty working tree
exits 2, not 0: nothing was examined.

Which findings block is the reviewing agent's own `ci_fail_on` (`never` / `critical` /
`warning` / `any`), applied server-side. The CLI reads the resulting `blockers` count and
never re-derives the gate from severities, so it cannot disagree with the web app or CI.

`--mode working` is the default and the only implemented mode; `staged` and `branch` are
named so an unknown mode fails with real options rather than silently reviewing something
else. `--agent <id>` picks a reviewer, `--json` emits the whole review for scripting, and
`--help` documents all of it.

## The five tools

| Tool | Writes? | What it is for |
|---|---|---|
| `devdigest_list_agents` | no | The configured reviewers. **The only source of a valid `agent_id`.** |
| `devdigest_run_agent_on_pr` | **yes** | Runs one reviewer and **blocks up to 120 s** for the result. |
| `devdigest_get_findings` | no | Reads a review that already finished. Also the recovery path after a timeout. |
| `devdigest_get_conventions` | no | The house rules mined from the repository's own code. |
| `devdigest_get_blast_radius` | no | What the changed symbols reach: callers, endpoints, scheduled jobs. |

Every tool addresses a pull request the way a person does — `repo` as `"owner/name"` plus
`pr_number` — and resolves the API's UUIDs internally. Every list-returning tool takes
`response_format` (`concise` by default) and a bounded `limit`, and says how to narrow the
request when it truncates.

### Why blast radius still errors on an unusable index

An empty success from a tool called "blast radius" reads to a model as a measured verdict of
*no impact*. That is why the stub returned `isError: true`, and the reason survives its
implementation: the tool now returns data, but an index that is **degraded or partial and
produced no callers is still an error**, with text that names the wrong inference explicitly.

Three empty results are kept apart, and only one of them is a success:

| `empty_reason` | Means | Result |
|---|---|---|
| `not_indexed` | The index could not answer. The emptiness carries no information. | `isError: true` |
| `no_symbols` | The diff changed no analysable code (config, docs, data). | success |
| `no_callers` | A healthy index found the symbols and nothing calls them. | success |

Only `no_callers` is allowed to say "the index covered every changed file, so this is a
measured result" — which is why a *partial* index with zero callers reports `not_indexed`
rather than `no_callers`. When the index is incomplete but did find something, every answer
is prefixed with a warning that the counts below it are a lower bound.

## How the blocking run works

`POST /pulls/:id/review` is fire-and-forget: it creates the run rows, returns their ids, and
executes in the background — the `reviews` array it returns is always empty. So "blocking"
lives here:

```
resolve owner/name + number  →  POST /pulls/:id/review  →  run_id
   ↓
sleep 1.5 s, then poll GET /pulls/:id/runs every 2 s
   ↓
status leaves "running"  →  GET /pulls/:id/reviews, pick the row whose run_id matches
   ↓
budget exhausted at exactly 120 s  →  isError with the run_id and instructions to use
                                       devdigest_get_findings instead of re-running
```

The last sleep is clamped to what remains of the budget, so the cap is honoured exactly rather
than overshot by whatever was left of a poll interval. Time arrives through an injected
`Clock`, which is what lets the test drive two simulated minutes in under a millisecond.

## Layering

The onion rings from
[`.claude/skills/onion-architecture`](../.claude/skills/onion-architecture/SKILL.md) apply:

| Ring | Here |
|---|---|
| 0 · pure | `src/domain/` — formatting, limits, the exact error strings |
| 1 · ports & contracts | `src/ports.ts`, `src/contracts.ts` |
| 2 · use cases | `src/usecases/` — one per tool, plus target resolution |
| 3 · infrastructure | `src/adapters/` — the only `fetch`, the real clock, the fakes |
| 4 · transport | `src/transport/tools.ts` |
| 5 · composition root | `src/container.ts`, `src/server.ts` |

The MCP SDK counts as transport framework, not as an adapter — it is to this package what
Fastify is to `server/` — so it appears only in rings 4–5. A raw `fetch` *is* an adapter and
appears in exactly one file.

`pnpm arch` is scoped to `server/src` and does not cover this package. These probes stand in
for it:

```sh
# from the repo root, with ripgrep
rg -n '\bfetch\b' mcp/src                                     # only src/adapters/http-client.ts
rg -n 'process\.env|Date\.now|new Date\(|setTimeout' mcp/src/domain mcp/src/usecases   # 0
rg -n '@modelcontextprotocol/sdk' mcp/src                      # only transport/ + server.ts
rg -n 'console\.log|vi\.mock|alwaysLoad' mcp                   # 0
rg -n '@devdigest/shared|vendor/shared|\.\./server' mcp/src    # 0
```

Note `fetch\(` does **not** work as the first probe: the call site reads `doFetch(`, so the
substring never matches and the probe passes for the wrong reason.

## Contracts

This package declares its own narrow Zod schemas in `src/contracts.ts` rather than taking a
third copy of `@devdigest/shared` or aliasing into the server's. Each one names the canonical
contract it mirrors, uses `.nullish()` throughout and strips unknown keys — so a field added
server-side is a no-op here, and there is no alias to keep mirrored between `tsconfig.json`
and `vitest.config.ts`.
