import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { renderPrompt } from '../../platform/prompts.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * brief module — one generated merge-risk brief per pull request.
 *
 *   GET  /pulls/:id/brief           → the stored brief, its staleness, availability
 *   POST /pulls/:id/brief/generate  → generate (ONE model call) and persist
 *
 * Both routes validate `:id` through the shared uuid schema, so a malformed
 * identifier is a 422 before any handler body runs (AC-23), and both resolve
 * the workspace through `getContext` before the service does anything — the
 * read path is scoped exactly like the write path, with no "it's only a GET"
 * exception. The workspace-scoped pull lookup inside the service is the
 * authorization boundary (AC-22); the brief row itself carries no workspace.
 *
 * The GET makes no model call and costs nothing (AC-14), so it carries no
 * per-route limit and the global one still applies. The POST spends money on
 * every request, so it takes the house rate for paid routes — the same ceiling
 * as `blast/routes.ts` and `onboarding/routes.ts`. The global 120/min would
 * otherwise allow 120 billed generations a minute. The limiter plugin is not
 * registered under `NODE_ENV=test`, where this config is inert.
 *
 * No `response:` schemas, matching every other route in this package; the
 * contracts are proved by parsing the bodies in the tests instead.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  // Composition seam: the container is a transport concern, so the service gets
  // the ports it actually uses (H7) rather than the whole world. `briefRepo`
  // owns `pr_brief`; `reviewRepo`, `repoIntel` and `contextRepo` already own the
  // tables and reads behind the other three ports and satisfy them structurally,
  // so this slice ships exactly one repository of its own (C2).
  const service = new BriefService({
    brief: app.container.briefRepo,
    pulls: app.container.reviewRepo,
    intel: app.container.repoIntel,
    context: app.container.contextRepo,
    llm: (provider) => app.container.llm(provider),
    github: () => app.container.github(),
    git: app.container.git,
    secrets: app.container.secrets,
    tokenizer: app.container.tokenizer,
    renderPrompt,
    // AC-08 — read off the config, not recovered from the facade: the facade
    // short-circuits on the flag before it would stamp `flag_off`.
    repoIntelEnabled: app.container.config.repoIntelEnabled,
  });

  app.get('/pulls/:id/brief', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.read(workspaceId, req.params.id);
  });

  app.post(
    '/pulls/:id/brief/generate',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.id);
    },
  );
}
