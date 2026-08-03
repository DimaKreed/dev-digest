import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type {
  BlastResult,
  FileRankRow,
  IndexResult,
  IndexState,
  RefRow,
  RepoIntel,
  RepoMapResult,
  SignatureRow,
  SymbolRow,
} from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * Conventions module — the code-only verification gate, end to end.
 *
 * The fixture below is a MODEL OUTPUT, so it lies the way models lie: one
 * honest rule, one citing files that do not exist, one quoting text that is not
 * in the files it names, and one whose two quotes both come from the same file.
 * Only the first may survive, and the stats must name each drop.
 */

// ---- the repository the mock git client serves ----------------------------

const USERS = [
  "import { getContext } from '../shared/context';", // 1
  '', // 2
  'export async function listUsers(req) {', // 3
  '  const { workspaceId } = await getContext(container, req);', // 4
  '  return repo.list(workspaceId);', // 5
  '}', // 6
].join('\n');

const ORDERS = [
  "import { getContext } from '../shared/context';", // 1
  '', // 2
  'export async function listOrders(req) {', // 3
  '  const { workspaceId } = await getContext(container, req);', // 4
  '  return repo.listOrders(workspaceId);', // 5
  '}', // 6
].join('\n');

const SAMPLES = ['src/api/users.ts', 'src/api/orders.ts'];

const FILES: Record<string, string> = {
  'src/api/users.ts': USERS,
  'src/api/orders.ts': ORDERS,
  'package.json': '{\n  "name": "payments-api"\n}',
};

const HONEST_RULE =
  'Route handlers resolve tenancy with getContext(container, req) before any other call.';

const EXTRACTION = {
  candidates: [
    {
      // Verifiable in BOTH files. Note start_line 99 — the server must ignore it.
      rule: HONEST_RULE,
      category: 'structure',
      rationale: 'Every handler opens with the same tenancy resolution.',
      confidence: 0.92,
      evidence: [
        {
          path: 'src/api/users.ts',
          snippet: 'const { workspaceId } = await getContext(container, req);',
          start_line: 99,
        },
        {
          path: 'src/api/orders.ts',
          snippet: '  const { workspaceId } = await getContext(container, req);',
          start_line: 1,
        },
      ],
    },
    {
      // Both paths are invented → 2 × dropped_no_file, then no distinct files.
      rule: 'Every module re-exports its public surface from an index barrel file.',
      category: 'imports',
      rationale: 'Cited from files that were never sampled.',
      confidence: 0.7,
      evidence: [
        { path: 'src/does-not-exist.ts', snippet: "export * from './thing';", start_line: 1 },
        { path: 'src/also-missing.ts', snippet: "export * from './other';", start_line: 2 },
      ],
    },
    {
      // Real files, invented quotes → 2 × dropped_no_snippet.
      rule: 'Services log a structured event before every outbound network call.',
      category: 'logging',
      rationale: 'The quotes are not in the files they name.',
      confidence: 0.6,
      evidence: [
        { path: 'src/api/users.ts', snippet: 'logger.info({ event: "outbound" });', start_line: 3 },
        { path: 'src/api/orders.ts', snippet: 'logger.info({ event: "outbound" });', start_line: 3 },
      ],
    },
    {
      // Both quotes verify, but in ONE file → dropped_single_occurrence.
      rule: 'Handlers return the repository result directly without an intermediate variable.',
      category: 'api-design',
      rationale: 'A pattern seen in a single file is a coincidence.',
      confidence: 0.55,
      evidence: [
        {
          path: 'src/api/users.ts',
          snippet: "import { getContext } from '../shared/context';",
          start_line: 1,
        },
        { path: 'src/api/users.ts', snippet: 'return repo.list(workspaceId);', start_line: 5 },
      ],
    },
  ],
};

/** Minimal RepoIntel stand-in — only the two reads this module makes matter. */
class FakeRepoIntel implements RepoIntel {
  constructor(private samples: string[]) {}
  async indexRepo(): Promise<IndexResult> {
    return { status: 'full', filesIndexed: this.samples.length, filesSkipped: 0, durationMs: 1 };
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
    };
  }
  async getBlastRadius(): Promise<BlastResult> {
    return { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true };
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: 'src/\n  api/\n    users.ts\n    orders.ts', tokens: 12, cached: true };
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
    return this.samples;
  }
  async getTopFilesByRank(): Promise<string[]> {
    return this.samples;
  }
  async getCriticalPaths(): Promise<string[][]> {
    return [];
  }
}

d('conventions module', () => {
  let pg: PgFixture;
  let repoId: string;
  let conventionId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId } = await seed(pg.handle.db);
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'conventions-probe',
        fullName: 'acme/conventions-probe',
      })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(samples: string[], llm?: MockLLMProvider) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: FILES }),
        repoIntel: new FakeRepoIntel(samples),
        // Keyed by the provider the service actually resolves: the registry
        // default for `conventions` is openrouter, not openai.
        llm: {
          openrouter:
            llm ??
            new MockLLMProvider('openrouter', {
              structuredBySchema: { ConventionExtraction: EXTRACTION },
            }),
        },
      },
    });
  }

  it('extract keeps only code-verified rules and reports every drop', async () => {
    const llm = new MockLLMProvider('openrouter', {
      structuredBySchema: { ConventionExtraction: EXTRACTION },
    });
    const app = await makeApp(SAMPLES, llm);
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The mock is driven through the per-schema fixture seam, which proves the
    // service asked for the 'ConventionExtraction' schema by name.
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    expect((call?.req as { schemaName?: string } | undefined)?.schemaName).toBe(
      'ConventionExtraction',
    );

    expect(body.candidates).toHaveLength(1);
    const c = body.candidates[0];
    conventionId = c.id;
    expect(c.rule).toBe(HONEST_RULE);
    expect(c.status).toBe('pending');
    expect(c.occurrences).toBe(2);
    expect(c.evidence_files).toEqual(SAMPLES);
    expect(c.evidence_path).toBe('src/api/users.ts');
    // start_line 99 was the model's claim; line 4 is where the snippet really is.
    expect(c.evidence_start_line).toBe(4);
    expect(c.evidence_end_line).toBe(4);

    expect(body.stats).toMatchObject({
      sampled_files: 2,
      config_files: ['package.json'],
      proposed: 4,
      verified: 1,
      dropped_no_file: 2,
      dropped_no_snippet: 2,
      dropped_single_occurrence: 3,
      // The registry default for `conventions` with no workspace override.
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      cost_usd: 0.001,
    });
    await app.close();
  });

  it('GET lists the persisted candidates with a scan timestamp', async () => {
    const app = await makeApp(SAMPLES);
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].id).toBe(conventionId);
    expect(typeof body.last_scan_at).toBe('string');
    // Stats belong to one scan and are not persisted.
    expect(body.stats).toBeNull();
    await app.close();
  });

  it('a second scan REPLACES the previous one rather than appending', async () => {
    const app = await makeApp(SAMPLES);
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().candidates).toHaveLength(1);

    const list = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(list.json().candidates).toHaveLength(1);
    conventionId = list.json().candidates[0].id;
    await app.close();
  });

  it('PATCH triages a candidate and rejects an unknown status', async () => {
    const app = await makeApp(SAMPLES);
    const bad = await app.inject({
      method: 'PATCH',
      url: `/conventions/${conventionId}`,
      payload: { status: 'maybe' },
    });
    expect(bad.statusCode).toBe(422);

    const ok = await app.inject({
      method: 'PATCH',
      url: `/conventions/${conventionId}`,
      payload: { status: 'accepted', category: 'api-design' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'accepted', category: 'api-design' });
    await app.close();
  });

  it('skill-draft renders one merged skill from the accepted candidates', async () => {
    const app = await makeApp(SAMPLES);
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill-draft`,
      payload: { convention_ids: [conventionId] },
    });
    expect(res.statusCode).toBe(200);
    const draft = res.json();
    expect(draft).toMatchObject({ name: 'conventions-probe-conventions', type: 'convention' });
    expect(draft.body).toContain(HONEST_RULE);
    expect(draft.body).toContain('`src/api/users.ts:4`');
    expect(draft.evidence_files).toEqual(SAMPLES);
    await app.close();
  });

  it('link-skill stamps a saved skill id on the candidates', async () => {
    const app = await makeApp(SAMPLES);
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'conventions-probe-conventions',
        type: 'convention',
        body: '# conventions-probe-conventions\n\nHouse rules.',
      },
    });
    expect(created.statusCode).toBe(201);
    const skillId = created.json().id as string;

    const linked = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/link-skill`,
      payload: { skill_id: skillId, convention_ids: [conventionId] },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toEqual({ linked: 1 });

    const list = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(list.json().candidates[0].skill_id).toBe(skillId);
    await app.close();
  });

  it('plugin exports the accepted conventions plus the merged skill', async () => {
    const app = await makeApp(SAMPLES);
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/plugin` });
    expect(res.statusCode).toBe(200);
    const bundle = res.json();
    expect(bundle.manifest).toMatchObject({
      format: 'devdigest-plugin/v1',
      name: 'conventions-probe-conventions',
      counts: { agents: 0, skills: 1, eval_cases: 0, conventions: 1 },
    });
    expect(bundle.conventions).toEqual([
      {
        rule: HONEST_RULE,
        evidence_path: 'src/api/users.ts',
        evidence_snippet: 'const { workspaceId } = await getContext(container, req);',
        confidence: 0.92,
        accepted: true,
      },
    ]);
    expect(bundle.skills[0]).toMatchObject({ source: 'extracted', type: 'convention' });
    await app.close();
  });

  it('an unindexed repo is a 409, not a crash', async () => {
    const app = await makeApp([]);
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_not_indexed');
    await app.close();
  });

  it('404s on a repo outside the workspace and 422s on a non-uuid id', async () => {
    const app = await makeApp(SAMPLES);
    const missing = await app.inject({
      method: 'GET',
      url: '/repos/00000000-0000-0000-0000-0000000000ff/conventions',
    });
    expect(missing.statusCode).toBe(404);

    const bad = await app.inject({ method: 'GET', url: '/repos/not-a-uuid/conventions' });
    expect(bad.statusCode).toBe(422);
    await app.close();
  });
});
