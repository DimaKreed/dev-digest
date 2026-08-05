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

/**
 * Hard ceiling on how many candidates the model may propose in one scan.
 *
 * Every candidate costs output tokens, and output is generated serially — this
 * number is close to a direct multiplier on how long a scan takes. The prompt
 * asks for 5–12 strong rules and the >=2-file gate discards most of the rest,
 * so a ceiling far above that only buys latency.
 */
export const MAX_CANDIDATES = 10;

/**
 * Longest snippet the server will slice out around a verified anchor line.
 * The model's own line range only chooses a length within this bound; it can
 * never choose the position.
 */
export const MAX_SNIPPET_LINES = 12;

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

/**
 * Timeout for the single extraction call, well above the 90s provider default.
 *
 * A scan is one large structured completion, and OpenRouter routes it to a
 * different upstream every time — measured 4.7s to 166.9s for the same payload.
 * At 90s the slowest draws are abandoned mid-generation and retried, which is
 * how one scan reached 13m48s. Waiting out a slow provider costs 170s once;
 * abandoning it costs 90s and buys another lottery ticket.
 */
export const EXTRACTION_TIMEOUT_MS = 300_000;

/** `version` stamped into an exported plugin bundle's manifest. */
export const PLUGIN_FORMAT_VERSION = '1.0.0';
