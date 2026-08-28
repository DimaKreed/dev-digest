import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import { Review } from '@devdigest/shared';
import {
  MockLLMProvider,
  MockGitClient,
  MockGitHubClient,
  MockCodeIndex,
  MockEmbedder,
} from '../src/adapters/mocks.js';
import { assemblePrompt } from '../src/platform/prompt.js';
import { groundFindings } from '../src/platform/grounding.js';
import { estimateCost } from '../src/adapters/llm/pricing.js';

describe('mock adapters (no network)', () => {
  it('MockGitClient.diff parses into hunks with new line numbers', async () => {
    const git = new MockGitClient();
    const diff = await git.diff();
    expect(diff.files[0]!.path).toBe('src/config.ts');
    expect(diff.files[0]!.hunks[0]!.newLineNumbers.length).toBeGreaterThan(0);
  });

  it('MockGitHubClient records posted reviews and opened PRs', async () => {
    const gh = new MockGitHubClient();
    await gh.postReview({ owner: 'a', name: 'b' }, 482, { body: 'x', event: 'COMMENT' });
    expect(gh.posted).toHaveLength(1);
    const { url } = await gh.openPullRequest({ owner: 'a', name: 'b' }, {
      title: 't',
      head: 'h',
      base: 'main',
      body: 'b',
    });
    expect(url).toContain('github.com');
  });

  it('MockCodeIndex + MockEmbedder return deterministic shapes', async () => {
    const ci = new MockCodeIndex();
    expect((await ci.symbols({ owner: 'a', name: 'b' }))[0]!.name).toBe('rateLimit');
    const emb = await new MockEmbedder().embed(['a', 'b']);
    expect(emb[0]!).toHaveLength(1536);
  });
});

describe('structured review pipeline (mock LLM → grounding)', () => {
  it('runs assemble → completeStructured(Review) → groundFindings end-to-end', async () => {
    // a fixture review where one finding is grounded and one is hallucinated
    const fixture = {
      verdict: 'request_changes',
      summary: 'secret key committed',
      score: 38,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'sk_live in diff',
          confidence: 0.98,
          kind: 'finding',
        },
        {
          id: 'f-hallucinated',
          severity: 'WARNING',
          category: 'bug',
          title: 'phantom finding on a line not in the diff',
          file: 'src/config.ts',
          start_line: 999,
          end_line: 999,
          rationale: 'not real',
          confidence: 0.3,
          kind: 'finding',
        },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const git = new MockGitClient();
    const diff = await git.diff();

    const { messages } = assemblePrompt({
      system: 'security reviewer',
      diff: diff.raw,
      task: 'Review PR #482',
    });
    const result = await llm.completeStructured({
      model: 'gpt-4.1',
      schema: Review,
      schemaName: 'Review',
      messages,
    });
    expect(result.data.findings).toHaveLength(2);

    const grounded = groundFindings(result.data.findings, diff);
    expect(grounded.kept).toHaveLength(1); // the real one survives
    expect(grounded.kept[0]!.id).toBe('f1');
    expect(grounded.dropped[0]!.finding.id).toBe('f-hallucinated');
    expect(llm.calls.find((c) => c.method === 'completeStructured')).toBeTruthy();
  });
});

describe('pricing / cost discipline', () => {
  it('estimates cost for known models and returns null for unknown', () => {
    expect(estimateCost('gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15, 5);
    expect(estimateCost('some-future-model', 1000, 1000)).toBeNull();
  });
});

/**
 * A file symlink needs privilege on Windows (`EPERM` unprivileged), while a
 * directory `junction` does not. The file-symlink case below therefore
 * SELF-SKIPS on this platform rather than being absorbed into the directory
 * case and reported as a pass — it runs on Linux CI, where both are available.
 * Top-level await, the same shape the integration lane's Docker gate uses.
 */
const canFileSymlink = await (async () => {
  const probe = await mkdtemp(join(tmpdir(), 'devdigest-symprobe-'));
  try {
    await writeFile(join(probe, 'target'), 'x');
    await symlink(join(probe, 'target'), join(probe, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
})();
const itFileLink = canFileSymlink ? it : it.skip;

if (!canFileSymlink) {
  console.warn('[adapters] file symlinks unavailable (EPERM) — the symlinked-FILE case is SKIPPED.');
}

/**
 * SPEC-01 — `SimpleGitClient.listFiles`, the clone-contained discovery read.
 *
 * Spec-first, derived from `specs/01-project-context-documents.md`: AC-01
 * (recursive `.md` read of the clone under configured roots), AC-24 (a path
 * resolving outside the clone is refused), AC-40 (the per-file size limit is a
 * MARKING decision above this adapter — an oversized file is still listed here)
 * and the spec's `## Untrusted inputs` symlink attack: a `docs/plan.md` link to
 * `~/.devdigest/secrets.json`.
 *
 * This is the one real-filesystem test in the unit lane: `MockGitClient` cannot
 * express a symlink at all, so containment is unassertable through it.
 */
describe('SimpleGitClient.listFiles — clone containment (real filesystem)', () => {
  const OWNER = 'acme';
  const NAME = 'payments-api';
  const repo = { owner: OWNER, name: NAME };
  const OVERSIZED = 500 * 1024;

  /** A clone tree plus a secret OUTSIDE it, which nothing may reach. */
  async function makeClone(): Promise<{ cloneDir: string; clone: string; secret: string }> {
    const cloneDir = await mkdtemp(join(tmpdir(), 'devdigest-listfiles-'));
    const clone = join(cloneDir, OWNER, NAME);
    await mkdir(join(clone, 'specs', 'nested'), { recursive: true });
    await mkdir(join(clone, 'docs', 'node_modules'), { recursive: true });
    await writeFile(join(clone, 'specs', 'public-api.md'), '# Public API\n');
    await writeFile(join(clone, 'specs', 'nested', 'deep.md'), '# Deep\n');
    await writeFile(join(clone, 'specs', 'notes.txt'), 'not markdown');
    await writeFile(join(clone, 'docs', 'architecture.md'), '# Architecture\n');
    await writeFile(join(clone, 'docs', 'node_modules', 'vendored.md'), '# Vendored\n');
    await writeFile(join(clone, 'docs', 'huge.md'), 'a'.repeat(OVERSIZED + 1));
    // The prize: a file outside the clone, beside it, as `~/.devdigest/secrets.json` is.
    const secret = join(cloneDir, 'secrets.json');
    await writeFile(secret, '{"OPENAI_API_KEY":"sk-live"}');
    return { cloneDir, clone, secret };
  }

  const OPTS = {
    recursive: true,
    ext: ['.md'] as const,
    excludeDirs: ['node_modules', '.git'] as const,
  };

  it('AC-01 — lists every `.md` under the requested root recursively, clone-relative, and nothing else', async () => {
    const { cloneDir } = await makeClone();
    const git = new SimpleGitClient(cloneDir);

    const specs = await git.listFiles(repo, { ...OPTS, root: 'specs' });
    expect(specs.map((f) => f.path)).toEqual(['specs/nested/deep.md', 'specs/public-api.md']);
    // Clone-relative with forward slashes — the exact string `readFile` takes,
    // not search-root-relative and never backslashed.
    for (const f of specs) expect(f.path).not.toContain('\\');
    expect(specs.some((f) => f.path.endsWith('.txt'))).toBe(false);

    // An excluded directory is never descended into.
    const docs = await git.listFiles(repo, { ...OPTS, root: 'docs' });
    expect(docs.map((f) => f.path)).not.toContain('docs/node_modules/vendored.md');

    // Non-recursive stops at the top level of the root.
    const shallow = await git.listFiles(repo, { ...OPTS, root: 'specs', recursive: false });
    expect(shallow.map((f) => f.path)).toEqual(['specs/public-api.md']);

    await rm(cloneDir, { recursive: true, force: true });
  });

  it('AC-40 — an oversized document is LISTED with its real size, not omitted by the reader', async () => {
    const { cloneDir } = await makeClone();
    const git = new SimpleGitClient(cloneDir);

    const docs = await git.listFiles(repo, { ...OPTS, root: 'docs' });
    const huge = docs.find((f) => f.path === 'docs/huge.md');
    // AC-40's stage-5 resolution: the limit marks a row not-attachable upstream.
    // Dropping it here would make that row impossible to show at all.
    expect(huge).toBeDefined();
    expect(huge!.size).toBeGreaterThan(OVERSIZED);
    expect(huge!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await rm(cloneDir, { recursive: true, force: true });
  });

  it('AC-07 — a root the repository does not have answers with an empty list, and so does a missing clone', async () => {
    const { cloneDir } = await makeClone();
    const git = new SimpleGitClient(cloneDir);

    expect(await git.listFiles(repo, { ...OPTS, root: 'insights' })).toEqual([]);
    expect(
      await git.listFiles({ owner: 'nobody', name: 'never-cloned' }, { ...OPTS, root: 'specs' }),
    ).toEqual([]);

    await rm(cloneDir, { recursive: true, force: true });
  });

  it('AC-24 — a root escaping the clone is refused', async () => {
    const { cloneDir } = await makeClone();
    const git = new SimpleGitClient(cloneDir);

    for (const root of ['../..', '../../', '../secrets.json', 'specs/../../..']) {
      await expect(git.listFiles(repo, { ...OPTS, root })).rejects.toThrow(
        /path escapes the repo clone/,
      );
    }

    await rm(cloneDir, { recursive: true, force: true });
  });

  itFileLink(
    'AC-24 — a symlinked FILE pointing outside the clone is neither read nor emitted',
    async () => {
      const { cloneDir, clone, secret } = await makeClone();
      const git = new SimpleGitClient(cloneDir);

      // The attack the read primitive's docblock names verbatim: `docs/plan.md`
      // → a secrets file outside the clone.
      await symlink(secret, join(clone, 'docs', 'plan.md'));

      const paths = (await git.listFiles(repo, { ...OPTS, root: 'docs' })).map((f) => f.path);
      expect(paths).not.toContain('docs/plan.md');
      expect(paths).toEqual(['docs/architecture.md', 'docs/huge.md']);

      await rm(cloneDir, { recursive: true, force: true });
    },
  );

  it('AC-24 — a symlinked DIRECTORY is not descended into, so nothing outside the clone is emitted', async () => {
    const { cloneDir, clone } = await makeClone();
    const git = new SimpleGitClient(cloneDir);

    // `junction` is the unprivileged Windows form; on Linux it is a plain
    // directory symlink. Either way the walk must not follow it — and a naive
    // walker WOULD, because the target contains `.md` files two levels down.
    await symlink(cloneDir, join(clone, 'docs', 'outside'), 'junction');

    const paths = (await git.listFiles(repo, { ...OPTS, root: 'docs' })).map((f) => f.path);
    expect(paths.some((p) => p.startsWith('docs/outside/'))).toBe(false);
    expect(paths).toEqual(['docs/architecture.md', 'docs/huge.md']);

    await rm(cloneDir, { recursive: true, force: true });
  });

  it('AC-24 — a search root that is itself a link out of the clone is refused, not followed', async () => {
    const { cloneDir, clone } = await makeClone();
    const git = new SimpleGitClient(cloneDir);

    let linked = false;
    try {
      await symlink(cloneDir, join(clone, 'escape'), 'junction');
      linked = true;
    } catch {
      linked = false;
    }
    expect(linked).toBe(true);

    // Lexically inside the clone, physically outside it: only the realpath
    // comparison catches this one.
    await expect(git.listFiles(repo, { ...OPTS, root: 'escape' })).rejects.toThrow(
      /path escapes the repo clone/,
    );

    await rm(cloneDir, { recursive: true, force: true });
  });
});

/**
 * SPEC-01 AC-42 — the walk the name-at-any-depth discovery is built on.
 *
 * Spec-first: `specs/01-project-context-documents.md:211-239`.
 *
 * NOTE on the seam. AC-42 says a root is a directory NAME at any depth, and the
 * landed design satisfies it by walking the clone ONCE from `.` and attributing
 * each file afterwards (`classifyByRoot`), rather than by teaching this adapter
 * about root names. So the criterion splits in two: the NAME matching and the
 * badge are asserted against the pure classifier in
 * `server/test/context-classify.test.ts`, and what belongs to the adapter — the
 * depth of the walk, the nested-repository guard (AC-42.3) and the untouched
 * exclusion list and ceiling (AC-42.4) — is asserted here, on a real filesystem,
 * because `MockGitClient` can express neither a `.git` directory nor depth.
 */
describe('SimpleGitClient.listFiles — AC-42 whole-clone walk and its guards', () => {
  const repo42 = { owner: 'acme', name: 'monorepo' };
  const CEILING = 500 * 1024;

  /**
   * A monorepo shaped like this one: every package carries its own `specs/` and
   * `docs/`, plus one vendored checkout with a real `.git` inside it.
   */
  async function makeMonorepo(): Promise<{ cloneDir: string; clone: string }> {
    const cloneDir = await mkdtemp(join(tmpdir(), 'devdigest-anydepth-'));
    const clone = join(cloneDir, repo42.owner, repo42.name);

    // The clone is itself a checkout: its own `.git` must NOT stop the walk.
    await mkdir(join(clone, '.git'), { recursive: true });
    await writeFile(join(clone, '.git', 'HEAD'), 'ref: refs/heads/main');

    // Top level — all a top-level-rooted walk would ever have reached.
    await mkdir(join(clone, 'specs'), { recursive: true });
    await writeFile(join(clone, 'specs', 'top.md'), '# Top-level spec');

    // Per-package, at depth. Invisible to the superseded top-level reading.
    await mkdir(join(clone, 'server', 'specs'), { recursive: true });
    await writeFile(join(clone, 'server', 'specs', 'README.md'), '# Server spec');
    await mkdir(join(clone, 'client', 'docs', 'adr'), { recursive: true });
    await writeFile(join(clone, 'client', 'docs', 'adr', '0007.md'), '# ADR 7');

    // AC-42.3 — a vendored checkout with its own history, exactly the shape
    // `server/clones/<owner>/<repo>/.git` has in this repository.
    const vendored = join(clone, 'server', 'clones', 'someone', 'other-repo');
    await mkdir(join(vendored, '.git'), { recursive: true });
    await writeFile(join(vendored, '.git', 'HEAD'), 'ref: refs/heads/main');
    await mkdir(join(vendored, 'specs'), { recursive: true });
    await writeFile(join(vendored, 'specs', 'not-ours.md'), '# Another repo');

    // AC-42.4 — the one PATH exclusion, and the two neighbours it must not take
    // with it: `.devdigest/specs` is a convention this product proposed to its
    // own users, and `.devdigest/cache-of-mine` merely shares a prefix.
    await mkdir(join(clone, '.devdigest', 'cache', 'plans'), { recursive: true });
    await writeFile(join(clone, '.devdigest', 'cache', 'plans', 'plan.md'), '# A plan');
    await mkdir(join(clone, '.devdigest', 'cache', 'runs', 'deep'), { recursive: true });
    await writeFile(join(clone, '.devdigest', 'cache', 'runs', 'deep', 'ledger.md'), '# Ledger');
    await mkdir(join(clone, '.devdigest', 'specs'), { recursive: true });
    await writeFile(join(clone, '.devdigest', 'specs', 'prd.md'), '# A PRD');
    await mkdir(join(clone, '.devdigest', 'cache-of-mine', 'specs'), { recursive: true });
    await writeFile(join(clone, '.devdigest', 'cache-of-mine', 'specs', 'z.md'), '# Not the cache');

    // AC-42.4 — the exclusion list and the ceiling, now that the walk is wider.
    await mkdir(join(clone, 'node_modules', 'dep', 'docs'), { recursive: true });
    await writeFile(join(clone, 'node_modules', 'dep', 'docs', 'vendored.md'), '# Vendored');
    await mkdir(join(clone, 'server', 'docs'), { recursive: true });
    await writeFile(join(clone, 'server', 'docs', 'huge.md'), 'a'.repeat(CEILING + 1));

    return { cloneDir, clone };
  }

  /** What discovery asks for: the whole clone, once. */
  const WHOLE_CLONE = {
    root: '.',
    recursive: true,
    ext: ['.md'] as const,
    excludeDirs: ['node_modules', '.git'] as const,
    excludePaths: ['.devdigest/cache'] as const,
    skipNestedRepos: true,
  };

  it('AC-42 — one walk from the clone root reaches a document at any depth', async () => {
    const { cloneDir } = await makeMonorepo();
    const git = new SimpleGitClient(cloneDir);

    const paths = (await git.listFiles(repo42, WHOLE_CLONE)).map((f) => f.path);

    // The per-package documents the top-level reading made undiscoverable.
    expect(paths).toContain('server/specs/README.md');
    expect(paths).toContain('client/docs/adr/0007.md');
    // Non-vacuity: a top-level-only walk of `specs` returns exactly ONE file
    // here, so a fixture without depth would pass against the old behaviour.
    expect(paths).toContain('specs/top.md');
    expect(paths.filter((p) => p.includes('/')).length).toBeGreaterThan(0);
    expect(paths.length).toBeGreaterThan(1);
    // The clone's OWN `.git` did not stop the walk at the door.
    expect(paths.length).toBeGreaterThanOrEqual(4);

    await rm(cloneDir, { recursive: true, force: true });
  });

  it('AC-42.3 — a nested repository is not descended into, and the guard is what does it', async () => {
    const { cloneDir } = await makeMonorepo();
    const git = new SimpleGitClient(cloneDir);
    const vendoredDoc = 'server/clones/someone/other-repo/specs/not-ours.md';

    const guarded = (await git.listFiles(repo42, WHOLE_CLONE)).map((f) => f.path);
    expect(guarded).not.toContain(vendoredDoc);
    expect(guarded.some((p) => p.includes('other-repo'))).toBe(false);
    // Our own nested document is still found, so the guard bounded the walk
    // rather than switching depth off.
    expect(guarded).toContain('server/specs/README.md');

    // Non-vacuity, proven rather than assumed: with the guard OFF the very same
    // walk reaches that file. Without this the assertion above would also pass
    // against a walk that never went deep enough to find it.
    const unguarded = (
      await git.listFiles(repo42, { ...WHOLE_CLONE, skipNestedRepos: false })
    ).map((f) => f.path);
    expect(unguarded).toContain(vendoredDoc);

    await rm(cloneDir, { recursive: true, force: true });
  });

  it('AC-42.4 — `.devdigest/cache` is excluded by PATH, and neither `.devdigest/specs` nor a prefix-sharing sibling goes with it', async () => {
    const { cloneDir } = await makeMonorepo();
    const git = new SimpleGitClient(cloneDir);

    const paths = (await git.listFiles(repo42, WHOLE_CLONE)).map((f) => f.path);

    // The agent workflow's own artifacts are not the repository's project
    // context: briefings, plans and run ledgers are excluded, at any depth
    // beneath the excluded path.
    expect(paths).not.toContain('.devdigest/cache/plans/plan.md');
    expect(paths).not.toContain('.devdigest/cache/runs/deep/ledger.md');
    expect(paths.some((p) => p.startsWith('.devdigest/cache/'))).toBe(false);

    // THE assertion that separates the shipped design from the plausible wrong
    // one. A name-based exclusion of `.devdigest` — or of `cache` — would also
    // pass the three above and fail here: `.devdigest/specs/` is a convention
    // the product proposed to its own users (`context.json`'s original empty
    // state directed people to put PRDs there), and AC-42's name matching makes
    // that path work with no configuration.
    expect(paths).toContain('.devdigest/specs/prd.md');
    // …and the exclusion is a PATH SEGMENT, not a string prefix: a sibling
    // called `cache-of-mine` starts with `.devdigest/cache` and must survive.
    expect(paths).toContain('.devdigest/cache-of-mine/specs/z.md');

    // Non-vacuity, proven rather than assumed, the same way the nested-repo
    // guard is: with the exclusion removed the identical walk reaches all four,
    // so the three absences above are the option's doing and not the fixture's.
    const unfiltered = (await git.listFiles(repo42, { ...WHOLE_CLONE, excludePaths: [] })).map(
      (f) => f.path,
    );
    expect(unfiltered).toContain('.devdigest/cache/plans/plan.md');
    expect(unfiltered).toContain('.devdigest/cache/runs/deep/ledger.md');
    expect(unfiltered).toContain('.devdigest/specs/prd.md');
    expect(unfiltered).toContain('.devdigest/cache-of-mine/specs/z.md');

    await rm(cloneDir, { recursive: true, force: true });
  });

  it('AC-42.4 — the wider walk widens neither the exclusion list nor the size ceiling', async () => {
    const { cloneDir } = await makeMonorepo();
    const git = new SimpleGitClient(cloneDir);

    const files = await git.listFiles(repo42, WHOLE_CLONE);
    const paths = files.map((f) => f.path);

    // An excluded directory name is still never descended into, even though the
    // `docs` inside it would now match by name one level up.
    expect(paths).not.toContain('node_modules/dep/docs/vendored.md');
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
    // Nor is the clone's own `.git` emitted as content.
    expect(paths.some((p) => p.includes('.git/'))).toBe(false);

    // The ceiling is still a MARK made upstream (AC-40), not an omission here:
    // the oversized file is listed with its real size.
    const huge = files.find((f) => f.path === 'server/docs/huge.md');
    expect(huge).toBeDefined();
    expect(huge!.size).toBeGreaterThan(CEILING);

    await rm(cloneDir, { recursive: true, force: true });
  });
});
