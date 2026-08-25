import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../src/adapters/mocks.js';
import { formatBlastRadius } from '../src/domain/format.js';
import { CALLERS_PER_SYMBOL } from '../src/domain/limits.js';
import { blastNoCallers } from '../src/domain/errors.js';
import {
  getBlastRadius,
  readIndexHealth,
  readResolution,
} from '../src/usecases/get-blast-radius.js';
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


// ---------------------------------------------------------------------------
// An empty answer is four facts, and "nothing calls the changed code" is only
// one of them. It was the one being reported for all four.
// ---------------------------------------------------------------------------

describe('readResolution defaults to the cautious branch', () => {
  it('reads a resolved caller as found whatever the label says', () => {
    expect(readResolution('not_callable', 3)).toBe('found');
  });

  it.each([
    ['not_callable', 'notCallable'],
    ['unreferenced', 'unreferenced'],
    ['unresolved', 'unresolved'],
  ])('maps %s', (value, expected) => {
    expect(readResolution(value, 0)).toBe(expected);
  });

  it.each([undefined, null, '', 'something-new'])(
    'reads %s as unresolved, never as a measured absence',
    (value) => {
      // The whole safety property of a tolerant schema: an unrecognised value
      // must degrade into "could not tell", not into "nothing to see".
      expect(readResolution(value, 0)).toBe('unresolved');
    },
  );
});

describe('the tally says why the symbols without callers have none', () => {
  const row = (symbol: string, resolution: string, mentions = 0) => ({
    symbol,
    callers: [],
    endpoints_affected: [],
    crons_affected: [],
    resolution,
    mentions,
  });

  it('counts each reason separately', async () => {
    const result = await getBlastRadius(
      deps({
        changed_symbols: [
          { name: 'RowShape', file: 'a.ts', kind: 'interface' },
          { name: 'brandNew', file: 'a.ts', kind: 'function' },
          { name: 'github', file: 'a.ts', kind: 'method' },
        ],
        downstream: [
          row('RowShape', 'not_callable'),
          row('brandNew', 'unreferenced'),
          row('github', 'unresolved', 8),
        ],
        state: 'ok',
      }),
      input,
    );
    if (!result.ok) return expect.fail('expected ok');

    expect(result.value.tally).toEqual({
      found: 0,
      notCallable: 1,
      unreferenced: 1,
      unresolved: 1,
    });
    expect(result.value.emptyReason).toBe('no_callers');
  });

  it('counts a row with callers as found even when the server sent no resolution', async () => {
    const result = await getBlastRadius(deps(BLAST_OK), input);
    if (!result.ok) return expect.fail('expected ok');

    expect(result.value.tally.found).toBeGreaterThan(0);
    expect(result.value.tally.unresolved).toBe(0);
  });
});

describe('blastNoCallers refuses to call unmeasured silence a measurement', () => {
  it('claims a measured result only for the names nothing references', () => {
    const msg = blastNoCallers('acme/api', 7, 1, {
      notCallable: 0,
      unreferenced: 1,
      unresolved: 0,
    });

    expect(msg).toContain('measured result');
  });

  it('says the callers exist when the names were referenced but unresolvable', () => {
    const msg = blastNoCallers('acme/api', 7, 1, {
      notCallable: 0,
      unreferenced: 0,
      unresolved: 1,
    });

    expect(msg).toContain('not provable from the import graph');
    // The sentence a model must not be able to read out of this case.
    expect(msg).not.toContain('this is a measured result');
  });

  it('explains that a type was never callable rather than counting it as clean', () => {
    const msg = blastNoCallers('acme/api', 7, 1, {
      notCallable: 1,
      unreferenced: 0,
      unresolved: 0,
    });

    expect(msg).toContain('annotated rather than invoked');
    expect(msg).not.toContain('this is a measured result');
  });

  it('always warns against reading it as containment', () => {
    const msg = blastNoCallers('acme/api', 7, 3, {
      notCallable: 1,
      unreferenced: 1,
      unresolved: 1,
    });

    expect(msg).toContain('Do not read this as "the change is contained"');
  });
});

describe('two declarations of one name stay distinguishable', () => {
  const twin = (file: string, callers: number) => ({
    symbol: 'getPull',
    file,
    callers: Array.from({ length: callers }, (_, i) => ({
      name: `use${i}`,
      file: `c${i}.ts`,
      line: i + 1,
      endpoints_affected: [],
      crons_affected: [],
    })),
    endpoints_affected: [],
    crons_affected: [],
    resolution: 'found',
    mentions: callers,
  });

  it('prints the declaring file, so the two entries are not one fact twice', () => {
    const out = formatBlastRadius(
      {
        symbolCount: 2,
        downstream: [
          { symbol: 'getPull', file: 'src/repository.ts', callers: [], callerCount: 5, endpoints: [], crons: [] },
          { symbol: 'getPull', file: 'src/repository/pull.repo.ts', callers: [], callerCount: 1, endpoints: [], crons: [] },
        ],
        total: 2,
        totalCallers: 6,
        endpoints: [],
        crons: [],
        summary: null,
        callersPerSymbol: CALLERS_PER_SYMBOL,
      },
      'concise',
    );

    expect(out).toContain('[src/repository.ts]');
    expect(out).toContain('[src/repository/pull.repo.ts]');
  });

  it('omits the bracket entirely when the server sent no file', () => {
    // An older server, or the degraded path. Printing `[]` would read as a fact.
    const out = formatBlastRadius(
      {
        symbolCount: 1,
        downstream: [{ symbol: 'helper', callers: [], callerCount: 2, endpoints: [], crons: [] }],
        total: 1,
        totalCallers: 2,
        endpoints: [],
        crons: [],
        summary: null,
        callersPerSymbol: CALLERS_PER_SYMBOL,
      },
      'concise',
    );

    expect(out).toContain('helper');
    expect(out).not.toContain('[');
  });

  it('breaks the sort tie on the file, so repeated calls agree', async () => {
    const result = await getBlastRadius(
      deps({
        changed_symbols: [
          { name: 'getPull', file: 'src/z.ts', kind: 'method' },
          { name: 'getPull', file: 'src/a.ts', kind: 'method' },
        ],
        downstream: [twin('src/z.ts', 2), twin('src/a.ts', 2)],
        state: 'ok',
      }),
      input,
    );
    if (!result.ok) return expect.fail('expected ok');

    expect(result.value.downstream.map((d) => d.file)).toEqual(['src/a.ts', 'src/z.ts']);
  });
});