/**
 * The hub guard on the reverse-import walk.
 *
 * Two hops over `file_edges` is enough to leave the change behind entirely. A
 * file that half the repository imports — `app.ts`, `schema.ts`, a barrel, the
 * DI root — is reached from almost any seed, so continuing outward from it
 * attributes ITS neighbours to the change. Measured on this repository: eleven
 * integration tests import `app.ts`, and a walk through it put 52 endpoints
 * those tests merely exercise onto one pull request.
 *
 * Hermetic: `svc.repo` is patched, as in `repo-intel-facade-degraded.test.ts`.
 * No Postgres, no clone, no Docker.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_HUB_FANIN } from '../src/modules/repo-intel/constants.js';

interface Edge {
  fromFile: string;
  toFile: string;
}

/** `file_facts` rows, keyed by path — only files that HAVE facts come back. */
type Facts = Record<string, { endpoints: string[]; crons: string[] }>;

function buildService(edges: Edge[], facts: Facts = {}): RepoIntelService {
  const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  let reverseQueries = 0;
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getReverseEdges: async (_repoId: string, files: string[]) => {
      reverseQueries += 1;
      return edges.filter((e) => files.includes(e.toFile));
    },
    getFileFacts: async (_repoId: string, files: string[]) =>
      files
        .filter((f) => facts[f])
        .map((f) => ({ filePath: f, endpoints: facts[f]!.endpoints, crons: facts[f]!.crons })),
  };
  (svc as unknown as { reverseQueries: () => number }).reverseQueries = () => reverseQueries;
  return svc;
}

/** `n` distinct importers of `file`, so its reverse fan-in is exactly `n`. */
function importers(file: string, n: number, prefix = 'imp'): Edge[] {
  return Array.from({ length: n }, (_, i) => ({ fromFile: `${prefix}${i}.ts`, toFile: file }));
}

describe('getReverseImpact — hub guard', () => {
  it('does not walk through a file more than MAX_HUB_FANIN files import', async () => {
    // service.ts is the seed. app.ts imports it, and app.ts is imported by
    // MAX_HUB_FANIN + 1 test files, each claiming an endpoint of its own.
    const hubImporters = importers('app.ts', MAX_HUB_FANIN + 1, 'spec');
    const svc = buildService(
      [{ fromFile: 'app.ts', toFile: 'service.ts' }, ...hubImporters],
      Object.fromEntries(
        hubImporters.map((e) => [e.fromFile, { endpoints: [`GET /${e.fromFile}`], crons: [] }]),
      ),
    );

    const res = await svc.getReverseImpact('r1', ['service.ts']);

    // app.ts itself was reached and keeps its place; nothing beyond it did.
    expect(res.rows.map((r) => r.file)).toEqual([]);
    expect(res.truncatedFrom).toEqual([]);
  });

  it('still walks through a file at exactly MAX_HUB_FANIN', async () => {
    // The boundary is `>`, not `>=`: a file imported by exactly the threshold is
    // still shared code, not yet a hub. Pinning it stops an off-by-one from
    // quietly changing which endpoints a repository reports.
    const hubImporters = importers('app.ts', MAX_HUB_FANIN, 'spec');
    const svc = buildService([{ fromFile: 'app.ts', toFile: 'service.ts' }, ...hubImporters], {
      'spec0.ts': { endpoints: ['GET /kept'], crons: [] },
    });

    const res = await svc.getReverseImpact('r1', ['service.ts']);

    expect(res.rows.map((r) => r.file)).toEqual(['spec0.ts']);
  });

  it('keeps a hub\'s OWN facts — only the step past it is refused', async () => {
    // app.ts declares GET /health and is a hub. The change genuinely reaches
    // app.ts, so /health is genuinely reachable; what is not informative is
    // everything app.ts in turn pulls in.
    const hubImporters = importers('app.ts', MAX_HUB_FANIN + 1, 'spec');
    const svc = buildService([{ fromFile: 'app.ts', toFile: 'service.ts' }, ...hubImporters], {
      'app.ts': { endpoints: ['GET /health'], crons: [] },
      'spec0.ts': { endpoints: ['GET /dropped'], crons: [] },
    });

    const res = await svc.getReverseImpact('r1', ['service.ts']);

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.file).toBe('app.ts');
    expect(res.rows[0]!.endpoints).toEqual(['GET /health']);
    expect(res.rows[0]!.originFiles).toEqual(['service.ts']);
  });

  it('exempts seeds — a caller the request asked about is expanded however wide', async () => {
    // The seed's own fan-out IS the answer. Applying the guard here would mean a
    // change to shared code reports no reverse impact at all, which is the exact
    // silence this feature exists to avoid.
    const svc = buildService(
      importers('shared.ts', MAX_HUB_FANIN + 1),
      Object.fromEntries(
        importers('shared.ts', MAX_HUB_FANIN + 1).map((e) => [
          e.fromFile,
          { endpoints: [`GET /${e.fromFile}`], crons: [] },
        ]),
      ),
    );

    const res = await svc.getReverseImpact('r1', ['shared.ts']);

    expect(res.rows).toHaveLength(MAX_HUB_FANIN + 1);
    for (const row of res.rows) expect(row.depth).toBe(1);
  });

  it('leaves an ordinary two-hop chain intact', async () => {
    // util → service → routes, nothing near the threshold. The whole point of
    // the walk, and the guard must not cost it.
    const svc = buildService(
      [
        { fromFile: 'service.ts', toFile: 'util.ts' },
        { fromFile: 'routes.ts', toFile: 'service.ts' },
      ],
      { 'routes.ts': { endpoints: ['GET /x'], crons: [] } },
    );

    const res = await svc.getReverseImpact('r1', ['util.ts']);

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.file).toBe('routes.ts');
    expect(res.rows[0]!.depth).toBe(2);
    expect(res.rows[0]!.originFiles).toEqual(['util.ts']);
  });

  it('costs no extra query — the fan-in is counted from the rows already fetched', async () => {
    // The guard needs each frontier member's reverse fan-in, and the reverse
    // query already returns one row per importer. Asking the database instead
    // would break the "exactly BFS_DEPTH queries" promise the walk is built on.
    const svc = buildService([
      { fromFile: 'service.ts', toFile: 'util.ts' },
      { fromFile: 'routes.ts', toFile: 'service.ts' },
    ]);

    await svc.getReverseImpact('r1', ['util.ts']);

    expect((svc as unknown as { reverseQueries: () => number }).reverseQueries()).toBe(2);
  });
});
