---
name: flaky-test-detector
description: Flag tests that can fail without any code change. Apply when the diff adds or edits test files.
type: custom
---

# Flaky test detector

A test that can fail without a code change is worse than no test — it trains the
team to re-run CI instead of reading it. Flag any of the following in test code
the diff adds or edits.

## Time
- `Date.now()`, `new Date()` or timezone-dependent formatting in an assertion.
- A hard-coded `setTimeout` / `sleep` standing in for a real wait condition.
- An assertion on elapsed duration with a tight bound.

## Order and shared state
- A test that reads state another test wrote (module-level `let`, a shared
  fixture mutated in place, a real DB row created by a sibling test).
- `beforeAll` setup that a test then mutates, instead of `beforeEach`.

## Concurrency
- A promise that is never awaited, including a floating `expect(...)` on an
  async call.
- `Promise.all` over tasks that contend for one resource.

## Environment
- Real network calls, real filesystem paths outside a temp dir, or a port bound
  to a fixed number.
- `Math.random()` or a uuid used in an assertion without a fixed seed.

Report each as a WARNING with the exact line and the mechanism by which it can
fail — name what has to be true for the test to go red without a code change.
Do not report a test merely because it is slow.
