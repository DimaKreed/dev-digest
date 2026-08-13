import { groupFiles } from '@devdigest/reviewer-core';
import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { latestLiveFindings } from './helpers.js';
import type { SmartDiffReads } from './ports.js';

/**
 * Smart Diff use case (ring 2): risk-ordered file groups for one PR.
 *
 * Three reads and a pure function. There is deliberately **no model call** on
 * this path — no LLM port, no provider, no review-engine entry point — so a
 * page open costs nothing and the same PR always renders the same order. That
 * is enforced mechanically by a grep probe over this directory, which is why
 * the forbidden identifiers are described here rather than spelled out. The
 * ordering itself lives in `@devdigest/reviewer-core` (ring 0) and the "last
 * review" collapse in `./helpers.ts`; this class only sequences them.
 *
 * Takes a narrow deps object typed by ports (H7), never the `Container`.
 */
export class SmartDiffService {
  constructor(private deps: { reads: SmartDiffReads }) {}

  async build(workspaceId: string, prId: string): Promise<SmartDiff> {
    // Workspace-scoped lookup FIRST — this is the authorization boundary, so a
    // PR in another workspace must 404 here rather than leak its file paths.
    const pull = await this.deps.reads.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const [files, reviews] = await Promise.all([
      this.deps.reads.getPrFiles(prId),
      this.deps.reads.reviewsForPull(prId),
    ]);

    return groupFiles(files, latestLiveFindings(reviews));
  }
}
