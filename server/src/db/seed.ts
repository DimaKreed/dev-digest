import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_SKILLS, SEED_AGENT_SKILLS } from './seed-skills.js';
import { CONTROL_EXPERIMENT_PULLS } from './seed-pulls.js';
import { BUILT_EVAL_CASES } from './seed-evals.js';

/**
 * Patches for the two PR #482 files an eval case can be seeded from.
 *
 * The line numbers the two seeded findings cite (config.ts:12, users.ts:45-52)
 * fall inside these hunks on purpose: a case seeded from a finding whose lines
 * miss the hunk would be dropped by the citation-grounding gate on every run,
 * so it could never pass however good the agent is.
 */
const SEED_CONFIG_PATCH = [
  '@@ -10,4 +10,5 @@',
  ' export const config = {',
  '   port: Number(process.env.PORT ?? 3000),',
  '+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",',
  '   redisUrl: process.env.REDIS_URL,',
  ' };',
].join('\n');

const SEED_USERS_PATCH = [
  '@@ -45,4 +45,8 @@',
  ' export async function listUsers(ids: string[]) {',
  '   const out = [];',
  '+  for (const id of ids) {',
  '+    out.push(await db.user.findById(id));',
  '+  }',
  '   return out;',
  ' }',
].join('\n');

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the four built-in agents (General + Security +
 * Performance + Test Quality) on the default openrouter/deepseek-v4-flash
 * provider+model, the disabled "Security Reviewer (control)" experiment
 * fixture, the demo skills with their agent links, the three
 * control-experiment PRs (#483 skills, #484 API contract, #485 prompt
 * ablation), and the Security Reviewer's starter eval set (SPEC-04) — ten
 * cases of both polarities.
 *
 * NOTE: this creates no `agent_runs`, so every run-derived surface (cost,
 * timeline, per-skill Stats) is legitimately empty until you trigger a review.
 *
 * Course lessons populate the remaining tables (conventions, memory, …)
 * once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    // Two of these carry a real `patch`. That is what makes "Turn into eval
    // case" work on seeded data: the seeding path freezes the stored patch into
    // the case, and a file with no patch is rejected rather than stored as an
    // unusable case (SPEC-04 § Edge cases).
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      {
        prId: pr!.id,
        path: 'src/config.ts',
        additions: 4,
        deletions: 0,
        patch: SEED_CONFIG_PATCH,
      },
      {
        prId: pr!.id,
        path: 'src/api/users.ts',
        additions: 7,
        deletions: 2,
        patch: SEED_USERS_PATCH,
      },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer (control)',
      description:
        'Experiment fixture for the prompt ablation — same prompt as Security Reviewer, no skills attached. Edit this one, not the built-in.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      // Seeded DISABLED, and that is load-bearing rather than tidy: `all: true`
      // resolves through `listEnabled`, so a disabled agent never joins a "Run
      // all" and never costs anything by accident. Running it explicitly by id
      // does NOT check the flag (`ReviewService.resolveTargets`), so it is
      // still one click away in the Run Review dropdown, and eval runs — which
      // resolve the agent by id too — work unchanged.
      enabled: false,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Checks test quality: uncovered branches, missed corner cases, over-mocking, flake risk.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- demo skills + their agent links ----
  // Skills are reusable instruction blocks, shared across agents. Same
  // insert-if-absent idempotency as the agents above: re-seeding never
  // overwrites a skill the user has since edited.
  for (const s of SEED_SKILLS) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, s.name)));
    if (existing) continue;
    const [row] = await db
      .insert(t.skills)
      .values({
        workspaceId,
        name: s.name,
        description: s.description,
        type: s.type,
        source: s.source,
        body: s.body,
        enabled: s.enabled,
        version: 1,
      })
      .returning();
    // v1 body snapshot. The repository does this on its own insert path; the
    // seed writes the table directly, so it must do it here too — otherwise a
    // seeded skill shows an empty Versions tab.
    await db
      .insert(t.skillVersions)
      .values({ skillId: row!.id, version: 1, body: s.body, note: 'Initial version' })
      .onConflictDoNothing();
  }

  for (const [agentName, skillNames] of Object.entries(SEED_AGENT_SKILLS)) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;
    const existingLinks = await db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent.id));
    if (existingLinks.length > 0) continue; // user owns the links once they exist
    for (const [order, skillName] of skillNames.entries()) {
      const [skill] = await db
        .select()
        .from(t.skills)
        .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skillName)));
      if (!skill) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId: skill.id, order })
        .onConflictDoNothing();
    }
  }

  // ---- control-experiment PRs (#483 test quality, #484 API contract,
  // #485 prompt ablation) ----
  // These carry real patches so a review can run with no clone and no token.
  for (const p of CONTROL_EXPERIMENT_PULLS) {
    const [existing] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, p.number)));
    if (existing) continue;
    const [row] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: p.number,
        title: p.title,
        author: p.author,
        branch: p.branch,
        base: 'main',
        headSha: p.headSha,
        additions: p.files.reduce((n, f) => n + f.additions, 0),
        deletions: p.files.reduce((n, f) => n + f.deletions, 0),
        filesCount: p.files.length,
        status: 'needs_review',
        body: p.body,
      })
      .returning();
    await db.insert(t.prFiles).values(
      p.files.map((f) => ({
        prId: row!.id,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      })),
    );
    await db.insert(t.prCommits).values({
      prId: row!.id,
      sha: p.headSha,
      message: p.commitMessage,
      author: p.author,
    });
  }

  // ---- SPEC-04: the eval pipeline's starter state -------------------------
  // Runs AFTER the agents exist, because both halves need the Security
  // Reviewer's id: the seeded review is attributed to it (so its findings have
  // an owning agent and can be turned into eval cases at all — AC-03), and the
  // starter case set is owned by it.
  const [security] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));

  if (security) {
    // Back-fill the two patches an eval case is frozen from.
    //
    // They are ALSO written in the PR-creation branch above, and that branch is
    // guarded by `if (!pr)`, so on any database that already ran an older seed
    // the columns are still null — and "Turn into eval case" then fails with
    // "no stored patch" on exactly the finding the demo is built around. A seed
    // change that enriches an existing row has to run outside the creation
    // guard, keyed per row so re-running it overwrites nothing.
    const patches: Record<string, string> = {
      'src/config.ts': SEED_CONFIG_PATCH,
      'src/api/users.ts': SEED_USERS_PATCH,
    };
    for (const [path, patch] of Object.entries(patches)) {
      await db
        .update(t.prFiles)
        .set({ patch })
        .where(and(eq(t.prFiles.path, path), isNull(t.prFiles.patch)));
    }

    // Attribute the seeded review, and LABEL its two findings — one accepted,
    // one dismissed. Those labels are the dataset: a fresh checkout otherwise
    // has no accept/dismiss history, and the one-click seeding path has nothing
    // to demonstrate either polarity with.
    const seededReviews = await db
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.model, 'seed')));
    for (const review of seededReviews) {
      if (!review.agentId) {
        await db
          .update(t.reviews)
          .set({ agentId: security.id })
          .where(eq(t.reviews.id, review.id));
      }
      const rows = await db.select().from(t.findings).where(eq(t.findings.reviewId, review.id));
      for (const f of rows) {
        if (f.acceptedAt || f.dismissedAt) continue;
        // The Stripe key is a real leak (accepted → must_find); the N+1 is a
        // known, tracked trade-off in this demo (dismissed → must_not_flag).
        const accepted = f.category === 'security';
        await db
          .update(t.findings)
          .set(accepted ? { acceptedAt: new Date() } : { dismissedAt: new Date() })
          .where(eq(t.findings.id, f.id));
      }
    }

    // The starter eval set. Idempotent by (owner, name), like the agents and
    // skills above: re-seeding never overwrites a case the user has since
    // edited, and never duplicates one.
    for (const c of BUILT_EVAL_CASES) {
      const [existing] = await db
        .select()
        .from(t.evalCases)
        .where(
          and(
            eq(t.evalCases.workspaceId, workspaceId),
            eq(t.evalCases.ownerId, security.id),
            eq(t.evalCases.name, c.name),
          ),
        );
      if (existing) continue;
      await db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: security.id,
        name: c.name,
        expectationKind: c.expectationKind,
        inputDiff: c.inputDiff,
        inputMeta: { title: c.name },
        expectedOutput: [c.expectation],
        notes: c.notes,
      });
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint. See the note in migrate.ts — a `file://${argv[1]}` template
// never matches import.meta.url on Windows, so this block silently never ran.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
