import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import { TiktokenTokenizer } from '../src/adapters/tokenizer/index.js';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import * as t from '../src/db/schema.js';

/**
 * SPEC-03 (PR Brief) — the server criteria, over real Postgres.
 *
 * Spec-first: every assertion cites the `AC-NN` in `specs/03-pr-brief-card.md`
 * it comes from, and nothing here was read off an implementation. The file is
 * expected to be RED until the brief module ships.
 *
 * Named `*.it.test.ts` because it imports `test/helpers/pg.ts` — the CI lanes
 * split on that exact substring.
 *
 * Why the whole generation surface is in the DB lane rather than a hermetic
 * one: the brief reads the pull request, its intent, its files and its
 * workspace settings through `container.reviewRepo`, which is constructed from
 * `db` and is NOT a `ContainerOverrides` key. Everything that a hermetic test
 * *could* substitute — the provider, the secrets, the git and GitHub clients,
 * the repo-intel flag — is substituted here at the same container seam. There
 * is no `vi.mock` anywhere in this package and this file does not add the first.
 *
 * Route paths follow `.devdigest/cache/plans/pr-brief.md` W6:
 * `GET /pulls/:id/brief` and `POST /pulls/:id/brief/generate`.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const HEAD_A = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
const HEAD_B = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';
const OTHER_WORKSPACE_PR = '33333333-3333-4333-8333-333333333333';

/** Markers that must NEVER reach the model input (AC-02's closed list, AC-03). */
const PATCH_MARKER = 'PATCH_HUNK_BODY_MUST_NOT_BE_SENT';
const REVIEW_MARKER = 'AGENT_REVIEW_SUMMARY_MUST_NOT_BE_SENT';
/** Markers that MUST reach it (AC-02). */
const INTENT_MARKER = 'INTENT_ADDS_A_PER_ROUTE_RATE_LIMIT';

/**
 * One structured model output. Two of its references are grounded in the
 * assembled input (`src/pay.ts`, `src/config.ts`) and two are not
 * (`src/ghost.ts`, and a review-focus entry on a file that does not exist), so
 * the same fixture serves AC-10, AC-11 and AC-13.
 */
const GENERATION = {
  risk_level: 'high',
  what: 'Adds a per-route rate limit to the review endpoints.',
  why: 'It sits in front of every paid route, so a wrong window blocks reviews.',
  risks: [
    {
      title: 'The limiter is applied before authentication',
      explanation: 'An unauthenticated caller can exhaust the window for everyone.',
      severity: 'high',
      // One ref WITH a line and one WITHOUT — AC-11 requires both to be
      // representable, which a preformatted `path:line` string cannot do.
      refs: [
        { path: 'src/pay.ts', line: 12 },
        { path: 'src/config.ts', line: null },
      ],
    },
    {
      title: 'Ungrounded risk about a file that was never in the input',
      explanation: 'Names src/ghost.ts, which the assembled input does not contain.',
      severity: 'medium',
      refs: [{ path: 'src/ghost.ts', line: 4 }],
    },
  ],
  review_focus: [
    {
      label: 'The limiter registration',
      ref: { path: 'src/pay.ts', line: 12 },
      reason: 'This is where the window is chosen.',
    },
    {
      label: 'Ungrounded focus entry',
      ref: { path: 'src/never-existed.ts', line: 3 },
      reason: 'Names a file absent from the assembled input.',
    },
  ],
};

/** A provider that always rejects, the way a real one does after its retries. */
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

d('PR brief endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prSeq = 0;

  const tokenizer = new TiktokenTokenizer();

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'brief-fixture', fullName: 'acme/brief-fixture' })
      .returning();
    repoId = repo!.id;
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  }, 120_000);

  /**
   * A fresh pull request per test — `pr_brief.pr_id` is a primary key and
   * regeneration replaces (AC-17), so sharing one row across tests would make
   * the order load-bearing.
   */
  async function setupPr(
    opts: {
      intent?: boolean;
      body?: string | null;
      files?: string[];
      review?: boolean;
    } = {},
  ): Promise<string> {
    const db = pg.handle.db;
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 900 + prSeq++,
        title: 'Add a per-route rate limit',
        author: 'marisa.koch',
        branch: 'feat/limiter',
        base: 'main',
        headSha: HEAD_A,
        // Diff stats — AC-02 requires these in the input, AC-05 never drops them.
        additions: 137,
        deletions: 42,
        filesCount: 2,
        body: opts.body === undefined ? 'Fixes #12' : opts.body,
        status: 'needs_review',
      })
      .returning();
    const prId = pr!.id;

    for (const path of opts.files ?? ['src/pay.ts', 'src/config.ts']) {
      await db.insert(t.prFiles).values({
        prId,
        path,
        additions: 10,
        deletions: 2,
        // The hunk body AC-03 excludes. Its marker is what proves the exclusion.
        patch: `@@ -1,3 +1,4 @@\n+const x = "${PATCH_MARKER}";`,
      });
    }

    if (opts.intent !== false) {
      await db.insert(t.prIntent).values({
        prId,
        intent: `${INTENT_MARKER}: adds a per-route rate limit to the review endpoints.`,
        inScope: ['rate limiting'],
        outOfScope: ['logging for the limiter'],
        headSha: HEAD_A,
        model: 'gpt-4.1',
      });
    }

    if (opts.review) {
      await db.insert(t.reviews).values({
        workspaceId,
        prId,
        agentId: '11111111-1111-4111-8111-111111111111',
        kind: 'review',
        verdict: 'request_changes',
        summary: REVIEW_MARKER,
        score: 40,
      });
    }

    return prId;
  }

  function makeApp(
    opts: {
      llm?: LLMProvider;
      secrets?: Record<string, string>;
      repoIntelEnabled?: boolean;
    } = {},
  ) {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      REPO_INTEL_ENABLED: opts.repoIntelEnabled === false ? 'false' : 'true',
    } as NodeJS.ProcessEnv);
    // `structured` (not `structuredBySchema`) so the fixture is returned
    // whatever the implementation names its schema — the schema NAME is not a
    // criterion of this spec, the single call is.
    const llm = opts.llm ?? new MockLLMProvider('openai', { structured: GENERATION });
    return {
      llm,
      app: buildApp({
        config,
        db: pg.handle.db,
        overrides: {
          llm: { openai: llm, anthropic: llm as LLMProvider, openrouter: llm as LLMProvider },
          secrets: new MockSecretsProvider(
            opts.secrets ?? {
              OPENAI_API_KEY: 'sk-test',
              ANTHROPIC_API_KEY: 'sk-test',
              OPENROUTER_API_KEY: 'sk-test',
            },
          ),
          github: new MockGitHubClient(),
          git: new MockGitClient({ head: HEAD_A }),
        },
      }),
    };
  }

  /** Every structured call a mock provider recorded. */
  function structuredCalls(llm: LLMProvider): { messages: { content: string }[] }[] {
    const mock = llm as MockLLMProvider;
    return mock.calls
      .filter((c) => c.method === 'completeStructured')
      .map((c) => c.req as { messages: { content: string }[] });
  }

  /** The whole assembled model input, as one string. */
  function assembledInput(llm: LLMProvider): string {
    return structuredCalls(llm)
      .flatMap((req) => req.messages.map((m) => m.content))
      .join('\n');
  }

  // -------------------------------------------------------------------------
  // Generation and inputs
  // -------------------------------------------------------------------------

  it('AC-01 / AC-09 / AC-10 / AC-11 — one structured call, a five-member brief, its provenance and structured refs', async () => {
    const prId = await setupPr();
    const { app, llm } = makeApp();
    const a = await app;

    const res = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // AC-01 — exactly one model call, and the result reports the count, both
    // token figures and the cost.
    expect(structuredCalls(llm)).toHaveLength(1);
    expect(body.usage.calls).toBe(1);
    expect(typeof body.usage.tokens_in).toBe('number');
    expect(typeof body.usage.tokens_out).toBe('number');
    expect(body.usage).toHaveProperty('cost_usd');

    // AC-10 — a brief is a risk level, a what, a why, risks and review focus,
    // all from that one call.
    const brief = body.brief;
    expect(['high', 'medium', 'low']).toContain(brief.risk_level);
    expect(brief.what).toContain('per-route rate limit');
    expect(typeof brief.why).toBe('string');
    expect(Array.isArray(brief.risks)).toBe(true);
    expect(Array.isArray(brief.review_focus)).toBe(true);

    // AC-09 — the stored document records the head it was assembled from and
    // the provider and model that produced it.
    expect(brief.head_sha).toBe(HEAD_A);
    expect(brief.provider).toBeTruthy();
    expect(brief.model).toBeTruthy();

    // AC-11 — every file reference is a structured path + optional line, never
    // a preformatted `path:line` string, and a ref with no line survives.
    const refs = [
      ...brief.risks.flatMap((r: { refs: unknown[] }) => r.refs),
      ...brief.review_focus.map((f: { ref: unknown }) => f.ref),
    ] as { path: string; line?: number | null }[];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(typeof ref).toBe('object');
      expect(typeof ref.path).toBe('string');
      expect(ref.path).not.toMatch(/:\d+$/);
    }
    expect(refs.some((r) => r.line === null || r.line === undefined)).toBe(true);

    await a.close();
  });

  it('AC-02 / AC-03 — the input carries intent, diff stats and the linked issue, and no hunk body or review text', async () => {
    const prId = await setupPr({ review: true });
    const { app, llm } = makeApp();
    const a = await app;

    const res = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(200);

    const input = assembledInput(llm);

    // AC-02 — the derived intent, the diff stats and the linked issue are in.
    expect(input).toContain(INTENT_MARKER);
    expect(input).toContain('137');
    expect(input).toContain('42');
    expect(input).toContain('src/pay.ts');
    expect(input).toContain('Issue #12');

    // AC-02 — "and from no other source": an agent review sitting on the same
    // pull request is not one of the five named inputs.
    expect(input).not.toContain(REVIEW_MARKER);

    // AC-03 — no diff hunk body, ever.
    expect(input).not.toContain(PATCH_MARKER);

    await a.close();
  });

  it('AC-04 / AC-05 / AC-06 — an oversized input is capped, dropped in the fixed order, and every drop is named', async () => {
    // 400 long paths plus a long issue body puts the unbudgeted input far over
    // the 8 000-token cap.
    const files = Array.from(
      { length: 400 },
      (_, i) => `src/modules/generated/very/deeply/nested/segment-${i}/implementation-file-${i}.ts`,
    );
    const prId = await setupPr({ files, body: `Fixes #12\n${'context filler sentence. '.repeat(600)}` });
    const { app, llm } = makeApp();
    const a = await app;

    const res = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(200);

    // AC-04 — counted with the server-side tokenizer, and not sent over the cap.
    const input = assembledInput(llm);
    expect(tokenizer.count(input)).toBeLessThanOrEqual(8_000);

    // AC-05 — intent and diff stats are never dropped, whatever else goes.
    expect(input).toContain(INTENT_MARKER);
    expect(input).toContain('137');

    // AC-06 — every input dropped to fit is named in the stored brief's list of
    // sources that did not fully reach the model...
    const named = (res.json().brief.degraded_sources as { name: string; reason: string }[]).map(
      (s) => s.name,
    );
    expect(named).toContain('file_list_tail');
    // ...and the order is fixed: the file-list tail is the THIRD thing to go,
    // so the issue body — which this fixture makes large on purpose — must
    // already have gone before it. (The project-context documents are first in
    // the order but empty in this fixture, so there is nothing to drop and
    // nothing this criterion can require. Their ABSENCE is AC-07's business.)
    expect(named).toContain('issue_body');

    await a.close();
  });

  it('AC-07 — an absent source degrades the brief instead of refusing it, and is named with a reason', async () => {
    // No intent row, no PR body (so no linked issue), no code index, no
    // attached project-context documents.
    const prId = await setupPr({ intent: false, body: null });
    const { app } = makeApp();
    const a = await app;

    const res = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(200);

    const degraded = res.json().brief.degraded_sources as { name: string; reason: string }[];
    expect(degraded.length).toBeGreaterThan(0);
    for (const source of degraded) {
      expect(source.name).toBeTruthy();
      expect(source.reason).toBeTruthy();
    }
    const names = degraded.map((s) => s.name).join(' ');
    expect(names).toMatch(/intent/);
    expect(names).toMatch(/context/);

    await a.close();
  });

  it('AC-08 — repo intelligence disabled by flag is recorded as the blast source’s reason, not silently skipped', async () => {
    const prId = await setupPr();
    const { app } = makeApp({ repoIntelEnabled: false });
    const a = await app;

    const res = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(200);

    const degraded = res.json().brief.degraded_sources as { name: string; reason: string }[];
    const blast = degraded.find((s) => /blast/.test(s.name));
    expect(blast).toBeDefined();
    // The flag, not "no data" — the whole point of AC-08 is that the reader can
    // tell a switched-off index from an empty one.
    expect(blast!.reason).toMatch(/flag|disabled/i);

    await a.close();
  });

  // -------------------------------------------------------------------------
  // Grounding
  // -------------------------------------------------------------------------

  it('AC-13 — entries naming a file absent from the assembled input are dropped and counted', async () => {
    const prId = await setupPr();
    const { app } = makeApp();
    const a = await app;

    const res = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The fixture emits two ungrounded entries: a risk on `src/ghost.ts` and a
    // review-focus entry on `src/never-existed.ts`.
    const paths = [
      ...body.brief.risks.flatMap((r: { refs: { path: string }[] }) => r.refs.map((x) => x.path)),
      ...body.brief.review_focus.map((f: { ref: { path: string } }) => f.ref.path),
    ];
    expect(paths).not.toContain('src/ghost.ts');
    expect(paths).not.toContain('src/never-existed.ts');
    expect(paths).toContain('src/pay.ts');

    // Observable rather than silent: the count is in the generation result AND
    // in the stored document.
    expect(body.dropped_entries).toBe(2);
    expect(body.brief.dropped_entries).toBe(2);

    await a.close();
  });

  // -------------------------------------------------------------------------
  // Storage, reuse and staleness
  // -------------------------------------------------------------------------

  it('AC-14 / AC-16 — reading a stored brief makes no model call, and staleness is a server-computed field', async () => {
    const prId = await setupPr();
    const writer = makeApp();
    const w = await writer.app;
    expect(
      (await w.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} })).statusCode,
    ).toBe(200);
    await w.close();

    // A brand-new app, so its provider's call log starts empty.
    const reader = makeApp();
    const r = await reader.app;
    const res = await r.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);

    // AC-14 — no model call, therefore no cost, on a read.
    expect(structuredCalls(reader.llm)).toHaveLength(0);

    // AC-16 — the client is handed the verdict, never the inputs to compute it.
    const body = res.json();
    expect(typeof body.stale).toBe('boolean');
    expect(body.stale).toBe(false);

    await r.close();
  });

  it('AC-15 / AC-20 — a head that advances mid-generation is not the head recorded, and the brief reads stale', async () => {
    const prId = await setupPr();

    /**
     * Advances the pull request's head DURING the call, which is the only way
     * to observe AC-20: the stored brief must be attributed to the head the
     * input was built from, not to the head current at write time.
     */
    class HeadAdvancingLLM extends MockLLMProvider {
      async completeStructured<T>(req: never): Promise<StructuredResult<T>> {
        await pg.handle.db
          .update(t.pullRequests)
          .set({ headSha: HEAD_B })
          .where(eq(t.pullRequests.id, prId));
        return super.completeStructured(req);
      }
    }

    const { app } = makeApp({
      llm: new HeadAdvancingLLM('openai', { structured: GENERATION }),
    });
    const a = await app;

    const gen = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(gen.statusCode).toBe(200);
    // AC-20 — the head it was BUILT from.
    expect(gen.json().brief.head_sha).toBe(HEAD_A);

    // AC-15 — recorded head ≠ current head ⇒ stale.
    const read = await a.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(read.json().stale).toBe(true);

    await a.close();
  });

  it('AC-15 — a brief whose recorded model is no longer the resolved model reads stale', async () => {
    const prId = await setupPr();
    const { app } = makeApp();
    const a = await app;

    expect(
      (await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} })).statusCode,
    ).toBe(200);
    expect((await a.inject({ method: 'GET', url: `/pulls/${prId}/brief` })).json().stale).toBe(false);

    // The head has not moved; only the feature model has.
    await pg.handle.db
      .insert(t.settings)
      .values({
        workspaceId,
        userId: null,
        key: 'feature_models',
        value: { risk_brief: { provider: 'openai', model: 'gpt-4.1-mini' } },
      })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: { risk_brief: { provider: 'openai', model: 'gpt-4.1-mini' } } },
      });

    const after = await a.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(after.json().stale).toBe(true);

    // Clean up so the override does not leak into a later test in this file.
    await pg.handle.db.delete(t.settings).where(eq(t.settings.key, 'feature_models'));
    await a.close();
  });

  it('AC-17 / AC-18 — at most one brief per pull request; a regeneration replaces it in one whole document', async () => {
    const prId = await setupPr();
    const { app } = makeApp();
    const a = await app;

    const first = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(first.statusCode).toBe(200);
    const second = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(second.statusCode).toBe(200);

    // AC-17 — keyed by the pull request; regeneration replaces rather than adds.
    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(rows).toHaveLength(1);

    // AC-18 — one write of ONE document: no partial-brief state is observable,
    // so the row that exists is always a complete brief.
    const stored = rows[0]!.json as Record<string, unknown>;
    for (const key of ['risk_level', 'what', 'why', 'risks', 'review_focus']) {
      expect(stored).toHaveProperty(key);
    }

    await a.close();
  });

  it('AC-19 — a failed generation leaves the previously stored brief untouched', async () => {
    const prId = await setupPr();
    const ok = makeApp();
    const o = await ok.app;
    expect(
      (await o.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} })).statusCode,
    ).toBe(200);
    const before = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    await o.close();

    const failing = new AlwaysFailingLLM();
    const bad = await makeApp({ llm: failing }).app;
    const res = await bad.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const after = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(after).toHaveLength(1);
    expect(after[0]!.json).toEqual(before[0]!.json);

    await bad.close();
  });

  // -------------------------------------------------------------------------
  // Concurrency, access and validation
  // -------------------------------------------------------------------------

  it('AC-21 — a second generation arriving mid-flight starts no second model call', async () => {
    const prId = await setupPr();

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    /** Holds the first call open long enough for a second request to arrive. */
    class SlowLLM extends MockLLMProvider {
      async completeStructured<T>(req: never): Promise<StructuredResult<T>> {
        await gate;
        return super.completeStructured(req);
      }
    }
    const llm = new SlowLLM('openai', { structured: GENERATION });

    const a = await makeApp({ llm }).app;
    const first = a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    const second = a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    // Let both requests reach the guard before the provider is allowed to answer.
    await new Promise((r) => setImmediate(r));
    release();
    const results = await Promise.all([first, second]);

    // The criterion, stated exactly: no second model call.
    expect(structuredCalls(llm)).toHaveLength(1);
    // And the second caller is told, rather than silently handed nothing: both
    // requests get an answer, and they are not two independent generations.
    for (const r of results) expect(r.statusCode).toBeLessThan(500);

    await a.close();
  });

  it('AC-22 — a pull request outside the requesting workspace is a 404 on both read and generate', async () => {
    const db = pg.handle.db;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const [otherRepo] = await db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'other',
        name: 'repo',
        fullName: 'other/repo',
      })
      .returning();
    const [otherPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: otherRepo!.id,
        number: 1,
        title: 'Not yours',
        author: 'someone',
        branch: 'x',
        base: 'main',
        headSha: HEAD_A,
        status: 'needs_review',
      })
      .returning();

    // A pull request of OUR workspace, so the 404s below are the scoping and
    // not merely an unregistered route.
    const ownPr = await setupPr();

    const { app, llm } = makeApp();
    const a = await app;

    expect((await a.inject({ method: 'GET', url: `/pulls/${ownPr}/brief` })).statusCode).toBe(200);
    expect((await a.inject({ method: 'GET', url: `/pulls/${otherPr!.id}/brief` })).statusCode).toBe(404);
    expect(
      (await a.inject({ method: 'POST', url: `/pulls/${otherPr!.id}/brief/generate`, payload: {} }))
        .statusCode,
    ).toBe(404);
    // A pull request that exists nowhere is the same answer.
    expect((await a.inject({ method: 'GET', url: `/pulls/${OTHER_WORKSPACE_PR}/brief` })).statusCode).toBe(
      404,
    );
    // The authorization boundary is checked before anything is paid for.
    expect(structuredCalls(llm)).toHaveLength(0);

    await a.close();
  });

  it('AC-23 — a malformed identifier is rejected with 422 before the handler runs', async () => {
    const { app } = makeApp();
    const a = await app;
    const res = await a.inject({ method: 'POST', url: '/pulls/482/brief/generate', payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await a.close();
  });

  it('AC-24 — no provider key for the resolved brief model answers 503, not 500', async () => {
    const prId = await setupPr();
    const { app, llm } = makeApp({ secrets: {} });
    const a = await app;

    const res = await a.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate`, payload: {} });
    expect(res.statusCode).toBe(503);
    expect(structuredCalls(llm)).toHaveLength(0);

    await a.close();
  });
});
