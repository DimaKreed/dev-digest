import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { renderPrompt } from '../../platform/prompts.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastNotesService } from './notes-service.js';
import { BlastService } from './service.js';

/**
 * blast module.
 *   GET  /pulls/:id/blast               → BlastRadiusResponse (the map)
 *   POST /pulls/:id/blast/history-notes → BlastHistoryNotes (prose, generated)
 *
 * The GET is a pure read over the already-built code index: no clone is opened,
 * no AST is rebuilt, no generation happens. It therefore carries no per-route
 * rate limit, matching `smart-diff` — the reverse-import walk is a fixed two
 * queries whatever the repo's size, the fan-out is capped, and there is no money
 * in the path. The global limiter still applies.
 *
 * The POST is the opposite on every count, so it takes the house rate for paid
 * routes. The two are separate services precisely so that the split is visible
 * here rather than buried in one class.
 *
 * No `response:` schemas, matching every other route in this package; the
 * contracts are proved by parsing the bodies in the tests instead.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // Composition seam: `container.reviewRepo` owns pull_requests/pr_files and
  // `container.repoIntel` is the facade over the index tables. Both satisfy the
  // narrow ports structurally, so this slice ships no repository of its own.
  const service = new BlastService({
    pulls: app.container.reviewRepo,
    intel: app.container.repoIntel,
  });

  const notes = new BlastNotesService({
    pulls: app.container.reviewRepo,
    llm: (provider) => app.container.llm(provider),
    renderPrompt,
  });

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.build(workspaceId, req.params.id);
  });

  app.post(
    '/pulls/:id/blast/history-notes',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return notes.annotate(workspaceId, req.params.id);
    },
  );
}
