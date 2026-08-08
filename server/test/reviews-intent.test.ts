import { describe, it, expect } from 'vitest';
import {
  extractIssueRefs,
  extractRepoFilePaths,
  extractUnfetchableLinks,
  fileListBlock,
  gatherSources,
  intentBlock,
  resolveIntentModel,
  safeRepoPath,
} from '../src/modules/reviews/intent.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { PullRow } from '../src/modules/reviews/ports.js';

/**
 * Intent Layer — source gathering. The security-relevant part is `safeRepoPath`:
 * it is the only new path from request input (PR body text) to the filesystem.
 */

describe('safeRepoPath', () => {
  it('accepts a plain repo-relative path', () => {
    expect(safeRepoPath('docs/plan.md')).toBe('docs/plan.md');
    expect(safeRepoPath('SPEC.md')).toBe('SPEC.md');
    expect(safeRepoPath('./docs/./plan.md')).toBe('docs/plan.md');
  });

  it('rejects every shape that escapes the repo root', () => {
    for (const bad of [
      '../etc/passwd',
      'docs/../../etc/passwd',
      // A traversal that would collapse to a legal-looking path if normalised first.
      'a/../../../../root/.ssh/id_rsa',
      '/etc/passwd',
      '/../etc/passwd',
      'C:/Windows/System32/config/SAM',
      'c:\\Windows\\win.ini',
      '\\\\server\\share\\x.md',
      'docs\\plan.md',
      '~/.devdigest/secrets.json',
      'file:///etc/passwd',
      'http://evil.test/x.md',
      'docs/pl\0an.md',
      '',
      '   ',
      '.',
      '..',
      './',
    ]) {
      expect(safeRepoPath(bad), bad).toBeNull();
    }
  });

  it('rejects an absurdly long path', () => {
    expect(safeRepoPath(`${'a/'.repeat(200)}x.md`)).toBeNull();
  });
});

describe('extractRepoFilePaths', () => {
  it('finds markdown paths and drops traversal attempts', () => {
    const text =
      'See docs/plan.md and SPEC.md. Also read ../../../etc/passwd.md and /abs/plan.md.';
    expect(extractRepoFilePaths(text)).toEqual(['docs/plan.md', 'SPEC.md']);
  });

  it('de-duplicates', () => {
    expect(extractRepoFilePaths('docs/plan.md docs/plan.md')).toEqual(['docs/plan.md']);
  });
});

describe('extractIssueRefs', () => {
  const self = { owner: 'acme', name: 'payments' };

  it('reads a bare #123 as this repo', () => {
    expect(extractIssueRefs('Closes #471.', self)).toEqual([
      { owner: 'acme', name: 'payments', number: 471, ref: '#471' },
    ]);
  });

  it('reads a full github issue/pull URL', () => {
    const refs = extractIssueRefs('see https://github.com/other/repo/issues/412', self);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ owner: 'other', name: 'repo', number: 412 });
  });

  it('de-duplicates the URL and the bare form of the same issue', () => {
    const refs = extractIssueRefs('#412 and https://github.com/acme/payments/pull/412', self);
    expect(refs).toHaveLength(1);
  });
});

describe('extractUnfetchableLinks', () => {
  it('records non-GitHub links (decision B: they are never fetched)', () => {
    const links = extractUnfetchableLinks(
      'spec at https://notion.so/abc, issue at https://github.com/a/b/issues/1.',
    );
    expect(links).toEqual(['https://notion.so/abc']);
  });
});

describe('fileListBlock', () => {
  it('emits paths, counts and hunk headers — never hunk contents', async () => {
    const diff = await new MockGitClient().diff();
    const block = fileListBlock(diff);
    expect(block).toContain('src/config.ts');
    expect(block).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(block).not.toContain('sk_live');
    expect(block).not.toContain('+ ');
  });
});

describe('gatherSources', () => {
  const pull = {
    id: 'pr-1',
    number: 482,
    title: 'Add rate limiting',
    body: 'Closes #471. Plan in docs/plan.md. Spec at https://notion.so/xyz.',
  } as unknown as PullRow;

  it('collects the reachable sources and records the rest as missing context', async () => {
    const diff = await new MockGitClient().diff();
    const got = await gatherSources(
      { github: async () => new MockGitHubClient(), git: new MockGitClient() },
      { pull, repoRef: { owner: 'acme', name: 'payments' }, diff },
    );

    expect(got.sources.map((s) => s.kind)).toContain('pr_title');
    expect(got.sources.map((s) => s.kind)).toContain('pr_body');
    expect(got.sources.map((s) => s.kind)).toContain('file_list');
    expect(got.sources.map((s) => s.kind)).toContain('github_issue');
    // The non-GitHub link is recorded, never fetched.
    expect(got.missing.some((m) => m.includes('https://notion.so/xyz'))).toBe(true);
    // The diff BODY never reaches the classifier.
    expect(got.user).not.toContain('sk_live');
  });

  it('records an empty PR description as missing context', async () => {
    const diff = await new MockGitClient().diff();
    const got = await gatherSources(
      { github: async () => new MockGitHubClient(), git: new MockGitClient() },
      {
        pull: { ...pull, body: '   ' } as PullRow,
        repoRef: { owner: 'acme', name: 'payments' },
        diff,
      },
    );
    expect(got.missing).toContain('empty PR description');
    expect(got.sources.map((s) => s.kind)).not.toContain('pr_body');
  });

  it('degrades to missing_context when GitHub is unavailable, instead of throwing', async () => {
    const diff = await new MockGitClient().diff();
    const got = await gatherSources(
      {
        github: async () => {
          throw new Error('GITHUB_TOKEN is not configured');
        },
        git: new MockGitClient(),
      },
      { pull, repoRef: { owner: 'acme', name: 'payments' }, diff },
    );
    expect(got.missing.some((m) => m.startsWith('linked issue #471'))).toBe(true);
  });
});

describe('resolveIntentModel', () => {
  it('falls back to the registry default (the cheap OpenRouter model)', async () => {
    const choice = await resolveIntentModel({ settingValue: async () => undefined }, 'ws');
    expect(choice).toEqual({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' });
  });

  it('honours a valid workspace override', async () => {
    const choice = await resolveIntentModel(
      { settingValue: async () => ({ review_intent: { provider: 'openai', model: 'gpt-4.1' } }) },
      'ws',
    );
    expect(choice).toEqual({ provider: 'openai', model: 'gpt-4.1' });
  });

  it('ignores a malformed override', async () => {
    const choice = await resolveIntentModel(
      { settingValue: async () => ({ review_intent: { provider: 'nope' } }) },
      'ws',
    );
    expect(choice.provider).toBe('openrouter');
  });
});

describe('intentBlock', () => {
  it('renders scope lists and missing context as plain prose', () => {
    const block = intentBlock({
      intent: 'adds a limiter',
      in_scope: ['rate limiting'],
      out_of_scope: ['logging'],
      confidence: 0.72,
      missing_context: ['empty PR description'],
    });
    expect(block).toContain('Intent: adds a limiter');
    expect(block).toContain('- rate limiting');
    expect(block).toContain('- logging');
    expect(block).toContain('Classifier confidence: 0.72');
    expect(block).toContain('- empty PR description');
  });

  it('says so explicitly when a scope list is empty', () => {
    const block = intentBlock({ intent: 'x', in_scope: [], out_of_scope: [] });
    expect(block).toContain('(nothing stated)');
  });
});
