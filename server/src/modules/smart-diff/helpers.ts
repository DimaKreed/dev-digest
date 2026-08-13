import type { SmartDiffFindingRef } from '@devdigest/reviewer-core';
import type { ReviewWithFindings } from './ports.js';

/**
 * Pure helpers for Smart Diff. Ring 0, so no persistence layer, no adapter and
 * no clock may be imported here — `c5-pure-helpers` enforces the import edges
 * and a grep probe enforces the rest, so neither directory is named in prose.
 *
 * ⚠️ THIRD COPY of the house "last review" formula. The other two are
 * `client/src/lib/severity.ts` (`latestRunPerAgent` + `isLiveFinding`) and
 * `server/src/modules/pulls/status.ts` (`rollupSeverities`, fed by the list
 * endpoint's SQL). Root `insights.md:47-62` records why there is no shared
 * helper and cannot be one; `no-cross-module` additionally forbids this slice
 * from importing `../pulls/status.js`, so the formula is RESTATED here rather
 * than reused. Change the rule in one place and you must change all three, or
 * the Smart Diff badge counts silently drift from the PR-detail header chips.
 *
 * The formula: newest review per `agent_id` (a null `agent_id` gets its OWN
 * bucket — an ad-hoc run is not "the same agent" as another ad-hoc run), then
 * dismissed findings excluded. Accepted findings still count: they are real,
 * just already handled.
 */

/**
 * Collapse a PR's review runs to the finding references Smart Diff should show.
 *
 * Sorts by `createdAt` descending here rather than trusting the repository's
 * `ORDER BY`: the client copy relies on the API being newest-first, and that
 * coupling is exactly what makes the two definitions able to diverge. Input
 * order therefore cannot affect the output.
 */
export function latestLiveFindings(rows: readonly ReviewWithFindings[]): SmartDiffFindingRef[] {
  const newestFirst = [...rows].sort((a, b) => {
    const byTime = b.review.createdAt.getTime() - a.review.createdAt.getTime();
    if (byTime !== 0) return byTime;
    // Total order: two runs can share a `created_at` (same-second re-run), and a
    // stable sort would then leak the caller's input order into the result.
    return a.review.id < b.review.id ? -1 : a.review.id > b.review.id ? 1 : 0;
  });

  const seen = new Set<string>();
  const refs: SmartDiffFindingRef[] = [];
  for (const row of newestFirst) {
    const key = row.review.agentId ?? `review:${row.review.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const finding of row.findings) {
      if (finding.dismissedAt != null) continue;
      refs.push({ file: finding.file, start_line: finding.startLine });
    }
  }
  return refs;
}
