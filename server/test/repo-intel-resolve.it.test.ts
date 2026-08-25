/**
 * `resolveReferences` — the one hop through a re-export barrel.
 *
 * A single-hop rule cannot resolve `page.tsx` → `_components/Thing` when that
 * folder's `index.ts` only re-exports: the symbol is declared one file further
 * on, so there is no candidate at all and `decl_file` stays NULL — a caller the
 * blast radius then never finds.
 *
 * The barrel is identified from the data, not from its name: a file the indexer
 * sees declaring NOTHING cannot be where the symbol lives. These tests pin both
 * halves of that rule and, most importantly, that it does not start guessing.
 *
 * SQL, so this needs Postgres — hence `.it.test.ts` and the self-skip.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('resolveReferences: one hop through a re-export barrel', () => {
  let pg: PgFixture;
  let repoId: string;
  let repo: RepoIntelRepository;

  const HASH = 'h';

  /** A declared, exported symbol in `path`. */
  const sym = (path: string, name: string) => ({
    repoId,
    path,
    name,
    kind: 'function',
    line: 1,
    endLine: null,
    exported: true,
    signature: null,
    contentHash: HASH,
  });

  /** A use of `name` inside `from`. */
  const ref = (from: string, name: string) => ({
    repoId,
    fromPath: from,
    toSymbol: name,
    line: 9,
    contentHash: HASH,
  });

  const declOf = async (from: string, name: string): Promise<string | null> => {
    const [row] = await pg.handle.db
      .select({ declFile: t.references.declFile })
      .from(t.references)
      .where(
        and(
          eq(t.references.repoId, repoId),
          eq(t.references.fromPath, from),
          eq(t.references.toSymbol, name),
        ),
      );
    return row?.declFile ?? null;
  };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'barrels', fullName: 'acme/barrels' })
      .returning();
    repoId = r!.id;
    repo = new RepoIntelRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });
  beforeEach(async () => {
    // Each case builds its own tiny graph, so nothing leaks between them.
    await pg.handle.db.delete(t.references).where(eq(t.references.repoId, repoId));
    await pg.handle.db.delete(t.symbols).where(eq(t.symbols.repoId, repoId));
    await repo.replaceEdges(repoId, []);
  });

  it('resolves through a barrel that declares nothing', async () => {
    // page.tsx → index.ts (declares nothing) → Thing.tsx (declares Thing)
    await repo.insertSymbols([sym('Thing.tsx', 'Thing')]);
    await repo.insertReferences([ref('page.tsx', 'Thing')]);
    await repo.replaceEdges(repoId, [
      { fromFile: 'page.tsx', toFile: 'index.ts' },
      { fromFile: 'index.ts', toFile: 'Thing.tsx' },
    ]);

    await repo.resolveReferences(repoId, { reset: true });

    expect(await declOf('page.tsx', 'Thing')).toBe('Thing.tsx');
  });

  it('does not hop through a file that declares symbols of its own', async () => {
    // Same graph, except the middle file declares something. It is then a real
    // module rather than a barrel, and "page.tsx imports it" says nothing about
    // what it re-exports — so this must stay unresolved rather than reach past.
    await repo.insertSymbols([sym('Thing.tsx', 'Thing'), sym('middle.ts', 'somethingElse')]);
    await repo.insertReferences([ref('page.tsx', 'Thing')]);
    await repo.replaceEdges(repoId, [
      { fromFile: 'page.tsx', toFile: 'middle.ts' },
      { fromFile: 'middle.ts', toFile: 'Thing.tsx' },
    ]);

    await repo.resolveReferences(repoId, { reset: true });

    expect(await declOf('page.tsx', 'Thing')).toBeNull();
  });

  it('refuses to guess when two barrels reach two different declarations', async () => {
    // The whole point of the uniqueness rule, now applied across both branches.
    // Two candidates must leave NULL — the honest "unresolved", never the first
    // one that happened to sort first.
    await repo.insertSymbols([sym('a/Thing.tsx', 'Thing'), sym('b/Thing.tsx', 'Thing')]);
    await repo.insertReferences([ref('page.tsx', 'Thing')]);
    await repo.replaceEdges(repoId, [
      { fromFile: 'page.tsx', toFile: 'a/index.ts' },
      { fromFile: 'a/index.ts', toFile: 'a/Thing.tsx' },
      { fromFile: 'page.tsx', toFile: 'b/index.ts' },
      { fromFile: 'b/index.ts', toFile: 'b/Thing.tsx' },
    ]);

    await repo.resolveReferences(repoId, { reset: true });

    expect(await declOf('page.tsx', 'Thing')).toBeNull();
  });

  it('prefers the direct import when both branches find the same file', async () => {
    // `page.tsx` imports Thing.tsx directly AND through a barrel. Both branches
    // yield the same candidate, and UNION (not UNION ALL) is what keeps that
    // from counting as two and failing its own uniqueness test.
    await repo.insertSymbols([sym('Thing.tsx', 'Thing')]);
    await repo.insertReferences([ref('page.tsx', 'Thing')]);
    await repo.replaceEdges(repoId, [
      { fromFile: 'page.tsx', toFile: 'Thing.tsx' },
      { fromFile: 'page.tsx', toFile: 'index.ts' },
      { fromFile: 'index.ts', toFile: 'Thing.tsx' },
    ]);

    await repo.resolveReferences(repoId, { reset: true });

    expect(await declOf('page.tsx', 'Thing')).toBe('Thing.tsx');
  });

  it('does not hop twice — a barrel behind a barrel stays unresolved', async () => {
    // Exactly one extra step. Two would start walking the repository, and the
    // further the walk the less an "import path" says about a call site.
    await repo.insertSymbols([sym('Thing.tsx', 'Thing')]);
    await repo.insertReferences([ref('page.tsx', 'Thing')]);
    await repo.replaceEdges(repoId, [
      { fromFile: 'page.tsx', toFile: 'outer.ts' },
      { fromFile: 'outer.ts', toFile: 'inner.ts' },
      { fromFile: 'inner.ts', toFile: 'Thing.tsx' },
    ]);

    await repo.resolveReferences(repoId, { reset: true });

    expect(await declOf('page.tsx', 'Thing')).toBeNull();
  });

  it('still resolves a plain direct import with no barrel involved', async () => {
    await repo.insertSymbols([sym('util.ts', 'helper')]);
    await repo.insertReferences([ref('service.ts', 'helper')]);
    await repo.replaceEdges(repoId, [{ fromFile: 'service.ts', toFile: 'util.ts' }]);

    await repo.resolveReferences(repoId, { reset: true });

    expect(await declOf('service.ts', 'helper')).toBe('util.ts');
  });
});
