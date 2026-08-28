import { z } from 'zod';
import { BriefFileRef, BriefRiskLevel } from '@devdigest/shared';

/**
 * Domain types, ports and the model-facing contract for the brief module (ring 1).
 *
 * Everything a sibling slice would otherwise supply is RESTATED here instead of
 * imported. Any reach into `modules/<other>/` trips the `no-cross-module` arch
 * rule — including a bare constant and including a type-only import, because
 * dependency-cruiser counts a type-only import as an edge
 * (`server/insights.md` § *`no-cross-module` fires on a sibling module's
 * constant and on its helper alike*). So the ports below describe the shapes
 * this module needs and the composition root hands in objects that satisfy them
 * structurally, with no `implements` and no adapter. `modules/blast` is not
 * touched by this feature and nothing here asserts anything about the blast
 * tab's response shape.
 *
 * Row and domain types live HERE rather than in `repository.ts` so that ring-0
 * `helpers.ts` and the repository both depend inward on one file instead of on
 * each other — the cycle recorded at `server/insights.md` § *Declaring Drizzle
 * row types in `repository.ts`*.
 */

// --- persistence ------------------------------------------------------------

/** A stored brief, straight off the row. `json` is unvalidated jsonb. */
export interface StoredBrief {
  json: unknown;
  /** The head the document was BUILT from (AC-20), not the head at write time. */
  headSha: string | null;
  model: string | null;
  generatedAt: Date;
}

/** What one generation persists. One document, one write (AC-18). */
export interface BriefUpsert {
  json: unknown;
  headSha: string | null;
  model: string | null;
}

/**
 * Repository port (C3) — the persistence surface `BriefService` depends on.
 * `BriefRepository` implements it; a test substitutes it through
 * `ContainerOverrides.brief` rather than casting into a private field.
 *
 * Only `pr_brief` is behind this port. Everything else the service reads comes
 * through the structural ports below over repositories that already own those
 * tables — a second repository over `pull_requests` would break C2.
 */
export interface BriefRepositoryPort {
  /** The stored brief, or `undefined` when there is none OR the PR is another workspace's. */
  get(workspaceId: string, prId: string): Promise<StoredBrief | undefined>;
  upsert(workspaceId: string, prId: string, doc: BriefUpsert): Promise<StoredBrief>;
}

// --- review-domain reads ----------------------------------------------------

/** Just enough of a pull request to assemble the input and key the reuse check. */
export interface BriefPull {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  headSha: string;
  additions: number;
  deletions: number;
  filesCount: number;
}

/** The derived intent, as `pr_intent` stores it. Never dropped for the cap (AC-05). */
export interface BriefIntent {
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
}

/** Exactly the five review-domain reads this slice performs (H11). */
export interface BriefPullReads {
  /** Workspace-scoped. THIS is the authorization boundary — a miss must 404 (AC-22). */
  getPull(workspaceId: string, prId: string): Promise<BriefPull | undefined>;
  getIntent(prId: string): Promise<BriefIntent | undefined>;
  /** Paths and per-file counts only. The `patch` column is never read (AC-03). */
  getPrFiles(prId: string): Promise<{ path: string }[]>;
  getRepo(repoId: string): Promise<{ owner: string; name: string } | undefined>;
  /** Raw `settings.<key>` value; this module validates it itself. */
  settingValue(workspaceId: string, key: string): Promise<unknown>;
}

// --- repo-intel facade reads ------------------------------------------------

/** What the blast-radius read yields, narrowed to what a one-paragraph summary needs. */
export interface BriefBlastRead {
  changedSymbols: { name: string; file: string; kind: string }[];
  callers: { file: string; symbol: string; viaSymbol: string; line: number }[];
  impactedEndpoints: string[];
  degraded?: boolean;
  reason?: string;
}

export interface BriefIndexStateRead {
  status: string;
  filesIndexed: number;
  /** Import edges the last index wrote; zero over a non-empty file set means no graph. */
  edgesWritten?: number;
  degraded?: boolean;
  degradedReason?: string;
}

/**
 * Exactly the two facade methods this slice calls, of the facade's eleven (H11).
 *
 * This is how the brief obtains a blast-radius summary WITHOUT touching
 * `modules/blast/`: the summary is rendered from the same facade reads in this
 * slice's own `helpers.ts`. Reaching `modules/blast/service.ts` is blocked by
 * `no-cross-module`, and moving the summary into the `repo-intel` facade would
 * be a change to a slice this feature has no business editing.
 */
export interface BriefIntelReads {
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BriefBlastRead>;
  getIndexState(repoId: string): Promise<BriefIndexStateRead>;
}

// --- project-context reads --------------------------------------------------

/**
 * The one project-context read this slice performs.
 *
 * AC-02 names the repository's attached project-context documents as an input.
 * Attachments are per agent AND per skill, and a brief has neither, so some
 * repository-wide set has to stand in. The one this slice uses is what
 * `ContextRepository.attachCountsByPath` answers, and that method selects from
 * `agent_context_files` alone — `skill_context_files` is not unioned in. So the
 * set below is "attached by any AGENT", a subset of the repository's attached
 * documents: a document attached only to a skill is not seen here.
 *
 * That narrowing is recorded rather than repaired. Widening the read would mean
 * changing a method `modules/context` owns and that other callers share, which
 * is outside this feature; and a project-context document missing from the
 * input degrades the brief exactly the way AC-07 already covers. The document
 * TEXT is then read out of the clone through `GitClient`, the same way
 * `run-executor.ts` reads it: attachments store paths, never text.
 */
export interface BriefContextReads {
  /** Every path attached by any agent in this repository, with how many attach it. */
  attachCountsByPath(repoId: string): Promise<{ path: string; count: number }[]>;
}

// --- the assembled fact set -------------------------------------------------

/** One linked issue, already fetched and confined to the PR's own repository. */
export interface BriefIssueFact {
  /** Our own reconstruction of the reference (`#123`), never raw input. */
  ref: string;
  title: string;
  body: string;
}

/** One attached project-context document, read fresh out of the clone. */
export interface BriefContextDoc {
  path: string;
  text: string;
}

/**
 * The complete fact set a brief is assembled from (AC-02), and NOTHING else —
 * in particular no diff hunk body: `patch` is never read (AC-03).
 *
 * Assembled by the service out of I/O, then handed to the pure kernel as plain
 * data (data-in beats port-in): the kernel never learns where any of it came
 * from, which is what lets `buildBriefPayload` and `fitToBudget` be tested with
 * no container at all.
 */
export interface BriefFacts {
  repoFullName: string;
  prNumber: number;
  title: string;
  description: string;
  /** `null` when the PR has never been classified — recorded under AC-07. */
  intent: BriefIntent | null;
  diffStats: { filesChanged: number; additions: number; deletions: number };
  changedFiles: string[];
  /** One paragraph, or `''` when repo intelligence could not produce one. */
  blastSummary: string;
  issues: BriefIssueFact[];
  contextDocs: BriefContextDoc[];
}

/**
 * What a model-named reference is checked against (AC-13): every path that was
 * actually present in the input assembled for THIS call — the changed files
 * plus the attached project-context documents.
 *
 * Paths and nothing else, deliberately. AC-13 names files, symbols and
 * endpoints, but the only place the model can name one in a machine-readable
 * position is a ref's `path`; a symbol or an endpoint mentioned inside prose has
 * no field to verify and no way to become a deep link. So the check is exact on
 * the one thing that does become a deep link, and an ungrounded prose claim can
 * still reach the reader — which is the spec's own reading, not a shortcut.
 */
export interface BriefGrounding {
  paths: Set<string>;
}

// --- the model-facing contract ----------------------------------------------

/** Schema name passed to `completeStructured` (and keyed by test fixtures). */
export const BRIEF_SCHEMA_NAME = 'PrBriefGeneration';

/**
 * What the generator model is asked to emit (AC-10). NOT a shared contract:
 * none of it is trusted.
 *
 * `risk_level`, `severity` and the ref shape are taken from the shared brief
 * contract on purpose, so a level outside the declared enum cannot even parse
 * and therefore can never reach the card as raw text (spec § *Untrusted
 * inputs*). Everything else is verified after parsing: every `path` named here
 * must have been present in the input actually assembled for the call, or the
 * entry carrying it is dropped and counted (AC-13).
 *
 * Note what carries NO `.default()`, unlike the stored contract: `StructuredRequest<T>`
 * is typed `ZodType<T, ZodTypeDef, T>`, so a schema whose input and output types
 * differ cannot be passed to `completeStructured` at all. Every list here is
 * therefore required. That is the right default for a model contract anyway —
 * an omitted list is a malformed response worth retrying at the provider, not a
 * legacy document worth tolerating. Tolerance for absent keys belongs on the
 * PERSISTED contract, which is where `.nullish()` and `.default([])` live.
 */
export const PrBriefGeneration = z.object({
  risk_level: BriefRiskLevel,
  what: z.string(),
  why: z.string(),
  risks: z.array(
    z.object({
      title: z.string(),
      explanation: z.string(),
      severity: BriefRiskLevel,
      refs: z.array(BriefFileRef),
    }),
  ),
  review_focus: z.array(
    z.object({
      label: z.string(),
      ref: BriefFileRef,
      reason: z.string(),
    }),
  ),
});
export type PrBriefGeneration = z.infer<typeof PrBriefGeneration>;
