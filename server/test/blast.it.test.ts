import { describe, it, expect, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { BlastRadiusResponse, type CodeIndex } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * The blast-radius endpoint over real Postgres.
 *
 * Fixtures are inserted with Drizzle rather than produced by running the
 * indexer, on purpose: this suite is about the READ path, and hand-written rows
 * are what make "the request rebuilt nothing" a meaningful assertion rather
 * than a race against a background job.
 *
 * Named `*.it.test.ts` because it imports `test/helpers/pg.ts` — the CI lanes
 * split on that exact substring. No `vi.mock`: the DB is real and every other
 * seam arrives through `buildApp({ overrides })`.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const UNKNOWN_PR = '33333333-3333-4333-8333-333333333333';

/**
 * A CodeIndex whose every method rejects.
 *
 * The persistent blast path never touches it; the ripgrep fallback does. So a
 * 200 while this is installed proves the answer came from the index — a
 * stronger claim than counting rows, and it uses the container seam instead of
 * reaching into a private field.
 */
const EXPLODING_CODE_INDEX: CodeIndex = {
  grep: () => Promise.reject(new Error('codeIndex.grep must not be reached')),
  symbols: () => Promise.reject(new Error('codeIndex.symbols must not be reached')),
  references: () => Promise.reject(new Error('codeIndex.references must not be reached')),
};

let repoSeq = 0;

/**
 * The shape every test here leans on:
 *
 *   src/util.ts      declares helper()      <- the changed file
 *   src/service.ts   calls helper()         <- a direct caller
 *   src/routes.ts    imports service.ts     <- NOT a caller; owns the endpoint
 *
 * `routes.ts` is two edges from the change and is reachable only through the
 * reverse-import walk. Reference-based attribution alone cannot see it, which is
 * exactly what the walk exists to fix.
 */
async function setupIndexedRepo(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: { status?: string; endpoint?: string } = {},
) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const repoId = repo!.id;

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: 700 + repoSeq,
      title: 'Change the shared helper',
      author: 'marisa.koch',
      branch: 'feat/helper',
      base: 'main',
      headSha: 'cafebabe',
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();

  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/util.ts',
    additions: 4,
    deletions: 1,
  });

  await db.insert(t.symbols).values([
    {
      repoId,
      path: 'src/util.ts',
      name: 'helper',
      kind: 'function',
      line: 3,
      endLine: 9,
      exported: true,
    },
    {
      repoId,
      path: 'src/service.ts',
      name: 'doWork',
      kind: 'function',
      line: 1,
      endLine: 30,
      exported: true,
    },
    {
      repoId,
      path: 'src/routes.ts',
      name: 'register',
      kind: 'function',
      line: 1,
      endLine: 20,
      exported: true,
    },
  ]);

  // A RESOLVED reference: decl_file points at the changed file, which is what
  // makes service.ts a caller rather than an unproven candidate.
  await db.insert(t.references).values({
    repoId,
    fromPath: 'src/service.ts',
    toSymbol: 'helper',
    line: 12,
    declFile: 'src/util.ts',
  });

  // importer -> imported. routes.ts imports service.ts imports util.ts.
  await db.insert(t.fileEdges).values([
    { repoId, fromFile: 'src/routes.ts', toFile: 'src/service.ts' },
    { repoId, fromFile: 'src/service.ts', toFile: 'src/util.ts' },
  ]);

  // getResolvedCallers INNER JOINs file_rank, so a caller with no rank row is
  // invisible. Every file that must appear needs one.
  await db.insert(t.fileRank).values([
    { repoId, filePath: 'src/util.ts', pagerank: 0.5, hotness: 0, rank: 0.5, percentile: 99 },
    { repoId, filePath: 'src/service.ts', pagerank: 0.3, hotness: 0, rank: 0.3, percentile: 80 },
    { repoId, filePath: 'src/routes.ts', pagerank: 0.1, hotness: 0, rank: 0.1, percentile: 40 },
  ]);

  // Only routes.ts carries the endpoint — two hops from the change.
  await db.insert(t.fileFacts).values({
    repoId,
    filePath: 'src/routes.ts',
    endpoints: [opts.endpoint ?? 'GET /orders'],
    crons: ['job:reconcile'],
  });

  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: 'cafebabe',
    indexerVersion: 2,
    status: opts.status ?? 'full',
    filesIndexed: 3,
    filesSkipped: 0,
    stats: {},
  });

  return { repoId, prId: pr!.id };
}

d('blast radius endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;
  let repoId: string;
  let prNumber: number;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const fixture = await setupIndexedRepo(pg.handle.db, workspaceId);
    prId = fixture.prId;
    repoId = fixture.repoId;
    const [row] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, prId));
    prNumber = row!.number;
  }, 120_000);

  const app = (overrides = {}) => buildApp({ config: config(), db: pg.handle.db, overrides });

  it('returns 200 and a contract-valid response with state ok', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    expect(res.statusCode).toBe(200);

    // Contract conformance proved by parsing — the route declares no `response:`.
    const body = BlastRadiusResponse.parse(res.json());
    expect(body.state).toBe('ok');
    expect(body.reason).toBeNull();
    expect(body.changed_symbols.map((s) => s.name)).toContain('helper');
    await a.close();
  });

  it('finds the endpoint two import hops out, on a file that is not a caller', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    const body = BlastRadiusResponse.parse(res.json());

    const helper = body.downstream.find((node) => node.symbol === 'helper')!;
    // src/service.ts is the only caller...
    expect(helper.callers.map((c) => c.file)).toEqual(['src/service.ts']);
    // ...and routes.ts, which nothing references, is where the endpoint lives.
    expect(helper.endpoints_affected).toContain('GET /orders');
    expect(helper.crons_affected).toContain('job:reconcile');
    // Attributed to the caller itself, which is what the graph draws edges from.
    expect(helper.callers[0]!.endpoints_affected).toContain('GET /orders');
    await a.close();
  });

  it('serves the answer from the index — the ripgrep fallback is never entered', async () => {
    // Every CodeIndex method rejects. A 200 here can only have come from Postgres.
    const a = await app({ codeIndex: EXPLODING_CODE_INDEX });
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    expect(res.statusCode).toBe(200);
    expect(BlastRadiusResponse.parse(res.json()).state).toBe('ok');
    await a.close();
  });

  it('rebuilds nothing: no symbol, reference or edge row moves, and no job is queued', async () => {
    const db = pg.handle.db;
    const countSymbols = async () =>
      Number(
        (
          await db
            .select({ n: sql<number>`count(*)` })
            .from(t.symbols)
            .where(eq(t.symbols.repoId, repoId))
        )[0]!.n,
      );
    const countRefs = async () =>
      Number(
        (
          await db
            .select({ n: sql<number>`count(*)` })
            .from(t.references)
            .where(eq(t.references.repoId, repoId))
        )[0]!.n,
      );
    const countEdges = async () =>
      Number(
        (
          await db
            .select({ n: sql<number>`count(*)` })
            .from(t.fileEdges)
            .where(eq(t.fileEdges.repoId, repoId))
        )[0]!.n,
      );

    const before = {
      symbols: await countSymbols(),
      references: await countRefs(),
      edges: await countEdges(),
      jobs: (await db.select().from(t.jobs)).length,
    };
    const [stateBefore] = await db
      .select()
      .from(t.repoIndexState)
      .where(eq(t.repoIndexState.repoId, repoId));

    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    expect(res.statusCode).toBe(200);
    await a.close();

    expect(await countSymbols()).toBe(before.symbols);
    expect(await countRefs()).toBe(before.references);
    expect(await countEdges()).toBe(before.edges);
    // Any indexer pass touches this row; an unchanged timestamp means none ran.
    const [stateAfter] = await db
      .select()
      .from(t.repoIndexState)
      .where(eq(t.repoIndexState.repoId, repoId));
    expect(stateAfter!.updatedAt).toEqual(stateBefore!.updatedAt);
    // The indexer's only async entry point is a queued job.
    expect((await db.select().from(t.jobs)).length).toBe(before.jobs);
  });

  it('calls no model — the map itself is free', async () => {
    // The invariant most at risk now that this module DOES have an LLM path
    // (history notes). One accidental import would spend money on a page open,
    // and the counter is what makes that impossible to miss.
    const llm = new MockLLMProvider('openai', { structured: {} });
    const a = await app({ llm: { openai: llm, anthropic: llm, openrouter: llm } });
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    expect(res.statusCode).toBe(200);
    expect(llm.calls.length).toBe(0);
    await a.close();
  });

  it('labels a partial index as partial WITHOUT dropping what it found', async () => {
    const db = pg.handle.db;
    await db
      .update(t.repoIndexState)
      .set({ status: 'partial' })
      .where(eq(t.repoIndexState.repoId, repoId));

    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    const body = BlastRadiusResponse.parse(res.json());

    expect(body.state).toBe('partial');
    expect(body.reason).toBe('index_partial');
    // partial degrades the LABEL, not the data — the endpoint is still here.
    const helper = body.downstream.find((node) => node.symbol === 'helper')!;
    expect(helper.endpoints_affected).toContain('GET /orders');
    expect(body.summary).toContain('unknown, not absent');

    await a.close();
    await db
      .update(t.repoIndexState)
      .set({ status: 'full' })
      .where(eq(t.repoIndexState.repoId, repoId));
  });

  it('reports a missing index as degraded, and refuses to read that as no impact', async () => {
    // The executable form of "do not mask missing data with an empty array".
    const db = pg.handle.db;
    const bare = await setupIndexedRepo(db, workspaceId);
    await db.delete(t.repoIndexState).where(eq(t.repoIndexState.repoId, bare.repoId));

    const a = await app({ codeIndex: EXPLODING_CODE_INDEX });
    const res = await a.inject({ method: 'GET', url: `/pulls/${bare.prId}/blast` });
    expect(res.statusCode).toBe(200);

    const body = BlastRadiusResponse.parse(res.json());
    expect(body.state).toBe('degraded');
    expect(body.reason).toBe('no_data');
    expect(body.summary).toContain('not a statement that the change has no impact');
    await a.close();
  });

  it('lists a merged PR that touched the same file, with no note requested', async () => {
    const db = pg.handle.db;
    const [prior] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 401,
        title: 'Introduce the shared helper',
        author: 'deepak.r',
        branch: 'feat/introduce',
        base: 'main',
        headSha: 'f00d',
        status: 'merged',
      })
      .returning();
    await db.insert(t.prFiles).values({ prId: prior!.id, path: 'src/util.ts' });

    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    const body = BlastRadiusResponse.parse(res.json());

    const found = body.prior_prs.find((p) => p.pr_number === 401);
    expect(found).toBeDefined();
    expect(found!.files_overlap).toEqual(['src/util.ts']);
    // The map path reaches no model, so a note cannot exist yet.
    expect(found!.notes).toBe('');
    expect(body.notes_state).toBe('absent');

    await a.close();
    await db.delete(t.pullRequests).where(eq(t.pullRequests.id, prior!.id));
  });

  it('excludes an unmerged PR, and the PR under review itself, from the history', async () => {
    const db = pg.handle.db;
    const [open] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 402,
        title: 'Still open',
        author: 'x',
        branch: 'b',
        base: 'main',
        headSha: 'aa',
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({ prId: open!.id, path: 'src/util.ts' });

    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
    const body = BlastRadiusResponse.parse(res.json());

    const numbers = body.prior_prs.map((p) => p.pr_number);
    expect(numbers).not.toContain(402);
    expect(numbers).not.toContain(prNumber);

    await a.close();
    await db.delete(t.pullRequests).where(eq(t.pullRequests.id, open!.id));
  });

  it('returns 404 for a valid uuid that is not a PR', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${UNKNOWN_PR}/blast` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await a.close();
  });

  it('returns 404 for a PR in another workspace, leaking neither paths nor endpoints', async () => {
    const db = pg.handle.db;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'blast-tenant' }).returning();
    const foreign = await setupIndexedRepo(db, otherWs!.id, { endpoint: 'GET /secret-route' });
    await db
      .update(t.prFiles)
      .set({ path: 'src/secret.ts' })
      .where(eq(t.prFiles.prId, foreign.prId));

    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${foreign.prId}/blast` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');

    // Blast leaks more than a path list would: endpoints must not appear either.
    expect(res.body).not.toContain('src/secret.ts');
    expect(res.body).not.toContain('GET /secret-route');

    await a.close();
    await db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
  });
});
