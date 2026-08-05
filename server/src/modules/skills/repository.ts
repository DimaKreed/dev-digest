import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillType, SkillSource } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION, STATS_WINDOW_DAYS } from './constants.js';

/**
 * Skills data-access. Owns `skills` and `skill_versions`.
 *
 * It also READS `agent_skills` and `run_skills` for the Stats rollup. That is
 * table access, not a cross-module import — `modules/skills` never imports
 * `modules/agents` (arch rule `no-cross-module`); the agents module still owns
 * the write side of `agent_skills`.
 */

import type { SkillRow, SkillVersionRow } from './ports.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  note?: string | null;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  note?: string | null;
}

/** Raw counters behind the Stats tab; the service shapes them into the DTO. */
export interface SkillStatsRow {
  usedBy: number;
  agents: Array<{ id: string; name: string }>;
  runsPulled: number;
  findings30d: number;
  accepted: number;
  dismissed: number;
  byCategory: Array<{ category: string; count: number }>;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill. Versions and agent/run links cascade. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  /** Insert a skill AND record version 1 (immutable body snapshot). */
  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        ...(values.evidenceFiles !== undefined ? { evidenceFiles: values.evidenceFiles } : {}),
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_SKILL_VERSION, values.note ?? null);
    return row!;
  }

  /**
   * Update a skill. Only a BODY change bumps the version and snapshots — a
   * rename, a retype or an enable/disable leaves history alone, because the
   * version exists to make a scored run reproducible against exact text.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row, nextVersion, patch.note ?? null);
    return row;
  }

  private async snapshotVersion(
    row: SkillRow,
    version: number,
    note: string | null,
  ): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body, note })
      .onConflictDoNothing();
  }

  // ---- skill_versions -----------------------------------------------------

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  // ---- Stats --------------------------------------------------------------

  /**
   * Per-skill rollup. Everything run-derived is scoped through `run_skills`,
   * i.e. "runs where this skill was actually in the prompt" — a finding cannot
   * be attributed to one skill, so the service labels these honestly.
   */
  async stats(skillId: string): Promise<SkillStatsRow> {
    const agents = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agentSkills.skillId, skillId))
      .orderBy(asc(t.agents.name));

    const [pulled] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(t.runSkills)
      .where(eq(t.runSkills.skillId, skillId));

    // Runs in the window that pulled this skill. Findings hang off reviews,
    // which carry the run id — `findings` itself has no timestamp, so the
    // window is applied to `agent_runs.ran_at`.
    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recentRunIds = await this.db
      .select({ id: t.agentRuns.id })
      .from(t.runSkills)
      .innerJoin(t.agentRuns, eq(t.runSkills.runId, t.agentRuns.id))
      .where(and(eq(t.runSkills.skillId, skillId), gt(t.agentRuns.ranAt, since)));

    const empty = {
      usedBy: agents.length,
      agents,
      runsPulled: pulled?.count ?? 0,
      findings30d: 0,
      accepted: 0,
      dismissed: 0,
      byCategory: [] as Array<{ category: string; count: number }>,
    };
    if (recentRunIds.length === 0) return empty;

    const runIds = recentRunIds.map((r) => r.id);
    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        accepted: sql<number>`count(*) filter (where ${isNotNull(t.findings.acceptedAt)})::int`,
        dismissed: sql<number>`count(*) filter (where ${isNotNull(t.findings.dismissedAt)})::int`,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(inArray(t.reviews.runId, runIds));

    const byCategory = await this.db
      .select({ category: t.findings.category, count: sql<number>`count(*)::int` })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(inArray(t.reviews.runId, runIds))
      .groupBy(t.findings.category)
      .orderBy(desc(sql`count(*)`));

    return {
      ...empty,
      findings30d: totals?.total ?? 0,
      accepted: totals?.accepted ?? 0,
      dismissed: totals?.dismissed ?? 0,
      byCategory,
    };
  }

  /**
   * Remove this skill from every agent. Returns how many links were dropped.
   *
   * The agents module owns link/reorder writes to `agent_skills`; this one
   * write lives here because it is a cascade of the skill's OWN state change
   * (enabled → false), and `modules/skills` may not import `modules/agents`.
   */
  async unlinkFromAllAgents(skillId: string): Promise<number> {
    const rows = await this.db
      .delete(t.agentSkills)
      .where(eq(t.agentSkills.skillId, skillId))
      .returning({ agentId: t.agentSkills.agentId });
    return rows.length;
  }

  /** How many agents link each of `skillIds` — one query for the whole list. */
  async usedByCounts(skillIds: string[]): Promise<Map<string, number>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.db
      .select({ skillId: t.agentSkills.skillId, count: sql<number>`count(*)::int` })
      .from(t.agentSkills)
      .where(inArray(t.agentSkills.skillId, skillIds))
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map((r) => [r.skillId, r.count]));
  }
}
