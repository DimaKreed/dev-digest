# Logic, constants and types

## Contents

- The logic ladder — four rungs
- Data access: hooks over `api.ts`
- Constants and the `labelKey` pattern
- User-facing strings
- Types
- Helpers vs `lib` modules — the naming test

## The logic ladder — four rungs

Classify the logic first, then place it. The rung decides the file; the promotion ladder in
`where-code-lives.md` decides the folder.

**Rung 1 — pure domain logic.** No React, no `window`, no fetch. A plain exported function that
takes arguments and returns a value.

- One component uses it → sibling `helpers.ts`.
- Several components in one route → the route's own `helpers.ts`, beside `page.tsx`.
- Two routes → a domain-named module in `src/lib/`.

This is the rung to aim for. Pure functions are unit-testable by direct import, with no render,
no provider and no mock. `client/src/lib/severity.ts` is the model: `parseSeverity`,
`isLiveFinding`, `countBySeverity`, `latestRunPerAgent`, `runMatches` — every one a pure
function over contract types, with a colocated `severity.test.ts`.

**Rung 2 — React-coupled logic.** Needs state, an effect, a ref, or an external system.

- Touches the server → a hook in `src/lib/hooks/<domain>.ts`. Always. See the next section.
- UI-only and used by one component tree → a `hooks/` subfolder in that component's folder
  (`client/src/components/app-shell/hooks/` is the sole precedent).
- Name it `use<Thing>` **only if it calls a hook.** A function that merely sorts or formats gets
  no `use` prefix — it is rung 1.

Do not write `useMount`, `useEffectOnce` or `useUpdateEffect`. Wrappers around `useEffect` are
not the pattern; a hook should name a concrete use case (`useRunEvents`, `usePrReviews`).

**Rung 3 — server-side logic.** Runs on the server, never ships to the client.

The repo has **no route handlers and no server actions** today. Only `layout.tsx` does async
server work (`getLocale`, `getMessages`). Introducing a `route.ts` or a server action is a new
pattern that needs a stated reason — the existing path is: server logic lives in
`@devdigest/api` (port 3001) and the client reaches it through `src/lib/api.ts`.

**Rung 4 — presentation-only formatting.** Turning a value into display text — durations,
percentages, truncated shas. Sibling `helpers.ts`, or `src/lib/` once a second route needs it
(`format-usage.ts`, `model-label.ts`, `github-urls.ts` are all rung 4 promoted to tier 3).

## Data access: hooks over `api.ts`

Two hard rules, both from `client/CLAUDE.md`:

1. **`client/src/lib/api.ts` is the only place `fetch` is called.** It owns `API_BASE`, the
   `ApiError` class, `apiFetch<T>` and the `api.{get,post,put,patch,del}` wrappers. It normalises
   every failure to `ApiError` — network failure becomes status `0` with code `network_error`,
   `204` becomes `undefined`.
2. **Every server call goes through a hook in `src/lib/hooks/`.** Never call `api.*` from a
   component either — the hook is the boundary, not just the fetch.

The idioms those hooks follow, so a new one matches:

| Concern | Pattern |
|---|---|
| Query key | a string-array tuple: `["pulls", repoId]`, `["run-trace", runId]` |
| Nullable id | type it `string \| null \| undefined` and gate with `enabled: !!id` — never a conditional hook call |
| Invalidation | `qc.invalidateQueries` by key in the mutation's `onSuccess`; `setQueryData` for a write-through |
| Polling | self-terminating: `refetchInterval: (query) => (running ? 4000 : false)` |
| Deferred fetch | a trailing `enabled = true` parameter so a caller can share the cache entry without triggering a request |
| Streaming | also a hook — `useRunEvents` owns the `EventSource` and its cleanup |

Error UX is already centralised in `client/src/lib/providers.tsx`: the `QueryCache`/
`MutationCache` `onError` handlers toast status `0` and `5xx`, and stay silent on `4xx`. Do not
add a per-component toast for a failed query. The taxonomy is: **system errors → toast, form
errors → inline, critical → full-screen `ErrorState`.**

## Constants and the `labelKey` pattern

Constants live in a `constants.ts` beside their consumer, at whichever tier the consumer sits.
17 of them exist; every one is under a component or route folder. None is global.

The canonical shape is a typed record keyed by a domain union, holding a CSS token and an **i18n
key** — never a translated string
(`client/src/app/repos/[repoId]/pulls/[number]/_components/VerdictBanner/constants.ts`):

```ts
/** Per-verdict visual meta. `labelKey` resolves under the `verdict` namespace. */
export const VERDICT_META: Record<
  Verdict,
  { c: string; bg: string; icon: IconName; labelKey: string }
> = {
  request_changes: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle", labelKey: "requestChanges" },
  approve:         { c: "var(--ok)",   bg: "var(--ok-bg)",   icon: "CheckCircle",    labelKey: "approve" },
  comment:         { c: "var(--info)", bg: "var(--info-bg)", icon: "MessageSquare",  labelKey: "comment" },
};
```

The component resolves it: `t(VERDICT_META[verdict].labelKey)`. This keeps the map free of
translated text and lets the same map serve every locale.

Placement by scope:

| Scope | Location | Example |
|---|---|---|
| One component | its folder's `constants.ts` | `VerdictBanner/constants.ts` |
| A whole route | the route root, beside `page.tsx` | `src/app/repos/[repoId]/pulls/constants.ts` |
| Two routes | a domain module in `src/lib/` | `SEVERITY_LEVELS` in `src/lib/severity.ts` |
| The design system | `vendor/ui/primitives/tokens.ts`, `vendor/ui/nav.ts` | `SEV`, `CAT`, `NAV`, `SHORTCUTS` |

Naming is `UPPER_SNAKE_CASE`. A route-level `constants.ts` may also declare the local types its
constants are keyed by (`src/app/repos/[repoId]/pulls/constants.ts` declares `PrSize`,
`SizeInfo` next to `STATUS_META`, `GRID`, `SIZE_SMALL_MAX`).

Before adding a colour or icon map, check whether `SEV` or `CAT` in
`vendor/ui/primitives/tokens.ts` already owns that vocabulary. A second severity colour map is
the mistake `src/lib/severity.ts:17-20` explicitly warns against.

## User-facing strings

Every string a user reads comes from a next-intl namespace. No inline literals.

- Namespaces are files: `client/messages/en/<namespace>.json` — 18 of them (`prReview`,
  `agents`, `settings`, `shell`, `runs`, `common`, `onboarding`, `context`, `ci`, …).
- Read them with `const t = useTranslations("<namespace>")` at the top of the component body.
- Keys are dot-paths mirroring the JSON nesting, with interpolation where needed:
  `t("list.summary", { open, needsReview })`.
- Namespaces with no UI yet (`blast`, `brief`, `conformance`, `conventions`, `eval`, `memory`,
  `skills`, `compose`) are intentional course scaffolding. Do not delete them.
- The one documented exception is `src/components/showcase/` — a dev-only gallery whose labels
  are deliberately not internationalised.

If a string is going into a `constants.ts`, it should be a `labelKey`, not the text.

## Types

Types live with the module that owns them. Only three `types.ts` files exist in the whole client
(`src/lib/types.ts`, `vendor/ui/kit/types.ts`, `vendor/ui/shell/types.ts`) and none is at
component level.

| Kind of type | Where |
|---|---|
| Component props | inline in the destructuring position — see `component-anatomy.md` |
| A type a `helpers.ts` needs | declared in that `helpers.ts` (`Line`, `DiffTarget`) |
| A type a domain module owns | declared in that module (`CommentThread`, `DiffCommentApi`, `ActiveRun`) |
| A wire/domain type | `import type { … } from "@devdigest/shared"` — never redeclared |
| A UI-only view model over a contract type | `src/lib/types.ts` (e.g. `PrRowView`) |

`@devdigest/shared` imports are **type-only**, always. See the boundary note in
`where-code-lives.md`.

## Helpers vs `lib` modules — the naming test

The words are not interchangeable here:

- **`helpers.ts`** — colocated, belongs to one component or one route, may be tiny and
  situational. Its name says nothing about its contents because its location does.
- **`src/lib/<domain>.ts`** — shared across routes, and named for the domain concept it owns:
  `severity`, `github-urls`, `format-usage`, `model-label`, `feature-models`.

The test for promoting: **can you name the module after a domain concept?** If yes, promote. If
the honest name is `utils.ts`, `helpers.ts` or `misc.ts`, it has not earned tier 3 — leave it
colocated. There is no `src/utils/` and adding one is the anti-pattern this test exists to
prevent.
