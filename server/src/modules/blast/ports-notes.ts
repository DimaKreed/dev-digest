/**
 * Ports for the history-notes route (ring 1).
 *
 * Split out of `ports.ts` so that the map's own port file carries no generation
 * dependency at all: `service.ts` imports `ports.js` and `notes-service.ts`
 * imports this one, which keeps the "no model on the map path" boundary visible
 * in the import graph rather than only in prose.
 */
import type { LLMProvider } from '@devdigest/shared';
import type { BlastPriorPr } from './ports.js';

/** The five review-domain reads the notes route performs. */
export interface BlastNotesPullReads {
  /** Raw `settings.<key>` value; this module validates it itself. */
  settingValue(workspaceId: string, key: string): Promise<unknown>;
  getPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ id: string; repoId: string; number: number; title: string } | undefined>;
  getRepo(repoId: string): Promise<{ owner: string; name: string } | undefined>;
  getPrFiles(prId: string): Promise<{ path: string }[]>;
  getPriorPrs(
    repoId: string,
    prId: string,
    paths: string[],
    limit: number,
  ): Promise<BlastPriorPr[]>;
}

/** Providers the container can build. Restated to keep this file free of `platform/`. */
export type BlastNotesProvider = 'openai' | 'anthropic' | 'openrouter';

export interface BlastNotesDeps {
  pulls: BlastNotesPullReads;
  llm(provider: BlastNotesProvider): Promise<LLMProvider>;
  renderPrompt(name: string, vars: Record<string, string>): Promise<string>;
}
