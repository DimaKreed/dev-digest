/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Per-source cap for the intent classifier's input. Mirrors
 * `MAX_PR_DESCRIPTION_CHARS = 4000` in reviewer-core's prompt.ts — one PR body,
 * one issue body or one plan file each get the same budget, so a giant spec
 * cannot crowd out the description.
 */
export const INTENT_MAX_SOURCE_CHARS = 4000;

/**
 * How many in-repo plan/spec files the classifier will read. Bounded because
 * every path is attacker-influenced (it comes out of PR body text) and each one
 * costs a filesystem round trip.
 */
export const INTENT_MAX_REPO_FILES = 3;

/** Same cap for linked GitHub issues/PRs, for the same reason. */
export const INTENT_MAX_LINKED_ISSUES = 3;

/**
 * Timeout for the single classifier call. Deliberately LONG with `maxRetries: 1`:
 * OpenRouter's measured spread for an identical request is 35× (4.7s–166.9s), and
 * `completeStructured` wraps this in its own repair loop — so a short timeout
 * multiplies into abandoning a generation you already paid for and drawing again.
 * See reviewer-core/insights.md.
 */
export const INTENT_TIMEOUT_MS = 120_000;

/** Reprompt budget for the classifier. One, for the reason above. */
export const INTENT_MAX_RETRIES = 1;
