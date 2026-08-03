# @devdigest/reviewer-core — the review engine (diff → prompt → LLM → grounded findings)

## Stack

TypeScript ESM · `openai` SDK + `zod` as the **only** runtime deps · vitest 2 ·
**npm** (`package-lock.json`) — *not* pnpm, unlike server/client.

## Commands

```bash
npm test            # vitest run --passWithNoTests
npm run typecheck
npm run build       # also `tsc --noEmit` — this package NEVER emits JS
```

The server imports `src/index.ts` directly through a tsconfig path alias, so there is
nothing to build and no dist to keep in sync.

## Map

`src/index.ts` — the public barrel; anything not exported here is internal
`src/prompt.ts` — system prompt assembly + `INJECTION_GUARD`
`src/grounding.ts` — maps findings back onto real diff lines
`src/review/` — `run.ts` (orchestration), `reduce.ts` (merge + scoring)
`src/output/to-review.ts` — engine result → API/DB shape
`src/llm/` — `openrouter.ts` provider, `structured.ts` json_schema plumbing

## Conventions (non-default)

- **Purity contract: no DB, no GitHub, no filesystem, no env reads.** The only side effect
  is the injected `LLMProvider`. Adding an import that breaks this is the one change to
  push back on — put the I/O in a `server/src/adapters/` port instead. This is rule **C5** of
  [onion-architecture](../.claude/skills/onion-architecture/SKILL.md); `src/llm/openrouter.ts`
  is the one file that already violates it.
- `INJECTION_GUARD` is appended to every system prompt. There is deliberately **no**
  keyword scanning of diff content; don't add heuristic filtering.
- Grounding is a mandatory gate — ungrounded findings are dropped silently, by design.
- The score is recomputed by `scoreFromFindings` in [src/review/reduce.ts](src/review/reduce.ts)
  (0 findings ⇒ 100; penalties CRITICAL 35 / WARNING 12 / SUGGESTION 3, clamped 0–100).
  **The model's self-reported score is ignored.** `verdict` is passed through as-is.
- The output schema is enforced via strict `json_schema`, not described in the prompt.
  Changing the schema means changing the contract in `server/src/vendor/shared/`, not the prompt text.

## Gotchas

- `zod` is pinned to `./node_modules/zod` in [tsconfig.json](tsconfig.json) to prevent a
  dual-zod resolution against the server's copy. Don't "clean up" that path entry.
- `@devdigest/shared` here resolves to the **server's** `src/vendor/shared/` — this package
  has no copy of its own.
- `.gitignore` deliberately ignores `src/**/*.js`, `*.js.map` and `*.d.ts` so stray tsc
  output can't shadow the sources.
- Editing this package triggers the server CI lane too (`server-unit.yml` watches
  `reviewer-core/**`). Run the server unit lane before assuming a change is safe.

## Docs

- [README.md](README.md) — purity contract, pipeline diagram, public API list
- [../docs/agent-prompts/README.md](../docs/agent-prompts/README.md) — prompt authoring,
  severity rubric, verdict semantics, shipping checklist
- [docs/](docs/) — design decisions, flows, ADRs
- [specs/](specs/) — intended behavior, written before implementation
- [insights.md](insights.md) — hard-won findings in fixed sections; **read it before you
  edit here**, append at the end of a task via `/engineering-insights`
