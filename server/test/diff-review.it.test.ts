import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { DiffReviewResponse } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

/**
 * `POST /reviews/diff` over real Postgres — the route the pre-push CLI calls.
 *
 * What this adds over `diff-review.test.ts`, which drives the service through
 * its ports: agent resolution against REAL seeded rows, real Zod body
 * validation, and proof that nothing is persisted. The unit test cannot show any
 * of those, because it hands the service a hand-written agent.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PATCH = [
  'diff --git a/src/pay.ts b/src/pay.ts',
  'index 111..222 100644',
  '--- a/src/pay.ts',
  '+++ b/src/pay.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '+const token = "sk-live-abc";',
  ' const b = 2;',
].join('\n');

/**
 * Both findings sit on line 2 — the added line — so both survive the grounding
 * gate. One CRITICAL and one WARNING, which is what makes the gate observable:
 * at `critical` only the first blocks.
 */
const REVIEW_FIXTURE = {
  summary: 'A secret was committed.',
  verdict: 'request_changes',
  score: 40,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      file: 'src/pay.ts',
      start_line: 2,
      end_line: 2,
      confidence: 0.9,
      rationale: 'A live key is committed in plaintext.',
      suggestion: 'Read it from the environment.',
    },
    {
      id: 'f2',
      severity: 'WARNING',
      category: 'style',
      title: 'Prefer a named constant',
      file: 'src/pay.ts',
      start_line: 2,
      end_line: 2,
      confidence: 0.6,
      rationale: 'The literal is unexplained.',
      suggestion: 'Extract it.',
    },
  ],
};

d('diff review endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'General Reviewer'));
    agentId = agent!.id;
  }, 120_000);

  const app = () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm, anthropic: llm, openrouter: llm } },
    });
  };

  it('reviews a patch with no pull request, resolving a real seeded agent', async () => {
    const a = await app();
    const res = await a.inject({ method: 'POST', url: '/reviews/diff', payload: { patch: PATCH } });
    expect(res.statusCode).toBe(200);

    // Contract conformance proved by parsing — the route declares no `response:`.
    const body = DiffReviewResponse.parse(res.json());
    expect(body.agent_name).toBe('General Reviewer');
    expect(body.files_reviewed).toBe(1);
    expect(body.findings.length).toBeGreaterThan(0);
    await a.close();
  });

  it('reports blockers under the agent gate, so the CLI exit code is the server decision', async () => {
    const a = await app();
    const res = await a.inject({ method: 'POST', url: '/reviews/diff', payload: { patch: PATCH } });
    const body = DiffReviewResponse.parse(res.json());

    // The seeded agent runs at the default gate, so the CRITICAL blocks and the
    // WARNING does not. `fail_on` travels with the count for exactly this reason:
    // the number alone cannot say which gate produced it.
    expect(body.fail_on).toBe('critical');
    expect(body.blockers).toBe(1);
    expect(body.verdict).toBe('request_changes');
    await a.close();
  });

  it('persists nothing — there is no pull request to attach a review to', async () => {
    const db = pg.handle.db;
    const before = {
      reviews: (await db.select().from(t.reviews)).length,
      findings: (await db.select().from(t.findings)).length,
      runs: (await db.select().from(t.agentRuns)).length,
    };

    const a = await app();
    const res = await a.inject({ method: 'POST', url: '/reviews/diff', payload: { patch: PATCH } });
    expect(res.statusCode).toBe(200);
    await a.close();

    expect((await db.select().from(t.reviews)).length).toBe(before.reviews);
    expect((await db.select().from(t.findings)).length).toBe(before.findings);
    expect((await db.select().from(t.agentRuns)).length).toBe(before.runs);
  });

  it('honours an explicitly named agent', async () => {
    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { patch: PATCH, agentId },
    });
    expect(res.statusCode).toBe(200);
    expect(DiffReviewResponse.parse(res.json()).agent_id).toBe(agentId);
    await a.close();
  });

  it('404s on an agent that does not exist, rather than falling back to another', async () => {
    // Silently reviewing with a different agent than the caller asked for would
    // report findings under a gate they did not choose.
    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { patch: PATCH, agentId: '44444444-4444-4444-8444-444444444444' },
    });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it('422s on a patch the parser reads as no files, rather than approving it', async () => {
    // An "approve, score 100" answer to an unreadable patch is a clean bill of
    // health nobody earned.
    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: '/reviews/diff',
      payload: { patch: 'this is not a diff' },
    });
    expect(res.statusCode).toBe(422);
    await a.close();
  });

  it('422s before the handler when the body has no patch', async () => {
    const a = await app();
    const res = await a.inject({ method: 'POST', url: '/reviews/diff', payload: {} });
    expect(res.statusCode).toBe(422);
    await a.close();
  });
});
