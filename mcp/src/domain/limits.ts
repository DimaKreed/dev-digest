/**
 * Ring 0 — the numbers that bound this server's behaviour.
 *
 * This layer is pure: it performs no I/O, reads no ambient state, and observes
 * no clock. Everything here is a constant or a function of its arguments.
 */

/**
 * The hard cap on a blocking review. Reaching it is a normal outcome, not a
 * crash: the run continues server-side and the caller is told how to collect it.
 */
export const RUN_TIMEOUT_MS = 120_000;

/** How often the wait loop asks the API whether the run has finished. */
export const POLL_INTERVAL_MS = 2_000;

/**
 * A review never finishes instantly, so the first poll is delayed slightly to
 * avoid one guaranteed-wasted round trip per run.
 */
export const FIRST_POLL_DELAY_MS = 1_500;

/**
 * Per-tool result bounds. These exist to keep tool output far below the point
 * where a client warns about or truncates it — truncation decided here, with a
 * message explaining how to narrow the request, always beats truncation imposed
 * blindly downstream.
 */
export const LIMITS = {
  agents: { default: 20, max: 50 },
  findings: { default: 25, max: 100 },
  conventions: { default: 15, max: 50 },
  blast: { default: 20, max: 100 },
} as const;

/**
 * Caller rows printed per affected symbol. A hot utility can have hundreds of
 * call sites, and printing them all buries the symbols that have three. The
 * caller COUNT is always reported in full even when the list is cut.
 */
export const CALLERS_PER_SYMBOL = 5;

/** Severity order, most severe first. The sort key for every findings list. */
export const SEVERITY_ORDER = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;

export function severityRank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity as (typeof SEVERITY_ORDER)[number]);
  return index === -1 ? SEVERITY_ORDER.length : index;
}
