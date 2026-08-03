# Where code lives

## Contents

- The tree
- The promotion ladder — the one decision that matters
- `src/components/` — what qualifies
- `src/lib/` — what qualifies
- The `vendor/` boundaries
- What must never be created
- Deliberate deviations from mainstream advice

## The tree

```
client/
  messages/en/*.json          18 next-intl namespaces — at the PACKAGE root, not under src/
  src/
    app/                      App Router. page.tsx files + route-private _components/ trees
    components/               components shared across two or more routes
    i18n/request.ts           next-intl getRequestConfig; reads messages/ off disk and merges
    lib/
      api.ts                  the ONLY fetch call site; API_BASE, ApiError, apiFetch, api.*
      hooks/                  index.ts barrel + core.ts, agents.ts, reviews.ts, trace.ts, repo-intel.ts
      providers.tsx           QueryClient > Theme > Toast > Repo
      theme.tsx  toast.tsx  repo-context.tsx
      severity.ts  github-urls.ts  format-usage.ts  model-label.ts  feature-models.ts
      types.ts                a re-export shim over @devdigest/shared + one UI-only view model
    test/                     setup.ts, smoke.test.tsx
    vendor/ui/                the @devdigest/ui design system — 56 files, no build step
    vendor/shared/            copied server Zod contracts — TYPE-ONLY for the client
```

Path aliases (`client/tsconfig.json`, mirrored by hand in `client/vitest.config.ts` because
vitest does not read tsconfig paths):

```
@/*                 → ./src/*
@devdigest/shared   → ./src/vendor/shared/index.ts
@devdigest/ui       → ./src/vendor/ui/index.ts
@devdigest/ui/*     → ./src/vendor/ui/*
```

Adding an alias means editing **both** files.

## The promotion ladder — the one decision that matters

Three tiers. Code starts at tier 1 and only moves up when a real consumer forces it.

| Tier | Location | Qualifies when |
|---|---|---|
| 1 | `src/app/<route>/**/_components/<Name>/` | exactly one route uses it |
| 2 | `src/components/<Name>/` | **two or more routes** use the UI |
| 3 | `src/lib/<domain>.ts` | two or more routes use the *logic* (no JSX) |

**The trigger is a second route, not a second component.** Two components inside the same route
sharing a helper is still tier 1 — the helper moves to the route's own `helpers.ts` at the route
root, beside `page.tsx`. Only when a *different* route needs it does it leave `app/`.

The worked precedent is recorded in the source. `client/src/lib/severity.ts:8-10`:

> These used to live in the detail page's `SeverityFilterBar/_components` folder; they moved
> here once the PR list needed them too — a route's `_components` is not an import target for
> another route.

That sentence is the rule. A route's `_components/` is private. If you find yourself wanting to
import from one, that is the signal to promote — not to reach across.

**Do not pre-promote.** A single-consumer module in `src/components/` or `src/lib/` is worse
than a colocated one: it advertises reuse that does not exist, and the next reader has to search
the whole tree to learn it has one call site.

## `src/components/` — what qualifies

Current contents, and the shape each name signals:

| Folder | Shape |
|---|---|
| `FindingSummaryRow/`, `FindingsHoverList/`, `RunCostBadge/` | PascalCase — one component + its siblings |
| `app-shell/`, `diff-viewer/`, `mermaid-diagram/`, `page-shell/`, `repo-not-found/`, `showcase/` | kebab-case — a feature folder with several components |

A feature folder keeps its shared modules at the folder root and gives each component its own
subfolder. `diff-viewer/` is the reference case:

```
diff-viewer/
  index.ts  styles.ts  helpers.ts  constants.ts  comments.ts   ← shared by the whole feature
  DiffViewer/  FileCard/  CodeLine/  CommentCard/
  CommentThreadView/  InlineComposer/  OutdatedComments/       ← each: <Name>.tsx + index.ts
```

Sub-components own **no** styles or constants of their own — they import upward from the feature
root (`client/src/components/diff-viewer/CodeLine/CodeLine.tsx:6-8`). Duplicating a style object
into a subfolder is the mistake this shape exists to prevent.

## `src/lib/` — what qualifies

`src/lib/` is not a utility bucket. Every file in it is one of four things:

1. **The fetch layer** — `api.ts`, and only `api.ts`. No component and no other lib module
   calls `fetch`.
2. **Hooks** — `hooks/<domain>.ts`, re-exported through `hooks/index.ts`. The only data-access
   surface the UI sees.
3. **A context** — `providers.tsx`, `theme.tsx`, `toast.tsx`, `repo-context.tsx`. Cross-cutting
   client state that genuinely spans routes.
4. **A domain module** — `severity.ts`, `github-urls.ts`, `format-usage.ts`, `model-label.ts`,
   `feature-models.ts`. Pure functions and constants, named for the domain concept they own.

A new file here must be nameable after a domain concept. If the best name you can find is
`utils.ts`, `helpers.ts` or `misc.ts`, the code has not earned tier 3 — leave it colocated.

## The `vendor/` boundaries

**`src/vendor/ui/` — the design system.** Exposed as `@devdigest/ui` via a tsconfig path; in-repo,
no `node_modules` entry, no build step. Layers: `primitives/` (17 components + `tokens.ts`),
`kit/` (dialogs, inputs), `charts/`, `shell/`, `command-palette/`, `icons.tsx`, `nav.ts`.

- Import **only** from the `"@devdigest/ui"` barrel. Zero deep imports exist today; keep it zero.
- No file in it carries `"use client"` — the directive-free design system inherits the boundary
  from its consumer.
- It stays **dumb**: no `useTranslations`, no hooks that fetch. `HoverCard` is a bare container
  on purpose; `src/components/FindingsHoverList/` is the wrapper that translates and fetches.
- Its own styling is built inline in the component body — the design system has no `styles.ts`
  files at all. Only consumer components use the `styles.ts` sibling.

**`src/vendor/shared/` — the contracts.** A copy of `server/src/vendor/shared/` that has
**already diverged**. Changing a contract here does not change the server's.

- `import type` only. Every current import site is type-only; a runtime import breaks the
  webpack build (`client/src/lib/feature-models.ts:6-10`).
- Need a runtime value from the server's contracts? Mirror it into a `src/lib/` module and say
  so in a comment, as `feature-models.ts` does.

## What must never be created

| ✗ | Why | Instead |
|---|---|---|
| `src/utils/` | a graveyard with no owner; unmaintained long after its call sites die | `src/lib/<domain>.ts` |
| `src/hooks/` | hooks are data access here, and data access lives in one place | `src/lib/hooks/<domain>.ts` |
| `src/types/` | types belong to the module that owns them | colocate, or `@devdigest/shared` |
| `src/components/common/` or `shared/` | says nothing about what is inside | name the feature |
| `src/store/`, `src/services/` | no Redux/Zustand here; server data is TanStack Query, view state is the URL | `src/lib/hooks/`, the URL |
| a second severity/verdict colour map | `SEV`/`CAT` in `vendor/ui/primitives/tokens.ts` already own it | import the existing map |

## Deliberate deviations from mainstream advice

Two places where this repo knowingly does the opposite of the popular recommendation. Both are
settled — do not "fix" them.

**Barrel files everywhere.** bulletproof-react advises against barrels (bundler graph size,
circular-dependency risk). This repo has 55 `index.ts` barrels and treats the barrel as the sole
import point for a component folder, because it makes a folder's public surface explicit and
lets internals be renamed freely. The cost is accepted; the mitigation is that barrels re-export
named symbols from one folder, never `export *` across the tree.

**Inline styles over utility classes.** Tailwind 4 is installed but no Tailwind utility class is
used anywhere. Styling is inline `style={s.x}` objects reading CSS custom properties, with four
global classes only (`mono`, `tnum`, `skeleton`, `dd-md`). Tailwind is present to provide the
preflight and to expose the tokens through a `@theme inline` bridge in
`client/src/vendor/ui/styles.css`. Adding `className="flex gap-2"` is a deviation, not an
improvement.
