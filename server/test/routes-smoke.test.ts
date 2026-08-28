import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';

/**
 * No-DB route smoke tests via app.inject(). `/health` and the validation/error
 * envelope don't touch the database (postgres-js connects lazily), so these run
 * without Docker. DB-backed routes are covered in integration.test.ts.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('routes (no DB)', () => {
  it('GET /health → ok', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('POST /settings/test-connection (github) returns structured ConnTestResult', async () => {
    const app = await buildApp({
      config,
      overrides: { github: new MockGitHubClient({ login: 'octocat' }) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'github' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('github');
    expect(body.ok).toBe(true);
    expect(body.message).toContain('octocat');
    await app.close();
  });

  it('POST /settings/test-connection (openai) uses injected LLM listModels', async () => {
    const app = await buildApp({
      config,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { models: [{ id: 'gpt-4.1', provider: 'openai' }] }) },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'openai' },
    });
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  /**
   * SPEC-01 — the context attach body, in the DB-FREE lane.
   *
   * The plan's W6 done-when requires a 422 from `PUT /agents/:id/context` with
   * `{ paths: "x" }`. It belongs here rather than in `context.it.test.ts`
   * because `body: SetContextBody` is declared on the route, so the type
   * provider rejects BEFORE the handler runs and no database is ever reached —
   * which also means it is the only one of that done-when's three results that
   * survives on a Docker-less runner (see the report's `## Not covered` for the
   * 200 and 404 halves, which cannot).
   */
  it('SPEC-01 W6 — PUT /agents/:id/context rejects a malformed body with 422, before any handler or DB', async () => {
    const app = await buildApp({ config });
    const agentId = '11111111-1111-4111-8111-111111111111';

    // `paths` is an ARRAY of strings; a bare string must not be coerced.
    const stringPaths = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context`,
      payload: { repo_id: '22222222-2222-4222-8222-222222222222', paths: 'x' },
    });
    expect(stringPaths.statusCode).toBe(422);
    expect(stringPaths.json().error.code).toBe('validation_error');

    // The same guard covers the other required field and the skill route, so a
    // missing repo_id never reaches a query either.
    const noRepo = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/context`,
      payload: { paths: ['specs/public-api.md'] },
    });
    expect(noRepo.statusCode).toBe(422);

    const skill = await app.inject({
      method: 'PUT',
      url: `/skills/${agentId}/context`,
      payload: { repo_id: 'not-a-uuid', paths: ['specs/public-api.md'] },
    });
    expect(skill.statusCode).toBe(422);

    await app.close();
  });

  it('returns 422 structured error on invalid body', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'not-a-provider' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});
