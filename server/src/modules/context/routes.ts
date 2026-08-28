import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ContextAttachment,
  ContextSearchRoot,
  SetContextBody,
  SpecFile,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ContextService } from './service.js';

/**
 * Project context — the repository's own markdown, attached to agents and
 * skills and injected into their prompts.
 *
 *   GET /repos/:id/context        → every discovered document (live fs read)
 *   GET /repos/:id/context/roots  → which directories were searched
 *   GET /repos/:id/context/file   → one document's markdown, read-only
 *   GET /agents/:id/context       → this agent's ordered attachment set
 *   PUT /agents/:id/context       → replace that whole set in one request
 *   GET /skills/:id/context       → same, for a skill
 *   PUT /skills/:id/context       → same, for a skill
 *
 * The attach endpoints live in THIS slice rather than in `agents` / `skills`
 * because this slice owns the two attachment tables — one repository per table
 * — and a Fastify plugin declares full paths, so nothing about serving
 * `/agents/:id/...` from here couples the two modules.
 *
 * Every handler resolves the workspace through `getContext` and every query is
 * workspace-scoped: an agent id from another workspace 404s rather than
 * exposing or overwriting its attachment set.
 */

const RepoQuery = z.object({ repo_id: z.string().uuid() });
const FileQuery = z.object({ path: z.string().min(1).max(1024) });

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ContextService({
    context: app.container.contextRepo,
    git: app.container.git,
    tokenizer: app.container.tokenizer,
    contextRoots: app.container.config.contextRoots,
  });

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams, response: { 200: z.array(SpecFile) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.list(workspaceId, req.params.id);
    },
  );

  // Sibling of the listing, not a field on it: the listing is an array of
  // documents and the empty state — the one surface that must name the roots —
  // has no document to hang them off.
  app.get(
    '/repos/:id/context/roots',
    { schema: { params: IdParams, response: { 200: z.array(ContextSearchRoot) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.searchRoots(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/context/file',
    { schema: { params: IdParams, querystring: FileQuery, response: { 200: SpecFile } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.preview(workspaceId, req.params.id, req.query.path);
    },
  );

  app.get(
    '/agents/:id/context',
    {
      schema: {
        params: IdParams,
        querystring: RepoQuery,
        response: { 200: z.array(ContextAttachment) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listForParent('agent', workspaceId, req.params.id, req.query.repo_id);
    },
  );

  app.put(
    '/agents/:id/context',
    {
      schema: {
        params: IdParams,
        body: SetContextBody,
        response: { 200: z.array(ContextAttachment) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setForParent(
        'agent',
        workspaceId,
        req.params.id,
        req.body.repo_id,
        req.body.paths,
      );
    },
  );

  app.get(
    '/skills/:id/context',
    {
      schema: {
        params: IdParams,
        querystring: RepoQuery,
        response: { 200: z.array(ContextAttachment) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listForParent('skill', workspaceId, req.params.id, req.query.repo_id);
    },
  );

  app.put(
    '/skills/:id/context',
    {
      schema: {
        params: IdParams,
        body: SetContextBody,
        response: { 200: z.array(ContextAttachment) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setForParent(
        'skill',
        workspaceId,
        req.params.id,
        req.body.repo_id,
        req.body.paths,
      );
    },
  );
}
