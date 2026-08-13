/**
 * Tunable values for Smart Diff — patterns and thresholds only, no logic.
 *
 * The filename is generic but the contents are smart-diff-scoped (that is the
 * filename the accepted design specifies); every export therefore carries a
 * `SMART_DIFF_` prefix so a second feature can share the file without collision.
 *
 * Ring 0: values only. No environment reads, no clock, no randomness, no I/O —
 * rule C5 in `.claude/skills/onion-architecture/SKILL.md`. A grep probe asserts
 * that, so the banned identifiers are described here rather than spelled out.
 *
 * Only the lock-file rule is an acceptance criterion. Everything else here is
 * taste encoded as data so that it is reviewable and changeable in one place
 * rather than argued over inside a classifier.
 */

/** Emitted group order, and the authoritative role list for Smart Diff. */
export const SMART_DIFF_ROLE_ORDER = ['core', 'wiring', 'boilerplate'] as const;

/**
 * Machine-generated, vendored or otherwise not-worth-reading paths. Tested
 * FIRST, so a lock file can never fall through to `wiring` or `core` on the
 * strength of its `.yaml`/`.json` extension.
 */
export const SMART_DIFF_BOILERPLATE_PATTERNS: readonly RegExp[] = [
  // Dependency lock files, at any depth.
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb)$/,
  // Build output and installed trees. NOTE: `vendor/` is deliberately absent —
  // in this repo `src/vendor/shared/` holds the canonical Zod contracts, which
  // are the most review-worthy files there are.
  /(^|\/)(dist|build|out|coverage|node_modules)\//,
  // Test snapshots.
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  // Minified or explicitly generated artifacts.
  /\.min\.(js|css)$/,
  /\.(map|lock)$/,
  /(^|\/)[^/]*\.generated\.[^/]+$/,
  // drizzle-kit journal / snapshot bookkeeping.
  /(^|\/)migrations\/meta\//,
];

/**
 * Configuration, registries and barrels — real code, but it wires things up
 * rather than deciding anything. Tested after boilerplate, before `core`.
 */
export const SMART_DIFF_WIRING_PATTERNS: readonly RegExp[] = [
  // Any `*.config.*` file (vitest.config.ts, next.config.mjs, drizzle.config.ts…).
  /(^|\/)[^/]*\.config\.(ts|tsx|js|mjs|cjs|json)$/,
  // tsconfig / jsconfig, including the `.base`/`.build` variants.
  /(^|\/)(ts|js)config([^/]*)?\.json$/,
  // Package manifests and package-manager settings.
  /(^|\/)(package\.json|\.npmrc|\.nvmrc)$/,
  // Barrels and registries — `src/modules/index.ts` is the canonical case.
  /(^|\/)index\.(ts|tsx|js|mjs|cjs)$/,
  // CI and container plumbing.
  /(^|\/)\.github\//,
  /(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml)$/,
  // Top-level-ish declarative config that is not a lock file.
  /\.(ya?ml|toml|ini)$/,
  // Environment templates and dotfile config.
  /(^|\/)\.env([^/]*)?$/,
  // Type declaration shims.
  /\.d\.ts$/,
];

/**
 * A PR whose total changed lines exceed this is flagged `too_big`. Chosen to
 * sit above a normal feature slice and below the "please split this" range;
 * it is a judgement call, which is why it lives here.
 */
export const SMART_DIFF_TOO_BIG_LINES = 800;
