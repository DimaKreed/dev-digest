# e2e/specs

**This directory is different from the other packages' `specs/`.** Here a spec *is* the
test: `run.ts` loads every `*.flow.json` in this directory and executes it. Prose specs
don't belong here — the executable flow is the spec.

Convention: `NN-name.flow.json`, numbered in the order a user would encounter the feature.
The runner ignores any file not ending in `.flow.json`, so this README is safe.

Rules that make a flow reliable:
- `{BASE}` is substituted at runtime — never hardcode a host.
- A `wait` step is an assertion; a timeout is a failure.
- Deterministic locators only. Never match on user-facing text (all of it is i18n-driven).
- Assume the seeded fixture only (`acme/payments-api`, PR #482). Run via
  `npm run e2e:hermetic` so that assumption holds.

Format details and the per-spec coverage table: [../README.md](../README.md).
