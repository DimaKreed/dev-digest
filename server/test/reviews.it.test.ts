import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
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
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);
    // The engine's cost reaches the trace document, not just the run row.
    expect(trace.stats.cost_usd).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');
    // Run cost is persisted, not discarded at the executor boundary (the mock LLM
    // adapter reports costUsd per call, so a completed run must carry a price).
    expect(run!.costUsd).toBeGreaterThan(0);

    // …and it is served on the run summary the timeline reads.
    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runs[0].cost_usd).toBe(run!.costUsd);

    // …and the PR list rolls the latest COMPLETED run's cost onto the row.
    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listRow = pulls.find((p: { number: number }) => p.number === pr.number);
    expect(listRow.cost_usd).toBe(run!.costUsd);

    // The FINDINGS column rolls up the same findings the detail page shows, so
    // the phantom WARNING the grounding gate dropped must NOT appear here —
    // only the one CRITICAL that survived.
    expect(listRow.findings_critical).toBe(1);
    expect(listRow.findings_warning).toBe(0);
    expect(listRow.findings_suggestion).toBe(0);

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  /**
   * The skills wiring end-to-end: linked skill bodies reach the assembled
   * prompt, the trace records the block plus its token cost, and `run_skills`
   * records which skills were in the prompt (the basis of every per-skill stat).
   *
   * This is the control experiment the lesson demonstrates, asserted rather
   * than eyeballed: the SAME agent, with and without skills attached.
   */
  describe('skills in the prompt', () => {
    async function createSkill(
      app: Awaited<ReturnType<typeof appWith>>,
      name: string,
      body: string,
      enabled = true,
    ) {
      const res = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name, type: 'custom', body, enabled },
      });
      return res.json() as { id: string; name: string };
    }

    async function runAndTrace(
      app: Awaited<ReturnType<typeof appWith>>,
      prId: string,
      agentId: string,
      expected: number,
    ) {
      const body = (
        await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } })
      ).json();
      await waitForPrRuns(pg.handle.db, prId, { expected });
      const runId = body.runs[0].run_id as string;
      const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
      return { runId, trace };
    }

    it('omits the skills block entirely when the agent has none attached', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'NoSkills', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
        })
      ).json();

      const { runId, trace } = await runAndTrace(app, pr.id, agent.id, 1);
      expect(trace.prompt_assembly.skills).toBeNull();
      expect(trace.prompt_assembly.skills_tokens).toBeNull();
      expect(trace.prompt_assembly.user).not.toContain('## Skills / rules');

      const rows = await pg.handle.db
        .select()
        .from(t.runSkills)
        .where(eq(t.runSkills.runId, runId));
      expect(rows).toHaveLength(0);
      await app.close();
    });

    it('injects linked skills in order, records the token cost and run_skills', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'WithSkills', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
        })
      ).json();

      const first = await createSkill(app, 'first-rule', '# FIRST RULE\n\nAlpha.');
      const second = await createSkill(app, 'second-rule', '# SECOND RULE\n\nBeta.');
      // Deliberately attached second-then-first, so a passing assertion proves
      // the ORDER comes from agent_skills.order and not from insertion order.
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [second.id, first.id] },
      });

      const { runId, trace } = await runAndTrace(app, pr.id, agent.id, 1);

      expect(trace.prompt_assembly.skills).toContain('SECOND RULE');
      expect(trace.prompt_assembly.skills).toContain('FIRST RULE');
      expect(trace.prompt_assembly.skills.indexOf('SECOND RULE')).toBeLessThan(
        trace.prompt_assembly.skills.indexOf('FIRST RULE'),
      );
      // The block is rendered into the user message, under its own heading.
      expect(trace.prompt_assembly.user).toContain('## Skills / rules');
      // Real token cost, counted server-side.
      expect(trace.prompt_assembly.skills_tokens).toBeGreaterThan(0);

      const rows = await pg.handle.db
        .select()
        .from(t.runSkills)
        .where(eq(t.runSkills.runId, runId));
      expect(rows.map((r) => r.skillId).sort()).toEqual([first.id, second.id].sort());
      await app.close();
    });

    /**
     * Defence in depth for "linked ⇒ enabled".
     *
     * This state is UNREACHABLE through the API: linking a disabled skill is
     * rejected with 400, and disabling one detaches it from every agent. So the
     * link is inserted straight into `agent_skills`, bypassing the service, to
     * prove the executor's own `.filter(l => l.skill.enabled)` still holds if
     * the invariant is ever broken by a direct DB edit or a bad seed.
     */
    it('the executor filters a disabled skill even if one is linked directly in the DB', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'MixedSkills', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
        })
      ).json();

      const on = await createSkill(app, 'enabled-rule', '# ENABLED RULE\n\nOn.');
      const off = await createSkill(app, 'disabled-rule', '# DISABLED RULE\n\nOff.', false);

      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [on.id] },
      });
      // Bypass the service on purpose — see the docblock above.
      await pg.handle.db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId: off.id, order: 1 });

      const { runId, trace } = await runAndTrace(app, pr.id, agent.id, 1);
      expect(trace.prompt_assembly.skills).toContain('ENABLED RULE');
      expect(trace.prompt_assembly.skills).not.toContain('DISABLED RULE');

      // …and it is not counted as pulled either, so the stats stay honest.
      const rows = await pg.handle.db
        .select()
        .from(t.runSkills)
        .where(eq(t.runSkills.runId, runId));
      expect(rows.map((r) => r.skillId)).toEqual([on.id]);
      await app.close();
    });

    it('per-skill stats count runs that pulled the skill', async () => {
      const app = await appWith(REVIEW_FIXTURE);
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'StatsAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
        })
      ).json();
      const skill = await createSkill(app, 'stats-rule', '# STATS RULE\n\nCount me.');
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [skill.id] },
      });

      await runAndTrace(app, pr.id, agent.id, 1);

      const stats = (
        await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` })
      ).json();
      expect(stats.runs_pulled).toBe(1);
      expect(stats.used_by).toBe(1);
      // One grounded CRITICAL survives the grounding gate in this fixture.
      expect(stats.findings_30d).toBe(1);
      // Nothing triaged yet ⇒ null, not 0.
      expect(stats.accept_rate).toBeNull();
      expect(stats.findings_by_category).toEqual([{ category: 'security', count: 1 }]);
      await app.close();
    });
  });
});
