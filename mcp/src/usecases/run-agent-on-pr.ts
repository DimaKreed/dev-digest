/**
 * Ring 2 — start a review and wait for it.
 *
 * The API's review endpoint is fire-and-forget: it creates the run rows, returns
 * their ids, and executes in the background. Nothing about it reports completion,
 * so "blocking" is implemented here, by polling the run list until the run this
 * call started leaves `running`.
 *
 * The 120-second cap is a first-class outcome, not an error path bolted on. When
 * it is reached the run is still executing server-side and the returned failure
 * carries the run id, because the only wrong move at that moment is to start a
 * second paid review.
 */
import type { FindingBrief } from '../contracts.js';
import { FIRST_POLL_DELAY_MS, POLL_INTERVAL_MS, RUN_TIMEOUT_MS } from '../domain/limits.js';
import type { Clock, DevDigestApi } from '../ports.js';
import { resolvePull, type ResolveDeps } from './resolve-target.js';
import { fail, fromApiFailure, ok, type UseCaseResult } from './result.js';

export interface RunAgentDeps extends ResolveDeps {
  api: DevDigestApi;
  clock: Clock;
}

export interface RunAgentInput {
  repo: string;
  prNumber: number;
  agentId: string;
}

export interface RunAgentOutput {
  runId: string;
  agentId: string;
  agentName: string;
  verdict: string;
  score: number | null;
  blockers: number | null;
  durationMs: number | null;
  findings: FindingBrief[];
}

export async function runAgentOnPr(
  deps: RunAgentDeps,
  input: RunAgentInput,
): Promise<UseCaseResult<RunAgentOutput>> {
  const target = await resolvePull(deps, input.repo, input.prNumber);
  if (!target.ok) return fail(target.failure);
  const { prId } = target.value;

  const started = await deps.api.startReview(prId, input.agentId);
  if (!started.ok) {
    // The pull request resolved a moment ago, so a 404 from this call is about
    // the agent id — the one part of the request the API had not yet seen.
    if (started.failure.kind === 'not_found') {
      return fail({ kind: 'unknown_agent', agentId: input.agentId });
    }
    return fail(fromApiFailure(started.failure));
  }

  const target0 = started.value.runs[0];
  if (!target0) {
    return fail({ kind: 'api_error', message: 'the API started no run for that agent' });
  }
  const runId = target0.run_id;

  const deadline = deps.clock.now() + RUN_TIMEOUT_MS;
  let delay = FIRST_POLL_DELAY_MS;

  for (;;) {
    const remaining = deadline - deps.clock.now();
    if (remaining <= 0) {
      return fail({ kind: 'timeout', runId, repo: input.repo, prNumber: input.prNumber });
    }
    // Clamp the wait so the cap is honoured exactly rather than overshot by
    // whatever was left of the last poll interval.
    await deps.clock.sleep(Math.min(delay, remaining));
    delay = POLL_INTERVAL_MS;

    const runs = await deps.api.listRuns(prId);
    if (!runs.ok) return fail(fromApiFailure(runs.failure));

    const run = runs.value.find((candidate) => candidate.run_id === runId);
    // A run row that has not appeared yet is still a run in flight.
    if (!run || !run.status || run.status === 'running') continue;

    if (run.status !== 'done') {
      return fail({
        kind: 'run_failed',
        runId,
        status: run.status,
        error: run.error ?? 'no error was recorded',
      });
    }

    const reviews = await deps.api.listReviews(prId);
    if (!reviews.ok) return fail(fromApiFailure(reviews.failure));

    const review = reviews.value.find((candidate) => candidate.run_id === runId);
    if (!review) {
      return fail({
        kind: 'api_error',
        message: `run ${runId} finished but no review was stored for it`,
      });
    }

    return ok({
      runId,
      agentId: target0.agent_id,
      agentName: target0.agent_name,
      verdict: review.verdict ?? 'comment',
      score: review.score ?? null,
      blockers: run.blockers ?? null,
      durationMs: run.duration_ms ?? null,
      findings: review.findings.filter((finding) => !finding.dismissed_at),
    });
  }
}
