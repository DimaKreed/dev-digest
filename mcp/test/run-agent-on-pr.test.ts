import { describe, expect, it } from 'vitest';
import { createFakeApi, createFakeClock } from '../src/adapters/mocks.js';
import { RUN_TIMEOUT_MS } from '../src/domain/limits.js';
import { runAgentOnPr } from '../src/usecases/run-agent-on-pr.js';
import {
  PULL,
  REPO,
  REVIEW_WITH_FINDINGS,
  RUN_DONE,
  RUN_RUNNING,
  STARTED_RUN,
  pullsFor,
} from './fixtures.js';

const INPUT = { repo: 'acme/payments-api', prNumber: 482, agentId: 'agent-1' };

describe('runAgentOnPr', () => {
  it('returns the matching review once the run reports done', async () => {
    const api = createFakeApi({
      repos: [REPO],
      pulls: pullsFor([PULL]),
      startedRuns: [STARTED_RUN],
      runsByPoll: [[RUN_RUNNING], [RUN_RUNNING], [RUN_DONE]],
      reviews: [REVIEW_WITH_FINDINGS],
    });
    const clock = createFakeClock();

    const result = await runAgentOnPr({ api, clock }, INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runId).toBe('run-1');
    expect(result.value.verdict).toBe('request_changes');
    expect(result.value.score).toBe(65);
    expect(result.value.findings.map((f) => f.id)).toEqual(['f-1', 'f-2']);
    expect(api.calls.listRuns).toBe(3);
    // 1.5 s before the first poll, then 2 s between the rest.
    expect(clock.elapsed()).toBe(1_500 + 2_000 + 2_000);
  });

  it('gives up at exactly the 120 second cap and names the run for recovery', async () => {
    const api = createFakeApi({
      repos: [REPO],
      pulls: pullsFor(),
      startedRuns: [STARTED_RUN],
      runsByPoll: [[RUN_RUNNING]], // the last entry repeats: never finishes
      reviews: [],
    });
    const clock = createFakeClock();

    const result = await runAgentOnPr({ api, clock }, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      kind: 'timeout',
      runId: 'run-1',
      repo: 'acme/payments-api',
      prNumber: 482,
    });
    // Exactly the cap, not the cap plus whatever was left of a poll interval.
    expect(clock.elapsed()).toBe(RUN_TIMEOUT_MS);
    // Nothing was fetched after the deadline.
    expect(api.calls.listReviews).toBe(0);
  });

  it('surfaces the error of a run that failed', async () => {
    const api = createFakeApi({
      repos: [REPO],
      pulls: pullsFor(),
      startedRuns: [STARTED_RUN],
      runsByPoll: [[{ run_id: 'run-1', status: 'failed', error: 'provider returned 402' }]],
      reviews: [],
    });

    const result = await runAgentOnPr({ api, clock: createFakeClock() }, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      kind: 'run_failed',
      runId: 'run-1',
      status: 'failed',
      error: 'provider returned 402',
    });
  });

  it('reads a 404 from the review trigger as an unknown agent, not an unknown PR', async () => {
    const api = createFakeApi({
      repos: [REPO],
      pulls: pullsFor(),
      failures: { startReview: { kind: 'not_found', message: 'Agent not found' } },
    });

    const result = await runAgentOnPr({ api, clock: createFakeClock() }, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'unknown_agent', agentId: 'agent-1' });
  });

  it('reports the API rate limit rather than retrying into it', async () => {
    const api = createFakeApi({
      repos: [REPO],
      pulls: pullsFor(),
      failures: { startReview: { kind: 'rate_limited', message: 'too many requests' } },
    });

    const result = await runAgentOnPr({ api, clock: createFakeClock() }, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('rate_limited');
    expect(api.calls.listRuns).toBe(0);
  });

  it('reports an unreachable API before doing anything else', async () => {
    const api = createFakeApi({
      failures: { listRepos: { kind: 'unreachable', baseUrl: 'http://localhost:3001' } },
    });

    const result = await runAgentOnPr({ api, clock: createFakeClock() }, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'unreachable', baseUrl: 'http://localhost:3001' });
    expect(api.calls.startReview).toBe(0);
  });
});
