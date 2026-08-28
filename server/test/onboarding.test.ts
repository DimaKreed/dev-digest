import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import {
  MockAuthProvider,
  MockGitClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import {
  buildSkeleton,
  mergeModelSections,
  parseManifest,
  verifyLinks,
} from '../src/modules/onboarding/helpers.js';
import { SECTION_KINDS } from '../src/modules/onboarding/constants.js';
import type {
  OnboardingRepositoryPort,
  RepoInfo,
  StoredTour,
} from '../src/modules/onboarding/ports.js';
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

/**
 * Onboarding — the pure kernel on its own, then the service branches through
 * the container seam. No Docker, no keys, no module mocking: every dependency
 * arrives as a port that `buildApp({ overrides })` swaps.
 */

const WORKSPACE = 'w1';
const REPO_ID = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// The pure kernel (W4)
// ---------------------------------------------------------------------------

describe('onboarding kernel', () => {
  it('parseManifest returns only what the manifest actually declares', () => {
    const facts = parseManifest(
      JSON.stringify({
        name: 'acme',
        dependencies: { fastify: '^5.0.0' },
        devDependencies: { vitest: '^2.0.0' },
        scripts: { dev: 'tsx watch src/server.ts', test: 'vitest' },
      }),
    );
    expect(facts.stack).toEqual(['fastify', 'vitest']);
    expect(facts.scripts).toEqual([
      { name: 'dev', command: 'tsx watch src/server.ts' },
      { name: 'test', command: 'vitest' },
    ]);
  });

  it('parseManifest invents nothing from an absent or unparseable manifest', () => {
    expect(parseManifest('')).toEqual({ stack: [], scripts: [] });
    expect(parseManifest('not json at all')).toEqual({ stack: [], scripts: [] });
    expect(parseManifest(JSON.stringify({ name: 'acme' }))).toEqual({ stack: [], scripts: [] });
  });

  it('buildSkeleton returns the five kinds in order even with no facts at all', () => {
    const sections = buildSkeleton({});
    expect(sections).toHaveLength(5);
    expect(sections.map((s) => s.kind)).toEqual([...SECTION_KINDS]);
  });

  it('mergeModelSections enriches a matching kind and drops one that matches nothing', () => {
    const merged = mergeModelSections(buildSkeleton({}), [
      { kind: 'overview', body: 'A payments API.', links: [{ label: 'entry', path: 'src/a.ts' }] },
      { kind: 'routes_and_apis', body: 'Should never appear.' },
    ]);
    expect(merged).toHaveLength(5);
    expect(merged.map((s) => s.kind)).toEqual([...SECTION_KINDS]);
    expect(merged[0]?.body).toBe('A payments API.');
    expect(merged[0]?.links).toEqual([{ label: 'entry', path: 'src/a.ts' }]);
  });

  it('verifyLinks drops every path outside the indexed set and counts the drops', () => {
    const sections = [
      {
        kind: 'overview',
        title: 'overview',
        body: '',
        diagram: null,
        links: [
          { label: 'a', path: 'src/a.ts' },
          { label: 'readme', path: 'README.md' },
          { label: 'b', path: 'src/b.ts' },
        ],
      },
      {
        kind: 'architecture',
        title: 'architecture',
        body: '',
        diagram: null,
        links: [
          { label: 'c', path: 'src/c.ts' },
          { label: 'ghost', path: 'src/never-existed.ts' },
        ],
      },
    ];
    const indexed = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    const result = verifyLinks(sections, indexed);
    expect(result.droppedLinks).toBe(2);
    expect(result.sections.flatMap((s) => s.links.map((l) => l.path))).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fakes for the container seam
// ---------------------------------------------------------------------------

const REPO: RepoInfo = {
  id: REPO_ID,
  owner: 'acme',
  name: 'payments-api',
  fullName: 'acme/payments-api',
  defaultBranch: 'main',
  clonePath: '/mock/clones/acme/payments-api',
};

/** In-memory tour store. One row per repo, last write wins — like the table. */
class FakeOnboardingRepo implements OnboardingRepositoryPort {
  public rows = new Map<string, StoredTour>();
  // `null`, not `undefined`: an explicit `undefined` argument re-triggers the
  // default, so a fake with no repo could not be expressed that way.
  constructor(private repo: RepoInfo | null = REPO) {}
  async getRepo(_workspaceId: string, repoId: string): Promise<RepoInfo | undefined> {
    return this.repo !== null && this.repo.id === repoId ? this.repo : undefined;
  }
  async featureModelsSetting(): Promise<unknown> {
    return undefined;
  }
  async get(_workspaceId: string, repoId: string): Promise<StoredTour | undefined> {
    return this.rows.get(repoId);
  }
  async upsert(_workspaceId: string, repoId: string, json: unknown): Promise<StoredTour> {
    const row = { json, generatedAt: new Date() };
    this.rows.set(repoId, row);
    return row;
  }
}

interface FakeIntelOptions {
  filesIndexed?: number;
  edgesWritten?: number;
  /** When set, the facade reports no persisted state at all. */
  noData?: boolean;
  indexedPaths?: string[];
  topFiles?: string[];
  /**
   * Precomputed per-file endpoint and cron facts for the files that reach
   * the reading path. Empty by default, so the other cases stay minimal.
   */
  impact?: {
    rows: Array<{ file: string; endpoints: string[]; crons: string[] }>;
    truncatedFrom: string[];
  };
}

class FakeRepoIntel implements RepoIntel {
  constructor(private opts: FakeIntelOptions = {}) {}
  async indexRepo(): Promise<IndexResult> {
    return {
      status: 'full',
      filesIndexed: this.opts.filesIndexed ?? 12,
      filesSkipped: 0,
      durationMs: 1,
    };
  }
  async refreshIndex(): Promise<IndexResult> {
    return this.indexRepo();
  }
  async getIndexState(repoId: string): Promise<IndexState> {
    if (this.opts.noData) {
      return {
        repoId,
        status: 'degraded',
        filesIndexed: 0,
        filesSkipped: 0,
        durationMs: 0,
        lastIndexedSha: '',
        indexerVersion: 1,
        updatedAt: new Date(0),
        degraded: true,
        degradedReason: 'no_data',
      };
    }
    return {
      ...(await this.indexRepo()),
      repoId,
      lastIndexedSha: 'a1b2c3d4',
      indexerVersion: 1,
      updatedAt: new Date(),
      edgesWritten: this.opts.edgesWritten ?? 40,
    };
  }
  async getBlastRadius(): Promise<BlastResult> {
    return { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true };
  }
  async getReverseImpact(): Promise<ReverseImpactResult> {
    const impact = this.opts.impact ?? { rows: [], truncatedFrom: [] };
    return {
      rows: impact.rows.map((r) => ({ ...r, depth: 1, originFiles: ['src/index.ts'] })),
      truncatedFrom: impact.truncatedFrom,
    };
  }
  async getSymbolMentions(): Promise<Map<string, number>> {
    return new Map();
  }
  async getRepoMap(): Promise<RepoMapResult> {
    return { text: 'src/\n  index.ts', tokens: 6, cached: true };
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
    return this.opts.topFiles ?? [];
  }
  async getTopFilesByRank(): Promise<string[]> {
    return this.opts.topFiles ?? ['src/index.ts'];
  }
  async getCriticalPaths(): Promise<string[][]> {
    return [];
  }
  async getIndexedPaths(): Promise<string[]> {
    return this.opts.indexedPaths ?? ['src/index.ts'];
  }
}

/**
 * A provider that always rejects, the way a real one does once its own retries
 * are exhausted. Hand-written rather than mocked: there is no module mocking in
 * this package and this change does not introduce the first.
 */
class AlwaysFailingLLM implements LLMProvider {
  readonly id = 'openai' as const;
  public structuredCalls = 0;
  async listModels() {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error('provider unavailable');
  }
  async completeStructured<T>(): Promise<StructuredResult<T>> {
    this.structuredCalls += 1;
    throw new Error('provider unavailable after retries');
  }
  async embed(): Promise<number[][]> {
    return [];
  }
}

const GENERATION = {
  sections: [
    {
      kind: 'overview',
      title: 'Model title that is never displayed',
      body: 'A payments API.',
      diagram: null,
      links: [
        { label: 'entry point', path: 'src/index.ts' },
        { label: 'the readme', path: 'README.md' },
      ],
    },
  ],
};

function makeApp(opts: {
  intel?: FakeRepoIntel;
  repo?: FakeOnboardingRepo;
  llm?: LLMProvider;
  secrets?: Record<string, string>;
  repoIntelEnabled?: boolean;
}) {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    REPO_INTEL_ENABLED: opts.repoIntelEnabled === false ? 'false' : 'true',
  } as NodeJS.ProcessEnv);
  const onboarding = opts.repo ?? new FakeOnboardingRepo();
  const llm =
    opts.llm ?? new MockLLMProvider('openai', { structuredBySchema: { OnboardingGeneration: GENERATION } });
  return {
    onboarding,
    llm,
    app: buildApp({
      config,
      overrides: {
        auth: new MockAuthProvider(
          { id: 'u1', email: 'you@local', name: 'You' },
          { id: WORKSPACE, name: 'default' },
        ),
        secrets: new MockSecretsProvider(opts.secrets ?? { OPENROUTER_API_KEY: 'sk-test' }),
        git: new MockGitClient({
          head: 'deadbeef',
          files: { 'package.json': JSON.stringify({ dependencies: { fastify: '^5' } }) },
        }),
        repoIntel: opts.intel ?? new FakeRepoIntel(),
        onboarding,
        // The registry default for `onboarding` is openrouter, so that is the
        // key the service resolves — not openai.
        llm: { openrouter: llm },
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// The service, through HTTP (W6, W7)
// ---------------------------------------------------------------------------

describe('onboarding routes (no DB)', () => {
  it('POST generate makes EXACTLY one model call and reports it as one', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { OnboardingGeneration: GENERATION },
    });
    const { app } = makeApp({ llm });
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(200);
    const structured = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structured).toHaveLength(1);
    const body = res.json();
    expect(body.usage.calls).toBe(1);
    expect(body.usage.tokens_in).toBe(100);
    expect(body.usage.tokens_out).toBe(50);
    expect(body.tour.sections).toHaveLength(5);
    expect(body.tour.sha).toBe('deadbeef');
    await server.close();
  });

  it('drops a cited path that is not in the indexed set and reports the count', async () => {
    const { app } = makeApp({});
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    const body = res.json();
    // README.md is a real file, but the indexer only holds source paths, so it
    // is not in the indexed set and the link drops. AC-06 makes that visible.
    expect(body.dropped_links).toBe(1);
    expect(body.tour.dropped_links).toBe(1);
    const overview = body.tour.sections.find((s: { kind: string }) => s.kind === 'overview');
    expect(overview.links.map((l: { path: string }) => l.path)).toEqual(['src/index.ts']);
    await server.close();
  });

  it('a failing provider still persists a five-section tour, flagged as model-free', async () => {
    const failing = new AlwaysFailingLLM();
    const { app, onboarding } = makeApp({ llm: failing });
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(200);
    expect(failing.structuredCalls).toBe(1);
    const body = res.json();
    expect(body.tour.generated_without_model).toBe(true);
    expect(body.tour.sections).toHaveLength(5);
    expect(onboarding.rows.get(REPO_ID)).toBeDefined();
    await server.close();
  });

  // AC-03 — endpoint and cron facts are PRECOMPUTED per file and reach the tour
  // through the reverse-impact walk seeded with the reading path. With that walk
  // returning nothing, every other case in this file passes whether or not the
  // service ever consults it. This one does not.
  it('carries precomputed endpoint and cron facts into the tour', async () => {
    const { app } = makeApp({
      intel: new FakeRepoIntel({
        impact: {
          rows: [
            {
              file: 'src/routes.ts',
              endpoints: ['GET /repos/:id/onboarding'],
              crons: ['nightly-reindex'],
            },
          ],
          truncatedFrom: [],
        },
      }),
    });
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(200);
    const sections = res.json().tour.sections as Array<{ kind: string; body: string }>;
    const keyModules = sections.find((s) => s.kind === 'key_modules');
    expect(keyModules?.body).toContain('GET /repos/:id/onboarding');
    expect(keyModules?.body).toContain('nightly-reindex');
    await server.close();
  });

  // The counterpart: a walk that hit its fan-out cap produces an empty list that
  // is NOT a measurement, so it must not be rendered as "there are none".
  it('reports a truncated impact walk as unmeasured rather than as no endpoints', async () => {
    const { app } = makeApp({
      intel: new FakeRepoIntel({ impact: { rows: [], truncatedFrom: ['src/index.ts'] } }),
    });
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    const sections = res.json().tour.sections as Array<{ kind: string; body: string }>;
    expect(sections.find((s) => s.kind === 'key_modules')?.body).toContain('not measured');
    await server.close();
  });

  it('hotness is reported as unavailable, because nothing computes it', async () => {
    const { app } = makeApp({});
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    expect(res.json().tour.hotness_available).toBe(false);
    await server.close();
  });

  it('refuses with 409 naming the resync route when files were indexed but no edges were written', async () => {
    const { app } = makeApp({ intel: new FakeRepoIntel({ filesIndexed: 548, edgesWritten: 0 }) });
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_not_indexed');
    expect(res.json().error.message).toContain('POST /repos/:id/resync');
    await server.close();
  });

  it('zero indexed files is NOT a refusal', async () => {
    const { app } = makeApp({
      intel: new FakeRepoIntel({ filesIndexed: 0, edgesWritten: 0, indexedPaths: [], topFiles: [] }),
    });
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tour.sections).toHaveLength(5);
    await server.close();
  });

  it('states the disabled flag as the reason, not an index failure', async () => {
    const { app } = makeApp({ repoIntelEnabled: false });
    const server = await app;
    const res = await server.inject({
      method: 'POST',
      url: `/repos/${REPO_ID}/onboarding/generate`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_intel_disabled');
    await server.close();
  });

  it('GET makes zero model calls and returns a null tour with a populated availability block', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { OnboardingGeneration: GENERATION },
    });
    const { app } = makeApp({ llm });
    const server = await app;
    const res = await server.inject({ method: 'GET', url: `/repos/${REPO_ID}/onboarding` });
    expect(res.statusCode).toBe(200);
    expect(llm.calls).toHaveLength(0);
    const body = res.json();
    expect(body.tour).toBeNull();
    expect(body.current_sha).toBe('deadbeef');
    expect(body.availability).toEqual({
      can_generate: true,
      reason: null,
      provider: 'openrouter',
    });
    await server.close();
  });

  it('GET says the key is missing when the resolved provider has none', async () => {
    const { app } = makeApp({ secrets: {} });
    const server = await app;
    const res = await server.inject({ method: 'GET', url: `/repos/${REPO_ID}/onboarding` });
    expect(res.json().availability).toEqual({
      can_generate: false,
      reason: 'missing_key',
      provider: 'openrouter',
    });
    await server.close();
  });

  it('rejects a malformed repository id with 422 before the handler runs', async () => {
    const { app } = makeApp({});
    const server = await app;
    const res = await server.inject({ method: 'GET', url: '/repos/not-a-uuid/onboarding' });
    expect(res.statusCode).toBe(422);
    await server.close();
  });

  it('returns 404 for a repo this workspace cannot see', async () => {
    const { app } = makeApp({ repo: new FakeOnboardingRepo(null) });
    const server = await app;
    const res = await server.inject({ method: 'GET', url: `/repos/${REPO_ID}/onboarding` });
    expect(res.statusCode).toBe(404);
    await server.close();
  });
});
