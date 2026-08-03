# Anti-patterns

Each pair is a real placement mistake and its fix. Paths are actual locations in `client/`.

## Contents

- Reaching across routes
- Pre-promoting a single-consumer module
- Inventing a `utils/` bucket
- Deep-importing past a barrel
- Importing a runtime value from `@devdigest/shared`
- Calling `fetch` from a component
- Putting translated text in `constants.ts`
- Hard-coding a colour
- Reaching for Tailwind utilities
- Pushing i18n or data into the design system
- Duplicating a parent's style object
- Splitting to hit a number

## Reaching across routes

✗ **Importing another route's private tree**

```ts
// src/app/repos/[repoId]/pulls/page.tsx
import { countBySeverity } from "../[number]/_components/SeverityFilterBar/_components/tally";
```

A `_components/` folder is private to its route. This import compiles, then quietly couples two
routes so neither can be refactored alone.

✓ **Promote to tier 3, then import from `src/lib/`**

```ts
// src/app/repos/[repoId]/pulls/page.tsx
import { countBySeverity } from "@/lib/severity";
```

This is exactly what happened historically — `client/src/lib/severity.ts:8-10` records the move
and the reason.

## Pre-promoting a single-consumer module

✗ **A shared folder for something one route uses**

```
src/components/AgentRunDuration/     ← imported only by src/app/agents/
```

Advertises reuse that does not exist. The next reader must search the tree to learn it has one
call site.

✓ **Keep it colocated until a second route needs it**

```
src/app/agents/_components/AgentRunDuration/
```

## Inventing a `utils/` bucket

✗ **A folder no one owns**

```
src/utils/formatDuration.ts
src/utils/index.ts
```

✓ **A domain-named module in `src/lib/`, or stay colocated**

```
src/lib/format-usage.ts        ← if two routes need it
<Component>/helpers.ts         ← if one does
```

The test: can you name the module after a domain concept? If the honest answer is `utils`, it has
not earned a shared home.

## Deep-importing past a barrel

✗ **Reaching into the design system's layers**

```ts
import { Button } from "@devdigest/ui/primitives/Button";
import { HoverCard } from "../../vendor/ui/kit/HoverCard";
```

✓ **The single barrel, always**

```ts
import { Button, HoverCard } from "@devdigest/ui";
```

Every current import site does this; not one deep import exists. Keep it that way — the barrel is
what lets the layers be reorganised.

## Importing a runtime value from `@devdigest/shared`

✗ **A value import breaks the build**

```ts
import { FEATURE_MODELS } from "@devdigest/shared";
```

This pulls `vendor/shared/index.ts` into the webpack bundle, whose `./contracts/*.js` re-exports
Next's webpack cannot resolve.

✓ **Types only; mirror the value locally and say so**

```ts
import type { Provider, Verdict } from "@devdigest/shared";
```

`client/src/lib/feature-models.ts:3-12` is the worked example: a client-local copy of the
registry with a comment stating why it exists and that it must be kept in sync.

## Calling `fetch` from a component

✗ **A component that talks to the network**

```tsx
useEffect(() => {
  fetch(`${API_BASE}/repos/${repoId}/pulls`).then(setPulls);
}, [repoId]);
```

Bypasses `ApiError` normalisation, the query cache, and the centralised error toasts.

✓ **A hook in `src/lib/hooks/` over `src/lib/api.ts`**

```ts
// src/lib/hooks/core.ts
export function usePulls(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["pulls", repoId],
    queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`),
    enabled: !!repoId,
  });
}
```

`api.ts` is the only `fetch` call site in the client. Do not add a second.

## Putting translated text in `constants.ts`

✗ **A map holding user-facing copy**

```ts
export const VERDICT_META = {
  request_changes: { c: "var(--crit)", label: "Request changes" },
};
```

✓ **Hold the key; let the component resolve it**

```ts
export const VERDICT_META = {
  request_changes: { c: "var(--crit)", labelKey: "requestChanges" },
};
// in the component:  t(VERDICT_META[verdict].labelKey)
```

The text itself belongs in `client/messages/en/<namespace>.json`.

## Hard-coding a colour

✗ **A hex literal in `styles.ts`**

```ts
title: { color: "#e5e7eb" } satisfies CSSProperties,
```

Breaks the light theme silently — `data-theme` switching only affects the CSS custom properties.

✓ **A token**

```ts
title: { color: "var(--text-primary)" } satisfies CSSProperties,
```

Tokens are defined once in `client/src/vendor/ui/styles.css`. No `styles.ts` in the repo contains
a hex literal.

## Reaching for Tailwind utilities

✗ **Utility classes**

```tsx
<div className="flex items-center gap-3 rounded-md bg-slate-800 px-3 py-2">
```

Tailwind 4 is installed for its preflight and the `@theme inline` token bridge only. No utility
class is used anywhere in the client; adding some creates a second, parallel styling system.

✓ **An inline style object from the sibling `styles.ts`**

```tsx
<div style={s.row}>
```

The four global classes that *are* allowed: `mono`, `tnum`, `skeleton`, `dd-md`.

## Pushing i18n or data into the design system

✗ **A kit component that translates or fetches**

```tsx
// src/vendor/ui/kit/HoverCard.tsx
const t = useTranslations("prReview");
const { data } = useFindings(prId);
```

Breaks `client/src/test/smoke.test.tsx`, which mounts the gallery wrapped in neither
`NextIntlClientProvider` nor `QueryClientProvider`.

✓ **Dumb primitive, smart wrapper**

```
src/vendor/ui/kit/HoverCard.tsx           ← bare container, no i18n, no data
src/components/FindingsHoverList/         ← calls useTranslations and the hook
```

## Duplicating a parent's style object

✗ **A child folder growing its own `styles.ts` for the same visuals**

```
diff-viewer/CodeLine/styles.ts     ← re-declares row and sign styles
```

✓ **Import upward from the feature root**

```ts
// src/components/diff-viewer/CodeLine/CodeLine.tsx:6-8
import { commentTargetFor, type CommentThread, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
```

If a child truly needs a new style, add an entry to the parent's `s` first.

## Splitting to hit a number

✗ **Extracting because the file is long**

```
FindingCard/_components/{Title,Meta,Rationale,Chevron}/   ← four folders, four one-line files
```

Now a reader needs four hops to find the markup, and each folder has a barrel with one export.

✓ **Split on a trigger**

Extract when a second consumer appears, when a render-state branch has its own layout, when a
helper needs its own test, or when prop count passes the limit in `react-best-practices`. The
trigger that fired should be visible in the extracted file's header comment — as in
`client/src/components/FindingSummaryRow/FindingSummaryRow.tsx:1-4`.
