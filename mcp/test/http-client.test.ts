import { describe, expect, it } from 'vitest';
import { createHttpApi } from '../src/adapters/http-client.js';
import { apiTooSlow, unreachable } from '../src/domain/errors.js';

const BASE = 'http://localhost:3001';

function apiThatFailsWith(error: Error) {
  return createHttpApi({
    baseUrl: BASE,
    fetchImpl: async () => {
      throw error;
    },
  });
}

/** What `AbortSignal.timeout` actually rejects with. */
function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

describe('createHttpApi — a slow API is not an absent one', () => {
  it('reports a request timeout as "slow", carrying the budget it exceeded', async () => {
    const result = await apiThatFailsWith(timeoutError()).listRepos();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'slow', baseUrl: BASE, timeoutMs: 20_000 });
  });

  it('still reports a refused connection as "unreachable"', async () => {
    const refused = new Error('fetch failed');
    refused.name = 'TypeError';

    const result = await apiThatFailsWith(refused).listRepos();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'unreachable', baseUrl: BASE });
  });

  it('gives the two cases opposite advice — one says restart, the other says do not', () => {
    expect(unreachable(BASE)).toContain('Start it by running ./scripts/dev.sh');
    expect(apiTooSlow(BASE, 20_000)).toContain('do not restart it');
    expect(apiTooSlow(BASE, 20_000)).not.toContain('./scripts/dev.sh');
  });
});

describe('createHttpApi — response handling', () => {
  it('maps a 404 to not_found and a 429 to rate_limited', async () => {
    const status = (code: number) =>
      createHttpApi({
        baseUrl: BASE,
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code: 'nope', message: 'no' } }), {
            status: code,
            headers: { 'content-type': 'application/json' },
          }),
      });

    expect((await status(404).listRepos()).ok).toBe(false);
    const notFound = await status(404).listRepos();
    const limited = await status(429).listRepos();

    expect(notFound.ok === false && notFound.failure.kind).toBe('not_found');
    expect(limited.ok === false && limited.failure.kind).toBe('rate_limited');
  });

  it('rejects a 200 whose body is not the shape this package expects', async () => {
    const api = createHttpApi({
      baseUrl: BASE,
      fetchImpl: async () =>
        new Response(JSON.stringify([{ id: 'r1' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const result = await api.listRepos();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('bad_response');
  });

  it('gives reviewDiff its own, far larger budget', async () => {
    // A diff review runs the model inside the request; holding it to the read
    // ceiling would time out every real review. The reported budget must be the
    // one that was actually applied, or the advice names the wrong number.
    const result = await apiThatFailsWith(timeoutError()).reviewDiff({ patch: 'x' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'slow', baseUrl: BASE, timeoutMs: 180_000 });
  });

  it('reports a refused connection on reviewDiff as unreachable, not as a clean review', async () => {
    const refused = new Error('fetch failed');
    refused.name = 'TypeError';

    const result = await apiThatFailsWith(refused).reviewDiff({ patch: 'x' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'unreachable', baseUrl: BASE });
  });

  it('sends the patch in the body and never in the URL', async () => {
    // The patch is arbitrary multi-line text from a working tree; a path segment
    // is the one place it must never appear.
    let seenUrl = '';
    let seenBody = '';
    const api = createHttpApi({
      baseUrl: BASE,
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        seenBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            agent_name: 'A',
            verdict: 'approve',
            findings: [],
            blockers: 0,
            fail_on: 'critical',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const patch = 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-a\n+b\n';
    const result = await api.reviewDiff({ patch });

    expect(result.ok).toBe(true);
    expect(seenUrl).toBe(`${BASE}/reviews/diff`);
    expect(seenUrl).not.toContain('diff --git');
    expect(JSON.parse(seenBody).patch).toBe(patch);
  });

  it('reports a 429 from the review cap as rate_limited', async () => {
    const api = createHttpApi({
      baseUrl: BASE,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const result = await api.reviewDiff({ patch: 'x' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('rate_limited');
  });

  it.each([
    ['blockers', { agent_name: 'A', verdict: 'approve', fail_on: 'critical' }],
    ['fail_on', { agent_name: 'A', verdict: 'approve', blockers: 0 }],
  ])('refuses a review body missing %s — the exit code depends on it', async (_field, body) => {
    // `blockers` is what the exit code is derived from, and `fail_on` is the
    // gate that produced it. Either one missing must fail loudly rather than
    // default to a value that reads as "safe to push".
    const api = createHttpApi({
      baseUrl: BASE,
      fetchImpl: async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const result = await api.reviewDiff({ patch: 'x' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('bad_response');
  });

  it('tolerates a field the server added that this package does not know', async () => {
    const api = createHttpApi({
      baseUrl: BASE,
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            { id: 'r1', owner: 'acme', name: 'x', full_name: 'acme/x', brand_new_field: 1 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const result = await api.listRepos();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.full_name).toBe('acme/x');
  });
});
