/**
 * Ring 2 — reading a review that has already finished.
 *
 * Two empty results are possible here and they mean opposite things: nobody has
 * ever reviewed this pull request, versus somebody did and it came back clean.
 * Collapsing them into one empty list is the single most damaging thing this tool
 * could do, so `emptyReason` keeps them apart all the way to the caller.
 *
 * "Newest review per agent" is the same rule the product's own severity tally
 * uses, and dismissed findings are excluded for the same reason — a tool that
 * disagreed with the web UI on the same data would read as a bug.
 */
import type { FindingBrief, ReviewBrief } from '../contracts.js';
import { countBySeverity } from '../domain/format.js';
import { severityRank } from '../domain/limits.js';
import type { DevDigestApi } from '../ports.js';
import { resolvePull, type ResolveDeps } from './resolve-target.js';
import { fail, fromApiFailure, ok, type UseCaseResult } from './result.js';

export interface GetFindingsDeps extends ResolveDeps {
  api: DevDigestApi;
}

export interface GetFindingsInput {
  repo: string;
  prNumber: number;
  agentId?: string;
  severity?: string;
  limit: number;
}

export interface GetFindingsOutput {
  reviews: ReviewBrief[];
  findings: FindingBrief[];
  returned: number;
  /** How many findings matched the severity filter — what `returned` paginates. */
  total: number;
  truncated: boolean;
  /** Live findings of these reviews before the severity filter. */
  totalLive: number;
  /**
   * Severity tally over ALL live findings of these reviews — never over the page
   * and never over the severity-filtered subset. It describes the review, so it
   * must not shrink because the caller asked for fewer rows.
   */
  counts: Record<string, number>;
  /**
   * `never_run` = no review exists at all.
   * `clean` = a review exists and has no live findings.
   * `filtered_out` = live findings exist, the caller's severity filter hid them.
   * Collapsing the third into the second would report a dirty review as clean.
   */
  emptyReason: 'never_run' | 'clean' | 'filtered_out' | null;
}

/**
 * Newest review per agent. Sorting by `created_at` alone is not a total order —
 * two reviews written in the same millisecond would leave the caller's row order
 * deciding which one wins — so the review id breaks the tie.
 */
export function latestPerAgent(reviews: ReviewBrief[]): ReviewBrief[] {
  const newestFirst = [...reviews].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );

  const seen = new Set<string>();
  const latest: ReviewBrief[] = [];
  for (const review of newestFirst) {
    // A review with no agent gets its own bucket rather than being merged with
    // every other agentless review.
    const bucket = review.agent_id ?? `__review__${review.id}`;
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    latest.push(review);
  }
  return latest;
}

export async function getFindings(
  deps: GetFindingsDeps,
  input: GetFindingsInput,
): Promise<UseCaseResult<GetFindingsOutput>> {
  const target = await resolvePull(deps, input.repo, input.prNumber);
  if (!target.ok) return fail(target.failure);

  const result = await deps.api.listReviews(target.value.prId);
  if (!result.ok) return fail(fromApiFailure(result.failure));

  const relevant = latestPerAgent(result.value).filter(
    (review) => input.agentId === undefined || review.agent_id === input.agentId,
  );

  if (relevant.length === 0) {
    return ok({
      reviews: [],
      findings: [],
      returned: 0,
      total: 0,
      truncated: false,
      totalLive: 0,
      counts: countBySeverity([]),
      emptyReason: 'never_run',
    });
  }

  // Everything the review still stands behind: dismissed findings are excluded
  // here and nowhere else, so the tally below and the severity filter both see
  // the same set the product's own counters do.
  const live: FindingBrief[] = [];
  for (const review of relevant) {
    for (const finding of review.findings) {
      if (finding.dismissed_at) continue;
      live.push(finding);
    }
  }
  const counts = countBySeverity(live);

  const matching =
    input.severity === undefined
      ? live
      : live.filter((finding) => finding.severity === input.severity);

  const ranked = [...matching].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.file.localeCompare(b.file) ||
      (a.start_line ?? 0) - (b.start_line ?? 0),
  );
  const shown = ranked.slice(0, input.limit);

  // Three distinct states, deliberately not two. `live.length === 0` is a review
  // that genuinely found nothing; `ranked.length === 0` with live findings
  // present is the caller's filter, and calling that one "clean" is a lie.
  const emptyReason =
    live.length === 0 ? 'clean' : ranked.length === 0 ? 'filtered_out' : null;

  return ok({
    reviews: relevant,
    findings: shown,
    returned: shown.length,
    total: ranked.length,
    truncated: shown.length < ranked.length,
    totalLive: live.length,
    counts,
    emptyReason,
  });
}
