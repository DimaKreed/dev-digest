/**
 * Ring 3 — the local git working tree, over `child_process`.
 *
 * The second I/O file in this package, and the only one that touches the local
 * machine. It shells out to `git` rather than taking a dependency: the CLI runs
 * where git already is, and a library would be the third runtime dependency in a
 * package that has deliberately kept two.
 *
 * SECURITY — nothing the caller supplies reaches the command line. Every git
 * invocation below is a fixed argument vector; only `cwd` varies, and that is
 * the process's own working directory, not user input. `execFile` is used rather
 * than `exec`, so there is no shell to quote for in the first place.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitClient, GitResult, LocalChanges } from '../ports-git.js';

const run = promisify(execFile);

/**
 * A diff of any size has to fit in memory here anyway, but an unbounded buffer
 * turns a huge accidental commit into an opaque crash. 32 MB is far past any
 * reviewable change and still safely below the point where that matters.
 */
const MAX_BUFFER = 32 * 1024 * 1024;

interface ExecError {
  code?: number | string;
  stderr?: string;
  message?: string;
}

function classify(error: unknown, cwd: string): GitResult<never> {
  const e = error as ExecError;
  const stderr = String(e.stderr ?? e.message ?? '');

  if (e.code === 'ENOENT') return { ok: false, failure: { kind: 'git_missing' } };
  if (/not a git repository/i.test(stderr)) {
    return { ok: false, failure: { kind: 'not_a_repo', cwd } };
  }
  // An unborn branch: the repo exists but nothing has been committed, so there
  // is no HEAD to diff against. Distinct advice from every other failure.
  if (/unknown revision|ambiguous argument 'HEAD'|bad revision/i.test(stderr)) {
    return { ok: false, failure: { kind: 'no_head' } };
  }
  return { ok: false, failure: { kind: 'git_failed', message: stderr.trim() || 'git failed' } };
}

export function createGitClient(): GitClient {
  async function git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await run('git', args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout;
  }

  return {
    async workingTree(cwd: string): Promise<GitResult<LocalChanges>> {
      try {
        const root = (await git(['rev-parse', '--show-toplevel'], cwd)).trim();

        // `git diff HEAD` covers staged AND unstaged changes to tracked files in
        // one read. It cannot see untracked files, which is why they are listed
        // separately below rather than quietly omitted.
        const patch = await git(['diff', 'HEAD'], root);

        // --porcelain keeps this parseable across git versions and locales;
        // `??` is the untracked marker.
        const status = await git(['status', '--porcelain', '--untracked-files=all'], root);
        const untracked = status
          .split('\n')
          .filter((line) => line.startsWith('?? '))
          .map((line) => line.slice(3).trim())
          .filter(Boolean);

        // A detached HEAD prints "HEAD"; report that as no branch rather than as
        // a branch literally named HEAD.
        const branchRaw = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], root)).trim();
        const branch = branchRaw === 'HEAD' ? null : branchRaw;

        return { ok: true, value: { root, patch, branch, untracked } };
      } catch (error) {
        return classify(error, cwd);
      }
    },
  };
}
