import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockLLMProvider,
  MockEmbedder,
  MockGitClient,
  MockGitHubClient,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type {
  EvalBatch,
  EvalCaseRecord,
  EvalCaseRun,
  EvalDashboardAll,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * The eval pipeline against a REAL Postgres (SPEC-04).
 *
 * The scorer and the batch aggregation are already covered hermetically; what
 * only a database can prove is the part that lives in SQL and migrations: that
 * the new columns exist and round-trip, that a batch reads back grouped by
 * `batch_id` through a join `eval_runs` cannot do on its own (it has no
 * workspace column), and that the seed leaves a runnable set behind.
 */
/**
 * Wait for a backgrounded batch to finish, the way the browser does.
 *
 * The run route answers 202 and executes the set in the background, so the
 * assertions below need the batch READ back rather than the one returned. The
 * cap is a test failure, not a timeout: a batch that never reaches `done` has
 * to fail loudly here rather than hang until vitest kills the file.
 */
async function pollBatch(
  app: Awaited<ReturnType<typeof buildApp>>,
  batchId: string,
): Promise<EvalBatch> {
  for (let i = 0; i < 600; i++) {
    const res = await app.inject({ method: 'GET', url: `/eval/batches/${batchId}` });
    if (res.statusCode === 200) {
      const batch = res.json() as EvalBatch;
      if (batch.status === 'done') return batch;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`batch ${batchId} never reached status "done"`);
}

d('eval pipeline (integration)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let securityAgentId: string;

  beforeAll(async () => {
    pg = await startPg();
    const r = await seed(pg.handle.db);
    workspaceId = r.workspaceId;
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    securityAgentId = agent!.id;
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  /** An app whose model always reports the Stripe key at src/config.ts:12. */
  function appWith(findings: unknown[]) {
    return buildApp({
      config: { ...config(), databaseUrl: pg.url },
      overrides: {
        llm: {
          openai: new MockLLMProvider('openai', {
            structured: {
              verdict: findings.length > 0 ? 'request_changes' : 'approve',
              summary: 'mock',
              score: findings.length > 0 ? 20 : 100,
              findings,
            },
          }),
          openrouter: new MockLLMProvider('openai', {
            structured: {
              verdict: findings.length > 0 ? 'request_changes' : 'approve',
              summary: 'mock',
              score: findings.length > 0 ? 20 : 100,
              findings,
            },
          }),
        },
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
      },
    });
  }

  const STRIPE_FINDING = {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key',
    file: 'src/config.ts',
    start_line: 12,
    end_line: 12,
    rationale: 'a literal sk_live_ key',
    confidence: 0.97,
  };

  it('seeds a runnable set of at least 8 cases for the Security Reviewer (AC-14)', async () => {
    const app = await appWith([]);
    const res = await app.inject({
      method: 'GET',
      url: `/agents/${securityAgentId}/eval-cases`,
    });
    expect(res.statusCode).toBe(200);
    const cases = res.json() as EvalCaseRecord[];
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(new Set(cases.map((c) => c.expectation_kind))).toEqual(
      new Set(['must_find', 'must_not_flag']),
    );
    // Every seeded case carries a diff and at least one expectation, or it
    // could never pass however good the agent is.
    for (const c of cases) {
      expect(c.input_diff.length, c.name).toBeGreaterThan(0);
      expect(c.expected_output.length, c.name).toBeGreaterThan(0);
    }
    await app.close();
  });

  it('runs the whole set and persists one row per case under one batch id (AC-05/AC-08)', async () => {
    const app = await appWith([STRIPE_FINDING]);
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${securityAgentId}/eval-runs`,
    });
    // 202, not 200: the set is accepted and executed in the background, so the
    // body is the batch in its first moment — no cases, and a total to poll
    // against. Asserting 200 here is how this test would stop noticing that.
    expect(res.statusCode).toBe(202);
    const accepted = res.json() as EvalBatch;
    expect(accepted.status).toBe('running');
    expect(accepted.cases).toEqual([]);
    expect(accepted.cases_total).toBeGreaterThanOrEqual(8);
    expect(accepted.cases_done).toBe(0);

    const batch = await pollBatch(app, accepted.batch_id);
    expect(batch.status).toBe('done');
    expect(batch.cases_done).toBe(batch.cases_total);

    const rows = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batch.batch_id));
    expect(rows.length).toBe(batch.cases.length);
    expect(rows.length).toBeGreaterThanOrEqual(8);

    // The snapshot columns the compare view reads back off the row.
    for (const row of rows) {
      expect(row.agentVersion).not.toBeNull();
      expect(row.systemPrompt).not.toBeNull();
      expect(row.model).not.toBeNull();
    }

    // The model reported the stripe key on every case, so the positive case
    // for it passes and the "test key in a fixture" negative case does not —
    // that finding cites a file the negative case's diff does not contain, so
    // grounding drops it there. What matters is that BOTH polarities scored.
    const stripe = batch.cases.find((c) => c.case_name === 'stripe-key-leak');
    expect(stripe?.pass).toBe(true);
    expect(batch.metrics.recall).toBeGreaterThan(0);
    expect(batch.metrics.traces_total).toBe(rows.length);

    // And the batch reads back the same way through its own route.
    const read = await app.inject({ method: 'GET', url: `/eval/batches/${batch.batch_id}` });
    expect(read.statusCode).toBe(200);
    expect((read.json() as EvalBatch).cases.length).toBe(batch.cases.length);
    // Once it is finished the batch is `done` on every read, including the ones
    // that never saw it run — a batch is only `running` inside the process
    // executing it, and nothing about that is persisted.
    expect((read.json() as EvalBatch).status).toBe('done');

    await app.close();
  }, 180_000);

  it('turns an accepted finding into a must_find case in one call (AC-01/AC-02)', async () => {
    const app = await appWith([]);
    // The seed labels the Stripe finding accepted and attributes its review to
    // the Security Reviewer, which is what makes this path reachable at all.
    const [finding] = await pg.handle.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.file, 'src/config.ts'));

    const res = await app.inject({
      method: 'POST',
      url: `/findings/${finding!.id}/eval-case`,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const created = res.json() as EvalCaseRecord;
    expect(created.expectation_kind).toBe('must_find');
    expect(created.source_finding_id).toBe(finding!.id);
    expect(created.expected_output[0]).toMatchObject({ file: 'src/config.ts' });
    expect(created.input_diff).toContain('src/config.ts');

    // Clean up so the case count assertions above stay meaningful if this file
    // is re-run against the same container.
    await app.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
    await app.close();
  });

  it('rejects seeding from a dismissed finding with no stored patch, and stores nothing', async () => {
    const app = await appWith([]);
    // src/middleware/ratelimit.ts is seeded WITHOUT a patch on purpose.
    const [review] = await pg.handle.db.select().from(t.reviews).limit(1);
    const [orphan] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/middleware/ratelimit.ts',
        startLine: 52,
        endLine: 52,
        severity: 'WARNING',
        category: 'bug',
        title: 'Retry-After header omitted on 429',
        rationale: 'no header',
        confidence: 0.81,
        dismissedAt: new Date(),
      })
      .returning();

    const before = await pg.handle.db.select().from(t.evalCases);
    const res = await app.inject({
      method: 'POST',
      url: `/findings/${orphan!.id}/eval-case`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/no stored patch/i);
    const after = await pg.handle.db.select().from(t.evalCases);
    expect(after.length).toBe(before.length);

    await pg.handle.db.delete(t.findings).where(eq(t.findings.id, orphan!.id));
    await app.close();
  });

  it('reads one case back with expected AND actual side by side', async () => {
    const app = await appWith([STRIPE_FINDING]);
    const cases = (
      await app.inject({ method: 'GET', url: `/agents/${securityAgentId}/eval-cases` })
    ).json() as EvalCaseRecord[];
    const stripe = cases.find((c) => c.name === 'stripe-key-leak')!;

    // The case record carries the WHOLE newest run, so the editor can render
    // "expected this, got that" without a second request.
    expect(stripe.last_run).not.toBeNull();
    expect(stripe.last_run!.findings.length).toBeGreaterThan(0);
    expect(stripe.last_run!.pass).toBe(true);

    const runs = (
      await app.inject({ method: 'GET', url: `/eval-cases/${stripe.id}/runs` })
    ).json() as EvalCaseRun[];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]!.missed).toEqual([]);
    expect(runs[0]!.violations).toEqual([]);

    // A case the model did NOT satisfy names the expectation it missed, which
    // is the whole reason `missed` is persisted rather than recomputed.
    const missedCase = cases.find((c) => c.last_run?.pass === false && !c.last_run?.error);
    if (missedCase) {
      expect(missedCase.last_run!.missed.length + missedCase.last_run!.violations.length)
        .toBeGreaterThan(0);
    }

    await app.close();
  });

  it('lists every agent on the dashboard, with metrics only where a run exists (AC-11/AC-12)', async () => {
    const app = await appWith([]);
    const res = await app.inject({ method: 'GET', url: '/eval/dashboard' });
    expect(res.statusCode).toBe(200);
    const dash = res.json() as EvalDashboardAll;

    // Four built-in agents are seeded; only the Security Reviewer has cases.
    expect(dash.agents.length).toBeGreaterThanOrEqual(4);
    const security = dash.agents.find((a) => a.agent_id === securityAgentId);
    expect(security?.cases_total).toBeGreaterThanOrEqual(8);
    expect(security?.latest).not.toBeNull();

    const untouched = dash.agents.find((a) => a.agent_id !== securityAgentId);
    expect(untouched?.cases_total).toBe(0);
    // Never run reads as null, not as a zeroed metric block.
    expect(untouched?.latest).toBeNull();

    await app.close();
  });

  it('404s for an agent in another workspace and 422s for a malformed id', async () => {
    const app = await appWith([]);
    const missing = await app.inject({
      method: 'GET',
      url: '/agents/00000000-0000-0000-0000-000000000000/eval-cases',
    });
    expect(missing.statusCode).toBe(404);

    const malformed = await app.inject({ method: 'GET', url: '/agents/not-a-uuid/eval-cases' });
    expect(malformed.statusCode).toBe(422);
    await app.close();
  });
});
