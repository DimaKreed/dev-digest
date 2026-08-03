---
name: semver-discipline
description: Classify a change as major, minor or patch and flag releases that understate what they break. Apply when the diff changes a public contract, a version field, or a changelog.
type: convention
---

# Semver discipline

Every contract change carries a required bump. Decide the bump from the diff, not
from the PR title — "add an option" and "support X" routinely describe major
changes.

## Classify

**MAJOR** — anything an existing caller must change code to survive:
- a public symbol, route path, method, field or config key removed or renamed;
- a required parameter added, or an optional one made required;
- a parameter or return type narrowed, or positional parameters reordered;
- a default changed such that unchanged calls behave differently;
- a route moved behind a new version prefix while the old path is deleted.

**MINOR** — purely additive, every prior call still valid:
- a new endpoint, exported symbol, optional parameter appended last, or optional
  response field;
- a new enum member **only** when consumers already have a default branch.

**PATCH** — no contract surface moves: internal fixes, performance, docs, tests.

## Rules

- State the required bump in the rationale of the finding that reports the break.
  Do **not** file a second finding restating a break already reported — that is a
  duplicate.
- File a standalone finding only when the **release metadata contradicts the
  diff**: a version field, changelog entry, PR title or description that presents
  a major change as additive or as a fix. Severity **WARNING**; cite the metadata
  line and the contract line that disagree.
- A version prefix in a URL is not a bump. `/v2/...` shipped while `/v1/...` is
  deleted is still MAJOR — see deprecation-policy.
- "Nobody uses it yet" is not a downgrade. Unless the contract is marked internal
  or private in the code, treat it as public.

## Example

❌ Understated — major change released as a minor feature:

```diff
  // package.json
- "version": "2.4.0",
+ "version": "2.5.0",

  // src/client.ts
- export function fetchUser(id: string) {
+ export function fetchUser(id: string, scope: Scope) {   // ← required: MAJOR
```

✅ Honest — the bump matches the break, and the break is announced:

```diff
  // package.json
- "version": "2.4.0",
+ "version": "3.0.0",

  // CHANGELOG.md
+ ## 3.0.0 — BREAKING
+ `fetchUser` now requires a `scope` argument. Pass `Scope.Self` to keep 2.x behaviour.
```
