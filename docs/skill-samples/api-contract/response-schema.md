---
name: response-schema
description: Guard the shape and value domain of responses, events and webhook payloads. Apply when the diff changes what a handler, serializer or exported function returns.
type: rubric
---

# Response schema stability

Consumers parse responses against a shape they were written for. Any change to
that shape, or to the set of values a field can hold, is a compatibility event.

## Flag these

- A response field **removed** or **renamed**.
- A field **retyped**: `string` → `number`, scalar → object, object → array, an
  id format changed.
- A field moved **optional → required**, or **non-null → nullable**. Both break
  consumers: the first breaks producers of requests, the second breaks readers.
- A field **relocated** — flattened, nested, or moved under a new envelope.
- A **widened value domain**: a new enum member or status, a new record kind, or
  rows the endpoint previously filtered out now being returned. Consumers written
  against the old domain have no branch for the new value.
- A change to the **selection predicate** behind a response — a new argument
  threaded into the query that changes which rows come back for an unchanged
  request.

## Severity

- **CRITICAL** — a field is removed, renamed or retyped and a consumer in this
  diff still reads it. Cite both lines.
- **WARNING** — the shape or value domain changed with no consumer visible here,
  or the change is additive-but-unbranched (new enum member, previously excluded
  rows now returned). Name the value the consumer has no handling for.
- **SUGGESTION** — an added optional field with no documentation or type update.
- Do not re-report a break already filed under breaking-change; fold the payload
  detail into that finding instead.

## Example

❌ Breaking — field renamed and the domain widened at once:

```diff
  // src/api/orders.ts
- return { id: o.id, state: o.state };          // state: 'open' | 'closed'
+ return { id: o.id, status: o.status };        // status: 'open' | 'closed' | 'void'

  // src/ui/order-badge.ts  (unchanged context)
  const label = LABELS[order.state];            // ← undefined: field is gone
```

✅ Compatible — old field kept during the transition, new value gated:

```diff
  // src/api/orders.ts
- return { id: o.id, state: o.state };
+ return {
+   id: o.id,
+   state: o.state,                             // @deprecated — remove 2026-03-01
+   status: o.status,
+ };
```
