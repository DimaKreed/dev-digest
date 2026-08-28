import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { MockGitClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import type {
  BlastResult,
  FileRankRow,
  IndexResult,
  IndexState,
  RefRow,
  RepoIntel,
  RepoMapResult,
  ReverseImpactResult,
  SignatureRow,
  SymbolRow,
} from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[onboarding] Docker not available — skipping integration tests.');
}

/**
 * Onboarding module against a real Postgres.
 *
 * What only a database can prove: the tour survives a round trip through the
 * jsonb column, a second generation replaces the first rather than adding a
 * row, tenancy holds when the `onboarding` row itself carries no workspace,
 * and `getIndexedPaths` really is the distinct set of indexed paths.
 */

const INDEXED = ['src/index.ts', 'src/service.ts'];

const GENERATION = {
  sections: [
    {
      kind: 'overview',
      title: 'ignored',
      body: 'First body.',
      diagram: null,
      links: [
        { label: 'entry', path: 'src/index.ts' },
        { label: 'readme', path: 'README.md' },
      ],
    },
  ],
};

const SECOND_GENERATION = {
  sections: [
    { kind: 'overview', title: 'ignored', body: 'Second body.', diagram: null, links: [] },
  ],
};

class FakeRepoIntel implements RepoIntel {
  async indexRepo(): Promise<IndexResult> {
    return { status: 'full', filesIndexed: INDEXED.length, filesSkipped: 0, durationMs: 1 };
  }
  async refreshIndex(): Promise<IndexResult> {
    return this.indexRepo();
  }
  async getIndexState(repoId: string): Promise<IndexState> {
    return {
      ...(await this.indexRepo()),
      repoId,
      lastIndexedSha: 'a1b2c3d4',
      indexerVersion: 1,
      updatedAt: new Date(),
      edgesWritten: 7,
    };
  }
  async getBlastRadius(): Promise<BlastResult> {
    return { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true };
  }
  async getReverseImpact(): Promise<ReverseImpactResult> {
    return { rows: [], truncatedFrom: [] };
  }
  async getSymbolMentions(): Promise<Map<string, number>> {
    return new Map();
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: 'src/', tokens: 2, cached: true };
  }
  async getFileRank(): Promise<FileRankRow[]> {
    return [];
  }
  async getSymbolsInFiles(): Promise<SymbolRow[]> {
    return [];
  }
  async getCallerSignatures(): Promise<SignatureRow[]> {
    return [];
  }
  async getUnresolvedReferences(): Promise<RefRow[]> {
    return [];
  }
  async getConventionSamples(): Promise<string[]> {
    return INDEXED;
  }
  async getTopFilesByRank(): Promise<string[]> {
    return INDEXED;
  }
  async getCriticalPaths(): Promise<string[][]> {
    return [];
  }
  async getIndexedPaths(): Promise<string[]> {
    return INDEXED;
  }
}

d('onboarding module', () => {
  let pg: PgFixture;
  let repoId: string;
  let foreignRepoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId } = await seed(pg.handle.db);

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'onboarding-probe',
        fullName: 'acme/onboarding-probe',
      })
      .returning();
    repoId = repo!.id;

    // A second workspace with its own repo — the tour row carries no workspace
    // of its own, so this is the only way to prove the join is what scopes it.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'other',
        name: 'not-yours',
        fullName: 'other/not-yours',
      })
      .returning();
    foreignRepoId = foreign!.id;
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(structured: unknown = GENERATION) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      REPO_INTEL_ENABLED: 'true',
    } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({ OPENROUTER_API_KEY: 'sk-test' }),
        git: new MockGitClient({
          head: 'cafebabe',
          files: { 'package.json': JSON.stringify({ scripts: { dev: 'tsx watch' } }) },
        }),
        repoIntel: new FakeRepoIntel(),
        // The registry default for `onboarding` resolves to openrouter.
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { OnboardingGeneration: structured },
          }),
        },
      },
    });
  }

  it('generates, persists and reads back a five-section tour', async () => {
    const app = await makeApp();

    const gen = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/onboarding/generate`,
    });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().usage.calls).toBe(1);
    // README.md is not in the indexed set, so its link never reaches the row.
    expect(gen.json().dropped_links).toBe(1);

    const read = await app.inject({ method: 'GET', url: `/repos/${repoId}/onboarding` });
    expect(read.statusCode).toBe(200);
    const body = read.json();
    expect(body.tour.sections).toHaveLength(5);
    expect(body.tour.sha).toBe('cafebabe');
    expect(body.tour.dropped_links).toBe(1);
    expect(body.generated_at).not.toBeNull();
    expect(body.current_sha).toBe('cafebabe');
    expect(body.availability.can_generate).toBe(true);

    const overview = body.tour.sections.find((s: { kind: string }) => s.kind === 'overview');
    expect(overview.body).toBe('First body.');
    expect(overview.links.map((l: { path: string }) => l.path)).toEqual(['src/index.ts']);

    await app.close();
  }, 120_000);

  // AC-25 is written about two generations that COMPLETE CONCURRENTLY, so the
  // two requests are in flight at the same time rather than one after the other.
  // Both must succeed — the criterion says neither request fails — and exactly
  // one row must survive. `repo_id` is the primary key and the write is a single
  // `onConflictDoUpdate`, so the loser is overwritten rather than rejected.
  //
  // WHICH of the two survives is deliberately not asserted: that is a race, and
  // a test that pinned it would be asserting scheduling, not behaviour. What is
  // asserted is that the surviving document is ONE of the two whole documents —
  // never a blend of both.
  it('two concurrent generations leave one row and neither request fails', async () => {
    const first = await makeApp();
    const second = await makeApp(SECOND_GENERATION);

    const [a, b] = await Promise.all([
      first.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` }),
      second.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` }),
    ]);
    await first.close();
    await second.close();

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);

    const rows = await pg.handle.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    expect(rows).toHaveLength(1);
    const doc = rows[0]!.json as { sections: Array<{ kind: string; body: string }> };
    expect(['First body.', 'Second body.']).toContain(
      doc.sections.find((s) => s.kind === 'overview')?.body,
    );
  }, 120_000);

  // The sequential companion: with the ordering fixed, the LATER write is the
  // one that survives, and its timestamp advances.
  it('a later generation replaces an earlier one: one row, last write wins', async () => {
    const first = await makeApp();
    await first.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    const [before] = await pg.handle.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    await first.close();

    const second = await makeApp(SECOND_GENERATION);
    await second.inject({ method: 'POST', url: `/repos/${repoId}/onboarding/generate` });
    await second.close();

    const rows = await pg.handle.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    expect(rows).toHaveLength(1);
    const doc = rows[0]!.json as { sections: Array<{ kind: string; body: string }> };
    expect(doc.sections.find((s) => s.kind === 'overview')?.body).toBe('Second body.');
    expect(rows[0]!.generatedAt.getTime()).toBeGreaterThanOrEqual(before!.generatedAt.getTime());
  }, 120_000);

  it('a repo in another workspace is 404 on both the read and the write path', async () => {
    const app = await makeApp();
    const read = await app.inject({ method: 'GET', url: `/repos/${foreignRepoId}/onboarding` });
    expect(read.statusCode).toBe(404);
    const write = await app.inject({
      method: 'POST',
      url: `/repos/${foreignRepoId}/onboarding/generate`,
    });
    expect(write.statusCode).toBe(404);
    await app.close();
  }, 120_000);

  it('getIndexedPaths returns every distinct indexed path, and [] for an unknown repo', async () => {
    const repository = new RepoIntelRepository(pg.handle.db);
    await pg.handle.db.insert(t.symbols).values([
      { repoId, path: 'src/a.ts', name: 'one', kind: 'function', line: 1 },
      // Same path, second symbol — the read is DISTINCT over paths, not rows.
      { repoId, path: 'src/a.ts', name: 'two', kind: 'function', line: 9 },
      { repoId, path: 'src/b.ts', name: 'three', kind: 'class', line: 3 },
    ]);

    expect(await repository.getIndexedPaths(repoId)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(
      await repository.getIndexedPaths('99999999-9999-4999-8999-999999999999'),
    ).toEqual([]);
  }, 120_000);
});
