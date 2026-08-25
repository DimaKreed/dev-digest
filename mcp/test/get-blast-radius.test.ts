import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../src/adapters/mocks.js';
import { formatBlastRadius } from '../src/domain/format.js';
import { CALLERS_PER_SYMBOL } from '../src/domain/limits.js';
import { getBlastRadius, readIndexHealth } from '../src/usecases/get-blast-radius.js';
import { BLAST_OK, PULL, REPO, pullsFor } from './fixtures.js';

/**
 * Hermetic: the API is substituted at the port seam, never with `vi.mock`.
 *
 * The property under test throughout is that a SHORT answer is not allowed to
 * read as a measured "small impact" unless the index earned that reading.
 */

function deps(blast: unknown) {
  return { api: createFakeApi({ repos: [REPO], pulls: pullsFor([PULL]), blast }) };
}

const input = { repo: 'acme/payments-api', prNumber: 482, limit: 20 };

describe('the three empty results are different facts', () => {
  it('says not_indexed — not no_callers — when the index is degraded', async () => {
    const result = await getBlastRadius(
      deps({ changed_symbols: [], downstream: [], state: 'degraded', reason: 'no_data' }),
      input,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.emptyReason).toBe('not_indexed');
  });

  it('says no_symbols when the diff exposed nothing to trace', async () => {
    const result = await getBlastRadius(
      deps({ changed_symbols: [], downstream: [], state: 'ok' }),
      input,
    );
    if (!result.ok) return expect.fail('expected ok');
    expect(result.value.emptyReason).toBe('no_symbols');
  });

  it('says no_callers when a healthy index found symbols nothing calls', async () => {
    const result = await getBlastRadius(
      deps({
        changed_symbols: [{ name: 'helper', file: 'src/util.ts', kind: 'function' }],
        downstream: [{ symbol: 'helper', callers: [], endpoints_affected: [] }],
        state: 'ok',
      }),
      input,
    );
    if (!result.ok) return expect.fail('expected ok');
    expect(result.value.emptyReason).toBe('no_callers');
  });

  it('does NOT claim no_callers on a partial index — the emptiness is unearned', async () => {
    const result = await getBlastRadius(
      deps({
        changed_symbols: [{ name: 'helper', file: 'src/util.ts', kind: 'function' }],
        downstream: [{ symbol: 'helper', callers: [], endpoints_affected: [] }],
        state: 'partial',
        reason: 'index_partial',
      }),
      input,
    );
    if (!result.ok) return expect.fail('expected ok');
    expect(result.value.emptyReason).toBe('not_indexed');
  });
});

describe('index health is read cautiously', () => {
  it('treats an ABSENT state as degraded, never as ok', async () => {
    // The key is omitted entirely — a server that will not say how complete its
    // index is has not earned the benefit of the doubt.
    const result = await getBlastRadius(
      deps({ changed_symbols: [], downstream: [] }),
      input,
    );
    if (!result.ok) return expect.fail('expected ok');
    expect(result.value.indexState).toBe('degraded');
  });

  it.each([
    ['ok', 'ok'],
    ['partial', 'partial'],
    ['degraded', 'degraded'],
    ['rebuilding', 'degraded'],
    [undefined, 'degraded'],
    [null, 'degraded'],
  ])('reads %s as %s', (state, expected) => {
    expect(readIndexHealth(state as string | null | undefined)).toBe(expected);
  });
});

describe('counting', () => {
  it('de-duplicates an endpoint reached through two changed symbols', async () => {
    const result = await getBlastRadius(deps(BLAST_OK), input);
    if (!result.ok) return expect.fail('expected ok');
    // POST /pay appears under both symbols; the union must count it once.
    expect(result.value.endpoints).toEqual(['GET /health', 'POST /pay']);
    expect(result.value.crons).toEqual(['nightly-settlement']);
    expect(result.value.totalCallers).toBe(3);
  });

  it('caps printed callers without shrinking the reported count', async () => {
    const callers = Array.from({ length: 8 }, (_, i) => ({
      name: `c${i}`,
      file: `src/c${i}.ts`,
      line: i + 1,
      endpoints_affected: [],
    }));
    const result = await getBlastRadius(
      deps({
        changed_symbols: [{ name: 'hot', file: 'src/hot.ts', kind: 'function' }],
        downstream: [{ symbol: 'hot', callers, endpoints_affected: [] }],
        state: 'ok',
      }),
      input,
    );
    if (!result.ok) return expect.fail('expected ok');
    expect(result.value.downstream[0]!.callers).toHaveLength(CALLERS_PER_SYMBOL);
    expect(result.value.downstream[0]!.callerCount).toBe(8);
    expect(result.value.totalCallers).toBe(8);
  });

  it('ranks by caller count with a stable tiebreak, whatever the input order', async () => {
    const one = {
      symbol: 'beta',
      callers: [{ name: 'x', file: 'x.ts', line: 1, endpoints_affected: [] }],
      endpoints_affected: [],
    };
    const two = {
      symbol: 'alpha',
      callers: [{ name: 'y', file: 'y.ts', line: 1, endpoints_affected: [] }],
      endpoints_affected: [],
    };
    const changed = [
      { name: 'alpha', file: 'a.ts', kind: 'function' },
      { name: 'beta', file: 'b.ts', kind: 'function' },
    ];

    const forward = await getBlastRadius(
      deps({ changed_symbols: changed, downstream: [one, two], state: 'ok' }),
      input,
    );
    const reverse = await getBlastRadius(
      deps({ changed_symbols: changed, downstream: [two, one], state: 'ok' }),
      input,
    );
    if (!forward.ok || !reverse.ok) return expect.fail('expected ok');
    expect(forward.value.downstream.map((d) => d.symbol)).toEqual(['alpha', 'beta']);
    expect(reverse.value.downstream.map((d) => d.symbol)).toEqual(['alpha', 'beta']);
  });

  it('truncates symbols by limit and says so', async () => {
    const result = await getBlastRadius(deps(BLAST_OK), { ...input, limit: 1 });
    if (!result.ok) return expect.fail('expected ok');
    expect(result.value.returned).toBe(1);
    expect(result.value.total).toBe(2);
    expect(result.value.truncated).toBe(true);
    // The counts stay over ALL of them, not over the page.
    expect(result.value.totalCallers).toBe(3);
  });
});

describe('failures', () => {
  it('surfaces an unreachable API as a failure, not as an empty radius', async () => {
    const api = createFakeApi({
      repos: [REPO],
      pulls: pullsFor([PULL]),
      failures: { getBlastRadius: { kind: 'unreachable', baseUrl: 'http://localhost:3001' } },
    });
    const result = await getBlastRadius({ api }, input);
    expect(result.ok).toBe(false);
  });
});

describe('formatBlastRadius', () => {
  const view = {
    symbolCount: 2,
    downstream: [
      {
        symbol: 'rateLimit',
        callerCount: 2,
        callers: [
          {
            name: 'publicRouter',
            file: 'src/api/public/index.ts',
            line: 23,
            endpoints: ['GET /health'],
          },
        ],
        endpoints: ['GET /health'],
        crons: [],
      },
    ],
    total: 1,
    totalCallers: 2,
    endpoints: ['GET /health', 'POST /pay'],
    crons: ['nightly'],
    summary: 's',
    callersPerSymbol: CALLERS_PER_SYMBOL,
  };

  it('omits per-caller rows when concise', () => {
    const out = formatBlastRadius(view, 'concise');
    expect(out).not.toContain('src/api/public/index.ts:23');
    expect(out).toContain('rateLimit');
  });

  it('includes file:line when detailed', () => {
    expect(formatBlastRadius(view, 'detailed')).toContain('src/api/public/index.ts:23');
  });

  it('prints the endpoint union in BOTH formats — it is the point of the tool', () => {
    for (const format of ['concise', 'detailed'] as const) {
      expect(formatBlastRadius(view, format)).toContain(
        'Endpoints affected: GET /health, POST /pay',
      );
    }
  });
});
