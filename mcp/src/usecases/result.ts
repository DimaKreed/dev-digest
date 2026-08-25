/**
 * Ring 2 — the result shape every use case returns.
 *
 * Use cases report failure as a value, never by throwing, and never as an MCP
 * envelope. The transport layer is the only place that knows what an MCP result
 * looks like; here a failure is just a cause plus whatever the recovery message
 * will need to name.
 */
import type { ApiFailure } from '../ports.js';

export type UseCaseFailure =
  | { kind: 'unreachable'; baseUrl: string }
  | { kind: 'slow'; baseUrl: string; timeoutMs: number }
  | { kind: 'unknown_repo'; repo: string }
  | { kind: 'unknown_pull'; repo: string; prNumber: number }
  | { kind: 'unknown_agent'; agentId: string }
  | { kind: 'rate_limited' }
  | { kind: 'timeout'; runId: string; repo: string; prNumber: number }
  | { kind: 'run_failed'; runId: string; status: string; error: string }
  | { kind: 'api_error'; message: string };

export type UseCaseResult<T> = { ok: true; value: T } | { ok: false; failure: UseCaseFailure };

export function ok<T>(value: T): UseCaseResult<T> {
  return { ok: true, value };
}

export function fail<T>(failure: UseCaseFailure): UseCaseResult<T> {
  return { ok: false, failure };
}

/**
 * Default translation of a transport-level failure. Callers that can say
 * something more specific — "that 404 was the agent id, not the pull request" —
 * check for it before falling back to this.
 */
export function fromApiFailure(failure: ApiFailure): UseCaseFailure {
  switch (failure.kind) {
    case 'unreachable':
      return { kind: 'unreachable', baseUrl: failure.baseUrl };
    case 'slow':
      return { kind: 'slow', baseUrl: failure.baseUrl, timeoutMs: failure.timeoutMs };
    case 'rate_limited':
      return { kind: 'rate_limited' };
    case 'not_found':
      return { kind: 'api_error', message: failure.message };
    case 'api_error':
      return { kind: 'api_error', message: `${failure.code}: ${failure.message}` };
    case 'bad_response':
      return { kind: 'api_error', message: `unexpected response from the API (${failure.message})` };
  }
}
