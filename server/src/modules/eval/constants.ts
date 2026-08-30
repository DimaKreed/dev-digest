/** Constants for the eval module (ring 0). */

/**
 * Structured-output retry budget for one eval case.
 *
 * Lower than a pull-request review's, matching `modules/diff-review`: a batch
 * holds a synchronous caller across N cases, so an unbounded retry chain on one
 * case stalls the whole set. One retry absorbs a malformed JSON response
 * without letting a persistently broken model spend the batch's whole budget.
 */
export const EVAL_MAX_RETRIES = 1;

/**
 * How many cases of one batch run at the same time.
 *
 * The cases of a batch are independent by construction — each one replays a
 * frozen diff and reads nothing the others produce (AC-13) — so running them
 * one at a time bought nothing but wall clock: the seeded ten-case set measured
 * 111 s, which is exactly the sum of its ten model calls (3.2 s to 24.3 s each,
 * no retries, no overhead between them).
 *
 * Four, not more: the ceiling is the provider's rate limit, not this process.
 * A 429 costs a case its whole run — it lands as an `error` row that no metric
 * counts (AC-07) — so a batch that trips the limit reports LESS than one that
 * took longer, which is the failure mode worth staying well clear of.
 *
 * The original reason for running in sequence was that a fan-out turns one
 * comprehensible failure into N incomprehensible ones. That reasoning was
 * written when a batch held the HTTP request open; it no longer applies now
 * that each case persists its own row with its own error text.
 */
export const EVAL_CONCURRENCY = 4;

/**
 * Wall-clock ceiling on ONE case, retries and all.
 *
 * Without it a case has no ceiling worth the name. The OpenRouter provider
 * gives its SDK client `timeout: 90_000, maxRetries: 2` and then wraps it in a
 * reprompt loop of its own three attempts — 3 x 3 x 90 s, so a single case can
 * hold a slot for **13.5 minutes**. Measured, not theorised: a real batch sat
 * at 9/10 for over nine minutes on one case while the other nine finished in
 * 56 s. Sequential execution had the same ceiling and merely hid it behind a
 * request that was already hanging.
 *
 * 90 s is one provider timeout with no nesting. The slowest case that has ever
 * SUCCEEDED here took 42 s, so this is roughly double the observed worst case;
 * and a third attempt at a frozen diff that has already failed twice returns
 * the same answer ten minutes later, which is not an answer anyone waits for.
 *
 * A case that trips this lands as an `error` row and is counted in no metric,
 * exactly like any other case-level failure (AC-07) — "we did not get an
 * answer" must never be recorded as "the agent answered wrongly".
 */
export const EVAL_CASE_TIMEOUT_MS = 90_000;

/**
 * Strategy for an eval run, regardless of what the agent is configured with.
 *
 * A case's diff is one file and a few dozen lines; `auto` would pick
 * single-pass for it anyway, and pinning it means a batch cannot silently
 * change shape because someone flipped the agent to map-reduce. Comparability
 * between two batches is the entire product here.
 */
export const EVAL_STRATEGY = 'single-pass' as const;

/** How many batches the agent history and the dashboard trend look back over. */
export const EVAL_HISTORY_LIMIT = 20;

/** How many recent batches the all-agents dashboard lists. */
export const EVAL_RECENT_RUNS_LIMIT = 12;

/** Row cap on the run-history read that the two limits above are sliced from. */
export const EVAL_RUN_ROWS_LIMIT = 2000;

/**
 * A metric delta below this is reported as unchanged rather than as movement.
 *
 * Two batches of the same agent over the same set can differ by a fraction of a
 * point purely from model sampling. Calling that a regression in the alert line
 * would teach the reader to ignore the alert line.
 */
export const EVAL_ALERT_EPSILON = 0.005;
