# @devdigest/web — Next.js studio UI

## Stack

Next 15 App Router · React 19 · TanStack Query 5 · Tailwind 4 (`@tailwindcss/postcss`) ·
next-intl 3 · recharts · mermaid · vitest 2 + jsdom + Testing Library ·
**pnpm 10.34.5** · Node ≥ 22.

## Commands

```bash
pnpm dev        # :3000
pnpm test
pnpm typecheck  # tsc --noEmit
pnpm build
```

**There is no lint script and no ESLint config** — don't add `next lint` or a formatter.

## Map

`src/app/<route>/` — thin route pages + colocated `_components/`
`src/components/` — components shared across routes (app-shell, diff-viewer, …)
`src/lib/` — `api.ts` (the only fetch layer), `hooks/`, contexts (`repo-context`, `theme`, `toast`)
`messages/en/*.json` — next-intl namespaces (note: at package root, **not** under `src/i18n/`)
`src/vendor/ui/` — `@devdigest/ui` design system
`src/vendor/shared/` — copy of the server Zod contracts

## Conventions (non-default)

- Route pages stay thin. Feature logic lives in `src/app/<route>/_components/<Name>/`
  alongside its own `*.test.tsx`.
- **Every server call goes through a hook in [src/lib/hooks/](src/lib/hooks/) built on
  [src/lib/api.ts](src/lib/api.ts).** Never call `fetch` from a component.
- Import UI **only** from the `@devdigest/ui` barrel. Never reach into
  `src/vendor/ui/primitives|kit|charts|shell` directly.
- All user-facing strings come from a next-intl namespace — no inline literals.
- Component tests mock `fetch`; there is no MSW and no dev-server dependency.

## Gotchas

- `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`) is the only client env var,
  read in [src/lib/api.ts](src/lib/api.ts).
- `src/vendor/shared/` is a **copy** of `server/src/vendor/shared/` and has already
  diverged from it. Changing a contract here does not change the server's.
- `noUncheckedIndexedAccess: true` — `arr[0]` is `T | undefined`, so index access needs
  a guard or `!`.
- Namespaces in `messages/en/` with no UI yet (blast, brief, conformance, conventions,
  eval, memory, skills, compose) are intentional course scaffolding — not dead code.
- vitest doesn't read tsconfig paths: new aliases must be added to
  [vitest.config.ts](vitest.config.ts) as well.

## Docs

- [README.md](README.md) — route → API surface map, stack notes
- [src/vendor/ui/README.md](src/vendor/ui/README.md) — design system, CSS-variable theming
- [../TESTING.md](../TESTING.md) — suite map and CI lanes
- [docs/](docs/) — design decisions, flows, ADRs
- [../server/docs/smart-diff.md](../server/docs/smart-diff.md) — why `SmartDiffViewer` re-derives
  per-line severity instead of the contract carrying it, and why it renders no diff rows of its own
- [specs/](specs/) — intended behavior, written before implementation
- [insights.md](insights.md) — hard-won findings in fixed sections; **read it before you
  edit here**, append at the end of a task via `/engineering-insights`
