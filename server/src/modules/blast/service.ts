import type { BlastRadiusResponse } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_PRIOR_PRS, toBlastResponse } from './helpers.js';
import type { BlastIntelReads, BlastPullReads } from './ports.js';

/**
 * Blast radius use case (ring 2): what else a pull request's changes can reach.
 *
 * Four reads and a pure mapping. This slice reaches no model provider and no
 * generation adapter of any kind — opening the tab costs nothing and the same
 * pull request always renders the same map. That is enforced mechanically by a
 * grep probe over this file, which is why the forbidden identifiers are
 * described here rather than spelled out. Prose about the file history is the
 * one part that needs a model, and it lives in a separate service behind its
 * own route so that this constraint stays checkable.
 *
 * Takes a narrow deps object typed by ports (H7), never the `Container`.
 */
export class BlastService {
  constructor(private deps: { pulls: BlastPullReads; intel: BlastIntelReads }) {}

  async build(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
    // Workspace-scoped lookup FIRST — this is the authorization boundary, so a
    // PR in another workspace must 404 here rather than leak its file paths,
    // its callers or the endpoints they sit behind.
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const paths = (await this.deps.pulls.getPrFiles(prId)).map((f) => f.path);

    const [blast, indexState, priorPrs] = await Promise.all([
      this.deps.intel.getBlastRadius(pull.repoId, paths),
      this.deps.intel.getIndexState(pull.repoId),
      // Plain PR history — no code index involved, so this section is populated
      // even when the blast radius itself comes back degraded.
      this.deps.pulls.getPriorPrs(pull.repoId, prId, paths, MAX_PRIOR_PRS),
    ]);

    // Seeded from the caller files rather than the changed files: level one is
    // then "who imports the caller", which is the util → service → route chain
    // that direct attribution misses. Depends on `blast`, so it cannot join the
    // batch above.
    const callerFiles = [...new Set(blast.callers.map((c) => c.file))];
    const impact = await this.deps.intel.getReverseImpact(pull.repoId, callerFiles);

    return toBlastResponse({
      blast,
      impact,
      indexStatus: indexState.status,
      priorPrs,
    });
  }
}
