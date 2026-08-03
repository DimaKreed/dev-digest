/**
 * Conventions module constants. Pure values only — no I/O, no imports from
 * `db/` or `adapters/` (arch rule `c5-pure-helpers` covers this file too).
 */

/** How many top-ranked source files repo-intel is asked for per scan. */
export const SAMPLE_COUNT = 12;

/** Token budget for the repo skeleton mixed into the extraction prompt. */
export const REPO_MAP_TOKEN_BUDGET = 2000;

/**
 * A rule must survive verification in at least this many DISTINCT files. One
 * occurrence is a coincidence; two is the weakest thing that can be called a
 * convention. Mirrors `ConventionCandidate.occurrences.min(2)` in the contract.
 */
export const MIN_DISTINCT_FILES = 2;

/** Hard ceiling on how many candidates the model may propose in one scan. */
export const MAX_CANDIDATES = 20;

// ---- Sample payload budget -------------------------------------------------
// Truncation is always TAIL-only, never head or middle, so the 1-based line
// numbers rendered next to each line stay true for everything the model sees.
// A snippet cited from a truncated tail simply fails verification later.

/** Per-sampled-file cap in the prompt payload. */
export const MAX_FILE_CHARS = 8_000;

/** Per-config-file cap — a lockfile-sized `package.json` is mostly noise. */
export const MAX_CONFIG_FILE_CHARS = 2_000;

/** Cap on the repo skeleton block. */
export const MAX_REPO_MAP_CHARS = 8_000;

/** Cap on the whole assembled payload. */
export const MAX_PAYLOAD_CHARS = 120_000;

/** `version` stamped into an exported plugin bundle's manifest. */
export const PLUGIN_FORMAT_VERSION = '1.0.0';
