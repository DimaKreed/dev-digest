import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillStats,
  SkillType,
  SkillSource,
  SkillVersion,
} from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { extractSkill, toSkillDto, toSkillVersionDto } from './helpers.js';

/**
 * Skills service.
 *
 * A skill is TEXT and nothing else — no tools, no execution, no filesystem
 * access. The only processing applied to a body is token counting and, on
 * import, pulling it out of an archive.
 */

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  note?: string;
  evidenceFiles?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  note?: string;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  private tokens(body: string): number {
    return this.container.tokenizer.count(body);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    const usedBy = await this.repo.usedByCounts(rows.map((r) => r.id));
    return rows.map((r) => toSkillDto(r, this.tokens(r.body), usedBy.get(r.id) ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const usedBy = await this.repo.usedByCounts([row.id]);
    return toSkillDto(row, this.tokens(row.body), usedBy.get(row.id) ?? 0);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description ?? '',
      type: input.type,
      source: input.source ?? 'manual',
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.evidenceFiles !== undefined ? { evidenceFiles: input.evidenceFiles } : {}),
    });
    return toSkillDto(row, this.tokens(row.body), 0);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    // Disabling a skill detaches it from every agent, so "linked ⇒ enabled"
    // holds without a "linked but inert" state existing at all.
    const existing = await this.repo.getById(workspaceId, id);
    const isDisabling = patch.enabled === false && existing?.enabled === true;

    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
    });
    if (!row) return undefined;

    // Deliberately AFTER the update, and deliberately not in a transaction —
    // this codebase has none. If the unlink fails the skill is left disabled
    // but still linked, which the run executor already filters out safely and
    // a retry fixes. The reverse order would silently destroy an agent's links
    // while leaving the skill enabled.
    if (isDisabling) await this.repo.unlinkFromAllAgents(id);

    const usedBy = await this.repo.usedByCounts([row.id]);
    return toSkillDto(row, this.tokens(row.body), usedBy.get(row.id) ?? 0);
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Body history, newest first. Undefined when the skill isn't in this workspace. */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /**
   * Restore an older body. History is never rewritten — this writes a NEW
   * version carrying the old text, so a run scored against v3 still resolves
   * to exactly the v3 body.
   */
  async restoreVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<Skill | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const snapshot = await this.repo.getVersion(skillId, version);
    if (!snapshot) return undefined;
    return this.update(workspaceId, skillId, {
      body: snapshot.body,
      note: `Restored from v${version}`,
    });
  }

  async stats(workspaceId: string, skillId: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const raw = await this.repo.stats(skillId);
    const triaged = raw.accepted + raw.dismissed;
    return {
      used_by: raw.usedBy,
      agents: raw.agents,
      runs_pulled: raw.runsPulled,
      findings_30d: raw.findings30d,
      accepted: raw.accepted,
      dismissed: raw.dismissed,
      // Null, not 0 — "nothing triaged yet" is not "0% accepted".
      accept_rate: triaged === 0 ? null : raw.accepted / triaged,
      findings_by_category: raw.byCategory,
    };
  }

  /**
   * Parse an uploaded .md/.zip into a previewable skill. Writes NOTHING: the
   * user reviews the body first and saving is a separate POST /skills. Keeping
   * the read path write-free is the whole point — an import can't quietly land
   * a stranger's instructions in an agent's prompt.
   */
  previewImport(fileName: string, bytes: Uint8Array): SkillImportPreview {
    const extracted = extractSkill(fileName, bytes);
    return { ...extracted, tokens: this.tokens(extracted.body) };
  }
}
