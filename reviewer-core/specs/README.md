# reviewer-core/specs

The intended behavior of an engine change, written **before** it is implemented, then kept
as the acceptance reference.

Convention: one file per feature, `NN-feature-name.md`. Write it, get it agreed, then build
against it. When behavior changes, update the spec in the same change — a stale spec is
worse than none.

A spec covers: inputs (diff shape, config), the expected findings/verdict/score behavior,
degenerate cases (empty diff, provider error, ungrounded output), and what "done" means.
Because this package is pure, a spec here should be expressible as a test — if it isn't,
it probably belongs in `server/specs/`.

## Index

_Empty. Add a link here when you add a spec._
