# App Router placement

What goes in `src/app/` and what does not. For App Router *semantics* — how segments resolve,
how RSC renders, metadata, caching — use `next-best-practices`. This file is only about placement.

## Contents

- `app/` is routing plus private trees
- The two page shapes
- Where the client boundary sits
- View state lives in the URL
- Conventions this repo does not use, and when to introduce them

## `app/` is routing plus private trees

The current route surface — five pages, one layout, nothing else:

```
src/app/layout.tsx                                the ONLY layout; the only async server page work
src/app/globals.css                               imports vendor/ui/styles.css + one font + one keyframe
src/app/page.tsx                                  /                          "use client"
src/app/onboarding/page.tsx                       /onboarding                "use client"
src/app/agents/page.tsx                           /agents                    server, thin
src/app/agents/[id]/page.tsx                      /agents/:id
src/app/repos/[repoId]/pulls/page.tsx             /repos/:repoId/pulls       "use client"
src/app/repos/[repoId]/pulls/[number]/page.tsx    …/pulls/:number            "use client"
src/app/settings/[section]/page.tsx               /settings/:section         server, thin
```

Everything else under `app/` is a `_components/` tree. The underscore is a Next.js private
folder: it opts the folder and all its subfolders out of routing, so nothing inside can become a
route by accident. Colocation inside `app/` is already safe without it (only `page.tsx` and
`route.ts` make a segment public), but the underscore is used consistently here to make the
routing/UI split visible at a glance.

Route-level siblings sit beside `page.tsx` when they serve the whole route:

```
src/app/repos/[repoId]/pulls/
  page.tsx  constants.ts  helpers.ts  styles.ts        ← shared by this route
  _components/FilterBar/{FilterBar.tsx,index.ts}
  _components/PRRow/{PRRow.tsx,PRRow.test.tsx,index.ts}
  [number]/
    page.tsx
    _components/{DiffTab,FindingCard,FindingsPanel,FindingsTab,OverviewTab,PrDetailHeader,
                 ReviewRunAccordion,RunHistory,RunReviewDropdown,RunStatus,RunTraceDrawer,
                 SeverityFilterBar,VerdictBanner}/
```

## The two page shapes

Both are correct. Pick by whether the route drives interactive view state.

**Thin server page** — the default for a new non-interactive route. Three lines; the view and
everything it owns are colocated. `src/app/agents/page.tsx` in full:

```tsx
import { AgentsListView } from "./_components/AgentsListView";

/* Route: /agents (Agents list). Thin route entry — the view, its create modal,
   styles, constants, helpers and i18n are colocated under _components/AgentsListView. */
export default function AgentsPage() {
  return <AgentsListView />;
}
```

`src/app/settings/[section]/page.tsx` is the same shape. These two are the only server pages.

**Client controller page** — for a route that owns interactive view state. The page becomes the
controller: it reads `useParams` and `useSearchParams`, owns the setter that writes them back,
calls the hooks, derives memoized data, and threads props into `_components/`.

`src/app/repos/[repoId]/pulls/[number]/page.tsx` is the reference case (237 lines). Note what
stays in the page and what does not:

| Stays in `page.tsx` | Moves to `_components/` |
|---|---|
| reading params and search params | every piece of rendered UI |
| the batched `setParams` writer | per-tab layout and logic |
| hook calls and derived/memoized data | anything with its own styles |

Feature logic never lives in `page.tsx` in either shape. If the page is growing, the split
triggers in `component-anatomy.md` apply — extract into a sibling `_components/<Name>/`, and do
**not** promote to `src/components/` while only this route uses it.

## Where the client boundary sits

- `"use client"` goes after the file's header comment and before the imports.
- The directive is a **module-graph boundary**: everything a client module imports joins the
  client bundle. Components passed as `children` do not.
- **`src/vendor/ui/` carries no directive in any of its 56 files.** The design system inherits
  the boundary from whichever consumer imports it. Do not add one.
- Keep design-system components dumb: no `useTranslations`, no data fetching. The translated,
  data-fetching wrapper goes in `src/components/<Name>/`. `HoverCard` (kit) is a bare container
  on purpose; `src/components/FindingsHoverList/` is the one that translates and fetches. The
  reason is concrete: the only renderer of the `showcase` gallery is
  `client/src/test/smoke.test.tsx`, which mounts it wrapped in neither `NextIntlClientProvider`
  nor `QueryClientProvider` — a kit component that translated or fetched would break it.
- Providers are composed once, in `src/lib/providers.tsx`
  (`QueryClientProvider > ThemeProvider > ToastProvider > RepoProvider`), and rendered from
  `layout.tsx` around `{children}` — not around `<html>`. A new cross-cutting provider is added
  there, not in a page.

Practically, this client is client-rendered throughout: 62 files carry the directive. That is the
existing shape, not a target to preserve — but converting a route to RSC is a deliberate change
with its own reason, not a side effect of adding a component.

## View state lives in the URL

No client route state is kept outside the URL apart from ephemeral input (a search box's text,
hover, open/closed). The mapping on the PR detail route:

| State | Param |
|---|---|
| active tab | `?tab` |
| severity filter | `?severity` |
| deep link to a finding | `?finding` |
| deep link to a file/line | `?file` + `?line` |
| trace drawer | `?trace` |

**Batch multi-param writes into one `router.replace`.** Selecting a severity from another tab has
to set `?tab` and `?severity` together, or the first write is lost. The pattern is a single
`setParams(patch: Record<string, string | null>)` on the page that applies the whole patch and
replaces once.

When adding view state, add a param — not a `useState` in the page, and not a context.

## Conventions this repo does not use, and when to introduce them

None of these exist today. Each absence is a decision; introducing one is a new pattern that
needs a stated reason, and `next-best-practices` owns its semantics.

| Absent | What is done instead | Introduce when |
|---|---|---|
| route groups `(group)` | flat segments; one root layout | two sections genuinely need different layouts |
| `loading.tsx` | `isLoading ? <Skeleton/> : …` inside the page, from query state | a route does server-side data fetching worth streaming |
| `error.tsx` | `isError ? <ErrorState/> : …` from query state; global toasts from the query cache | an uncaught render error needs a segment-level boundary |
| `not-found.tsx` / `notFound()` | a `useRepoNotFound(repoId)` branch rendering `<RepoNotFound/>` | a server page needs a real 404 status |
| nested layouts | one root layout | a subtree needs persistent chrome across navigations |
| `route.ts` handlers, server actions | `src/lib/hooks/` → `src/lib/api.ts` → `@devdigest/api` on :3001 | something must not be reachable from the browser |
| parallel / intercepting routes | drawers and modals driven by a search param | a modal must be deep-linkable as its own route |

Adding one of these in isolation is usually the wrong instinct: `loading.tsx` on a client-rendered
page does nothing, and an `error.tsx` beside a page whose errors are already toasted duplicates
the handling.
