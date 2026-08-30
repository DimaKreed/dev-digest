import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalExpectation, EvalExpectationKind } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EvalRepository } from './repository.js';
import { EvalService } from './service.js';

/**
 * Eval pipeline module (SPEC-04) — the regression harness for reviewer agents.
 *
 *   GET    /eval/dashboard             → every agent + the newest batches
 *   GET    /eval/batches/:id           → one run of the set, with its case rows
 *   GET    /agents/:id/eval-cases      → the agent's case set
 *   POST   /agents/:id/eval-cases      → create a case by hand
 *   PUT    /eval-cases/:id             → edit a case
 *   DELETE /eval-cases/:id             → delete a case
 *   GET    /eval-cases/:id/runs        → this case's runs: expected vs actual
 *   POST   /eval-cases/:id/run         → run ONE case (202, a batch of one)
 *   GET    /findings/:id/eval-case/draft → the case a finding WOULD become
 *   POST   /findings/:id/eval-case     → seed a case from a real finding
 *   POST   /agents/:id/eval-preview    → run a draft once, persisting nothing
 *   POST   /agents/:id/eval-runs       → run the whole set (202, then poll)
 *   GET    /agents/:id/eval-runs       → batch history, newest first
 *   GET    /agents/:id/eval-dashboard  → metrics + delta + trend + history
 *
 * Every `:id` goes through the shared uuid schema, so a malformed identifier is
 * a 422 before any handler body runs, and every route resolves the workspace
 * through `getContext` — the read paths are scoped exactly like the write ones.
 *
 * The two routes that spend money (`/eval-runs`, `/eval-cases/:id/run`) carry
 * the house rate for paid routes. A batch is N model calls, so the global
 * 120/min would allow a four-figure call count per minute from one tab. The
 * limiter plugin is not registered under `NODE_ENV=test`, where this is inert.
 *
 * Both of them answer **202** with the batch in its `running` state and execute
 * it in the background; the client then polls `GET /eval/batches/:id` until
 * `status` is `done`. A set of ten cases is ten model calls, `EVAL_CONCURRENCY`
 * at a time — tens of seconds — and holding a request open for that gives the
 * browser a spinner with no progress and no way to tell a slow run from a dead
 * one.
 *
 * No `response:` schemas, matching every other route in this package; the
 * contracts are proved by parsing the bodies in the tests instead.
 */

const ExpectationList = z.array(EvalExpectation);

const CreateCaseBody = z.object({
  name: z.string().min(1),
  expectation_kind: EvalExpectationKind.default('must_find'),
  input_diff: z.string().min(1),
  input_meta: z.unknown().optional(),
  expected_output: ExpectationList.default([]),
  notes: z.string().nullish(),
});

const UpdateCaseBody = z.object({
  name: z.string().min(1).optional(),
  expectation_kind: EvalExpectationKind.optional(),
  input_diff: z.string().min(1).optional(),
  input_meta: z.unknown().optional(),
  expected_output: ExpectationList.optional(),
  notes: z.string().nullish(),
});

/** Body of the dry run — a case's content, with no case behind it. */
const PreviewBody = z.object({
  expectation_kind: EvalExpectationKind.default('must_find'),
  input_diff: z.string().min(1),
  input_meta: z.unknown().optional(),
  expected_output: ExpectationList.default([]),
});

/** Both fields optional: the click carries no form, the editor may carry one. */
const SeedFromFindingBody = z
  .object({
    name: z.string().min(1).optional(),
    expectation_kind: EvalExpectationKind.optional(),
  })
  .optional();

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // Composition seam. `EvalRepository` owns both eval tables (C2); the agent
  // and finding reads are satisfied structurally by the repositories that
  // already own THOSE tables, so this slice ships exactly one repository and
  // reaches into no sibling module.
  const service = new EvalService({
    repo: new EvalRepository(app.container.db),
    agents: app.container.agentsRepo,
    findings: app.container.reviewRepo,
    engine: {
      llm: (provider) => app.container.llm(provider),
      parseDiff: app.container.parseDiff,
    },
  });

  // ---- dashboard ----------------------------------------------------------

  app.get('/eval/dashboard', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.dashboard(workspaceId);
  });

  app.get('/eval/batches/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getBatch(workspaceId, req.params.id);
  });

  // ---- cases --------------------------------------------------------------

  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listCases(workspaceId, req.params.id);
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: CreateCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: UpdateCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await service.deleteCase(workspaceId, req.params.id);
    return { ok: true };
  });

  // The DRAFT: what the click opens the editor with. No row is written, so it
  // is a GET and it costs nothing — a case must be a decision, not a side
  // effect of opening a dialog.
  app.get('/findings/:id/eval-case/draft', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.draftFromFinding(workspaceId, req.params.id);
  });

  app.post(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, body: SeedFromFindingBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.seedFromFinding(workspaceId, req.params.id, req.body);
      reply.status(201);
      return created;
    },
  );

  // ---- runs ---------------------------------------------------------------

  app.get('/eval-cases/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listCaseRuns(workspaceId, req.params.id);
  });

  app.post(
    '/eval-cases/:id/run',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const batch = await service.startCase(workspaceId, req.params.id);
      reply.status(202);
      return batch;
    },
  );

  // Dry run: the same engine call and the same scorer a saved case gets, over
  // content that has no row behind it. Paid, so it takes the paid-route rate.
  app.post(
    '/agents/:id/eval-preview',
    {
      schema: { params: IdParams, body: PreviewBody },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.previewCase(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/eval-runs',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const batch = await service.startAll(workspaceId, req.params.id);
      reply.status(202);
      return batch;
    },
  );

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listBatches(workspaceId, req.params.id);
  });

  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.agentDashboard(workspaceId, req.params.id);
  });
}
