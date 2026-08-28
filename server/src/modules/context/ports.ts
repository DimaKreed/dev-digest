/**
 * Domain types + persistence port for the project-context module (ring 1).
 *
 * Row types live HERE, not in `repository.ts`: `helpers.ts` is ring 0 and may
 * not import `src/db/` at all (arch rule `c5-pure-helpers`, and a type-only
 * import is still an import edge), while importing them from `repository.ts`
 * would close the `helpers → repository → helpers` cycle. Both `helpers.ts`
 * and `repository.ts` depend inward on this file.
 */

/**
 * A configured search root, re-exported inward from the platform config that
 * owns it so ring 0 `helpers.ts` reaches it without importing `platform/**`
 * itself. Its `dir` is also the displayed type of every document under it.
 */
export type { ContextRoot } from '../../platform/config.js';

/** Just enough of a repo row to address the clone and name it in an error. */
export interface RepoInfo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  clonePath: string | null;
}

/** One persisted attachment: a path and its position in the injection order. */
export interface ContextAttachmentRow {
  path: string;
  order: number;
}

/** `COUNT(*) GROUP BY path` over the agent attachments of one repository. */
export interface AttachCountRow {
  path: string;
  count: number;
}

/**
 * A run-time attachment with its origin. `skillId === null` means the agent's
 * own attachment; anything else is the linked skill it came from. Flat on
 * purpose — the ordering rule (agent first, then each enabled skill in the
 * agent's skill order, earliest position wins on a duplicate) is a pure
 * function over this list, not a shape the repository has to know.
 */
export interface ContextAttachmentSource {
  skillId: string | null;
  path: string;
  order: number;
}

export type ContextParentKind = 'agent' | 'skill';

/**
 * Repository port (C3) — the persistence surface `ContextService` depends on.
 * `ContextRepository` implements it; a test substitutes it through
 * `ContainerOverrides.context` instead of casting into a private field.
 */
export interface ContextRepositoryPort {
  /** Reads the `repos` table — this module never imports `modules/repos`. */
  getRepo(workspaceId: string, repoId: string): Promise<RepoInfo | undefined>;
  /**
   * Whether an agent / skill id exists IN THIS WORKSPACE. The attachment tables
   * carry no `workspace_id` of their own, so every read and write is scoped
   * through the parent row — an id from another workspace must 404 rather than
   * return or overwrite its set.
   */
  parentInWorkspace(
    kind: ContextParentKind,
    workspaceId: string,
    parentId: string,
  ): Promise<boolean>;
  listForAgent(agentId: string, repoId: string): Promise<ContextAttachmentRow[]>;
  listForSkill(skillId: string, repoId: string): Promise<ContextAttachmentRow[]>;
  /** Replaces the whole ordered set atomically; returns what was persisted. */
  setForAgent(
    agentId: string,
    repoId: string,
    paths: readonly string[],
  ): Promise<ContextAttachmentRow[]>;
  setForSkill(
    skillId: string,
    repoId: string,
    paths: readonly string[],
  ): Promise<ContextAttachmentRow[]>;
  /** How many AGENTS attach each path in this repository. */
  attachCountsByPath(repoId: string): Promise<AttachCountRow[]>;
  /** The agent's own attachments plus those of the given skills, unordered. */
  listForAgentAndSkills(
    agentId: string,
    skillIds: readonly string[],
    repoId: string,
  ): Promise<ContextAttachmentSource[]>;
}
