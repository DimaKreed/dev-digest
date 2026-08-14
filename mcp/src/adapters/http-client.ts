/**
 * Ring 3 — the DevDigest HTTP API, over the network.
 *
 * This is the only file in the package that performs I/O. Everything above it
 * depends on the `DevDigestApi` port, which is what lets the whole test suite run
 * with no server, no database and no keys.
 *
 * SECURITY — what may be interpolated into a request path.
 * `repo` and `agent_id` arrive from a model and are therefore attacker-influenced
 * whenever the model is reading a repository. `repo` is NEVER interpolated into a
 * URL: it is matched against the `full_name` values the API itself returned, and
 * only the matching record's own identifier is then used to build a path. The
 * identifiers that do reach a path are values this API produced, and each is
 * percent-encoded on the way in anyway, so a crafted value cannot escape its
 * segment or reach another route.
 */
import { z } from 'zod';
import {
  AgentBrief,
  ApiError,
  BlastRadiusBrief,
  ConventionListResponse,
  DiffReviewBrief,
  PrBrief,
  RepoBrief,
  ReviewBrief,
  RunBrief,
  StartReviewResponse,
} from '../contracts.js';
import type { ApiResult, DevDigestApi } from '../ports.js';

/**
 * Per-request ceiling. Deliberately far below the 120-second review cap: a single
 * hung HTTP call must never eat the whole wait budget, because the budget is what
 * the caller was promised.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A diff review runs the model synchronously inside the request, so it cannot be
 * held to the read-request ceiling. Matched to the review cap the server itself
 * works to, plus a margin for the response to come back.
 */
const REVIEW_TIMEOUT_MS = 180_000;

export interface HttpApiOptions {
  baseUrl: string;
  /** Injectable for tests that want to drive the wire without a server. */
  fetchImpl?: typeof fetch;
}

export function createHttpApi(options: HttpApiOptions): DevDigestApi {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;

  async function request<T>(
    schema: z.ZodType<T>,
    path: string,
    init?: RequestInit,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // These are NOT one situation, and conflating them sends the caller to
      // restart a server that is working. `AbortSignal.timeout` rejects with a
      // DOMException named TimeoutError; a refused connection does not.
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return timedOut
        ? { ok: false, failure: { kind: 'slow', baseUrl, timeoutMs } }
        : { ok: false, failure: { kind: 'unreachable', baseUrl } };
    }

    if (!response.ok) {
      const envelope = ApiError.safeParse(await readJson(response));
      const code = envelope.success ? envelope.data.error.code : 'unknown';
      const message = envelope.success ? envelope.data.error.message : response.statusText;

      if (response.status === 404) return { ok: false, failure: { kind: 'not_found', message } };
      if (response.status === 429) return { ok: false, failure: { kind: 'rate_limited', message } };
      return { ok: false, failure: { kind: 'api_error', status: response.status, code, message } };
    }

    // The API declares no response schemas, so this is the boundary where an
    // unvalidated payload becomes typed data.
    const parsed = schema.safeParse(await readJson(response));
    if (!parsed.success) {
      return {
        ok: false,
        failure: { kind: 'bad_response', message: parsed.error.issues[0]?.message ?? 'unexpected shape' },
      };
    }
    return { ok: true, value: parsed.data };
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  const id = encodeURIComponent;

  return {
    listAgents: () => request(z.array(AgentBrief), '/agents'),
    listRepos: () => request(z.array(RepoBrief), '/repos'),
    listPulls: (repoId) => request(z.array(PrBrief), `/repos/${id(repoId)}/pulls`),
    listRuns: (prId) => request(z.array(RunBrief), `/pulls/${id(prId)}/runs`),
    listReviews: (prId) => request(z.array(ReviewBrief), `/pulls/${id(prId)}/reviews`),
    listConventions: (repoId) =>
      request(ConventionListResponse, `/repos/${id(repoId)}/conventions`),
    getBlastRadius: (prId) => request(BlastRadiusBrief, `/pulls/${id(prId)}/blast`),
    reviewDiff: (input) =>
      request(
        DiffReviewBrief,
        '/reviews/diff',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // The patch is a request BODY, never a path segment — it is arbitrary
          // multi-line text from the developer's own working tree.
          body: JSON.stringify(input),
        },
        REVIEW_TIMEOUT_MS,
      ),
    startReview: (prId, agentId) =>
      request(StartReviewResponse, `/pulls/${id(prId)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
      }),
  };
}
