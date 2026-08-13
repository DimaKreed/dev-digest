/**
 * Ring 3 — hand-written fakes for the two ports.
 *
 * Substitution happens at the port seam, the same way the server substitutes
 * adapters through its container. There is no module mocking anywhere in this
 * repository and there must not be any here: the seam already exists, and a fake
 * that satisfies the interface is checked by the compiler while a mocked module
 * is not.
 *
 * Every fixture is parsed through the narrow schemas on the way in. A fixture
 * that cannot parse is a broken fake, not a passing test — without this, a test
 * suite drifts from the shapes the real API sends and keeps reporting green.
 */
import {
  AgentBrief,
  BlastRadiusBrief,
  ConventionListResponse,
  PrBrief,
  RepoBrief,
  ReviewBrief,
  RunBrief,
} from '../contracts.js';
import type { ApiFailure, ApiResult, Clock, DevDigestApi } from '../ports.js';

export interface FakeClock extends Clock {
  /** Simulated milliseconds slept so far. */
  elapsed(): number;
}

/**
 * Time under test control. `sleep` advances the clock instead of waiting, so a
 * two-minute timeout is exercised in microseconds and the assertion can be about
 * the exact simulated duration rather than about a tolerance window.
 */
export function createFakeClock(startAt = 1_000): FakeClock {
  let current = startAt;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
    elapsed: () => current - startAt,
  };
}

export interface FakeApiOptions {
  agents?: unknown[];
  repos?: unknown[];
  /** repoId → pull requests. */
  pulls?: Record<string, unknown[]>;
  reviews?: unknown[];
  conventions?: unknown;
  /** The blast-radius payload `getBlastRadius` returns. */
  blast?: unknown;
  /**
   * Run rows to return per `listRuns` call, 1-based. The last entry repeats
   * forever, which is how "never leaves running" is expressed.
   */
  runsByPoll?: unknown[][];
  /** Force a specific call to fail, to exercise the recovery messages. */
  failures?: Partial<Record<keyof DevDigestApi, ApiFailure>>;
  /** run rows the review start call reports as created. */
  startedRuns?: { run_id: string; agent_id: string; agent_name: string }[];
}

export interface FakeApi extends DevDigestApi {
  calls: { listRuns: number; startReview: number; listReviews: number };
}

export function createFakeApi(options: FakeApiOptions = {}): FakeApi {
  const agents = (options.agents ?? []).map((row) => AgentBrief.parse(row));
  const repos = (options.repos ?? []).map((row) => RepoBrief.parse(row));
  const pulls = Object.fromEntries(
    Object.entries(options.pulls ?? {}).map(([repoId, rows]) => [
      repoId,
      rows.map((row) => PrBrief.parse(row)),
    ]),
  );
  const reviews = (options.reviews ?? []).map((row) => ReviewBrief.parse(row));
  const runsByPoll = (options.runsByPoll ?? [[]]).map((rows) => rows.map((row) => RunBrief.parse(row)));
  const conventions = ConventionListResponse.parse(
    options.conventions ?? { candidates: [], last_scan_at: null },
  );
  const blast = BlastRadiusBrief.parse(
    options.blast ?? { changed_symbols: [], downstream: [], summary: null, state: 'ok' },
  );

  const calls = { listRuns: 0, startReview: 0, listReviews: 0 };

  function answer<T>(method: keyof DevDigestApi, value: T): ApiResult<T> {
    const failure = options.failures?.[method];
    return failure ? { ok: false, failure } : { ok: true, value };
  }

  return {
    calls,
    listAgents: async () => answer('listAgents', agents),
    listRepos: async () => answer('listRepos', repos),
    listPulls: async (repoId) => answer('listPulls', pulls[repoId] ?? []),
    listConventions: async () => answer('listConventions', conventions),
    getBlastRadius: async () => answer('getBlastRadius', blast),
    listReviews: async () => {
      calls.listReviews += 1;
      return answer('listReviews', reviews);
    },
    listRuns: async () => {
      calls.listRuns += 1;
      const index = Math.min(calls.listRuns, runsByPoll.length) - 1;
      return answer('listRuns', runsByPoll[index] ?? []);
    },
    startReview: async (prId) => {
      calls.startReview += 1;
      return answer('startReview', {
        pr_id: prId,
        runs: options.startedRuns ?? [],
      });
    },
  };
}
