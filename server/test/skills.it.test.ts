import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills module — CRUD, body versioning, restore, stats, and the import
 * preview's no-write guarantee.
 */
d('skills module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const body = {
    name: 'no-console-log',
    description: 'Flag console.log left in production code.',
    type: 'convention' as const,
    body: '# No console.log\n\nFlag any console.log in non-test code.',
  };

  it('creates a skill with v1 recorded and computed tokens/used_by', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: body });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill).toMatchObject({ name: body.name, type: 'convention', version: 1, used_by: 0 });
    // Counted server-side by the tokenizer, so it must be a real positive number.
    expect(skill.tokens).toBeGreaterThan(0);

    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);
    expect(versions.json()[0]).toMatchObject({ version: 1, body: body.body });
    await app.close();
  });

  it('a BODY edit bumps the version and snapshots; other edits do not', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...body, name: 'versioning-probe' },
    });
    const id = created.json().id as string;

    // Rename only — no new version.
    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { name: 'versioning-probe-2' },
    });
    expect(renamed.json().version).toBe(1);

    // Toggling enabled — still no new version.
    const toggled = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { enabled: false },
    });
    expect(toggled.json().version).toBe(1);

    // Body change — versions.
    const edited = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: '# Changed\n\nNew rule.', note: 'Tightened the rule' },
    });
    expect(edited.json().version).toBe(2);

    const versions = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect(versions.json()).toHaveLength(2);
    // Newest first, and the note is carried.
    expect(versions.json()[0]).toMatchObject({ version: 2, note: 'Tightened the rule' });
    await app.close();
  });

  it('restore writes a NEW version rather than rewriting history', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...body, name: 'restore-probe', body: '# v1 body' },
    });
    const id = created.json().id as string;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: '# v2 body' } });

    const restored = await app.inject({
      method: 'POST',
      url: `/skills/${id}/versions/1/restore`,
    });
    expect(restored.statusCode).toBe(200);
    // v3 carrying v1's text — v1 and v2 are untouched.
    expect(restored.json()).toMatchObject({ version: 3, body: '# v1 body' });

    const versions = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect(versions.json().map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(versions.json().find((v: { version: number }) => v.version === 1).body).toBe('# v1 body');
    await app.close();
  });

  it('reports used_by from agent_skills, and stats are all zero with no runs', async () => {
    const app = await makeApp();
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'Test Quality Reviewer'));
    const [skill] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.name, 'test-coverage-nudge'));

    const stats = await app.inject({ method: 'GET', url: `/skills/${skill!.id}/stats` });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({
      used_by: 1,
      runs_pulled: 0,
      findings_30d: 0,
      accepted: 0,
      dismissed: 0,
      // null, not 0 — nothing has been triaged, which is not "0% accepted".
      accept_rate: null,
      findings_by_category: [],
    });
    expect(stats.json().agents).toEqual([{ id: agent!.id, name: 'Test Quality Reviewer' }]);

    const list = await app.inject({ method: 'GET', url: '/skills' });
    const seeded = list.json().find((s: { name: string }) => s.name === 'test-coverage-nudge');
    expect(seeded.used_by).toBe(1);
    await app.close();
  });

  it('deleting a skill unlinks it from its agents', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { ...body, name: 'doomed-skill' },
    });
    const skillId = created.json().id as string;
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'General Reviewer'));

    await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_id: skillId },
    });
    const del = await app.inject({ method: 'DELETE', url: `/skills/${skillId}` });
    expect(del.statusCode).toBe(200);

    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId));
    expect(links).toHaveLength(0);
    await app.close();
  });

  /**
   * "Linked ⇒ enabled" is an invariant, not a UI hint. Two halves keep it true:
   * a disabled skill cannot be attached, and disabling one detaches it.
   */
  describe('linked implies enabled', () => {
    async function makeAgent(app: Awaited<ReturnType<typeof makeApp>>, name: string) {
      const res = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'x' },
      });
      return res.json() as { id: string };
    }

    it('rejects attaching a disabled skill, naming it, and links nothing', async () => {
      const app = await makeApp();
      const agent = await makeAgent(app, 'GateAgent');
      const created = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...body, name: 'off-rule', enabled: false },
      });
      const skillId = created.json().id as string;

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [skillId] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('skill_disabled');
      expect(res.json().error.message).toContain('off-rule');

      // The whole request is rejected — nothing was written.
      const links = await pg.handle.db
        .select()
        .from(t.agentSkills)
        .where(eq(t.agentSkills.agentId, agent.id));
      expect(links).toHaveLength(0);
      await app.close();
    });

    it('rejects the single-skill link form too', async () => {
      const app = await makeApp();
      const agent = await makeAgent(app, 'GateAgentSingle');
      const created = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...body, name: 'off-rule-single', enabled: false },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_id: created.json().id },
      });
      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('a mixed batch is rejected whole — an enabled sibling is not partially linked', async () => {
      const app = await makeApp();
      const agent = await makeAgent(app, 'MixedBatchAgent');
      const good = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...body, name: 'batch-on' },
      });
      const bad = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...body, name: 'batch-off', enabled: false },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [good.json().id, bad.json().id] },
      });
      expect(res.statusCode).toBe(400);
      const links = await pg.handle.db
        .select()
        .from(t.agentSkills)
        .where(eq(t.agentSkills.agentId, agent.id));
      expect(links).toHaveLength(0);
      await app.close();
    });

    it('disabling a linked skill detaches it from every agent', async () => {
      const app = await makeApp();
      const a1 = await makeAgent(app, 'DetachA');
      const a2 = await makeAgent(app, 'DetachB');
      const created = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...body, name: 'detach-me' },
      });
      const skillId = created.json().id as string;

      for (const a of [a1, a2]) {
        await app.inject({
          method: 'POST',
          url: `/agents/${a.id}/skills`,
          payload: { skill_ids: [skillId] },
        });
      }
      expect(
        (await app.inject({ method: 'GET', url: `/skills/${skillId}` })).json().used_by,
      ).toBe(2);

      const disabled = await app.inject({
        method: 'PUT',
        url: `/skills/${skillId}`,
        payload: { enabled: false },
      });
      expect(disabled.statusCode).toBe(200);
      expect(disabled.json().enabled).toBe(false);
      expect(disabled.json().used_by).toBe(0);

      const links = await pg.handle.db
        .select()
        .from(t.agentSkills)
        .where(eq(t.agentSkills.skillId, skillId));
      expect(links).toHaveLength(0);

      // Re-enabling does NOT restore the links — they were deleted, and the UI
      // warns about exactly that before disabling.
      await app.inject({ method: 'PUT', url: `/skills/${skillId}`, payload: { enabled: true } });
      const after = await pg.handle.db
        .select()
        .from(t.agentSkills)
        .where(eq(t.agentSkills.skillId, skillId));
      expect(after).toHaveLength(0);
      await app.close();
    });

    it('editing a disabled skill without touching `enabled` does not re-run the cascade', async () => {
      const app = await makeApp();
      const created = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...body, name: 'already-off', enabled: false },
      });
      const skillId = created.json().id as string;
      // Renaming an already-disabled skill is not a true→false transition.
      const res = await app.inject({
        method: 'PUT',
        url: `/skills/${skillId}`,
        payload: { name: 'already-off-renamed' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().enabled).toBe(false);
      await app.close();
    });
  });

  it('404s an unknown skill and 422s a non-uuid id', async () => {
    const app = await makeApp();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/skills/${missing}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/skills/${missing}/stats` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/skills/not-a-uuid' })).statusCode).toBe(422);
    await app.close();
  });

  describe('POST /skills/import/preview', () => {
    function multipart(filename: string, content: Uint8Array) {
      const boundary = '----devdigesttest';
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`,
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      return {
        payload: Buffer.concat([head, Buffer.from(content), tail]),
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      };
    }

    it('extracts SKILL.md from an archive and never reads the executable', async () => {
      const app = await makeApp();
      const archive = zipSync({
        'SKILL.md': strToU8('---\nname: imported-rule\n---\n\n# Imported rule\n\nBe strict.'),
        'scripts/detect.sh': strToU8('#!/usr/bin/env bash\necho PWNED\n'),
      });
      const before = await pg.handle.db.select().from(t.skills);

      const res = await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        ...multipart('bundle.zip', archive),
      });
      expect(res.statusCode).toBe(200);
      const preview = res.json();
      expect(preview.name).toBe('imported-rule');
      expect(preview.source_file).toBe('SKILL.md');
      expect(preview.body).not.toContain('PWNED');
      expect(preview.tokens).toBeGreaterThan(0);
      expect(preview.skipped).toEqual([
        { path: 'scripts/detect.sh', reason: 'executable' },
      ]);

      // The preview endpoint writes NOTHING — saving is a separate POST /skills.
      const after = await pg.handle.db.select().from(t.skills);
      expect(after).toHaveLength(before.length);
      await app.close();
    });

    it('accepts a plain .md upload', async () => {
      const app = await makeApp();
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        ...multipart('rule.md', strToU8('# Plain rule\n\nDo the thing.')),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Plain rule', source_file: 'rule.md', skipped: [] });
      await app.close();
    });

    it('400s an archive with no markdown in it', async () => {
      const app = await makeApp();
      const archive = zipSync({ 'run.sh': strToU8('echo hi') });
      const res = await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        ...multipart('bad.zip', archive),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_skill_import');
      await app.close();
    });
  });

  it('seeds skills with their agent links and a v1 snapshot', async () => {
    const [skill] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.name, 'pr-quality-rubric'));
    expect(skill).toBeDefined();

    const versions = await pg.handle.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skill!.id));
    expect(versions).toHaveLength(1);

    // The imported sample seeds DISABLED — enabling a stranger's instructions
    // is a deliberate act.
    const [imported] = await pg.handle.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.name, 'phantom-api-gate'));
    expect(imported!.enabled).toBe(false);
    expect(imported!.source).toBe('imported_file');

    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.name, 'Test Quality Reviewer'));
    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent!.id));
    expect(links).toHaveLength(2);
    // Order is prompt order.
    expect(links.sort((a, b) => a.order - b.order)[0]!.skillId).toBe(
      (
        await pg.handle.db
          .select()
          .from(t.skills)
          .where(eq(t.skills.name, 'test-coverage-nudge'))
      )[0]!.id,
    );
  });

  it('seeds the two control-experiment PRs with real patches', async () => {
    const prs = await pg.handle.db.select().from(t.pullRequests);
    const numbers = prs.map((p) => p.number).sort((a, b) => a - b);
    expect(numbers).toEqual(expect.arrayContaining([482, 483, 484]));

    const [pr483] = prs.filter((p) => p.number === 483);
    const files = await pg.handle.db
      .select()
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, pr483!.id));
    // Patches are what diffFromPrFiles reconstructs the diff from, so a review
    // can run with no clone and no GitHub token.
    expect(files.every((f) => (f.patch ?? '').includes('@@'))).toBe(true);
  });

  it('is idempotent — re-seeding creates no duplicate skills or links', async () => {
    const before = await pg.handle.db.select().from(t.skills);
    await seed(pg.handle.db);
    const after = await pg.handle.db.select().from(t.skills);
    expect(after).toHaveLength(before.length);

    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.name, 'Test Quality Reviewer')));
    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent!.id));
    expect(links).toHaveLength(2);
  });
});
