---
name: frontend-ui-architecture
description: "Decides where frontend code belongs in the client/ package: which folder a component goes in, how to split a file that has grown, where constants, types, helpers and business logic live, and which module may import which. Use when adding a component, route, hook or constant; when a file needs splitting; when choosing between colocating code and promoting it to a shared folder; or when reviewing frontend structure. Covers folder layout, naming, import direction, the @devdigest/ui and @devdigest/shared boundaries, and App Router placement. Defers React-internal rules to react-best-practices and App Router semantics to next-best-practices."
version: 1.0.0
---

# Frontend UI architecture

This skill answers one question: **where does this code go?** It describes the structure that
`client/` (`@devdigest/web`) actually has — not a generic React layout. Where this repo departs
from mainstream advice it does so deliberately, and those spots are called out. Check **Scope**
first: three neighbouring skills own the questions this one does not.

## Scope

| Question | Owner |
|---|---|
| *Where* a file or folder goes; what may import what | **this skill** |
| How a component or hook is written inside (purity, derived state, `useEffect`, keys, memo) | `react-best-practices` |
| Whether a value belongs in state at all; Context vs hook | `react-best-practices` §State Management |
| App Router file semantics, RSC mechanics, metadata, caching | `next-best-practices` |
| Test authoring, RTL queries, mocking | `react-testing-library` |

This skill states the *placement* consequences of the server/client split. It does not re-teach
how RSC works.

## The two rules

**1. Colocate by default.** Code lives beside its only consumer. It moves out only when a
**second route** needs it — then UI goes to `src/components/<Name>/` and logic goes to a
domain-named module in `src/lib/`. One route's `_components/` is never an import target for
another route. Promotion is earned by a real second consumer, never anticipated.

**2. Imports point one way, and only through barrels.** The direction is
`app/<route>/` → `src/components/` → `src/lib/` → `@devdigest/ui` / `@devdigest/shared`.
Never upward, never sideways between sibling routes, never a deep path past a barrel.

Everything else in this skill follows from those two.

## Placement decision table

Most tasks resolve here without opening a reference file.

| You are adding… | It goes… | Read |
|---|---|---|
| A component one route uses | `src/app/<route>/_components/<Name>/` | `where-code-lives.md` |
| A component two or more routes use | `src/components/<Name>/` | `where-code-lives.md` |
| A child of an existing component | `<Parent>/_components/<Name>/` | `component-anatomy.md` |
| Styles for a component | sibling `styles.ts`, one object named `s` | `component-anatomy.md` |
| A static map, threshold or tuple | sibling `constants.ts` | `logic-and-constants.md` |
| A pure function one component uses | sibling `helpers.ts` | `logic-and-constants.md` |
| A pure function two routes use | `src/lib/<domain>.ts` | `logic-and-constants.md` |
| A server call | a hook in `src/lib/hooks/<domain>.ts` over `src/lib/api.ts` | `logic-and-constants.md` |
| Cross-cutting client state | a context in `src/lib/` | `logic-and-constants.md` |
| A user-facing string | `messages/en/<namespace>.json` | `logic-and-constants.md` |
| A business-agnostic UI primitive | `src/vendor/ui/<layer>/` + its layer barrel | `where-code-lives.md` |
| A domain type | nowhere — `import type` from `@devdigest/shared` | `logic-and-constants.md` |
| View state (tab, filter, deep link, drawer) | the URL, not component state | `app-router-placement.md` |
| A new route | `src/app/<segment>/page.tsx`, thin | `app-router-placement.md` |

## Layout of client/src

Six folders. The absences are as load-bearing as the contents.

```
src/app/          App Router: page.tsx files + route-private _components/ trees
src/components/   components shared across routes (app-shell, diff-viewer, …)
src/i18n/         one file: request.ts — next-intl config, reads messages/ off disk
src/lib/          api.ts (the only fetch layer), hooks/, contexts, domain helper modules
src/test/         setup.ts + smoke.test.tsx
src/vendor/ui/    the @devdigest/ui design system (in-repo, no build step)
src/vendor/shared/ copied server Zod contracts — type-only for the client
```

**There is no** `src/hooks/`, `src/utils/`, `src/types/`, `src/styles/`, `src/store/` or
`src/services/`. Do not create one. Hooks live in `src/lib/hooks/`; shared logic lives in a
domain-named file in `src/lib/`; types live with the module that owns them.

`messages/` sits at the **package root** (`client/messages/en/*.json`), not under `src/`.

## Import direction

| From | May import | Must not import |
|---|---|---|
| `src/app/<route>/` | its own `_components/`, `src/components/`, `src/lib/`, `@devdigest/ui` | another route's `_components/` |
| `src/components/` | `src/lib/`, `@devdigest/ui`, sibling files in its own folder | anything under `src/app/` |
| `src/lib/` | `@devdigest/ui`, `@devdigest/shared` (types) | `src/app/`, `src/components/` |
| `src/vendor/ui/` | its own layers | anything outside `src/vendor/` |

Two hard boundaries:

- **`@devdigest/ui` is barrel-only.** Import from `"@devdigest/ui"`, never from
  `src/vendor/ui/primitives|kit|charts|shell`. Not one deep import exists — keep it that way.
- **`@devdigest/shared` is type-only.** `import type` and nothing else. A runtime import pulls
  `vendor/shared/index.ts` into the bundle, whose `./contracts/*.js` re-exports Next's webpack
  cannot resolve — the reason is recorded at `client/src/lib/feature-models.ts:6-10`. There is
  no Zod parsing on the client; API responses are typed, not validated.

## Naming

| Kind | Convention | Example |
|---|---|---|
| Component folder | `PascalCase`, file name == folder name == export | `src/components/FindingSummaryRow/` |
| Multi-file feature folder | `kebab-case` | `src/components/diff-viewer/` |
| Route-private tree | `_components/` (underscore keeps it out of routing) | `src/app/agents/_components/` |
| Colocated siblings | fixed names: `styles.ts`, `constants.ts`, `helpers.ts`, `index.ts` | `FindingSummaryRow/styles.ts` |
| Test | `<Name>.test.tsx`, beside the component | `FindingSummaryRow/FindingSummaryRow.test.tsx` |
| Shared logic module | `kebab-case`, named for its domain — never `utils` | `src/lib/severity.ts` |
| Constant | `UPPER_SNAKE_CASE` | `VERDICT_META`, `SEVERITY_LEVELS` |

The mixed casing in `src/components/` is deliberate: PascalCase means one component,
kebab-case means a feature folder with several.

## App Router placement

`src/app/` holds routing plus colocated `_components/`. Two page shapes are both correct:

- **Thin server page** — 3 lines, delegates to a colocated view
  (`src/app/agents/page.tsx`). This is the default for a new non-interactive route.
- **Client controller page** — `"use client"`, reads `useParams`/`useSearchParams`, owns the
  batched `router.replace` setter, calls hooks, threads props down. Use when the route drives
  interactive view state.

Placement rules that follow:

- Feature logic never sits in `page.tsx`. It goes in `_components/<Name>/` beside it.
- `"use client"` goes after the file's header comment and before the imports.
- `src/vendor/ui/` carries **no** directive in any file — it inherits the boundary from its
  consumer. Keep it that way.
- Design-system components stay dumb: no i18n, no data fetching. The translated,
  data-fetching wrapper belongs in `src/components/<Name>/`.

The repo has no route groups, no `loading.tsx`/`error.tsx`/`not-found.tsx` (those states render
inline from query state), and no route handlers or server actions. Introducing any of them is a
new pattern that needs a reason — and `next-best-practices` owns its semantics.

## Split triggers

Split a file when **one** of these is true — not on line count alone:

1. A **second consumer** appears. Extract, then apply rule 1 to decide where it lands.
2. A distinct **render-state branch** (loading / error / empty / one tab) has its own layout.
3. A helper needs **its own test** — move it to `helpers.ts` so it can be imported directly.
4. Prop count climbs past the limit in `react-best-practices` §Component Design.

Splitting for its own sake creates barrels with one export and folders with one file. Don't.

## Not covered here

- Internal component quality, hooks misuse, memoization → `react-best-practices`
- RSC mechanics, metadata, caching, App Router file semantics → `next-best-practices`
- Test structure and queries → `react-testing-library`
- Contract shape and Zod schemas → `zod`, and `server/src/vendor/shared/` for the canonical copy
- Backend layering, repository ports, dependency direction in `server/` → `onion-architecture`

## References

- [references/where-code-lives.md](references/where-code-lives.md) — the annotated `src/` tree,
  the three-tier promotion ladder and its trigger, the `vendor/` boundaries, what must never
  be created.
- [references/component-anatomy.md](references/component-anatomy.md) — the folder-per-component
  contract, the role and shape of each sibling file, the four barrel shapes, nested
  `_components/`, header comments and prop declaration style.
- [references/logic-and-constants.md](references/logic-and-constants.md) — the business-logic
  ladder (pure fn → hook → server), constants and the `labelKey` pattern, i18n placement,
  type placement, the data-access rules.
- [references/app-router-placement.md](references/app-router-placement.md) — `app/` as routing,
  the two page shapes, where the client boundary sits, URL-as-view-state, the absent
  conventions and when to introduce them.
- [references/antipatterns.md](references/antipatterns.md) — ✗/✓ pairs for every rule above,
  anchored to real paths in `client/`.
