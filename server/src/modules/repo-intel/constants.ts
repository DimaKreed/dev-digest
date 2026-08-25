/**
 * repo-intel constants. Phase-tagged: [T1] used now; [T2]/[T3]
 * exported early so the pipeline lands against a single source of truth.
 */

// --- Job kinds (registered on JobRunner; enqueued from repos/service.ts) ----
export const INDEX_JOB_KIND = 'repo-intel-index';
export const REFRESH_JOB_KIND = 'repo-intel-refresh';
/** Manual "re-analyze": fetch latest from origin + incremental reindex. */
export const RESYNC_JOB_KIND = 'repo-intel-resync';

// --- Walk / parse scope -----------------------------------------------------
/** [T1] Files we parse (diff-scoped in T1; whole walk in T2). */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** [T1] Directories never walked. `.gitignore` is layered on top in T2 walk. */
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

// --- Read-time limits -------------------------------------------------------
/** [T1] Caller fan-out cap per changed symbol (ORDER BY rank DESC LIMIT N). */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * [T1] Bumped whenever the AST extractor or symbol schema changes. A mismatch
 * with `repo_index_state.indexer_version` forces a full reindex.
 *
 * v2 (T3): graph + decl_file resolution + file_rank + repo-map landed, so every
 * T2 `partial` index must be rebuilt to gain the rank-driven data.
 */
export const INDEXER_VERSION = 2;

// --- [T2] Full-index limits (documented now, enforced in the pipeline) ------
export const MAX_INDEXED_FILES = 5000;
export const MAX_FILE_SIZE = 400 * 1024; // 400 KB
export const MAX_PARSE_MS_PER_FILE = 2000;
/** Soft self-watch budget (< JobRunner hard 120s) → finish as `partial`. */
export const INDEX_SOFT_BUDGET_MS = 110_000;

// --- [T3] Graph / hotness / repo-map ---------------------------------------
export const BFS_DEPTH = 2;
/**
 * [T3] Distinct files the reverse-import walk may reach before it stops
 * expanding. A barrel file has hundreds of reverse edges and two hops square
 * that, so an uncapped walk over one `index.ts` would pull most of the repo.
 * Hitting this cap is reported (`truncatedFrom`) rather than silently absorbed:
 * a walk that stopped early is a `partial` answer, not a complete one.
 */
export const MAX_REVERSE_FANOUT = 200;
/**
 * [T3] Reverse fan-in above which a file discovered mid-walk is treated as a
 * CONDUIT and not expanded through.
 *
 * A file imported by this many others is shared infrastructure — `app.ts`,
 * `schema.ts`, a barrel, the DI root. Arriving at one says almost nothing about
 * the change that started the walk, because almost everything arrives there;
 * continuing outward then attributes that hub's neighbours to the change too.
 * Measured on this repo's own index: reverse fan-in is 1 at p50 and 7 at p95,
 * while `app.ts` sits at 12 and is imported by eleven integration tests, so a
 * walk through it hands every endpoint those tests exercise to any server file.
 *
 * The hub itself is kept — it WAS reached, at its own depth, and its own facts
 * are still its own. Only the step past it is refused. Seeds are exempt: they
 * are callers the request explicitly asked about, so their fan-out is the
 * answer rather than noise.
 */
export const MAX_HUB_FANIN = 8;
export const HOTNESS_WINDOW_DAYS = 180;
export const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500;
/** Signatures are trimmed to this many chars in the parse phase (cache stability). */
export const MAX_SIGNATURE_CHARS = 120;
