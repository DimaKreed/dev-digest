import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * smart-diff module.
 *   GET /pulls/:id/smart-diff → SmartDiffResponse (risk-ordered file groups)
 *
 * A pure read: it joins `pr_files` against findings already in the DB and orders
 * them with the ring-0 classifier. No LLM call, so no per-route rate limit —
 * there is no money in this path and the global limiter still applies.
 *
 * No `response:` schema, matching every other route in this package (zero
 * `response:` declarations exist today); the contract is proved by parsing the
 * body with `SmartDiffResponse` in the tests instead.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Composition seam: `container.reviewRepo` already owns `pr_files`, `reviews`
  // and `findings` (rule C2), and satisfies `SmartDiffReads` structurally, so
  // this slice ships no repository of its own.
  const service = new SmartDiffService({ reads: app.container.reviewRepo });

  app.get('/pulls/:id/smart-diff', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.build(workspaceId, req.params.id);
  });
}
