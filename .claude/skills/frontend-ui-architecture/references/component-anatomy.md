# Component anatomy

## Contents

- The folder contract
- The sibling files
- `styles.ts` — the invariants
- Barrel shapes and when to use each
- Nesting: `_components/` inside a component
- The `atoms.tsx` escape hatch
- The header comment
- Declaring props
- Split triggers in detail

## The folder contract

One folder per component. The folder name, the `.tsx` file name and the exported symbol are all
the same PascalCase word.

```
<Name>/
  <Name>.tsx          the component
  <Name>.test.tsx     colocated test (optional)
  styles.ts           style objects           (optional)
  constants.ts        static maps, thresholds (optional)
  helpers.ts          pure functions          (optional)
  index.ts            the barrel — the only import point
  _components/        children, same shape, recursively (optional)
```

Only those file names. There is no `types.ts` and no `config.ts` at component level anywhere in
`client/` — types are declared in the file that owns them, and configuration is a `constants.ts`
entry.

Reference: `client/src/components/FindingSummaryRow/` — `FindingSummaryRow.tsx`,
`FindingSummaryRow.test.tsx`, `styles.ts`, `index.ts`.

## The sibling files

| File | Holds | Must not hold |
|---|---|---|
| `<Name>.tsx` | the component, its inline prop types, small local render helpers | data fetching, `fetch`, literal user-facing strings |
| `styles.ts` | exactly one exported object named `s` | hex colours, component logic |
| `constants.ts` | typed const maps, thresholds, column keys, `labelKey` fragments | translated strings, anything that changes at runtime |
| `helpers.ts` | pure functions and the local types they need | React imports, hooks |
| `index.ts` | re-exports of the folder's public surface | logic of any kind |

A helper that needs a hook is not a helper — it is a hook, and it belongs in
`src/lib/hooks/` if it touches the server, or beside the component in a `hooks/` subfolder if it
is UI-only (`client/src/components/app-shell/hooks/` is the one precedent).

## `styles.ts` — the invariants

25 of these exist and every one follows the same shape. Copy it exactly.

```ts
import type { CSSProperties } from "react";

/** Co-located styles for <Name> (one line on why, if it moved here from elsewhere). */
export const s = {
  badgeWrap: { paddingTop: 1 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  root: (clickable: boolean): CSSProperties => ({
    display: "flex",
    cursor: clickable ? "pointer" : "default",
  }),
  title: (muted: boolean): CSSProperties => ({
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
  }),
} as const;
```

1. One export, named `s`. Never `styles`, never a default export.
2. Static entries end `satisfies CSSProperties`.
3. Variant entries are **functions** taking the deciding props and returning `CSSProperties`.
4. The object closes with `as const`.
5. **Every colour is `var(--token)`.** No hex literal appears in any `styles.ts`; the tokens are
   defined once in `client/src/vendor/ui/styles.css` and switch with `data-theme`.
6. `styles.ts` may import from its sibling `constants.ts` (a shared grid template, for example).

A second style object in the same folder is allowed when a domain module owns its own visuals —
`client/src/components/diff-viewer/comments.ts` exports `cs` under a `// ---- styles ----`
banner alongside its thread-grouping functions. Prefer one; reach for two only when the module
is already a cohesive unit.

## Barrel shapes and when to use each

`index.ts` narrows the folder to its public surface. Four shapes are in use:

```ts
// 1. Named export — the default. Use for a component with a named export.
export { FindingSummaryRow, lineLabel } from "./FindingSummaryRow";

// 2. Named + default alias — when a route or lazy import needs a default.
export { AgentEditor, AgentEditor as default } from "./AgentEditor";

// 3. Default-first — when the component itself is a default export.
export { default, default as RunTraceDrawer } from "./RunTraceDrawer";
export type { RunTraceDrawerProps } from "./RunTraceDrawer";

// 4. Wildcard — only for a folder whose whole contents are the surface.
export * from "./Showcase";
```

Prefer shape 1. A **feature** barrel is where the narrowing earns its keep — list only what
consumers may touch and let everything else stay internal
(`client/src/components/diff-viewer/index.ts`):

```ts
/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export { parseLineRange } from "./helpers";
export type { DiffTarget } from "./helpers";
```

Seven components live in that folder; four symbols leave it.

## Nesting: `_components/` inside a component

A component whose children are only its own gets a `_components/` subfolder, recursively. The
deepest current nesting is three levels
(`app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/`).

The rule that makes nesting cheap: **children import shared modules upward from the feature
root, they do not re-declare them.** From
`client/src/components/diff-viewer/CodeLine/CodeLine.tsx:6-8`:

```ts
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
```

If a child needs its own `styles.ts`, ask first whether the parent's `s` should gain an entry.
Usually it should.

## The `atoms.tsx` escape hatch

Trivial presentational layout helpers — no logic, never tested alone — may share one flat file
instead of each getting a folder. One precedent:
`client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/atoms.tsx`,
whose header states the rule. Use it for wrappers that are pure markup. Anything with a
conditional belongs in its own folder.

## The header comment

Every file opens with a block comment naming the file and saying **what it is and why it
exists**. Record the *why* when the file was extracted — future readers need the reason more
than the description. `client/src/components/FindingSummaryRow/FindingSummaryRow.tsx:1-4`:

```
/* FindingSummaryRow — the one-line identity of a finding: severity icon, title,
   category, file:line and confidence. Extracted from FindingCard's collapsed
   header so the findings hover panel shows the same row instead of inventing a
   third layout (the trace drawer's FindingsSection is already a second one). */
```

`"use client"` goes **after** this comment and **before** the imports.

## Declaring props

Props are declared inline in the destructuring position, with per-prop JSDoc. There is no
separate `interface <Name>Props`.

```tsx
export function CodeLine({
  ln,
  path,
  highlighted,
  scrollTo,
}: {
  ln: Line;
  path: string;
  /** Inside the deep-linked line range. */
  highlighted?: boolean;
  /** Set (to the target's nonce) on the FIRST row of the range. */
  scrollTo?: number;
}) {
```

Export a named `<Name>Props` type only when a consumer must reference it — the barrel then
re-exports it (shape 3 above).

## Split triggers in detail

Split on **one** of these. Line count alone is not a trigger.

1. **A second consumer appears.** Extract it, then use the promotion ladder in
   `where-code-lives.md` to decide where it lands. This is the only trigger that also changes
   the file's location.
2. **A distinct render-state branch has its own layout** — loading, error, empty, or one tab of
   several. Each becomes a component; the parent becomes early returns.
3. **A helper needs its own test.** Move it to `helpers.ts` so the test can import it directly
   instead of driving it through the DOM.
4. **Prop count climbs past the limit** in `react-best-practices` §Component Design. Prefer
   passing a `children` slot or one grouped object over adding the eighth prop.

Counter-trigger: do not split to hit a number. The result is folders with one file and barrels
with one export, and a reader now needs three hops to find the markup.
