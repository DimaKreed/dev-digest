import type { ReviewRecord, Severity } from "@devdigest/shared";

/**
 * Severity vocabulary and the findings-tally rules, shared by every surface
 * that counts or lists findings: the PR list's FINDINGS column and peek
 * panels, and the PR detail header's counter bar.
 *
 * These used to live in the detail page's `SeverityFilterBar/_components`
 * folder; they moved here once the PR list needed them too — a route's
 * `_components` is not an import target for another route.
 *
 * NOTE: the server recomputes the same tally in SQL for the list endpoint
 * (`server/src/modules/pulls/routes.ts`). Change the rules here and you must
 * port the change there — see the cross-module entry in the root `insights.md`.
 */

/** The three contract severities, most severe first. Icon and colour per level
 *  come from `SEV` in @devdigest/ui — don't add another severity colour map.
 *  `FindingsPanel/constants.ts` also encodes this order as sort weights (plus
 *  `INFO`, which the wire contract can't produce); that one stays. */
export const SEVERITY_LEVELS: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export type SeverityCounts = Record<Severity, number>;

/** URL `?severity` → a contract Severity. Case-insensitive; null on absent or
 *  unknown values so a hand-edited URL degrades to "no filter", never a crash. */
export function parseSeverity(raw: string | null | undefined): Severity | null {
  if (!raw) return null;
  const upper = raw.toUpperCase() as Severity;
  return SEVERITY_LEVELS.includes(upper) ? upper : null;
}

/** The newest review per agent. `reviews` arrive newest-first from the API, so
 *  the first one seen per agent wins. A null `agent_id` gets its own bucket —
 *  an ad-hoc run isn't "the same agent" as another ad-hoc run. */
export function latestRunPerAgent(reviews: ReviewRecord[]): ReviewRecord[] {
  const seen = new Set<string>();
  return reviews.filter((r) => {
    const key = r.agent_id ?? `review:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Dismissed findings don't count — same rule as the blockers count in
 *  ReviewRunAccordion. Accepted ones do: they're real, just already handled. */
export function isLiveFinding(f: { dismissed_at: string | null }): boolean {
  return f.dismissed_at == null;
}

/** Per-severity tally across the given runs, always with all three keys present. */
export function countBySeverity(reviews: ReviewRecord[]): SeverityCounts {
  const counts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } satisfies SeverityCounts;
  for (const review of reviews) {
    for (const f of review.findings) {
      if (!isLiveFinding(f)) continue;
      if (f.severity in counts) counts[f.severity] += 1;
    }
  }
  return counts;
}

/** Does this run still have a live finding at that level? Uses the same
 *  predicate as countBySeverity, so a level counted 0 hides every run. */
export function runMatches(review: ReviewRecord, severity: Severity): boolean {
  return review.findings.some((f) => f.severity === severity && isLiveFinding(f));
}
