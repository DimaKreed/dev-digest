/**
 * Ring 1 — the git port the CLI depends on.
 *
 * Separate from `ports.ts` because the MCP server does not need git and must not
 * grow a dependency on a local working tree: the stdio server talks to an API
 * about repositories it never has on disk. Only the CLI reaches for this.
 */

/** Why a git read did not produce a diff. Causes, not exit codes. */
export type GitFailure =
  /** `git` is not on PATH. */
  | { kind: 'git_missing' }
  /** The working directory is not inside a git repository. */
  | { kind: 'not_a_repo'; cwd: string }
  /** The repository has no commits, so there is no HEAD to diff against. */
  | { kind: 'no_head' }
  /** git ran and failed for some other reason; its own message is carried. */
  | { kind: 'git_failed'; message: string };

export type GitResult<T> = { ok: true; value: T } | { ok: false; failure: GitFailure };

export interface LocalChanges {
  /** Absolute path of the repository root. */
  root: string;
  /** A unified diff of tracked files: staged and unstaged together. */
  patch: string;
  /** Current branch name, or null when detached. */
  branch: string | null;
  /**
   * Paths git does not track. `git diff HEAD` cannot see these, so they are NOT
   * in `patch` and are NOT reviewed. They are reported so a caller learns that a
   * brand-new file went unreviewed rather than silently assuming it passed.
   */
  untracked: string[];
}

export interface GitClient {
  /** Tracked staged + unstaged changes against HEAD. */
  workingTree(cwd: string): Promise<GitResult<LocalChanges>>;
}
