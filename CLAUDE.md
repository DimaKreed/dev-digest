# DevDigest — AI code-review studio (course starter template)

Four standalone packages, **no workspace / turbo / nx**. No root `package.json`.
Install, test and build run **per directory**.

**Before editing inside a module, read that module's `CLAUDE.md`.**

| Dir | Package | Port | Pkg manager |
|---|---|---|---|
| [server/](server/) | `@devdigest/api` — Fastify API, Drizzle/Postgres, repo indexer | 3001 | **pnpm** |
| [client/](client/) | `@devdigest/web` — Next 15 App Router studio | 3000 | **pnpm** |
| [reviewer-core/](reviewer-core/) | `@devdigest/reviewer-core` — pure review engine | — | **npm** |
| [e2e/](e2e/) | `@devdigest/e2e` — browser flow specs | — | **npm** |

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
- CI is path-filtered per package, with cross-package deps encoded by hand in
  `.github/workflows/` (`server-unit.yml` also triggers on `reviewer-core/**`).

## Conventions

- **No lint/format tooling exists** repo-wide — no ESLint, Biome or Prettier, and no
  `lint` script. Don't invent one or add a formatter unasked.
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
