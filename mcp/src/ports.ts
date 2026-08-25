/**
 * Ring 1 — the ports the use cases depend on. Implementations live in ring 3
 * (`src/adapters/`); nothing here knows how they are implemented.
 *
 * Both ports are deliberately narrow: `DevDigestApi` carries exactly the eight
 * calls the five tools make, and grows only when a tool needs a genuinely new
 * one. A port that mirrors a whole API forces every fake to stub methods no test
 * exercises.
 */
import type {
  AgentBrief,
  BlastRadiusBrief,
  ConventionListResponse,
  DiffReviewBrief,
  PrBrief,
  RepoBrief,
  ReviewBrief,
  RunBrief,
  StartReviewResponse,
} from './contracts.js';

/**
 * Why a call did not produce data. Kept as a closed set of *causes* rather than
 * HTTP status codes, because each one maps to a different piece of recovery
 * advice in the tool output — and advice is the whole value of an error here.
 */
export type ApiFailure =
  /** Nothing is listening. The API is almost certainly not started. */
  | { kind: 'unreachable'; baseUrl: string }
  /**
   * Something IS listening, it just did not answer in time. Kept apart from
   * `unreachable` because the advice is the opposite: restarting a server that
   * is merely slow is exactly the wrong move, and one route here syncs from
   * GitHub inside a GET handler, so slow is a normal state rather than a fault.
   */
  | { kind: 'slow'; baseUrl: string; timeoutMs: number }
  /** The API answered 404, or answered fine but the thing was not in the list. */
  | { kind: 'not_found'; message: string }
  /** The API's own 10-runs-per-minute cap on starting a review. */
  | { kind: 'rate_limited'; message: string }
  /** A non-2xx answer carrying the standard error envelope. */
  | { kind: 'api_error'; status: number; code: string; message: string }
  /** 2xx, but the body is not the shape this package was built against. */
  | { kind: 'bad_response'; message: string };

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

/**
 * The DevDigest HTTP API, as this package needs it.
 *
 * Every method reports failure as a value rather than throwing: a tool call that
 * fails still has to return a well-formed MCP result carrying advice, so an
 * exception would only be caught and re-shaped one layer up anyway.
 */
export interface DevDigestApi {
  listAgents(): Promise<ApiResult<AgentBrief[]>>;
  listRepos(): Promise<ApiResult<RepoBrief[]>>;
  listPulls(repoId: string): Promise<ApiResult<PrBrief[]>>;
  startReview(prId: string, agentId: string): Promise<ApiResult<StartReviewResponse>>;
  listRuns(prId: string): Promise<ApiResult<RunBrief[]>>;
  listReviews(prId: string): Promise<ApiResult<ReviewBrief[]>>;
  listConventions(repoId: string): Promise<ApiResult<ConventionListResponse>>;
  getBlastRadius(prId: string): Promise<ApiResult<BlastRadiusBrief>>;
  /**
   * Review a patch that belongs to no pull request. Used by the CLI, not by any
   * MCP tool: it is the one call in this port that costs money without a model
   * having asked for it.
   */
  reviewDiff(input: {
    patch: string;
    agentId?: string | undefined;
    task?: string | undefined;
  }): Promise<ApiResult<DiffReviewBrief>>;
}

/**
 * Time, injected.
 *
 * The 120-second cap is the one piece of behaviour here worth testing hard, and
 * it is untestable if the deadline arithmetic reads the machine clock. With this
 * port a test drives two minutes of waiting in microseconds, and the use cases
 * stay free of the timing primitives entirely.
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
