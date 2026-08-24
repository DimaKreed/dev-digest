import { describe, it, expect } from 'vitest';
import { sep } from 'node:path';
import { DepCruiseGraph } from '../src/adapters/depgraph/index.js';

/**
 * A regression guard for the one line that silently emptied the whole import
 * graph on Windows.
 *
 * `toRel` promised "repo-relative POSIX" but returned whatever `path.relative`
 * gives, which is backslash-separated on win32 — while `walkClone` produces
 * forward slashes. Every `fileSet.has()` then missed, every edge was rejected,
 * and `buildEdges` returned `[]` without throwing. Nothing downstream could tell
 * that from a repo with no imports: `decl_file` resolution, `file_rank` and
 * blast radius all went quiet while the index reported `status: 'full'`.
 *
 * `buildEdges` is deliberately un-throwing, so a unit test cannot observe the
 * failure directly. What it CAN observe is the contract the bug violated: every
 * path this adapter emits is forward-slash separated, on every platform.
 */
describe('DepCruiseGraph path normalisation', () => {
  it('emits forward slashes for every edge endpoint', async () => {
    // This repository is its own fixture: `server/src` has real local imports,
    // and the paths handed in are repo-relative POSIX exactly as walkClone makes
    // them. Run from the repo root, two levels above this file.
    const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const files = [
      'server/src/modules/blast/service.ts',
      'server/src/modules/blast/helpers.ts',
      'server/src/modules/blast/ports.ts',
      'server/src/modules/blast/routes.ts',
    ];

    const edges = await new DepCruiseGraph().buildEdges(root, files);

    // service.ts imports both helpers.ts and ports.ts, so the graph is non-empty
    // whenever resolution AND separator normalisation both work. An empty result
    // here is the bug, not a repo with no imports.
    expect(edges.length).toBeGreaterThan(0);

    for (const edge of edges) {
      expect(edge.from).not.toContain('\\');
      expect(edge.to).not.toContain('\\');
    }
  });

  it('produces endpoints that match the paths it was given', async () => {
    // The membership check is the whole mechanism: an edge whose endpoint is not
    // in the input set is dropped, so a separator mismatch is indistinguishable
    // from "no imports". Asserting membership pins the shape both sides use.
    const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const files = [
      'server/src/modules/blast/service.ts',
      'server/src/modules/blast/helpers.ts',
      'server/src/modules/blast/ports.ts',
    ];
    const given = new Set(files);

    const edges = await new DepCruiseGraph().buildEdges(root, files);

    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(given.has(edge.from)).toBe(true);
      expect(given.has(edge.to)).toBe(true);
    }
  });

  it('returns [] for an empty input rather than cruising the world', async () => {
    expect(await new DepCruiseGraph().buildEdges('/anywhere', [])).toEqual([]);
  });

  it('documents the platform separator this test is guarding against', () => {
    // Informational: on win32 `sep` is a backslash, which is exactly why the
    // normalisation above is load-bearing rather than cosmetic.
    expect(['/', '\\']).toContain(sep);
  });
});
