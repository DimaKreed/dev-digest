import {
  FEATURE_MODELS,
  FeatureModelChoice,
  type ConventionCandidate,
  type ExtractionStats,
  type PluginBundle,
  type PluginConvention,
  type RepoRef,
  type SkillDraft,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import {
  ConventionsRepository,
  type InsertConvention,
  type RepoInfo,
  type UpdateConvention,
} from './repository.js';
import { ConventionExtraction, EXTRACTION_SCHEMA_NAME } from './ports.js';
import {
  CONFIG_FILES,
  buildSamplePayload,
  buildSkillDraft,
  toDto,
  verifyEvidence,
  type SampleFile,
} from './helpers.js';
import {
  MIN_DISTINCT_FILES,
  PLUGIN_FORMAT_VERSION,
  REPO_MAP_TOKEN_BUDGET,
  SAMPLE_COUNT,
} from './constants.js';

/**
 * Conventions service — extract house rules from a repo's own code.
 *
 * The model PROPOSES; the server VERIFIES. Every cited snippet is re-read out
 * of the clone and matched before a candidate is persisted, and a rule that
 * cannot be shown in two distinct files is dropped whole. A scan returning far
 * fewer candidates than the model emitted is the feature working, not failing —
 * the same posture as review grounding.
 */

/** What a GET of a repo's candidate set returns. */
export interface ConventionListResult {
  candidates: ConventionCandidate[];
  last_scan_at: string | null;
  /**
   * Always null. Stats describe ONE scan; they live in the extract response and
   * are not persisted (a scorecard does not justify a table or a migration).
   */
  stats: ExtractionStats | null;
}

export interface ExtractionResult {
  candidates: ConventionCandidate[];
  stats: ExtractionStats;
}

/** One evidence item that survived the code check, with REAL line numbers. */
interface VerifiedEvidence {
  path: string;
  snippet: string;
  startLine: number;
  endLine: number;
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  // ---- reads ---------------------------------------------------------------

  async list(workspaceId: string, repoId: string): Promise<ConventionListResult> {
    await this.mustGetRepo(workspaceId, repoId);
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    const lastScan = rows.reduce<Date | null>(
      (latest, r) => (latest === null || r.createdAt > latest ? r.createdAt : latest),
      null,
    );
    return {
      candidates: rows.map(toDto),
      last_scan_at: lastScan?.toISOString() ?? null,
      stats: null,
    };
  }

  async patch(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionCandidate> {
    const row = await this.repo.update(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention not found');
    return toDto(row);
  }

  // ---- extraction ----------------------------------------------------------

  async extract(workspaceId: string, repoId: string): Promise<ExtractionResult> {
    const repo = await this.mustGetRepo(workspaceId, repoId);
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    // repo-intel degrades to [] when disabled OR unindexed — a legitimate state
    // rather than a crash, so it becomes a clear 409 the UI can act on.
    const paths = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_COUNT);
    if (paths.length === 0) {
      throw new AppError(
        'repo_not_indexed',
        `No indexed source files for ${repo.fullName}. Index the repo first ` +
          `(POST /repos/${repoId}/resync) and re-run the scan once indexing finishes.`,
        409,
      );
    }

    const files = await this.readFiles(ref, paths);
    if (files.length === 0) {
      throw new AppError(
        'repo_not_indexed',
        `None of the ${paths.length} sampled files could be read from the clone of ` +
          `${repo.fullName}. Re-sync the repo and try again.`,
        409,
      );
    }
    const configs = await this.readFiles(ref, CONFIG_FILES);
    const repoMap = await this.readRepoMap(repoId);

    const choice = await this.resolveModel(workspaceId);
    const system = await renderPrompt('conventions.system.md', {
      repo: repo.fullName,
      sampled_files: String(files.length),
    });
    const llm = await this.container.llm(choice.provider);
    const result = await llm.completeStructured({
      model: choice.model,
      schemaName: EXTRACTION_SCHEMA_NAME,
      schema: ConventionExtraction,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: buildSamplePayload({ files, configs, repoMap }) },
      ],
      temperature: 0,
    });

    const sampled = new Map(files.map((f) => [f.path, f.text]));
    const inserts: InsertConvention[] = [];
    let droppedNoFile = 0;
    let droppedNoSnippet = 0;
    let droppedSingleOccurrence = 0;

    for (const candidate of result.data.candidates) {
      const verified: VerifiedEvidence[] = [];
      for (const evidence of candidate.evidence) {
        const text = sampled.get(evidence.path);
        if (text === undefined) {
          droppedNoFile += 1; // cited a path we never sampled — hallucinated file
          continue;
        }
        const match = verifyEvidence(evidence.snippet, text);
        if (!match.ok) {
          droppedNoSnippet += 1; // file is real, the quote is not in it
          continue;
        }
        verified.push({
          path: evidence.path,
          snippet: evidence.snippet,
          // The model's `start_line` is discarded — these come from the match.
          startLine: match.startLine,
          endLine: match.endLine,
        });
      }

      const evidenceFiles = [...new Set(verified.map((v) => v.path))];
      if (evidenceFiles.length < MIN_DISTINCT_FILES) {
        droppedSingleOccurrence += 1;
        continue;
      }
      const primary = verified[0]!;
      inserts.push({
        rule: candidate.rule,
        category: candidate.category,
        evidencePath: primary.path,
        evidenceSnippet: primary.snippet,
        evidenceStartLine: primary.startLine,
        evidenceEndLine: primary.endLine,
        evidenceFiles,
        occurrences: evidenceFiles.length,
        confidence: candidate.confidence,
      });
    }

    const rows = await this.repo.replaceForRepo(workspaceId, repoId, inserts);
    return {
      candidates: rows.map(toDto),
      stats: {
        sampled_files: files.length,
        config_files: configs.map((c) => c.path),
        proposed: result.data.candidates.length,
        verified: inserts.length,
        dropped_no_file: droppedNoFile,
        dropped_no_snippet: droppedNoSnippet,
        dropped_single_occurrence: droppedSingleOccurrence,
        provider: choice.provider,
        model: result.model,
        cost_usd: result.costUsd ?? 0,
      },
    };
  }

  // ---- downstream ----------------------------------------------------------

  /** Render the accepted candidates as ONE skill body. Writes nothing. */
  async skillDraft(
    workspaceId: string,
    repoId: string,
    conventionIds: string[],
  ): Promise<SkillDraft> {
    const repo = await this.mustGetRepo(workspaceId, repoId);
    const rows = await this.repo.listByIds(workspaceId, repoId, conventionIds);
    // buildSkillDraft filters to `accepted` itself — a pending or rejected rule
    // never reaches a body a reviewer will act on.
    return buildSkillDraft(repo.name, rows.map(toDto));
  }

  async linkSkill(
    workspaceId: string,
    repoId: string,
    skillId: string,
    conventionIds: string[],
  ): Promise<{ linked: number }> {
    await this.mustGetRepo(workspaceId, repoId);
    return { linked: await this.repo.setSkillId(workspaceId, repoId, conventionIds, skillId) };
  }

  /** Export the accepted conventions (plus the merged skill) as a plugin bundle. */
  async pluginBundle(workspaceId: string, repoId: string): Promise<PluginBundle> {
    const repo = await this.mustGetRepo(workspaceId, repoId);
    const accepted = (await this.repo.listByRepo(workspaceId, repoId))
      .map(toDto)
      .filter((c) => c.status === 'accepted');
    const draft = buildSkillDraft(repo.name, accepted);

    const skills =
      accepted.length === 0
        ? []
        : [
            {
              name: draft.name,
              description: draft.description,
              type: 'convention' as const,
              source: 'extracted' as const,
              body: draft.body,
              enabled: true,
              evidence_files: draft.evidence_files,
            },
          ];
    const conventions: PluginConvention[] = accepted.map((c) => ({
      rule: c.rule,
      evidence_path: c.evidence_path,
      evidence_snippet: c.evidence_snippet,
      confidence: c.confidence,
      accepted: true,
    }));

    return {
      manifest: {
        name: draft.name,
        version: PLUGIN_FORMAT_VERSION,
        format: 'devdigest-plugin/v1',
        exported_at: new Date().toISOString(),
        description: `House conventions extracted from ${repo.fullName} and verified against real code.`,
        counts: {
          agents: 0,
          skills: skills.length,
          eval_cases: 0,
          conventions: conventions.length,
        },
      },
      agents: [],
      skills,
      eval_cases: [],
      conventions,
    };
  }

  // ---- internals -----------------------------------------------------------

  private async mustGetRepo(workspaceId: string, repoId: string): Promise<RepoInfo> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /** Read what we can; an unreadable or empty file is skipped, never fatal. */
  private async readFiles(ref: RepoRef, paths: readonly string[]): Promise<SampleFile[]> {
    const read = await Promise.all(
      paths.map(async (path) => {
        try {
          const text = await this.container.git.readFile(ref, path);
          return text.trim() ? { path, text } : null;
        } catch {
          return null;
        }
      }),
    );
    return read.filter((f): f is SampleFile => f !== null);
  }

  /** Skeleton context. Best-effort: a degraded repo-intel just means no map. */
  private async readRepoMap(repoId: string): Promise<string> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId, REPO_MAP_TOKEN_BUDGET);
      return map.degraded ? '' : map.text;
    } catch {
      return '';
    }
  }

  /**
   * Provider+model for this scan: the workspace's `feature_models.conventions`
   * override, else the registry default.
   *
   * This duplicates `modules/settings/feature-models.ts` deliberately — the
   * `no-cross-module` arch rule forbids `modules/conventions` importing from
   * `modules/settings`, and reading the `settings` TABLE from this module's own
   * repository is the legal equivalent.
   */
  private async resolveModel(workspaceId: string): Promise<FeatureModelChoice> {
    const fallback = FEATURE_MODELS.find((f) => f.id === 'conventions')!;
    const raw = await this.repo.featureModelsSetting(workspaceId);
    const chosen = (raw as Record<string, unknown> | null | undefined)?.['conventions'];
    const parsed = FeatureModelChoice.safeParse(chosen);
    return parsed.success
      ? parsed.data
      : { provider: fallback.defaultProvider, model: fallback.defaultModel };
  }
}
