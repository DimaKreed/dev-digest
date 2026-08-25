/**
 * The caller cap in `tryPersistentBlast` is PER CHANGED SYMBOL.
 *
 * It used to be `callers.slice(0, 20)` over the flat, rank-sorted array, despite
 * the constant being named `MAX_CALLERS_PER_SYMBOL`. Measured on a real
 * 130-symbol pull request: 77 callers existed across 45 symbols, the flat cap
 * kept 20 rows covering 13 symbols, and the other 32 rendered as "0 callers" —
 * a zero produced by a budget and indistinguishable from a measurement.
 *
 * Hermetic: `svc.repo` is patched, as in `repo-intel-facade-degraded.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import {
  MAX_BLAST_CALLERS_TOTAL,
  MAX_CALLERS_PER_SYMBOL,
} from '../src/modules/repo-intel/constants.js';

/** `count` callers of `name`, rank descending so order is observable. */
function callersOf(name: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    fromPath: `callers/${name}-${i}.ts`,
    toSymbol: name,
    line: i + 1,
    rank: count - i,
  }));
}

function buildService(symbols: string[], callers: ReturnType<typeof callersOf>) {
  const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () => ({ status: 'full' }),
    // Declarations of the changed symbols, then the enclosing-symbol lookup for
    // the caller files — one method serves both, keyed on the paths asked for.
    getSymbolRows: async (_r: string, paths: string[]) =>
      paths.includes('changed.ts')
        ? symbols.map((name) => ({
            path: 'changed.ts',
            name,
            kind: 'function',
            line: 1,
            endLine: null,
            exported: true,
            signature: null,
          }))
        : [],
    getResolvedCallers: async () => callers,
    getFileFacts: async () => [],
  };
  return svc;
}

describe('tryPersistentBlast caller cap', () => {
  it('gives each changed symbol its own budget rather than sharing one', async () => {
    // Two symbols, each over the cap. A flat cap would hand everything to the
    // first and leave the second reporting nothing.
    const svc = buildService(
      ['alpha', 'beta'],
      [...callersOf('alpha', MAX_CALLERS_PER_SYMBOL + 5), ...callersOf('beta', MAX_CALLERS_PER_SYMBOL + 5)],
    );

    const res = await svc.getBlastRadius('r1', ['changed.ts']);

    const perSymbol = new Map<string, number>();
    for (const c of res.callers) perSymbol.set(c.viaSymbol, (perSymbol.get(c.viaSymbol) ?? 0) + 1);
    expect(perSymbol.get('alpha')).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(perSymbol.get('beta')).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(res.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL * 2);
  });

  it('names the symbols it capped, so the response can call itself partial', async () => {
    const svc = buildService(
      ['alpha', 'quiet'],
      [...callersOf('alpha', MAX_CALLERS_PER_SYMBOL + 1), ...callersOf('quiet', 2)],
    );

    const res = await svc.getBlastRadius('r1', ['changed.ts']);

    expect(res.cappedSymbols).toEqual(['alpha']);
  });

  it('reports nothing capped when every symbol fits', async () => {
    const svc = buildService(['alpha'], callersOf('alpha', 3));

    const res = await svc.getBlastRadius('r1', ['changed.ts']);

    expect(res.cappedSymbols).toBeUndefined();
    expect(res.callers).toHaveLength(3);
  });

  it('keeps rank order inside a capped group', async () => {
    // The cap must keep the HIGHEST-ranked callers, not an arbitrary 20.
    const svc = buildService(['alpha'], callersOf('alpha', MAX_CALLERS_PER_SYMBOL + 5));

    const res = await svc.getBlastRadius('r1', ['changed.ts']);

    const ranks = res.callers.map((c) => c.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(ranks[0]).toBe(MAX_CALLERS_PER_SYMBOL + 5);
  });

  it('still bounds the whole response, and says so', async () => {
    // Per-symbol alone is unbounded across a large pull request. The ceiling is
    // reported through the same channel, under a name no symbol can collide with.
    const many = Math.ceil(MAX_BLAST_CALLERS_TOTAL / MAX_CALLERS_PER_SYMBOL) + 2;
    const names = Array.from({ length: many }, (_, i) => `sym${i}`);
    const svc = buildService(
      names,
      names.flatMap((nm) => callersOf(nm, MAX_CALLERS_PER_SYMBOL)),
    );

    const res = await svc.getBlastRadius('r1', ['changed.ts']);

    expect(res.callers).toHaveLength(MAX_BLAST_CALLERS_TOTAL);
    expect(res.cappedSymbols).toContain('__total__');
  });
});
