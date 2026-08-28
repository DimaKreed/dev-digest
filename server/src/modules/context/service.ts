import type {
  ContextAttachment,
  ContextSearchRoot,
  GitClient,
  RepoFileEntry,
  RepoRef,
  SpecFile,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import type {
  ContextParentKind,
  ContextRepositoryPort,
  ContextRoot,
  RepoInfo,
} from './ports.js';
import {
  classifyByRoot,
  isAttachablePath,
  toAttachment,
  toDocument,
  type DiscoveredDoc,
  type NotAttachableReason,
} from './helpers.js';
import {
  CONTEXT_EXT,
  EXCLUDED_CONTEXT_DIRS,
  EXCLUDED_CONTEXT_PATHS,
  MAX_CONTEXT_FILE_SIZE,
} from './constants.js';

/**
 * Project-context service — discover the repository's markdown, report it, and
 * own the attachment sets agents and skills inject at run time.
 *
 * Discovery is a DIRECT filesystem read of the clone on every request: no code
 * index, no embeddings, no chunking and no model call. It is therefore
 * unaffected by `EMBEDDINGS_ENABLED` and `REPO_INTEL_ENABLED` — this slice
 * reaches neither the indexer facade nor any model provider.
 */
export interface ContextServiceDeps {
  context: ContextRepositoryPort;
  git: GitClient;
  tokenizer: Tokenizer;
  contextRoots: readonly ContextRoot[];
}

export class ContextService {
  constructor(private deps: ContextServiceDeps) {}

  /**
   * Every discovered document with its directory, type badge, token size and
   * attaching-agent count. No chunk count and no coverage score: neither is
   * measured anywhere in this slice, and inventing one would be a number with
   * nothing behind it.
   */
  async list(workspaceId: string, repoId: string): Promise<SpecFile[]> {
    const repo = await this.mustGetRepo(workspaceId, repoId);
    const docs = await this.discover(repo);
    const counts = new Map(
      (await this.deps.context.attachCountsByPath(repoId)).map((r) => [r.path, r.count]),
    );
    const ref = refOf(repo);
    return Promise.all(
      docs.map(async (doc) => {
        const reason = reasonFor(doc.entry);
        return toDocument(doc, {
          // Counted with the tokenizer ADAPTER, never estimated here and never
          // on the client. Skipped for an over-ceiling document: it cannot be
          // attached, so reading it would buy a number nothing can use.
          tokens: reason === null ? await this.countTokens(ref, doc.entry.path) : null,
          usedBy: counts.get(doc.entry.path) ?? 0,
          reason,
        });
      }),
    );
  }

  /**
   * The directories that WERE searched, so the empty state can name them.
   *
   * Deliberately a sibling read rather than a field on the listing: the listing
   * is an array of documents, and the case that needs this answer is the one
   * with no documents in it. Independent of the clone — the roots are
   * configuration, so this answers even when there is nothing to walk.
   */
  async searchRoots(workspaceId: string, repoId: string): Promise<ContextSearchRoot[]> {
    await this.getRepoOr404(workspaceId, repoId);
    return this.deps.contextRoots.map((root) => ({ dir: root.dir }));
  }

  /**
   * One document's markdown, read-only.
   *
   * A path absent from the DISCOVERED set is a 404 and is never read, so this
   * endpoint cannot be used as a general file-read primitive over the clone.
   */
  async preview(workspaceId: string, repoId: string, path: string): Promise<SpecFile> {
    const repo = await this.mustGetRepo(workspaceId, repoId);
    const docs = await this.discover(repo);
    const doc = docs.find((d) => d.entry.path === path);
    if (!doc) throw new NotFoundError(`No such document in ${repo.fullName}: ${path}`);
    const content = await this.deps.git.readFile(refOf(repo), doc.entry.path);
    const reason = reasonFor(doc.entry);
    return {
      ...toDocument(doc, {
        tokens: this.deps.tokenizer.count(content),
        usedBy: 0,
        reason,
      }),
      content,
    };
  }

  // ---- attachment sets -----------------------------------------------------

  async listForParent(
    kind: ContextParentKind,
    workspaceId: string,
    parentId: string,
    repoId: string,
  ): Promise<ContextAttachment[]> {
    await this.mustOwnParent(kind, workspaceId, parentId);
    const rows =
      kind === 'agent'
        ? await this.deps.context.listForAgent(parentId, repoId)
        : await this.deps.context.listForSkill(parentId, repoId);
    return rows.map(toAttachment);
  }

  /**
   * Replace the whole ordered set. Last write wins: the request carries the
   * complete array, the repository swaps it in one transaction, and the response
   * is what was persisted — so a client that lost a race sees it on refetch.
   */
  async setForParent(
    kind: ContextParentKind,
    workspaceId: string,
    parentId: string,
    repoId: string,
    paths: readonly string[],
  ): Promise<ContextAttachment[]> {
    await this.mustOwnParent(kind, workspaceId, parentId);
    const repo = await this.mustGetRepo(workspaceId, repoId);
    await this.assertAttachable(repo, paths);
    const rows =
      kind === 'agent'
        ? await this.deps.context.setForAgent(parentId, repoId, paths)
        : await this.deps.context.setForSkill(parentId, repoId, paths);
    return rows.map(toAttachment);
  }

  // ---- internals -----------------------------------------------------------

  /** Workspace-scoped existence check. Says nothing about the clone. */
  private async getRepoOr404(workspaceId: string, repoId: string): Promise<RepoInfo> {
    const repo = await this.deps.context.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError(`Repo ${repoId} not found`);
    return repo;
  }

  private async mustGetRepo(workspaceId: string, repoId: string): Promise<RepoInfo> {
    const repo = await this.getRepoOr404(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new AppError(
        'repo_not_indexed',
        `${repo.fullName} has no local clone yet. Import or re-sync the repository ` +
          `and try again once the clone finishes.`,
        409,
      );
    }
    return repo;
  }

  private async mustOwnParent(
    kind: ContextParentKind,
    workspaceId: string,
    parentId: string,
  ): Promise<void> {
    if (!(await this.deps.context.parentInWorkspace(kind, workspaceId, parentId))) {
      // 404, not 403: an id in another workspace must not be distinguishable
      // from one that does not exist.
      throw new NotFoundError(`No such ${kind}: ${parentId}`);
    }
  }

  /**
   * ONE walk of the clone, then classify each markdown file by the nearest
   * ancestor directory whose name is a configured root.
   *
   * A root is a directory NAME at any depth, so walking once per root would
   * mean traversing the same tree N times to answer a question a single pass
   * already answers — and would have to reconcile the same file discovered
   * under two roots. Classifying after one traversal makes "nearest ancestor
   * wins" a local decision per path instead.
   *
   * The containment guard is unchanged and still lives in the adapter: the walk
   * is rooted at the clone, follows no symlink, refuses the excluded directory
   * names, and stops at any nested repository.
   */
  private async discover(repo: RepoInfo): Promise<DiscoveredDoc[]> {
    const entries = await this.deps.git.listFiles(refOf(repo), {
      root: '.',
      recursive: true,
      ext: CONTEXT_EXT,
      excludeDirs: EXCLUDED_CONTEXT_DIRS,
      excludePaths: EXCLUDED_CONTEXT_PATHS,
      skipNestedRepos: true,
    });
    return classifyByRoot(entries, new Set(this.deps.contextRoots.map((r) => r.dir)));
  }

  private async countTokens(ref: RepoRef, path: string): Promise<number | null> {
    try {
      return this.deps.tokenizer.count(await this.deps.git.readFile(ref, path));
    } catch {
      // A document that vanished between the walk and the read still belongs in
      // the listing; only its size is unknown.
      return null;
    }
  }

  /**
   * Refuse an unattachable set BEFORE it is persisted.
   *
   * Two rules, and they are not the same rule: a malformed path (absolute,
   * traversing, not markdown) is refused outright, while a path that is simply
   * not in the discovered set is ALLOWED through — a document attached and then
   * deleted from the repository has to stay in the set long enough to be
   * detached. A discovered-but-over-ceiling document is refused, which is the
   * write-side half of the row being marked not-attachable in the listing.
   */
  private async assertAttachable(repo: RepoInfo, paths: readonly string[]): Promise<void> {
    const bad = paths.find((p) => !isAttachablePath(p));
    if (bad !== undefined) {
      throw new AppError('invalid_context_path', `Not an attachable document path: ${bad}`, 400);
    }
    if (new Set(paths).size !== paths.length) {
      throw new AppError('invalid_context_path', 'The same document is listed twice', 400);
    }
    if (paths.length === 0) return;
    const wanted = new Set(paths);
    const oversized = (await this.discover(repo))
      .filter((d) => wanted.has(d.entry.path) && reasonFor(d.entry) !== null)
      .map((d) => d.entry.path);
    if (oversized.length > 0) {
      throw new AppError(
        'context_file_too_large',
        `This document is too large to attach: ${oversized.join(', ')}`,
        400,
      );
    }
  }
}

function refOf(repo: RepoInfo): RepoRef {
  return { owner: repo.owner, name: repo.name };
}

/**
 * The per-file ceiling, applied at DISCOVERY AND ATTACHMENT only. Nothing in
 * the run path calls this: an already-attached document is injected verbatim
 * whatever its size.
 */
function reasonFor(entry: RepoFileEntry): NotAttachableReason | null {
  return entry.size > MAX_CONTEXT_FILE_SIZE ? 'too_large' : null;
}
