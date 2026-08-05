import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillSource, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { SkillImportError } from './helpers.js';

/**
 * Skills module — reusable, agent-agnostic instruction blocks.
 *
 *   GET    /skills                              → list (workspace-scoped)
 *   GET    /skills/:id                          → one skill
 *   POST   /skills                              → create (records v1)
 *   PUT    /skills/:id                          → update; a BODY change versions
 *   DELETE /skills/:id                          → delete (links cascade)
 *   GET    /skills/:id/versions                 → body history, newest first
 *   POST   /skills/:id/versions/:version/restore→ restore as a NEW version
 *   GET    /skills/:id/stats                    → per-skill rollup
 *   POST   /skills/import/preview               → parse .md/.zip, WRITES NOTHING
 *   POST   /skills/import/url                   → fetch + parse a URL, WRITES NOTHING
 *
 * Linking a skill to an agent lives on the agents module
 * (`POST /agents/:id/skills`), which owns the `agent_skills` write side.
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: SkillType,
  source: SkillSource.optional(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
  note: z.string().optional(),
  /** Provenance for a generated skill — the files its rules were verified in. */
  evidence_files: z.array(z.string()).optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  note: z.string().optional(),
});

/**
 * `z.string().url()` accepts `http:`/`file:`/`javascript:` too — it only checks
 * that the string parses. The scheme allow-list and the SSRF guard live in the
 * HttpFetcher adapter, which is the single place that can enforce them for
 * every hop of a redirect chain. This schema is a shape check, nothing more.
 */
const ImportUrlBody = z.object({
  url: z.string().url().max(2048),
});

const VersionParams = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const b = req.body;
    const skill = await service.create(workspaceId, {
      name: b.name,
      type: b.type,
      body: b.body,
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.source !== undefined ? { source: b.source } : {}),
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
      ...(b.note !== undefined ? { note: b.note } : {}),
      ...(b.evidence_files !== undefined ? { evidenceFiles: b.evidence_files } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put('/skills/:id', { schema: { params: IdParams, body: UpdateSkillBody } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.update(workspaceId, req.params.id, req.body);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: VersionParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(workspaceId, req.params.id, req.params.version);
      if (!skill) throw new NotFoundError('Skill version not found');
      return skill;
    },
  );

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.stats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  /**
   * Parse an uploaded .md/.zip and return a preview. This route performs NO
   * writes — that is the guarantee behind "збереження лише після підтвердження".
   * Saving is an explicit POST /skills once the user has read the body.
   *
   * No `schema.body`: the payload is a multipart stream, not JSON.
   */
  app.post('/skills/import/preview', async (req) => {
    await getContext(app.container, req);
    const file = await req.file();
    if (!file) throw new ValidationError('No file uploaded');
    const bytes = new Uint8Array(await file.toBuffer());
    // `await` inside the try is load-bearing: previewImport is async now (it
    // awaits the injection scan), so a bare `return` would let a rejection skip
    // this catch entirely and surface as a 500 instead of a 400.
    try {
      return await service.previewImport(file.filename, bytes);
    } catch (err) {
      if (err instanceof SkillImportError) {
        throw new AppError('invalid_skill_import', err.message, 400);
      }
      throw err;
    }
  });

  /**
   * Fetch a skill from a URL and return the same preview shape. Like the file
   * route this WRITES NOTHING — saving is still an explicit POST /skills.
   *
   * Everything that makes a user-supplied URL safe to GET (https-only, no
   * private/loopback/link-local target, byte cap, timeout, per-hop redirect
   * re-validation) lives in the HttpFetcher adapter, not here.
   */
  app.post('/skills/import/url', { schema: { body: ImportUrlBody } }, async (req) => {
    await getContext(app.container, req);
    try {
      return await service.previewImportUrl(req.body.url);
    } catch (err) {
      if (err instanceof SkillImportError) {
        throw new AppError('invalid_skill_import', err.message, 400);
      }
      throw err;
    }
  });
}
