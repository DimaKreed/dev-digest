import { z } from 'zod';
import { FeatureModelChoice, FEATURE_MODELS, type BlastHistoryNotes } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { MAX_PRIOR_PRS } from './helpers.js';
import type { BlastNotesDeps, BlastNotesProvider } from './ports-notes.js';

/**
 * Prose notes about how each prior pull request relates to this one (ring 2).
 *
 * Deliberately a separate service from `BlastService`, behind a separate route.
 * `GET /pulls/:id/blast` must stay free and instant, and keeping the generation
 * dependency out of that class is what makes "the map itself consults no model"
 * a property a grep probe can check rather than a claim in a comment.
 *
 * ONE generation call per request, covering the whole list — not one per pull
 * request. Five sequential calls to annotate five rows would cost five times as
 * much for an optional garnish.
 */

const NoteItem = z.object({
  pr_number: z.number().int(),
  note: z.string(),
});

const HistoryNotes = z.object({ notes: z.array(NoteItem) });
type HistoryNotesT = z.infer<typeof HistoryNotes>;

const NOTES_TIMEOUT_MS = 30_000;
const NOTES_MAX_RETRIES = 1;

export class BlastNotesService {
  constructor(private deps: BlastNotesDeps) {}

  async annotate(workspaceId: string, prId: string): Promise<BlastHistoryNotes> {
    const pull = await this.deps.pulls.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const paths = (await this.deps.pulls.getPrFiles(prId)).map((f) => f.path);
    const priorPrs = await this.deps.pulls.getPriorPrs(
      pull.repoId,
      prId,
      paths,
      MAX_PRIOR_PRS,
    );
    // Nothing to annotate is not a failure, and it must not spend a call.
    if (priorPrs.length === 0) return { notes: [] };

    const repo = await this.deps.pulls.getRepo(pull.repoId);
    const system = await this.deps.renderPrompt('blast-history.system.md', {
      repo: repo ? `${repo.owner}/${repo.name}` : 'this repository',
      number: String(pull.number),
    });

    const user = [
      `Pull request under review: #${pull.number} — ${pull.title}`,
      `Files it changes:\n${paths.map((p) => `  ${p}`).join('\n')}`,
      '',
      'Previously merged pull requests that touched some of the same files:',
      ...priorPrs.map(
        (p) =>
          `  #${p.number} — ${p.title} (by ${p.author})\n` +
          `    also touched: ${p.filesOverlap.join(', ')}`,
      ),
    ].join('\n');

    const choice = await this.resolveModel(workspaceId);
    const llm = await this.deps.llm(choice.provider);
    const res = await llm.completeStructured<HistoryNotesT>({
      model: choice.model,
      schema: HistoryNotes,
      schemaName: 'BlastHistoryNotes',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      timeoutMs: NOTES_TIMEOUT_MS,
      maxRetries: NOTES_MAX_RETRIES,
    });

    // Which pull requests exist is a FACT, established by the query above. Keep
    // only notes for numbers that were actually offered, so a hallucinated
    // pull request cannot reach the reviewer as history.
    const offered = new Set(priorPrs.map((p) => p.number));
    const seen = new Set<number>();
    const notes = res.data.notes.filter((n) => {
      if (!offered.has(n.pr_number) || seen.has(n.pr_number)) return false;
      seen.add(n.pr_number);
      return n.note.trim().length > 0;
    });

    return { notes };
  }

  /**
   * Provider+model for these notes: the workspace's `feature_models.risk_brief`
   * override, else the registry default.
   *
   * Duplicates `modules/settings/feature-models.ts` deliberately — the
   * `no-cross-module` arch rule forbids importing it from here, and reading the
   * `settings` row through this module's own port is the legal equivalent. The
   * same duplication exists in `modules/conventions/service.ts` for the same
   * reason.
   */
  private async resolveModel(
    workspaceId: string,
  ): Promise<{ provider: BlastNotesProvider; model: string }> {
    const fallback = FEATURE_MODELS.find((f) => f.id === 'risk_brief')!;
    const raw = await this.deps.pulls.settingValue(workspaceId, 'feature_models');
    const chosen = (raw as Record<string, unknown> | null | undefined)?.['risk_brief'];
    const parsed = FeatureModelChoice.safeParse(chosen);
    return parsed.success
      ? parsed.data
      : { provider: fallback.defaultProvider, model: fallback.defaultModel };
  }
}
