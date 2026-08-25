import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import {
  MAX_CALLERS_PER_SYMBOL,
  buildSummary,
  deriveState,
  toBlastResponse,
} from '../src/modules/blast/helpers.js';
import type {
  BlastPriorPr,
  BlastRadiusRead,
  IndexStateRead,
  ReverseImpactRead,
} from '../src/modules/blast/ports.js';

/**
 * Unit tests for the blast-radius mapper — the whole feature lives in that pure
 * function, so this is where it is pinned.
 *
 * No `test/helpers/pg.ts` import: this file must pass in the hermetic unit lane
 * (`vitest run --exclude '**\/*.it.test.ts'`). No `vi.mock` anywhere — the
 * mapper is pure and the route is driven through `buildApp()` + `inject()`.
 */

const NO_IMPACT: ReverseImpactRead = { rows: [], truncatedFrom: [] };

function blastRead(over: Partial<BlastRadiusRead> = {}): BlastRadiusRead {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    ...over,
  };
}

function map(input: {
  blast?: Partial<BlastRadiusRead>;
  impact?: ReverseImpactRead;
  indexStatus?: IndexStateRead['status'] | null;
  priorPrs?: BlastPriorPr[];
}) {
  return toBlastResponse({
    blast: blastRead(input.blast),
    impact: input.impact ?? NO_IMPACT,
    indexStatus: input.indexStatus === undefined ? 'full' : input.indexStatus,
    priorPrs: input.priorPrs ?? [],
  });
}

// ---------------------------------------------------------------------------
// The per-symbol cap. This is the defect the mapper exists to fix.
// ---------------------------------------------------------------------------

describe('caller cap is per symbol, not across the whole result', () => {
  it('gives every changed symbol its own budget of 20 callers', () => {
    const changedSymbols = [
      { file: 'src/a.ts', name: 'alpha', kind: 'function' },
      { file: 'src/b.ts', name: 'beta', kind: 'function' },
    ];
    // 25 callers each: over the cap on both, so a global cap would starve one.
    const callers = ['alpha', 'beta'].flatMap((via) =>
      Array.from({ length: 25 }, (_, i) => ({
        file: `src/callers/${via}-${i}.ts`,
        symbol: `caller${i}`,
        viaSymbol: via,
        line: i + 1,
        rank: 1 - i / 100,
      })),
    );

    const res = map({ blast: { changedSymbols, callers } });

    expect(res.downstream).toHaveLength(2);
    expect(res.downstream[0]!.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(res.downstream[1]!.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // A cap applied to the flat array would total 20 here, not 40.
    const total = res.downstream.reduce((n, d) => n + d.callers.length, 0);
    expect(total).toBe(40);
  });

  it('keeps rank order inside each group', () => {
    const changedSymbols = [{ file: 'src/a.ts', name: 'alpha', kind: 'function' }];
    // Supplied rank-descending, the order the facade guarantees.
    const callers = [0.9, 0.5, 0.1].map((rank, i) => ({
      file: `src/c${i}.ts`,
      symbol: `c${i}`,
      viaSymbol: 'alpha',
      line: 1,
      rank,
    }));

    const res = map({ blast: { changedSymbols, callers } });

    expect(res.downstream[0]!.callers.map((c) => c.file)).toEqual([
      'src/c0.ts',
      'src/c1.ts',
      'src/c2.ts',
    ]);
  });
});

describe('what belongs in downstream', () => {
  it('excludes a reference that lives in the declaring file itself', () => {
    const res = map({
      blast: {
        changedSymbols: [{ file: 'src/a.ts', name: 'alpha', kind: 'function' }],
        callers: [
          { file: 'src/a.ts', symbol: 'self', viaSymbol: 'alpha', line: 9, rank: 1 },
          { file: 'src/b.ts', symbol: 'other', viaSymbol: 'alpha', line: 3, rank: 1 },
        ],
      },
    });

    expect(res.downstream[0]!.callers.map((c) => c.file)).toEqual(['src/b.ts']);
  });

  it('keeps a symbol nothing calls, with an empty caller list', () => {
    const res = map({
      blast: {
        changedSymbols: [
          { file: 'src/a.ts', name: 'alpha', kind: 'function' },
          { file: 'src/b.ts', name: 'lonely', kind: 'function' },
        ],
        callers: [
          { file: 'src/x.ts', symbol: 'x', viaSymbol: 'alpha', line: 1, rank: 1 },
        ],
      },
    });

    expect(res.downstream.map((d) => d.symbol)).toEqual(['alpha', 'lonely']);
    expect(res.downstream[1]!.callers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Row order. On a 130-symbol pull request only 13 symbols had callers, and they
// were scattered through the list — the answer was present and invisible.
// ---------------------------------------------------------------------------

describe('rows carrying an answer come first', () => {
  it('sorts by caller count descending', () => {
    const res = map({
      blast: {
        changedSymbols: [
          { file: 'a.ts', name: 'quiet', kind: 'function' },
          { file: 'a.ts', name: 'busy', kind: 'function' },
          { file: 'a.ts', name: 'some', kind: 'function' },
        ],
        callers: [
          { file: 'c1.ts', symbol: 'x', viaSymbol: 'busy', line: 1, rank: 3 },
          { file: 'c2.ts', symbol: 'y', viaSymbol: 'busy', line: 2, rank: 2 },
          { file: 'c3.ts', symbol: 'z', viaSymbol: 'some', line: 3, rank: 1 },
        ],
      },
    });

    expect(res.downstream.map((d) => d.symbol)).toEqual(['busy', 'some', 'quiet']);
  });

  it('breaks ties by name, so the same input always renders identically', () => {
    // The declaration order handed in is deliberately reversed relative to the
    // alphabet: without the tiebreak this would echo the input order, which is
    // whatever order the database returned.
    const res = map({
      blast: {
        changedSymbols: [
          { file: 'a.ts', name: 'zeta', kind: 'function' },
          { file: 'a.ts', name: 'beta', kind: 'function' },
          { file: 'a.ts', name: 'alpha', kind: 'function' },
        ],
      },
    });

    expect(res.downstream.map((d) => d.symbol)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('does not reorder the callers inside a row', () => {
    // Callers arrive rank-sorted from the facade and must stay that way — the
    // row sort is over rows only.
    const res = map({
      blast: {
        changedSymbols: [{ file: 'a.ts', name: 'busy', kind: 'function' }],
        callers: [
          { file: 'high.ts', symbol: 'x', viaSymbol: 'busy', line: 1, rank: 9 },
          { file: 'low.ts', symbol: 'y', viaSymbol: 'busy', line: 2, rank: 1 },
        ],
      },
    });

    expect(res.downstream[0]!.callers.map((c) => c.file)).toEqual(['high.ts', 'low.ts']);
  });
});

// ---------------------------------------------------------------------------
// The two-level reverse walk. This is the before/after of the shallow
// attribution the facade ships on its own.
// ---------------------------------------------------------------------------

describe('endpoint attribution reaches through the import graph', () => {
  const changedSymbols = [{ file: 'src/util.ts', name: 'helper', kind: 'function' }];
  const callers = [
    { file: 'src/service.ts', symbol: 'doWork', viaSymbol: 'helper', line: 12, rank: 1 },
  ];

  it('finds an endpoint two hops out, on a file that is not itself a caller', () => {
    // routes.ts imports service.ts; service.ts calls helper(). Only routes.ts
    // declares an endpoint, and it is not in the caller set at all.
    const impact: ReverseImpactRead = {
      rows: [
        {
          file: 'src/routes.ts',
          depth: 1,
          originFiles: ['src/service.ts'],
          endpoints: ['GET /x'],
          crons: [],
        },
      ],
      truncatedFrom: [],
    };

    const res = map({ blast: { changedSymbols, callers }, impact });

    expect(res.downstream[0]!.endpoints_affected).toEqual(['GET /x']);
    expect(res.downstream[0]!.callers[0]!.endpoints_affected).toEqual(['GET /x']);
  });

  it('finds nothing without the walk — the same input, no impact rows', () => {
    const res = map({ blast: { changedSymbols, callers } });
    expect(res.downstream[0]!.endpoints_affected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Endpoints extracted from a test file are calls, not declarations. Left in,
// they dominated the answer: eleven integration tests importing `app.ts` put 52
// of 57 endpoints on one pull request in this repository.
// ---------------------------------------------------------------------------

describe('test files are not an HTTP surface', () => {
  const changedSymbols = [{ file: 'src/util.ts', name: 'helper', kind: 'function' }];
  const callers = [
    { file: 'src/service.ts', symbol: 'doWork', viaSymbol: 'helper', line: 12, rank: 1 },
  ];

  const impact = (file: string): ReverseImpactRead => ({
    rows: [
      { file, depth: 1, originFiles: ['src/service.ts'], endpoints: ['GET /x'], crons: [] },
    ],
    truncatedFrom: [],
  });

  it.each([
    'test/reviews.it.test.ts',
    'src/modules/blast/helpers.spec.ts',
    'src/__tests__/routes.ts',
    'tests/smoke.ts',
    'client/src/lib/api.test.tsx',
  ])('drops the endpoints a walked %s claims', (file) => {
    const res = map({ blast: { changedSymbols, callers }, impact: impact(file) });
    expect(res.downstream[0]!.endpoints_affected).toEqual([]);
  });

  it.each(['src/routes.ts', 'src/latest/contest.ts', 'src/protest.ts'])(
    'keeps the endpoints %s declares',
    (file) => {
      // Guards the regex against matching a path that merely CONTAINS "test":
      // `contest.ts` and `protest.ts` are production files.
      const res = map({ blast: { changedSymbols, callers }, impact: impact(file) });
      expect(res.downstream[0]!.endpoints_affected).toEqual(['GET /x']);
    },
  );

  it('drops them from the facade’s direct attribution too', () => {
    // Same rule, other source: `factsByFile` is depth 0, where a caller file is
    // its own fact carrier. A test that calls the changed symbol lands here.
    const res = map({
      blast: {
        changedSymbols,
        callers: [
          { file: 'test/util.test.ts', symbol: 'it', viaSymbol: 'helper', line: 3, rank: 1 },
        ],
        factsByFile: { 'test/util.test.ts': { endpoints: ['GET /x'], crons: ['nightly'] } },
      },
    });

    expect(res.downstream[0]!.endpoints_affected).toEqual([]);
    expect(res.downstream[0]!.crons_affected).toEqual([]);
    // The caller itself is NOT dropped — "your tests cover this" still reads.
    expect(res.downstream[0]!.callers).toHaveLength(1);
  });
});

describe('per-caller attribution', () => {
  it('gives each caller only the endpoints of its own file', () => {
    // Two callers, two endpoints. A flat per-symbol union would let a graph draw
    // 2 x 2 = 4 edges; the real answer is one endpoint per caller.
    const res = map({
      blast: {
        changedSymbols: [{ file: 'src/a.ts', name: 'alpha', kind: 'function' }],
        callers: [
          { file: 'src/one.ts', symbol: 'one', viaSymbol: 'alpha', line: 1, rank: 2 },
          { file: 'src/two.ts', symbol: 'two', viaSymbol: 'alpha', line: 2, rank: 1 },
        ],
        factsByFile: {
          'src/one.ts': { endpoints: ['GET /one'], crons: [] },
          'src/two.ts': { endpoints: ['POST /two'], crons: ['nightly'] },
        },
      },
    });

    const callers = res.downstream[0]!.callers;
    expect(callers[0]!.endpoints_affected).toEqual(['GET /one']);
    expect(callers[1]!.endpoints_affected).toEqual(['POST /two']);
    expect(callers[1]!.crons_affected).toEqual(['nightly']);
    // The symbol-level union still holds both.
    expect(res.downstream[0]!.endpoints_affected).toEqual(['GET /one', 'POST /two']);
    // Total edges a graph would draw: one per caller, not the 2x2 product.
    const edges = callers.reduce((n, c) => n + c.endpoints_affected.length, 0);
    expect(edges).toBe(2);
  });

  it('sorts endpoints so the output does not leak DB row order', () => {
    const res = map({
      blast: {
        changedSymbols: [{ file: 'src/a.ts', name: 'alpha', kind: 'function' }],
        callers: [{ file: 'src/c.ts', symbol: 'c', viaSymbol: 'alpha', line: 1, rank: 1 }],
        factsByFile: {
          'src/c.ts': { endpoints: ['POST /z', 'GET /a', 'DELETE /m'], crons: [] },
        },
      },
    });

    expect(res.downstream[0]!.endpoints_affected).toEqual([
      'DELETE /m',
      'GET /a',
      'POST /z',
    ]);
  });
});

// ---------------------------------------------------------------------------
// ok / partial / degraded — the three states must stay apart.
// ---------------------------------------------------------------------------

describe('deriveState', () => {
  const clean = blastRead();

  it('is ok on a full index with a complete walk', () => {
    expect(deriveState('full', clean, false)).toEqual({ state: 'ok', reason: null });
  });

  it('is partial when the reverse walk hit the fan-out cap', () => {
    expect(deriveState('full', clean, true)).toEqual({
      state: 'partial',
      reason: 'fanout_capped',
    });
  });

  it('is partial on a partial index', () => {
    expect(deriveState('partial', clean, false)).toEqual({
      state: 'partial',
      reason: 'index_partial',
    });
  });

  it.each(['degraded', 'failed'] as const)('is degraded on a %s index', (status) => {
    expect(deriveState(status, clean, false).state).toBe('degraded');
  });

  it('is degraded when the facade fell back, whatever the index says', () => {
    expect(deriveState('full', blastRead({ degraded: true, reason: 'no_data' }), false)).toEqual({
      state: 'degraded',
      reason: 'no_data',
    });
  });

  it('is degraded when the index wrote NO import graph, whatever status says', () => {
    // The bug this guards: buildEdges swallows its own failures and returns [],
    // so the pipeline stamps status 'full' with an empty graph. No graph means
    // no reference resolves, so no caller can ever be found — reporting 'ok'
    // would present that blindness as a measured "nothing calls this code".
    expect(deriveState('full', clean, false, { edges: 0, files: 312 })).toEqual({
      state: 'degraded',
      reason: 'no_import_graph',
    });
  });

  it('stays ok when the graph exists', () => {
    expect(deriveState('full', clean, false, { edges: 514, files: 312 })).toEqual({
      state: 'ok',
      reason: null,
    });
  });

  it('does not call an EMPTY repo broken — zero files means nothing to graph', () => {
    expect(deriveState('full', clean, false, { edges: 0, files: 0 })).toEqual({
      state: 'ok',
      reason: null,
    });
  });

  it('stays ok when the edge count is unknown (a run predating the field)', () => {
    expect(deriveState('full', clean, false, { edges: undefined, files: 312 })).toEqual({
      state: 'ok',
      reason: null,
    });
  });

  it('is degraded when there is no index row at all', () => {
    expect(deriveState(null, clean, false)).toEqual({ state: 'degraded', reason: 'no_data' });
  });
});

describe('summary', () => {
  it('is deterministic for the same input', () => {
    const once = buildSummary('ok', null, 3, 12, 4, 1);
    const twice = buildSummary('ok', null, 3, 12, 4, 1);
    expect(once).toBe(twice);
    expect(once).toBe(
      '3 changed symbols reach 12 callers, affecting 4 HTTP endpoints and 1 scheduled job.',
    );
  });

  it('refuses to let a degraded empty result read as "no impact"', () => {
    const text = buildSummary('degraded', 'no_data', 0, 0, 0, 0);
    expect(text).toContain('not a statement that the change has no impact');
  });

  it('says a partial result is a lower bound', () => {
    expect(buildSummary('partial', 'index_partial', 1, 2, 0, 0)).toContain(
      'unknown, not absent',
    );
  });
});

describe('prior PRs', () => {
  it('maps a merged PR and leaves its note empty and unrequested', () => {
    const res = map({
      priorPrs: [
        {
          number: 401,
          title: 'Introduce public API namespace',
          author: 'deepak.r',
          mergedAt: new Date('2026-03-18T00:00:00.000Z'),
          filesOverlap: ['src/server.ts', 'src/api/public/index.ts'],
        },
      ],
    });

    expect(res.prior_prs).toHaveLength(1);
    expect(res.prior_prs[0]).toMatchObject({
      pr_number: 401,
      title: 'Introduce public API namespace',
      author: 'deepak.r',
      notes: '',
      // Sorted, so the chips render in a stable order.
      files_overlap: ['src/api/public/index.ts', 'src/server.ts'],
    });
    expect(res.notes_state).toBe('absent');
  });
});

// ---------------------------------------------------------------------------
// Route wiring, without a database.
// ---------------------------------------------------------------------------

describe('GET /pulls/:id/blast (schema + registration)', () => {
  const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' });

  it('rejects a non-uuid id with 422 before the handler runs', async () => {
    const app = await buildApp({ config: config() });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('is registered — an unknown route would 404 instead of 422', async () => {
    const app = await buildApp({ config: config() });
    const res = await app.inject({ method: 'GET', url: '/pulls/nope/blast' });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('registers the notes route too', async () => {
    const app = await buildApp({ config: config() });
    const res = await app.inject({
      method: 'POST',
      url: '/pulls/nope/blast/history-notes',
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});
