/**
 * SPEC-01 — Project context documents, end to end against a real Postgres.
 *
 * Spec-first: every assertion is derived from an acceptance criterion in
 * `specs/01-project-context-documents.md`. None of it is derived from an
 * implementation — the module does not exist yet, so this file is expected to
 * be red until it lands.
 *
 * Criteria asserted here: AC-01, AC-02, AC-03, AC-05, AC-09, AC-10, AC-14,
 * AC-15, AC-16, AC-18, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27,
 * AC-29, AC-31, AC-34, AC-37, AC-40.
 *
 * Seams: substituted at the container (`buildApp({ overrides })`) with the
 * fakes in `src/adapters/mocks.ts` plus two hand-written fakes below. No
 * `vi.mock` anywhere — that is banned in `server/`.
 *
 * Endpoint and field names follow the development plan; the criteria are what
 * the assertions are answerable to.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  CodeIndex,
  Embedder,
  Review,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[context] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const DOC_SPEC = 'specs/public-api.md';
const DOC_DOC = 'docs/architecture.md';
const DOC_INSIGHT = 'insights/perf.md';
const DOC_HUGE = 'docs/huge.md';
const DOC_GONE = 'docs/deleted-after-attach.md';

const SPEC_TEXT = '# Public API invariants\nEvery exported route must be versioned.';
const DOC_TEXT = '# Architecture\nAdapters own all I/O.';
const INSIGHT_TEXT = '# Perf\nNever de-duplicate model output by its text.';
/** Over the 400 KB per-file discovery limit AC-40 bounds. */
const HUGE_TEXT = `# Huge\n${'a'.repeat(420 * 1024)}\nEND-OF-HUGE`;

/** A fresh clone contents map per test group; mutated to simulate a resync. */
function cloneFiles(): Record<string, string> {
  return {
    [DOC_SPEC]: SPEC_TEXT,
    [DOC_DOC]: DOC_TEXT,
    [DOC_INSIGHT]: INSIGHT_TEXT,
    [DOC_HUGE]: HUGE_TEXT,
    'README.md': '# readme, outside every configured root',
  };
}

/** AC-18: every token figure comes from the server-side counter. Deterministic. */
const countingTokenizer = { count: (text: string) => text.length };

/**
 * AC-01: discovery consults NO code index. Every method rejects, so a 200 from
 * the listing endpoint proves the answer came from the clone.
 * (Same trick as `blast.it.test.ts`.)
 */
class RejectingCodeIndex implements CodeIndex {
  async grep(): Promise<never> {
    throw new Error('code index must not be consulted for document discovery');
  }
  async symbols(): Promise<never> {
    throw new Error('code index must not be consulted for document discovery');
  }
  async references(): Promise<never> {
    throw new Error('code index must not be consulted for document discovery');
  }
}

/**
 * AC-01: discovery consults NO embedding store either. `dims` is declared so the
 * fake satisfies the port; `embed` rejecting is the assertion.
 */
class RejectingEmbedder implements Embedder {
  readonly dims = 1536;
  async embed(): Promise<never> {
    throw new Error('embedding store must not be consulted for document discovery');
  }
}

/** AC-26: a provider that rejects the review call, as a context-window refusal does. */
class RejectingLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('context_length_exceeded: assembled prompt exceeds the context window');
  }
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error('context_length_exceeded: assembled prompt exceeds the context window');
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

/** AC-37: the finding cites the attached document's path, in existing fields only. */
const REVIEW_CITING_DOC: Review = {
  verdict: 'request_changes',
  summary: 'Violates the attached public API invariant.',
  score: 40,
  findings: [
    {
      id: 'f-doc',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: `Violates \`${DOC_SPEC}\`: secrets must never be committed.`,
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

const INTENT_FIXTURE = {
  intent: 'Adds rate limiting to the public API endpoints.',
  in_scope: ['rate limiting'],
  out_of_scope: [],
  confidence: 0.7,
  sources: [{ kind: 'pr_title', ref: '#482' }],
  missing_context: [],
};

let seq = 0;

d('SPEC-01 project context documents', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  }, 120_000);
  afterAll(async () => {
    await pg?.stop();
  }, 120_000);

  async function setupRepoAndPr() {
    const name = `payments-api-ctx-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: `/mock/clones/acme/${name}`,
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Add rate limiting. Closes #471.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  /** App for discovery/listing: no index, no embedder, a counting LLM spy. */
  async function listingApp(files: Record<string, string>) {
    const llm = new MockLLMProvider('openai', {});
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files }),
        github: new MockGitHubClient(),
        codeIndex: new RejectingCodeIndex(),
        embedder: new RejectingEmbedder(),
        tokenizer: countingTokenizer,
        llm: { openai: llm, openrouter: llm },
      },
    });
    return { app, llm };
  }

  /** App for a run: mock git + a review fixture, and the intent classifier stubbed. */
  function runApp(files: Record<string, string>, review: unknown, reviewProvider?: LLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF, files }),
        github: new MockGitHubClient(),
        tokenizer: countingTokenizer,
        llm: {
          openai: reviewProvider ?? new MockLLMProvider('openai', { structured: review }),
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { IntentClassification: INTENT_FIXTURE },
            structured: review,
          }),
        },
      },
    });
  }

  /**
   * AC-27: ONE provider instance registered as both the agent's provider and the
   * intent classifier's, so `calls` is the run's whole model-call ledger.
   */
  function countingRunApp(files: Record<string, string>, review: unknown) {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { IntentClassification: INTENT_FIXTURE },
      structured: review,
    });
    return {
      llm,
      app: buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          git: new MockGitClient({ diff: DIFF, files }),
          github: new MockGitHubClient(),
          embedder: new RejectingEmbedder(),
          tokenizer: countingTokenizer,
          llm: { openai: llm, openrouter: llm },
        },
      }),
    };
  }

  async function makeAgent(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'You are a reviewer.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function makeSkill(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name,
        description: 'A skill that carries its own documents.',
        type: 'convention',
        body: '# Skill\nBe strict.',
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  // ---------------- Discovery and listing ----------------

  it('AC-01 / AC-02 / AC-03 / AC-39 — lists every discovered document with name, directory and root-derived type, from the clone alone', async () => {
    const { app, llm } = await listingApp(cloneFiles());
    const { repo } = await setupRepoAndPr();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { path: string; dir: string; doc_type: string }[];

    const byPath = new Map(rows.map((r) => [r.path, r]));
    expect([...byPath.keys()].sort()).toEqual([DOC_DOC, DOC_HUGE, DOC_INSIGHT, DOC_SPEC].sort());
    // AC-02 + AC-41: the type is the matched root's own directory name,
    // verbatim — `specs`, not `spec`. The singular was the old closed-enum
    // mapping and was the deviation from the design.
    expect(byPath.get(DOC_SPEC)!.doc_type).toBe('specs');
    expect(byPath.get(DOC_DOC)!.doc_type).toBe('docs');
    expect(byPath.get(DOC_INSIGHT)!.doc_type).toBe('insights');
    // AC-41's distinctness clause, on the default roots.
    const badges = [DOC_SPEC, DOC_DOC, DOC_INSIGHT].map((p) => byPath.get(p)!.doc_type);
    expect(new Set(badges).size).toBe(3);
    // AC-03: the containing directory is carried per row.
    expect(byPath.get(DOC_SPEC)!.dir).toBe('specs');
    // AC-39: no clone-root entry, so a top-level README is not a context document.
    expect(byPath.has('README.md')).toBe(false);
    // AC-01: the code index AND the embedder reject every call, so a 200 here
    // proves the answer came from the clone — not from the index, the embedding
    // store or a stored copy. AC-27: no model call either.
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('AC-10 / AC-18 / AC-40 — rows carry server-counted tokens, no chunk count and no score, and an oversized document is listed but not attachable', async () => {
    const { app } = await listingApp(cloneFiles());
    const { repo } = await setupRepoAndPr();

    const rows = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as
      Record<string, unknown>[];
    const spec = rows.find((r) => r.path === DOC_SPEC)!;
    const huge = rows.find((r) => r.path === DOC_HUGE)!;

    // AC-18: the figure is the server tokenizer's answer, which the override
    // makes deterministic. The client counts nothing.
    expect(spec.tokens).toBe(SPEC_TEXT.length);
    // AC-10: no indexed-chunk count and no coverage score anywhere in the row.
    for (const row of rows) {
      for (const key of Object.keys(row)) expect(key).not.toMatch(/chunk|coverage|score/i);
    }
    // AC-40: still listed, marked not-attachable, and the reason comes from the server.
    expect(huge.attachable).toBe(false);
    expect(String(huge.not_attachable_reason ?? '')).not.toBe('');

    await app.close();
  });

  it('AC-05 — a selected document is readable as markdown, and an undiscovered path is not a file-read primitive', async () => {
    const { app } = await listingApp(cloneFiles());
    const { repo } = await setupRepoAndPr();

    const ok = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent(DOC_SPEC)}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(String((ok.json() as { content?: string }).content)).toContain(
      'Every exported route must be versioned.',
    );

    const denied = await app.inject({
      method: 'GET',
      url: `/repos/${repo.id}/context/file?path=${encodeURIComponent('../../etc/passwd')}`,
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(400);

    await app.close();
  });

  // ---------------- Search roots (the mechanism AC-07 needs) ----------------
  //
  // `GET /repos/:id/context/roots` serves no criterion of its own: it exists so
  // AC-07's "naming the configured search roots" is satisfiable on the client,
  // which otherwise had only a static literal of the shipped defaults. The three
  // cases below are AC-07 with the endpoint as the mechanism.

  it('AC-07 — the roots endpoint answers with the configured directories and their badges, and nothing else', async () => {
    const { app } = await listingApp(cloneFiles());
    const { repo } = await setupRepoAndPr();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/roots` });
    expect(res.statusCode).toBe(200);
    const roots = res.json() as Record<string, unknown>[];

    // This is the WIRE shape, which `context-roots.test.ts` (a `loadConfig`
    // test) cannot see: which directories were searched, and in what order.
    expect(roots).toEqual([{ dir: 'specs' }, { dir: 'docs' }, { dir: 'insights' }]);
    // AC-41: a root carries `dir` and nothing else. It used to ship a
    // `doc_type` equal to `dir`, and a contract sending the same value twice
    // across two `vendor/shared` copies is drift waiting to happen. The badge a
    // DOCUMENT displays still comes over the wire on `SpecFile.doc_type`,
    // because only the server knows which root matched that path.
    for (const r of roots) expect(Object.keys(r)).toEqual(['dir']);

    // AC-18 / AC-40 meeting in one place: the per-file size limit is a
    // server-side mark, so the threshold must not cross the wire. Assert on the
    // payload as a whole, not per key, so a nested carrier is caught too.
    const raw = res.body;
    for (const root of roots) {
      for (const key of Object.keys(root)) expect(key).not.toMatch(/size|limit|max|byte/i);
    }
    expect(raw).not.toMatch(/409600|400 ?\* ?1024|maxBytes/i);

    await app.close();
  });

  it('AC-07 — a repo in another workspace 404s from the roots endpoint', async () => {
    const { app } = await listingApp(cloneFiles());
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${seq++}` })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: other!.id,
        owner: 'someone-else',
        name: `private-${seq++}`,
        fullName: `someone-else/private-${seq}`,
        clonePath: '/mock/clones/someone-else/private',
      })
      .returning();

    const res = await app.inject({ method: 'GET', url: `/repos/${foreign!.id}/context/roots` });
    expect(res.statusCode).toBe(404);
    // Workspace scope, not clone state: the same repo is 404 for the listing too.
    expect(
      (await app.inject({ method: 'GET', url: `/repos/${foreign!.id}/context` })).statusCode,
    ).toBe(404);

    await app.close();
  });

  it('AC-07 — the roots read succeeds with NO clone, where every clone-dependent read 409s on the same repo', async () => {
    const { app } = await listingApp(cloneFiles());
    // A repo imported but not yet cloned: `repos.clone_path` is nullable.
    const [unclonedRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `not-cloned-${seq++}`,
        fullName: `acme/not-cloned-${seq}`,
        clonePath: null,
      })
      .returning();
    const uncloned = unclonedRepo!;
    const agent = await makeAgent(app, `No-clone ${seq}`);
    const skill = await makeSkill(app, `no-clone-skill-${seq}`);

    // The roots are CONFIGURATION, not clone state — this asymmetry is
    // deliberate and is what makes the empty state nameable on a repo that has
    // no clone to search. Do not "tidy" it into a shared clone check.
    const roots = await app.inject({ method: 'GET', url: `/repos/${uncloned.id}/context/roots` });
    expect(roots.statusCode).toBe(200);
    expect((roots.json() as { dir: string }[]).map((r) => r.dir)).toEqual([
      'specs',
      'docs',
      'insights',
    ]);

    // …and the reverse direction: nothing lost its clone check in the split.
    const list = await app.inject({ method: 'GET', url: `/repos/${uncloned.id}/context` });
    expect(list.statusCode).toBe(409);
    expect(list.json().error.code).toBe('repo_not_indexed');

    const preview = await app.inject({
      method: 'GET',
      url: `/repos/${uncloned.id}/context/file?path=${encodeURIComponent(DOC_SPEC)}`,
    });
    expect(preview.statusCode).toBe(409);
    expect(preview.json().error.code).toBe('repo_not_indexed');

    for (const url of [`/agents/${agent.id}/context`, `/skills/${skill.id}/context`]) {
      const put = await app.inject({
        method: 'PUT',
        url,
        payload: { repo_id: uncloned.id, paths: [DOC_SPEC] },
      });
      expect(put.statusCode).toBe(409);
      expect(put.json().error.code).toBe('repo_not_indexed');
    }

    await app.close();
  });

  it('AC-07 — CONFIGURED roots reach the wire: `adr,rfc` returns those two and the shipped defaults are gone', async () => {
    // The end-to-end guard for the defect `plan-verifier` caught: the empty
    // state must name what was ACTUALLY searched. Nothing else asserts the
    // configured value past `loadConfig`, so reverting the fix would otherwise
    // stay green on the wire.
    const configured = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DEVDIGEST_CONTEXT_ROOTS: 'adr,rfc',
    } as NodeJS.ProcessEnv);
    // The clone holds a document under `adr/` and NOTHING under `rfc/`, plus the
    // default-root files, which are now out of scope entirely.
    const files = { ...cloneFiles(), 'adr/0007-onion.md': '# ADR 7 - rings.' };
    const app = await buildApp({
      config: configured,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files }),
        github: new MockGitHubClient(),
        codeIndex: new RejectingCodeIndex(),
        embedder: new RejectingEmbedder(),
        tokenizer: countingTokenizer,
      },
    });
    const { repo } = await setupRepoAndPr();

    const roots = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/roots` })
    ).json() as { dir: string }[];

    expect(roots.map((r) => r.dir)).toEqual(['adr', 'rfc']);
    // The shipped defaults are not merged in — they are replaced.
    for (const gone of ['specs', 'docs', 'insights']) {
      expect(roots.map((r) => r.dir)).not.toContain(gone);
    }
    // AC-41 — this case used to pin the fallback collapse (`adr` and `rfc` both
    // badging `doc`) with a comment saying the collapse was reported, not
    // endorsed. That is now fixed, and the roots response no longer carries a
    // badge at all: the distinctness AC-41 requires is asserted on the
    // DOCUMENTS below, which is where a user actually reads a type.
    expect(roots).toEqual([{ dir: 'adr' }, { dir: 'rfc' }]);

    // The listing follows the same configuration: only the `adr/` document, and
    // none of the default-root files that are still sitting in the clone.
    const listed = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as
      { path: string; doc_type: string; dir: string }[];
    expect(listed.map((f) => f.path)).toEqual(['adr/0007-onion.md']);
    // AC-41: a document under a non-default root displays that root's name.
    expect(listed[0]!.doc_type).toBe('adr');
    expect(listed[0]!.dir).toBe('adr');
    expect(listed.some((f) => f.path === DOC_SPEC)).toBe(false);

    // Third asymmetry, one level down from the no-clone case: `rfc` exists in the
    // CONFIGURATION and not in the clone, so it is still named as searched while
    // contributing no document.
    expect(roots.map((r) => r.dir)).toContain('rfc');
    expect(listed.some((f) => f.path.startsWith('rfc/'))).toBe(false);

    await app.close();
  });

  it('AC-42 / AC-42.1 — a document in a package\'s own `specs/` is discovered, and its type is the directory NAME, not its path', async () => {
    // The defect AC-42 was written for: in this repository every package keeps
    // its own `specs/` and `docs/`, so a top-level-rooted walk found almost
    // nothing. `dir` and the badge are DIFFERENT strings here on purpose — a
    // top-level fixture would let a path-valued badge pass unnoticed.
    const { app } = await listingApp({
      'server/specs/README.md': '# Server spec',
      'client/docs/adr/0007.md': '# ADR 7',
      'README.md': '# not under any configured root',
    });
    const { repo } = await setupRepoAndPr();

    const rows = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as
      { path: string; dir: string; doc_type: string }[];
    const byPath = new Map(rows.map((r) => [r.path, r]));

    // AC-42 — found at depth, with only the bare names configured.
    expect(byPath.has('server/specs/README.md')).toBe(true);
    expect(byPath.has('client/docs/adr/0007.md')).toBe(true);
    // Non-vacuity: a top-level-only walk would have returned NOTHING from this
    // clone, so the count itself is the assertion.
    expect(rows.length).toBe(2);

    // AC-42.1 — the type is the matched directory's own name. `server/specs`
    // and `client/docs` are what `dir` carries; the badge must not be either.
    expect(byPath.get('server/specs/README.md')!.doc_type).toBe('specs');
    expect(byPath.get('server/specs/README.md')!.dir).toBe('server/specs');
    expect(byPath.get('client/docs/adr/0007.md')!.doc_type).toBe('docs');
    expect(byPath.get('client/docs/adr/0007.md')!.dir).toBe('client/docs/adr');
    for (const row of rows) expect(row.doc_type).not.toContain('/');

    // A file under no matching directory is still not a context document.
    expect(byPath.has('README.md')).toBe(false);

    await app.close();
  });

  it('AC-42.2 — a document beneath two matching directories belongs to the NEAREST one', async () => {
    // `docs` is configured FIRST here, so first-root-wins would badge
    // `docs/specs/x.md` as `docs`. Nearest-ancestor-wins says `specs`. This is
    // the only fixture where the two rules disagree, which is why the root
    // order is reversed rather than left at the default.
    const configured = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DEVDIGEST_CONTEXT_ROOTS: 'docs,specs',
    } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config: configured,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({
          files: { 'docs/specs/x.md': '# Nested under docs', 'docs/plain.md': '# A plain doc' },
        }),
        github: new MockGitHubClient(),
        codeIndex: new RejectingCodeIndex(),
        embedder: new RejectingEmbedder(),
        tokenizer: countingTokenizer,
      },
    });
    const { repo } = await setupRepoAndPr();

    const rows = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as
      { path: string; doc_type: string }[];
    const byPath = new Map(rows.map((r) => [r.path, r.doc_type]));

    expect(byPath.get('docs/specs/x.md')).toBe('specs');
    // …and the sibling directly under `docs` is unaffected.
    expect(byPath.get('docs/plain.md')).toBe('docs');
    // Read once, listed once: reachable from two roots is still one document.
    expect(rows.filter((r) => r.path === 'docs/specs/x.md')).toHaveLength(1);

    await app.close();
  });

  it('AC-42.4 — the agent-workflow cache is not project context, while `.devdigest/specs` is, badged `specs`', async () => {
    // End-to-end companion to the adapter case: this one proves the exclusion
    // and AC-42's name matching COMPOSE — the surviving path is not merely
    // present, it arrives badged by the directory that matched it.
    const { app } = await listingApp({
      '.devdigest/cache/plans/project-context.md': '# This workflow\'s own briefing',
      '.devdigest/cache/runs/ledger.md': '# Run ledger',
      '.devdigest/specs/prd.md': '# A PRD the user was told to put here',
    });
    const { repo } = await setupRepoAndPr();

    const rows = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as
      { path: string; doc_type: string; dir: string }[];
    const byPath = new Map(rows.map((r) => [r.path, r]));

    // Offering the workflow its own plan as the repository's context is
    // incoherent, so the cache subtree contributes nothing.
    expect(rows.some((r) => r.path.startsWith('.devdigest/cache/'))).toBe(false);

    // …and the sibling the product deliberately kept is discoverable with no
    // configuration at all, typed by the directory that matched it (AC-42.1).
    expect(byPath.has('.devdigest/specs/prd.md')).toBe(true);
    expect(byPath.get('.devdigest/specs/prd.md')!.doc_type).toBe('specs');
    expect(byPath.get('.devdigest/specs/prd.md')!.dir).toBe('.devdigest/specs');
    // Non-vacuity: exactly one of the three files survives, so an over-broad
    // `.devdigest` exclusion would show up here as an empty list.
    expect(rows).toHaveLength(1);

    await app.close();
  });

  // ---------------- Attaching ----------------

  it('AC-14 / AC-15 / AC-16 — one request persists the whole ordered set, keyed by agent+repo+path, storing paths and positions only', async () => {
    const { app } = await listingApp(cloneFiles());
    const { repo } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Ordered ${seq}`);

    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_SPEC, DOC_DOC, DOC_INSIGHT] },
    });
    expect(put.statusCode).toBe(200);

    const read = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context?repo_id=${repo.id}` })
    ).json() as { path: string }[];
    expect(read.map((r) => r.path)).toEqual([DOC_SPEC, DOC_DOC, DOC_INSIGHT]);

    // AC-16: a reordered set replaces the old order wholesale (last write wins).
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_INSIGHT, DOC_SPEC] },
    });
    const reordered = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/context?repo_id=${repo.id}` })
    ).json() as { path: string }[];
    expect(reordered.map((r) => r.path)).toEqual([DOC_INSIGHT, DOC_SPEC]);

    // AC-15: identity is (agent, repo, path) + position; no document text is stored.
    const rows = await pg.handle.db
      .select()
      .from(t.agentContextFiles)
      .where(
        and(
          eq(t.agentContextFiles.agentId, agent.id),
          eq(t.agentContextFiles.repoId, repo.id),
        ),
      );
    expect(rows.map((r) => r.path).sort()).toEqual([DOC_INSIGHT, DOC_SPEC].sort());
    expect(new Set(rows.map((r) => r.order)).size).toBe(rows.length);
    for (const row of rows) {
      for (const key of Object.keys(row)) expect(key).not.toMatch(/content|text|body/i);
      for (const value of Object.values(row)) expect(value).not.toBe(SPEC_TEXT);
    }

    await app.close();
  });

  it('AC-09 — the listing reports how many agents currently attach each document', async () => {
    const { app } = await listingApp(cloneFiles());
    const { repo } = await setupRepoAndPr();
    const a1 = await makeAgent(app, `Counter A ${seq}`);
    const a2 = await makeAgent(app, `Counter B ${seq}`);

    for (const agent of [a1, a2]) {
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context`,
        payload: { repo_id: repo.id, paths: [DOC_SPEC] },
      });
    }

    const rows = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as
      { path: string; used_by: number }[];
    expect(rows.find((r) => r.path === DOC_SPEC)!.used_by).toBe(2);
    expect(rows.find((r) => r.path === DOC_DOC)!.used_by).toBe(0);

    await app.close();
  });

  it('W6 done-when (`mustOwnParent`) — an agent or skill in ANOTHER workspace 404s on read and on write, and nothing is persisted', async () => {
    const { app } = await listingApp(cloneFiles());
    const { repo } = await setupRepoAndPr();

    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `foreign-parent-ws-${seq++}` })
      .returning();
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: other!.id,
        name: `Foreign agent ${seq}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'not yours',
      })
      .returning();
    const [foreignSkill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: other!.id,
        name: `foreign-skill-${seq}`,
        description: 'not yours',
        type: 'convention',
        source: 'manual',
        body: '# Foreign',
      })
      .returning();

    const cases = [
      { url: `/agents/${foreignAgent!.id}/context`, id: foreignAgent!.id, table: 'agent' as const },
      { url: `/skills/${foreignSkill!.id}/context`, id: foreignSkill!.id, table: 'skill' as const },
    ];

    for (const c of cases) {
      // Deliberately 404, NOT 403: a parent in another workspace does not exist
      // as far as this workspace is concerned, so the status must not confirm
      // that the id is real.
      const read = await app.inject({ method: 'GET', url: `${c.url}?repo_id=${repo.id}` });
      expect(read.statusCode).toBe(404);

      const write = await app.inject({
        method: 'PUT',
        url: c.url,
        payload: { repo_id: repo.id, paths: [DOC_SPEC] },
      });
      expect(write.statusCode).toBe(404);
    }

    // The refused write left no row behind — a 404 that still persisted would be
    // a cross-workspace write with a reassuring status code.
    const agentRows = await pg.handle.db
      .select()
      .from(t.agentContextFiles)
      .where(eq(t.agentContextFiles.agentId, foreignAgent!.id));
    expect(agentRows).toEqual([]);
    const skillRows = await pg.handle.db
      .select()
      .from(t.skillContextFiles)
      .where(eq(t.skillContextFiles.skillId, foreignSkill!.id));
    expect(skillRows).toEqual([]);

    await app.close();
  });

  // ---------------- Reading and injection at run time ----------------

  it('AC-20 / AC-21 / AC-22 / AC-31 / AC-34 — the agent and its linked skill documents are read fresh, deduplicated, injected in order and named in the trace', async () => {
    const files = cloneFiles();
    const app = await runApp(files, REVIEW_CITING_DOC);
    const { pr, repo } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Injector ${seq}`);
    const skill = await makeSkill(app, `doc-carrying-skill-${seq}`);

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_SPEC, DOC_DOC] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_DOC, DOC_INSIGHT] },
    });

    // AC-20: the clone changes after the attachment is saved; the run must read
    // the file as it is at run time, never text captured when it was attached.
    files[DOC_SPEC] = `${SPEC_TEXT}\nRESYNCED-LINE`;

    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const user = trace.prompt_assembly.user as string;

    // AC-20: fresh bytes.
    expect(trace.prompt_assembly.specs).toContain('RESYNCED-LINE');
    // AC-22: one untrusted block per document inside `## Project context`.
    expect(user).toContain('## Project context');
    expect((trace.prompt_assembly.specs.match(/<untrusted source="spec-\d+">/g) ?? []).length).toBe(3);
    // AC-21: agent set first in its persisted order, then the skill's; the
    // duplicated path is read once, injected once and listed once.
    expect(trace.specs_read).toEqual([DOC_SPEC, DOC_DOC, DOC_INSIGHT]);
    const injected = trace.prompt_assembly.specs as string;
    expect(injected.indexOf(SPEC_TEXT.slice(0, 20))).toBeLessThan(injected.indexOf(DOC_TEXT));
    expect(injected.indexOf(DOC_TEXT)).toBeLessThan(injected.indexOf(INSIGHT_TEXT));
    expect(injected.split(DOC_TEXT)).toHaveLength(2);

    // AC-31: every document read, with its token size (the counting tokenizer
    // makes the expected number exact).
    const docs = trace.context_docs as { path: string; tokens: number }[];
    expect(docs.map((doc) => doc.path)).toEqual([DOC_SPEC, DOC_DOC, DOC_INSIGHT]);
    expect(docs.find((doc) => doc.path === DOC_DOC)!.tokens).toBe(DOC_TEXT.length);

    // AC-34: the run log states how many were read and how many skipped.
    const log = (trace.log as { msg: string }[]).map((l) => l.msg).join('\n');
    expect(log).toMatch(/context: 3 read, 0 skipped/);

    await app.close();
  });

  it('AC-23 — an agent with no attachments assembles a prompt with no `## Project context` section at all', async () => {
    const app = await runApp(cloneFiles(), REVIEW_CITING_DOC);
    const { pr } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Bare ${seq}`);

    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');
    expect(trace.specs_read).toEqual([]);

    await app.close();
  });

  it('AC-24 — a document deleted from the clone is skipped with its reason, and the run still completes', async () => {
    const files = cloneFiles();
    const app = await runApp(files, REVIEW_CITING_DOC);
    const { pr, repo } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Skipper ${seq}`);

    // Attach a path that exists at attach time, then remove it from the clone.
    files[DOC_GONE] = '# Temporary\nAttached, then deleted.';
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_SPEC, DOC_GONE] },
    });
    delete files[DOC_GONE];

    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs[0]!.status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    // Not dropped silently: named, with a reason.
    const skipped = trace.context_skipped as { path: string; reason: string }[];
    expect(skipped.map((s) => s.path)).toEqual([DOC_GONE]);
    expect(skipped[0]!.reason).toBe('missing');
    // The surviving document was still injected.
    expect(trace.specs_read).toEqual([DOC_SPEC]);
    expect((trace.log as { msg: string }[]).map((l) => l.msg).join('\n')).toMatch(
      /context: 1 read, 1 skipped/,
    );

    await app.close();
  });

  it('AC-25 / AC-40 — a document already attached before it grew past the discovery limit is still injected verbatim', async () => {
    const files = cloneFiles();
    const app = await runApp(files, REVIEW_CITING_DOC);
    const { pr, repo } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Verbatim ${seq}`);

    // Attached directly: AC-40 makes it not-attachable through the API, and the
    // criterion's own boundary says such a row is still injected in full.
    await pg.handle.db
      .insert(t.agentContextFiles)
      .values({ agentId: agent.id, repoId: repo.id, path: DOC_HUGE, order: 0 });

    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const injected = trace.prompt_assembly.specs as string;
    // No cap, no truncation: the tail of a 420 KB document is present.
    expect(injected).toContain('END-OF-HUGE');
    expect(injected.length).toBeGreaterThan(HUGE_TEXT.length);

    await app.close();
  });

  it('AC-26 — when the provider rejects the call, the run fails and its trace still carries the documents read and their sizes', async () => {
    const app = await runApp(cloneFiles(), REVIEW_CITING_DOC, new RejectingLLMProvider());
    const { pr, repo } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Overflow ${seq}`);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_SPEC] },
    });

    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs[0]!.status).toBe('failed');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    const docs = trace.context_docs as { path: string; tokens: number }[];
    expect(docs).toEqual([{ path: DOC_SPEC, tokens: SPEC_TEXT.length }]);

    await app.close();
  });

  it('AC-37 — a finding judged against an attached invariant cites that document path, in the existing vocabulary and with no new field', async () => {
    const app = await runApp(cloneFiles(), REVIEW_CITING_DOC);
    const { pr, repo } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Citer ${seq}`);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_SPEC] },
    });

    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // The criterion is "the agent reviews the PR *with the document attached*",
    // so the injection is part of the assertion — otherwise a fixture citing a
    // path passes with nothing attached at all.
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([DOC_SPEC]);
    expect(String(trace.prompt_assembly.specs)).toContain(
      'Every exported route must be versioned.',
    );

    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    expect(review.findings).toHaveLength(1);

    const finding = review.findings[0] as Record<string, unknown>;
    // The path survives into the persisted finding's own text.
    expect(String(finding.rationale)).toContain(DOC_SPEC);
    // Existing vocabulary only…
    expect(['CRITICAL', 'WARNING', 'SUGGESTION']).toContain(finding.severity);
    expect(['request_changes', 'approve', 'comment']).toContain(review.verdict);
    // …and no new finding field carries the citation.
    for (const key of Object.keys(finding)) {
      expect(key).not.toMatch(/document|context|attach/i);
    }

    await app.close();
  });

  it('AC-20 — a DISABLED linked skill contributes no document, while the agent\'s own set still does', async () => {
    const app = await runApp(cloneFiles(), REVIEW_CITING_DOC);
    const { pr, repo } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Disabled-skill ${seq}`);
    const skill = await makeSkill(app, `disabled-doc-skill-${seq}`);

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_INSIGHT] },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_SPEC] },
    });

    // Globally disabling the skill must take its documents with it: AC-20 reads
    // only the ENABLED linked skills.
    const disabled = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().enabled).toBe(false);

    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([DOC_SPEC]);
    expect(String(trace.prompt_assembly.specs)).not.toContain(INSIGHT_TEXT);
    // Not a skip either — a disabled skill's document was never resolved at all.
    expect(trace.context_skipped ?? []).toEqual([]);

    await app.close();
  });

  it('AC-27 — resolving and injecting documents adds no model call, no embedding pass and no chunking', async () => {
    // Baseline: a run with no attachments.
    const bare = countingRunApp(cloneFiles(), REVIEW_CITING_DOC);
    const bareApp = await bare.app;
    const first = await setupRepoAndPr();
    const bareAgent = await makeAgent(bareApp, `Ledger-bare ${seq}`);
    await bareApp.inject({
      method: 'POST',
      url: `/pulls/${first.pr.id}/review`,
      payload: { agentId: bareAgent.id },
    });
    await waitForPrRuns(pg.handle.db, first.pr.id, { expected: 1 });
    const baseline = bare.llm.calls.length;
    await bareApp.close();

    // Same run with three documents attached.
    const withDocs = countingRunApp(cloneFiles(), REVIEW_CITING_DOC);
    const docsApp = await withDocs.app;
    const second = await setupRepoAndPr();
    const docsAgent = await makeAgent(docsApp, `Ledger-docs ${seq}`);
    await docsApp.inject({
      method: 'PUT',
      url: `/agents/${docsAgent.id}/context`,
      payload: { repo_id: second.repo.id, paths: [DOC_SPEC, DOC_DOC, DOC_INSIGHT] },
    });
    const posted = await docsApp.inject({
      method: 'POST',
      url: `/pulls/${second.pr.id}/review`,
      payload: { agentId: docsAgent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, second.pr.id, { expected: 1 });

    // The documents really were injected…
    const trace = (await docsApp.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([DOC_SPEC, DOC_DOC, DOC_INSIGHT]);

    // …and the model-call ledger is unchanged: exactly the intent classification
    // plus the review, with no extra call for the documents.
    const calls = withDocs.llm.calls;
    expect(calls).toHaveLength(baseline);
    expect(calls.filter((c) => c.method === 'completeStructured')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'complete')).toHaveLength(0);
    // No embedding pass: the embedder rejects, so any call would have thrown.
    expect(calls.filter((c) => c.method === 'embed')).toHaveLength(0);
    // No chunking: one untrusted block per DOCUMENT, not per chunk.
    expect((String(trace.prompt_assembly.specs).match(/<untrusted source="spec-\d+">/g) ?? [])).toHaveLength(3);

    await docsApp.close();
  });

  it('AC-29 — with the indexer and embeddings disabled, discovery and injection are unchanged', async () => {
    const disabled = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      EMBEDDINGS_ENABLED: 'false',
      REPO_INTEL_ENABLED: 'false',
    } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config: disabled,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF, files: cloneFiles() }),
        github: new MockGitHubClient(),
        codeIndex: new RejectingCodeIndex(),
        tokenizer: countingTokenizer,
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW_CITING_DOC }),
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { IntentClassification: INTENT_FIXTURE },
            structured: REVIEW_CITING_DOC,
          }),
        },
      },
    });
    const { pr, repo } = await setupRepoAndPr();
    const agent = await makeAgent(app, `Degraded ${seq}`);

    const rows = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/context` })).json() as
      { path: string }[];
    expect(rows.map((r) => r.path)).toContain(DOC_SPEC);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/context`,
      payload: { repo_id: repo.id, paths: [DOC_SPEC] },
    });
    const posted = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = posted.json().runs[0].run_id as string;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([DOC_SPEC]);
    expect(trace.prompt_assembly.specs).toContain('Every exported route must be versioned.');

    await app.close();
  });
});
