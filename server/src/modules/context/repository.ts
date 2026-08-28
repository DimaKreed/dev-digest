import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  AttachCountRow,
  ContextAttachmentRow,
  ContextAttachmentSource,
  ContextParentKind,
  ContextRepositoryPort,
  RepoInfo,
} from './ports.js';

/**
 * Project-context data access. The ONLY place that touches
 * `agent_context_files` and `skill_context_files`.
 *
 * It also READS three tables it does not own — `repos` (to resolve the clone
 * ref and display name) and `agents` / `skills` (to prove a parent id belongs
 * to the caller's workspace before its attachment set is read or replaced).
 * That is table access, not a cross-module import: this module never imports
 * `modules/repos`, `modules/agents` or `modules/skills` (arch rule
 * `no-cross-module`), and it writes to none of those three. Same precedent as
 * `modules/conventions`, which reads `repos` and `settings`.
 */
export class ContextRepository implements ContextRepositoryPort {
  constructor(private db: Db) {}

  // ---- reads on other domains' tables --------------------------------------

  async getRepo(workspaceId: string, repoId: string): Promise<RepoInfo | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async parentInWorkspace(
    kind: ContextParentKind,
    workspaceId: string,
    parentId: string,
  ): Promise<boolean> {
    if (kind === 'agent') {
      const [row] = await this.db
        .select({ id: t.agents.id })
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, parentId)));
      return row !== undefined;
    }
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, parentId)));
    return row !== undefined;
  }

  // ---- attachment sets -----------------------------------------------------

  async listForAgent(agentId: string, repoId: string): Promise<ContextAttachmentRow[]> {
    return this.db
      .select({ path: t.agentContextFiles.path, order: t.agentContextFiles.order })
      .from(t.agentContextFiles)
      .where(
        and(eq(t.agentContextFiles.agentId, agentId), eq(t.agentContextFiles.repoId, repoId)),
      )
      // `order` has a default, so two rows can share one — the path breaks the
      // tie and makes the comparator a total order.
      .orderBy(asc(t.agentContextFiles.order), asc(t.agentContextFiles.path));
  }

  async listForSkill(skillId: string, repoId: string): Promise<ContextAttachmentRow[]> {
    return this.db
      .select({ path: t.skillContextFiles.path, order: t.skillContextFiles.order })
      .from(t.skillContextFiles)
      .where(
        and(eq(t.skillContextFiles.skillId, skillId), eq(t.skillContextFiles.repoId, repoId)),
      )
      .orderBy(asc(t.skillContextFiles.order), asc(t.skillContextFiles.path));
  }

  /**
   * Replace the whole ordered set for one (agent, repo) in ONE transaction.
   *
   * The set is the unit the client sends and the unit the run reads, so a
   * half-applied write is a corrupted set rather than a lost row. The Drizzle
   * handle never leaves this method — the service gets rows back and stays
   * unaware that a transaction happened.
   */
  async setForAgent(
    agentId: string,
    repoId: string,
    paths: readonly string[],
  ): Promise<ContextAttachmentRow[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.agentContextFiles)
        .where(
          and(eq(t.agentContextFiles.agentId, agentId), eq(t.agentContextFiles.repoId, repoId)),
        );
      if (paths.length === 0) return [];
      return tx
        .insert(t.agentContextFiles)
        .values(paths.map((path, order) => ({ agentId, repoId, path, order })))
        .returning({ path: t.agentContextFiles.path, order: t.agentContextFiles.order });
    });
  }

  /** Same contract as `setForAgent`, for a skill. */
  async setForSkill(
    skillId: string,
    repoId: string,
    paths: readonly string[],
  ): Promise<ContextAttachmentRow[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.skillContextFiles)
        .where(
          and(eq(t.skillContextFiles.skillId, skillId), eq(t.skillContextFiles.repoId, repoId)),
        );
      if (paths.length === 0) return [];
      return tx
        .insert(t.skillContextFiles)
        .values(paths.map((path, order) => ({ skillId, repoId, path, order })))
        .returning({ path: t.skillContextFiles.path, order: t.skillContextFiles.order });
    });
  }

  async attachCountsByPath(repoId: string): Promise<AttachCountRow[]> {
    return this.db
      .select({ path: t.agentContextFiles.path, count: count() })
      .from(t.agentContextFiles)
      .where(eq(t.agentContextFiles.repoId, repoId))
      .groupBy(t.agentContextFiles.path);
  }

  async listForAgentAndSkills(
    agentId: string,
    skillIds: readonly string[],
    repoId: string,
  ): Promise<ContextAttachmentSource[]> {
    const own = await this.listForAgent(agentId, repoId);
    const rows: ContextAttachmentSource[] = own.map((r) => ({ skillId: null, ...r }));
    if (skillIds.length === 0) return rows;
    const fromSkills = await this.db
      .select({
        skillId: t.skillContextFiles.skillId,
        path: t.skillContextFiles.path,
        order: t.skillContextFiles.order,
      })
      .from(t.skillContextFiles)
      .where(
        and(
          eq(t.skillContextFiles.repoId, repoId),
          inArray(t.skillContextFiles.skillId, [...skillIds]),
        ),
      );
    return [...rows, ...fromSkills];
  }
}
