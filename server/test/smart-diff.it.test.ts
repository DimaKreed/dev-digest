import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { SmartDiffResponse } from '@devdigest/shared';
import * as t from '../src/db/schema.js';

/**
 * Spec-first integration tests for W5 of `.devdigest/cache/plans/smart-diff.md`:
 * the real endpoint over real Postgres. Named `*.it.test.ts` because it imports
 * `test/helpers/pg.ts` — the CI lanes split on that exact substring (W5.1).
 *
 * No `vi.mock` (W5.5): the DB is real and everything else arrives through
 * `buildApp({ config, db })`.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A review's agent. `reviews.agent_id` carries no FK, so a literal uuid is enough. */
const AGENT_A = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_PR = '22222222-2222-4222-8222-222222222222';

let repoSeq = 0;

async function setupPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + repoSeq,
      title: 'Smart diff fixture',
      author: 'marisa.koch',
      branch: 'feat/smart-diff',
      base: 'main',
      headSha: 'deadbeef',
      additions: 12,
      deletions: 2,
      filesCount: 3,
      status: 'needs_review',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('smart diff endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const db = pg.handle.db;
    const { pr } = await setupPr(db, workspaceId);
    prId = pr.id;

    // Three files spanning all three roles (W1.1 / W1.2 through the endpoint).
    await db.insert(t.prFiles).values([
      { prId, path: 'pnpm-lock.yaml', additions: 900, deletions: 30 },
      { prId, path: 'src/modules/index.ts', additions: 2, deletions: 0 },
      { prId, path: 'src/service.ts', additions: 10, deletions: 2 },
    ]);

    // Two reviews for the SAME agent: the older one is superseded (W3.1).
    const [older] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: AGENT_A,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'superseded run',
        score: 40,
        createdAt: new Date('2026-08-01T00:00:00Z'),
      })
      .returning();
    const [newer] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: AGENT_A,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'latest run',
        score: 50,
        createdAt: new Date('2026-08-02T00:00:00Z'),
      })
      .returning();

    await db.insert(t.findings).values([
      // Superseded review's finding — must NOT appear (W5.3).
      {
        reviewId: older!.id,
        file: 'src/service.ts',
        startLine: 42,
        endLine: 42,
        severity: 'WARNING',
        category: 'bug',
        title: 'stale finding from the superseded run',
        rationale: 'older run',
        confidence: 0.6,
      },
      // Live finding — must appear.
      {
        reviewId: newer!.id,
        file: 'src/service.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'live finding',
        rationale: 'newest run, not dismissed',
        confidence: 0.9,
      },
      // Dismissed finding — must NOT appear (W3.3 / W5.3).
      {
        reviewId: newer!.id,
        file: 'src/service.ts',
        startLine: 99,
        endLine: 99,
        severity: 'WARNING',
        category: 'style',
        title: 'dismissed finding',
        rationale: 'dismissed by the user',
        confidence: 0.5,
        dismissedAt: new Date('2026-08-03T00:00:00Z'),
      },
    ]);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  const app = () => buildApp({ config: config(), db: pg.handle.db });

  it('returns 200 and a contract-valid SmartDiff, core first, lock file in boilerplate (W2.1, W5.3)', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);

    // Contract conformance is proved by parsing the body (W2.1, the
    // test/contracts.test.ts idiom — no `response:` schema on the route).
    const body = SmartDiffResponse.parse(res.json());

    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(body.groups[0]!.role).toBe('core');

    const boilerplate = body.groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplate.files.map((f) => f.path)).toEqual(['pnpm-lock.yaml']);

    const core = body.groups.find((g) => g.role === 'core')!;
    expect(core.files.map((f) => f.path)).toContain('src/service.ts');

    const wiring = body.groups.find((g) => g.role === 'wiring')!;
    expect(wiring.files.map((f) => f.path)).toContain('src/modules/index.ts');

    await a.close();
  });

  it('annotates only the newest run\'s live finding lines (W5.3)', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    const body = SmartDiffResponse.parse(res.json());
    const service = body.groups
      .flatMap((g) => g.files)
      .find((f) => f.path === 'src/service.ts')!;

    expect(service.finding_lines).toContain(11); // live
    expect(service.finding_lines).not.toContain(99); // dismissed
    expect(service.finding_lines).not.toContain(42); // superseded run
    expect(service.pseudocode_summary).toBeNull(); // W1.6 end-to-end
    await a.close();
  });

  it('adds no agent_runs row — no model call in this path (W5.4)', async () => {
    const a = await app();
    const before = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const res = await a.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const after = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    expect(after.length).toBe(before.length);
    await a.close();
  });

  it('returns 404 for a valid uuid that is not a PR (W2.2)', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${UNKNOWN_PR}/smart-diff` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await a.close();
  });

  it('returns 404, not 200, for a PR in another workspace (W2.4)', async () => {
    const db = pg.handle.db;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();
    const { pr: foreignPr } = await setupPr(db, otherWs!.id);
    await db.insert(t.prFiles).values({
      prId: foreignPr.id,
      path: 'src/secret.ts',
      additions: 1,
      deletions: 0,
    });

    const a = await app();
    const res = await a.inject({ method: 'GET', url: `/pulls/${foreignPr.id}/smart-diff` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');

    // And nothing leaked: the foreign path never appears in a body.
    expect(res.body).not.toContain('src/secret.ts');

    await a.close();
    await db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
  });
});
