# frontend-ui-architecture

Where frontend code lives in `client/` (`@devdigest/web`): folder layout, component splitting,
logic and constant placement, import direction, and App Router placement.

**Version 1.0.0**

## Why this skill exists

Before it, no skill in this repo answered *"where does this code go?"* for the frontend. Total
coverage was ten lines — `## Code Organization` in `react-best-practices/SKILL.md`, two bullets.
`next-best-practices/` owns App Router *file semantics*, not application architecture. A vendored
`architecture-patterns` skill is still listed in `skills-lock.json` but its directory is gone.

The result was that every structural decision got re-derived: a new component might land in
`src/components/` or in a route's `_components/`, constants might go in a colocated
`constants.ts` or a new global file, a helper might become `src/utils/`. This skill fixes the
answers to the structure that `client/` already has.

## Scope

Owns: file and folder placement, promotion rules, import direction, naming, the `vendor/`
boundaries, App Router placement.

Defers: component internals to `react-best-practices`; App Router and RSC semantics to
`next-best-practices`; tests to `react-testing-library`; backend layering to
`onion-architecture`.

## Layout

```
frontend-ui-architecture/
  SKILL.md                              scope, the two rules, placement decision table, the tree
  README.md                             this file
  references/
    where-code-lives.md                 the annotated src/ tree, the promotion ladder, vendor/ boundaries
    component-anatomy.md                folder-per-component contract, sibling files, barrels, split triggers
    logic-and-constants.md              the logic ladder, data access, constants, i18n, types
    app-router-placement.md             app/ as routing, the two page shapes, URL-as-view-state
    antipatterns.md                     ✗/✓ pairs anchored to real paths
```

Two deviations from the contract in `.claude/skills/README.md`, both deliberate:

- A `references/` directory instead of flat `examples.md` / `references.md`. Four of the eleven
  existing skills already do this (`drizzle-orm-patterns`, `typescript-expert`, `zod`,
  `fastify-best-practices` via `rules/`), and the topics here split cleanly by question.
- A `version` field in the frontmatter. No other skill in this repo or in `C:\work\.claude\skills`
  has one — provenance for *vendored* skills lives in `skills-lock.json`, and hand-authored
  skills carry none. It was requested for this skill; unknown frontmatter keys are ignored by the
  loader, so it is inert. Bump it here and in the changelog together.

## How the research maps to the rules

The skill documents *this repo's* architecture. The external sources supply the reasoning, and in
two places the repo knowingly does the opposite of the popular advice.

| Rule in the skill | Where it comes from |
|---|---|
| Colocate by default; promotion is earned by a real second consumer | Kent C. Dodds on colocation; the vertical-slice "shared code is earned through repeated use" rule |
| The promotion trigger is a second **route**, not a second component | the repo itself — `client/src/lib/severity.ts:8-10` records the move and the reason |
| Imports point one way (route → components → lib → vendor) | bulletproof-react's unidirectional-codebase rule; FSD's "layers import strictly downward" |
| A slice exposes a narrow public surface | FSD's public-API-per-slice rule, realised here as the folder barrel |
| Split on a trigger, not on line count | Parnas' extension/contraction criteria; Infinum's single-responsibility framing |
| Business logic as pure functions, React-coupled logic as hooks | React docs on custom hooks (`use` prefix only if it calls a hook; no `useMount`-style wrappers); Dan Abramov's 2019 retraction of container/presentational — the container is now a hook |
| `app/` holds routing only; feature code in `_components/` | Next.js project-structure docs (private folders, safe colocation); FSD's Next.js App Router guide |
| `"use client"` marks leaves; the design system stays directive-free | Next.js Server and Client Components docs (the directive is a module-graph boundary) |
| Providers wrap `{children}`, not `<html>` | Next.js docs, "render providers as deep as possible" |
| Design-system layering (tokens → primitives → kit → shell) | Brad Frost's atomic design as a mental model — the labels were never the point |
| **Barrels everywhere** (contradicts the mainstream) | bulletproof-react and the barrel-file critiques argue against them; this repo accepts the cost for an explicit public surface. Documented as a deviation, not restated as best practice |
| **Inline styles over utility classes** (contradicts the mainstream) | the repo's own measured reality: 538 `style={}` vs 58 `className`, zero Tailwind utilities. Tailwind 4 is present for preflight and the `@theme inline` token bridge only |

## Sources

Every link below was read while writing this skill.

**Folder structure and feature organisation**

- [bulletproof-react — project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
- [Feature-Sliced Design — overview](https://feature-sliced.design/docs/get-started/overview)
- [Feature-Sliced Design — the ultimate Next.js App Router architecture](https://feature-sliced.design/blog/nextjs-app-router-guide)
- [React Handbook — project standards](https://reacthandbook.dev/project-standards)
- [Sandro Roth — how to structure your React projects](https://sandroroth.com/blog/project-structure/)
- [Milan Jovanović — screaming architecture](https://milanjovanovic.tech/blog/screaming-architecture)

**Colocation and the promotion rule**

- [Kent C. Dodds — colocation](https://kentcdodds.com/blog/colocation)
- [Kent C. Dodds — state colocation](https://kentcdodds.com/blog/state-colocation-will-make-your-react-app-faster)
- [Matias Kinnunen — locality of behaviour / co-location](https://mtsknn.fi/blog/locality-of-behavior-and-co-location/)

**Component splitting and composition**

- [React docs — reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [Dan Abramov — presentational and container components (with the 2019 retraction)](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0)
- [Infinum frontend handbook — React guidelines and best practices](https://infinum.com/handbook/frontend/react/react-guidelines-and-best-practices)
- [Guidelines from the 1970s on how to split your React components (Parnas)](https://dev.to/imforja/guidelines-from-the-1970s-on-how-to-split-your-react-components-2jn5)
- [Brad Frost — atomic design, chapter 2](https://atomicdesign.bradfrost.com/chapter-2/)

**Next.js architecture**

- [Next.js — project structure and organisation](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js — server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components)

**Barrel files — the deliberate deviation**

- [Steven Lemon — are TypeScript barrel files an anti-pattern?](https://steven-lemon182.medium.com/are-typescript-barrel-files-an-anti-pattern-72a713004250)
- [Stop using barrel files](https://jsdev.space/howto/stop-using-barrel-files/)

**Skill authoring**

- [Anthropic — skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

**In-repo sources of truth** (these outrank anything above when they disagree)

- `client/CLAUDE.md` — the stated conventions and gotchas
- `client/insights.md` — durable findings, appended via `/engineering-insights`
- `client/src/vendor/ui/README.md` — design-system layers and theming

## Changelog

### 1.0.0

- Initial release. Grounded in `client/` as of commit `c23eaa4`.
- Takes ownership of code organisation from `react-best-practices`, whose `## Code Organization`
  section was replaced with a pointer.
- Corrected two bullets in `react-best-practices` that described a different codebase: the
  `useApiQuery`/`useApiMutation` hooks it named do not exist here (data access is
  `src/lib/hooks/*` over `src/lib/api.ts`), and its Tailwind section prescribed utility classes
  and a `components/ui/` folder, neither of which this client has.
