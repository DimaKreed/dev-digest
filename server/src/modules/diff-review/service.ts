import { countBlockers, reviewPullRequest } from '@devdigest/reviewer-core';
import type { DiffReviewResponse, LLMProvider, UnifiedDiff } from '@devdigest/shared';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type {
  DiffReviewAgent,
  DiffReviewAgentReads,
  DiffReviewProvider,
} from './ports.js';

/**
 * Studio default when an agent states no strategy of its own.
 *
 * Duplicated from the reviews module rather than imported: the `no-cross-module`
 * arch rule forbids reaching into a sibling module's constants, and this is the
 * same duplication `modules/conventions` makes for its model resolution. It must
 * stay equal to the reviews module's value — a diff review that silently used a
 * different strategy from a PR review would report different findings for the
 * same code, which is the one thing this route exists to avoid.
 */
const DEFAULT_STRATEGY = 'single-pass' as const;

/**
 * Retry budget for the one engine call this route makes.
 *
 * Lower than a PR review's, on purpose: that path is fire-and-forget with SSE
 * and can afford to keep trying, while this one holds a synchronous caller who
 * will give up at its own deadline. Retrying past that point spends money on a
 * result nobody will read.
 */
const DIFF_REVIEW_MAX_RETRIES = 1;

/**
 * Review an arbitrary patch (ring 2) — the same engine a pull-request review
 * runs, over a diff that belongs to no pull request.
 *
 * This exists so a change can be reviewed BEFORE it is pushed. The alternative
 * was a second review implementation living in the CLI, which would drift from
 * this one the first time either changed. So the CLI is a thin client of this
 * route, and there is still exactly one review pipeline in the repo.
 *
 * What it deliberately does NOT do, compared with `run-executor`:
 *   - persist anything. There is no pull request to attach a review to, and a
 *     row keyed on nothing would be unreachable from the UI.
 *   - enrich from repo-intel. Callers, repo map and file rank are all keyed on
 *     an indexed repository; a working tree is not one.
 *   - derive intent, or open an SSE run. Both are pull-request concerns.
 * Everything that decides the OUTCOME — the prompt, the strategy, the skills,
 * the grounding gate, the score and the verdict — is shared with a PR review.
 */
export class DiffReviewService {
  constructor(
    private deps: {
      agents: DiffReviewAgentReads;
      llm(provider: DiffReviewProvider): Promise<LLMProvider>;
      parseDiff(raw: string): UnifiedDiff;
    },
  ) {}

  async review(
    workspaceId: string,
    input: {
      patch: string;
      agentId?: string | undefined;
      task?: string | undefined;
      /**
       * True once the caller has hung up. Checked between chunks, so a CLI that
       * timed out stops the spend instead of paying for a result nobody reads.
       */
      abandoned?: (() => boolean) | undefined;
    },
  ): Promise<DiffReviewResponse> {
    const agent = await this.resolveAgent(workspaceId, input.agentId);

    const diff = this.deps.parseDiff(input.patch);
    // A patch that parses to nothing is a caller error, not an empty review: an
    // "approve, score 100" answer to an unparseable diff is the one result that
    // must not be returned, because it reads as a clean bill of health.
    if (diff.files.length === 0) {
      throw new ValidationError('The patch contained no file changes the parser could read');
    }

    const skills = (await this.deps.agents.linkedSkills(agent.id))
      .filter((l) => l.skill.enabled)
      .map((l) => l.skill.body);

    const llm = await this.deps.llm(agent.provider);

    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm,
      strategy: agent.strategy ?? DEFAULT_STRATEGY,
      failOn: agent.ciFailOn,
      ...(skills.length > 0 ? { skills } : {}),
      // Mirrors run-executor: nothing may be deferred out of the score at a
      // WARNING gate, or the scope layer could turn a red gate green.
      allowDefer: agent.ciFailOn !== 'warning',
      ...(input.task ? { task: input.task } : {}),
      // Bounded retries: the caller waits synchronously, so an unbounded retry
      // chain would run past any client deadline and spend the whole time.
      maxRetries: DIFF_REVIEW_MAX_RETRIES,
      // The engine's cancellation seam, the same one run-executor uses for a
      // cancelled run. It is checked between chunks, so it stops the NEXT call
      // rather than the one in flight — which is what bounds a map-reduce run
      // after the client has gone.
      ...(input.abandoned
        ? {
            checkCancelled: () => {
              if (input.abandoned?.()) {
                throw new ValidationError('The caller stopped waiting for this review');
              }
            },
          }
        : {}),
    });

    return {
      agent_id: agent.id,
      agent_name: agent.name,
      model: agent.model,
      verdict: outcome.review.verdict,
      score: outcome.review.score,
      summary: outcome.review.summary,
      // The ACTIVE set only — the same findings score and verdict derive from.
      // Deferred ones are excluded here as they are from the numbers.
      findings: outcome.review.findings,
      blockers: countBlockers(outcome.review.findings, agent.ciFailOn),
      fail_on: agent.ciFailOn,
      files_reviewed: diff.files.length,
      grounding: outcome.grounding,
      cost_usd: outcome.costUsd,
    };
  }

  /** The named agent, or the workspace's first enabled one. */
  private async resolveAgent(
    workspaceId: string,
    agentId: string | undefined,
  ): Promise<DiffReviewAgent> {
    if (agentId) {
      const agent = await this.deps.agents.getById(workspaceId, agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      if (!agent.enabled) throw new ValidationError('That agent is disabled');
      return agent;
    }

    const [first] = await this.deps.agents.listEnabled(workspaceId);
    if (!first) throw new NotFoundError('No enabled reviewer agent is configured');
    return first;
  }
}
