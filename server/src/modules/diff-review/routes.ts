import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { DiffReviewRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { DiffReviewService } from './service.js';

/**
 * diff-review module.
 *   POST /reviews/diff → DiffReviewResponse
 *
 * Reviews a patch that belongs to no pull request, so a change can be checked
 * before it is pushed. `devdigest review --mode working` in the mcp package is
 * the caller this was built for; it stays a plain HTTP client rather than
 * growing its own copy of the review pipeline.
 *
 * Rate-limited like the PR review route: this one also spends money and takes
 * real time, and the two should not have different ceilings just because one is
 * driven from a terminal.
 */
export default async function diffReviewRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  const service = new DiffReviewService({
    agents: app.container.agentsRepo,
    llm: (provider) => app.container.llm(provider),
    parseDiff: app.container.parseDiff,
  });

  app.post(
    '/reviews/diff',
    {
      schema: { body: DiffReviewRequest },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      // A hang-up is the normal end of a CLI review that outran its own
      // deadline. Without this the handler runs to completion and spends the
      // full token budget on a body nothing will read.
      let abandoned = false;
      req.raw.on('close', () => {
        abandoned = true;
      });
      return service.review(workspaceId, { ...req.body, abandoned: () => abandoned });
    },
  );
}
