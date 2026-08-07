import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module — house rules mined from a repo's own code.
 *
 *   POST   /repos/:id/conventions/extract      → scan: propose → VERIFY → persist
 *   GET    /repos/:id/conventions              → this repo's candidate set
 *   PATCH  /conventions/:id                    → triage (accept/reject) or edit
 *   POST   /repos/:id/conventions/skill-draft  → merged skill markdown (no write)
 *   POST   /repos/:id/conventions/link-skill   → stamp a saved skill's id on rows
 *   GET    /repos/:id/conventions/plugin       → PluginBundle of accepted rules
 *
 * Saving the draft as a real skill is a separate, explicit POST /skills by the
 * client — which is what keeps this module free of any dependency on
 * `modules/skills`.
 */

const PatchConventionBody = z.object({
  status: ConventionStatus.optional(),
  rule: z.string().min(1).optional(),
  category: ConventionCategory.optional(),
});

const SkillDraftBody = z.object({
  convention_ids: z.array(z.string().uuid()).min(1),
});

const LinkSkillBody = z.object({
  skill_id: z.string().uuid(),
  convention_ids: z.array(z.string().uuid()).min(1),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Composition seam: the container is a transport/root concern, so the service
  // gets the four ports it actually uses (H7) rather than the whole world.
  const service = new ConventionsService({
    conventions: app.container.conventionsRepo,
    repoIntel: app.container.repoIntel,
    llm: (provider) => app.container.llm(provider),
    git: app.container.git,
  });

  app.post('/repos/:id/conventions/extract', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.extract(workspaceId, req.params.id);
  });

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: PatchConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.patch(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams, body: SkillDraftBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillDraft(workspaceId, req.params.id, req.body.convention_ids);
    },
  );

  app.post(
    '/repos/:id/conventions/link-skill',
    { schema: { params: IdParams, body: LinkSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.linkSkill(
        workspaceId,
        req.params.id,
        req.body.skill_id,
        req.body.convention_ids,
      );
    },
  );

  app.get('/repos/:id/conventions/plugin', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.pluginBundle(workspaceId, req.params.id);
  });
}
