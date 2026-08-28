import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { OnboardingService } from './service.js';

/**
 * Onboarding module — one five-section tour per repository.
 *
 *   POST /repos/:id/onboarding/generate  → generate (ONE model call) and persist
 *   GET  /repos/:id/onboarding           → the stored tour + how honest it is
 *
 * Both routes validate `:id` through the shared uuid schema, so a malformed
 * identifier is a 422 before any handler body runs, and both resolve the
 * workspace through `getContext` before the service does anything: the read
 * path is scoped exactly like the write path, with no "it's only a GET"
 * exception. The tour row itself carries no workspace, so the service resolves
 * tenancy through the owning repository on every call.
 */
export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Composition seam: the container is a transport concern, so the service gets
  // the ports it actually uses (H7) rather than the whole world.
  const service = new OnboardingService({
    onboarding: app.container.onboardingRepo,
    repoIntel: app.container.repoIntel,
    llm: (provider) => app.container.llm(provider),
    git: app.container.git,
    secrets: app.container.secrets,
    repoIntelEnabled: app.container.config.repoIntelEnabled,
  });

  app.post('/repos/:id/onboarding/generate', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.generate(workspaceId, req.params.id);
  });

  app.get('/repos/:id/onboarding', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.read(workspaceId, req.params.id);
  });
}
