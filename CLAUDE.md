# DevDigest — AI code-review studio (course starter template)

Five standalone packages, **no workspace / turbo / nx**. No root `package.json`.
Install, test and build run **per directory**.

**Before editing inside a module, read that module's `CLAUDE.md`.**

| Dir | Package | Port | Pkg manager |
|---|---|---|---|
| [server/](server/) | `@devdigest/api` — Fastify API, Drizzle/Postgres, repo indexer | 3001 | **pnpm** |
| [client/](client/) | `@devdigest/web` — Next 15 App Router studio | 3000 | **pnpm** |
| [reviewer-core/](reviewer-core/) | `@devdigest/reviewer-core` — pure review engine | — | **npm** |
| [e2e/](e2e/) | `@devdigest/e2e` — browser flow specs | — | **npm** |
| [mcp/](mcp/) | `@devdigest/mcp` — local stdio MCP server over the HTTP API | — (stdio) | **npm** |

Mixing up pnpm/npm per directory is the most common mistake here.

## Session protocol

**Before working inside a module**, read that module's `insights.md` — plus the root one when
the task crosses packages — and state the top 3 findings that bear on the task. Treat them as
high-confidence guidance unless the code contradicts them. Empty sections are a valid answer;
say so rather than skipping the step.

**At the end of a task**, run `/engineering-insights` to append what was learned. Append inside
the existing sections, never overwrite. Nothing durable learned ⇒ write nothing and say so —
an invented entry is worse than an empty file.

## Commands

`./scripts/dev.sh` — zero → docker + migrate + seed + server + client (`--db-only`,
`--no-seed`, `--no-client`). Node ≥ 22. The app boots with **zero API keys**.
Per-package commands live in each module's CLAUDE.md.

## Cross-module wiring

- `server` imports `reviewer-core` as **TypeScript source** via tsconfig path alias
  (`@devdigest/reviewer-core` → `../reviewer-core/src/index.ts`). reviewer-core never
  emits JS. Changing reviewer-core changes server behavior with no build step.
- `@devdigest/shared` (Zod contracts) is **duplicated**: canonical in
  `server/src/vendor/shared/`, an already-diverged copy in `client/src/vendor/shared/`.
  Editing a contract means editing both — or deciding not to, on purpose.
- **tsconfig paths are not honored by vitest.** Every alias is re-declared in each
  `vitest.config.ts`. Adding an alias ⇒ edit two files per package.
- `mcp` is a **client** of the HTTP API, not a sibling of `server/`. It shares no source with
  it: rather than a third `vendor/shared` copy or an alias into the server's, it declares its
  own narrow, tolerant response schemas. So it has **no tsconfig alias** and **no cross-package
  CI edge** — `.github/workflows/mcp.yml` filters `mcp/**` alone, and no other lane triggers
  on it.
- CI is path-filtered per package, with cross-package deps encoded by hand in
  `.github/workflows/` (`server-unit.yml` also triggers on `reviewer-core/**`).
  One lane is not keyed to a package: `governance.yml` fires on `.claude/**` and
  runs `scripts/check-agent-frontmatter.mjs` — the only automated coverage the
  agent and skill definitions get. `server-unit.yml`'s typecheck job also runs
  `pnpm arch`, so the dependency-cruiser baseline is enforced by CI, not just by
  the review agents.

## Conventions

- **No lint/format tooling exists** repo-wide — no ESLint, Biome or Prettier, and no
  `lint` script. Don't invent one or add a formatter unasked. The one exception is
  `server/`'s `pnpm arch` — an *architecture* boundary check (import direction only) over the
  already-present `dependency-cruiser`, owned by the `onion-architecture` skill. It is not a
  linter; don't remove it as one.
- `strict` + `noUncheckedIndexedAccess` everywhere: indexing an array yields `T | undefined`.
- Output vocabulary is fixed by contract: severity `CRITICAL | WARNING | SUGGESTION`,
  verdict `request_changes | approve | comment`.

## Do not touch

This repo is a **course starter template** (lessons L01–L08 build on it). Empty tables in
`server/src/db/schema/*` (ci, eval, knowledge, skills, context, ops) and unused i18n
namespaces in `client/messages/en/*.json` (blast, brief, conformance, conventions, eval,
memory, skills, compose) are **intentional scaffolding, not dead code**. Never clean them up.

## Docs

- [README.md](README.md) — architecture diagrams, feature tour, lesson roadmap
- [TESTING.md](TESTING.md) — suite map, CI lanes, the hard testing conventions
- [docs/agent-prompts/README.md](docs/agent-prompts/README.md) — how reviewer system prompts are built
- [insights.md](insights.md) — **cross-module** findings (wiring, CI, tooling) in fixed
  sections. Module-specific findings go in that module's `insights.md`.
- [.claude/skills/engineering-insights/SKILL.md](.claude/skills/engineering-insights/SKILL.md)
  — routing, quality bar and entry format for the files above
- [.claude/skills/onion-architecture/SKILL.md](.claude/skills/onion-architecture/SKILL.md)
  — ring model and layering rules for `server/` + `reviewer-core/`, enforced by `pnpm arch`
- [.claude/skills/feature-workflow/SKILL.md](.claude/skills/feature-workflow/SKILL.md)
  — the subagent chain for a large change, its artifact hand-offs and its per-run trace, plus the
  gate for when a task is too small to earn one. Agent roster in
  [.claude/agents/README.md](.claude/agents/README.md)
- [.claude/skills/spec-creator/SKILL.md](.claude/skills/spec-creator/SKILL.md)
  — stage 1 of that chain: the six question groups, the design critique, EARS acceptance
  criteria with `AC-NN` ids, and the `draft → approved → implemented` gate
- [specs/](specs/) — **cross-module** specs. Single-module ones live in that module's `specs/`;
  the `NN` counter is shared by all five directories, so `SPEC-07` is unambiguous repo-wide
- [specs/01-project-context-documents.md](specs/01-project-context-documents.md) — SPEC-01,
  Project Context: repository markdown hand-attached to agents and skills, read per run and
  injected as the untrusted `## Project context` block, with the read set named in the trace
- [specs/02-onboarding-generator.md](specs/02-onboarding-generator.md) — SPEC-02, Onboarding
  Generator: five fixed sections per repo from deterministic repo-intel facts plus one structured
  model call, with link verification and an honest banner when the index, the key or the commit
  does not match
- [specs/03-pr-brief-card.md](specs/03-pr-brief-card.md) — SPEC-03, PR Brief: one structured model
  call per PR state over intent, blast, diff stats, the linked issue and attached specs, cached on
  head sha plus model, rendered on the Overview tab with grounded risks and a clickable review
  focus list
