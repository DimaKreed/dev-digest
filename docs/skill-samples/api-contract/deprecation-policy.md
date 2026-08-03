---
name: deprecation-policy
description: Require contracts to be retired through deprecation rather than deleted outright. Apply when the diff removes or replaces a route, exported symbol, field or config key.
type: convention
---

# Deprecation policy

A public contract is retired in two releases, never one. Deleting it in the same
commit that introduces its replacement gives consumers no window to migrate.

## A correct retirement has all four

1. **A marker on the old path** — `@deprecated` in the doc comment, a
   `Deprecation` / `Sunset` response header, or a logged warning on use.
2. **The replacement named** in that marker, so a reader knows where to go.
3. **A sunset window** — a date or release in which the old path disappears.
4. **Both paths live** during the window: the old contract keeps working,
   typically by delegating to the new one.

## Flag these

- A route, exported symbol, field or config key **deleted in the same diff** that
  adds its successor — including a path moved under a new version prefix while
  the old path is removed from the router.
- A `@deprecated` marker with **no replacement named** or **no sunset window**.
- A sunset date that has **already passed**, or a removal shipped **before** the
  announced window closes.
- A replacement whose signature or payload differs from the old one with no
  migration note telling callers what to change.

## Severity

- **WARNING** — the retirement is missing a marker, a replacement, a window, or
  the transition overlap. This is the default for a silent removal whose broken
  callers are already reported elsewhere.
- **CRITICAL** only when the deletion itself breaks a caller visible in this
  material — in which case report it as the breaking change, and note the missing
  deprecation path inside that same finding rather than filing a second one.
- Do not demand a deprecation cycle for a symbol the diff shows is internal, or
  for a contract added and removed within the same unreleased change.

## Example

❌ Silent removal — old route deleted the moment the new one lands:

```diff
  // src/routes/reports.ts
- app.get('/reports/:id', handler);
+ app.get('/v2/reports/:id', handler);
```

✅ Retired properly — both live, marker, replacement and window:

```diff
  // src/routes/reports.ts
+ /** @deprecated Use GET /v2/reports/:id. Removed after 2026-03-01. */
  app.get('/reports/:id', async (req, reply) => {
+   reply.header('Sunset', 'Sat, 01 Mar 2026 00:00:00 GMT');
+   reply.header('Deprecation', 'true');
    return handler(req);
  });
+ app.get('/v2/reports/:id', handler);
```
