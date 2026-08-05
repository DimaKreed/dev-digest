---
name: breaking-change
description: Detect changes that break existing callers of a public contract. Apply when the diff touches an exported symbol, a route definition, or a shared type.
type: rubric
---

# Breaking change detection

A change is breaking when a call that was valid before this diff is no longer
valid after it. Intent is irrelevant; only compatibility counts.

## Flag these

- A public contract **removed or renamed**: an exported function, class, const or
  type; a route path or method; a field on a shared type; an event or config key.
  A rename is a removal — the old name is gone.
- A **required parameter added** to an exported function: a new parameter with no
  default and no `?`. Adding it in the middle, or reordering existing positional
  parameters, is breaking even if the count is unchanged.
- An existing parameter that **becomes required**, or whose **type narrows**
  (union member dropped, `string` → a literal union, optional → required).
- A **return type change** that existing consumers cannot absorb, including a
  return that newly admits `null` / `undefined`.

## Find the caller before you judge

Scan the whole diff — added lines, deleted lines and **unchanged context lines** —
plus any `## Callers of changed symbols` block, for call sites of the changed
symbol and for links to the changed route. A call site left in the old form is
the evidence.

## Severity

- **CRITICAL** — the diff changes an exported function's or a route's contract
  **and** at least one existing caller visible in this material still uses the
  old form. Cite the offending `file:line` **and** the un-updated caller's
  `file:line` in the same finding; name the exact failure (argument count,
  `undefined` at runtime, 404).
- **WARNING** — the contract changed but no un-updated caller is visible here.
  Say that consumers outside this diff must be checked.
- Never split one break into several findings. The rename, the new parameter and
  the stale caller are one finding when they are one contract.

## Example

❌ Breaking — required parameter added, caller not updated:

```diff
  // src/render/chart.ts
- export function renderChart(data: Series[]) {
+ export function renderChart(data: Series[], theme: Theme) {

  // src/pages/dashboard.ts  (unchanged context in the same diff)
  renderChart(series);          // ← still one argument: theme is undefined
```

✅ Compatible — optional with a default, or every caller migrated in the same PR:

```diff
  // src/render/chart.ts
- export function renderChart(data: Series[]) {
+ export function renderChart(data: Series[], theme: Theme = defaultTheme) {

  // src/pages/dashboard.ts
- renderChart(series);
+ renderChart(series, currentTheme);
```
