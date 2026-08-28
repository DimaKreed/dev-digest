import { z } from 'zod';
import { MAX_LINKS_PER_SECTION, SECTION_KINDS } from './constants.js';

/**
 * Domain types, ports and the model-facing contract for the onboarding module.
 *
 * Everything a sibling slice would otherwise supply is RESTATED here instead of
 * imported. Any reach into another slice's folder trips the `no-cross-module`
 * arch rule — and a type-only import is still an import edge to
 * dependency-cruiser — so the two ports below describe the shapes this module
 * needs and the container hands in objects that satisfy them structurally,
 * with no `implements`. The conventions slice's ports file is the precedent.
 *
 * Row and domain types live HERE rather than in `repository.ts` so that the
 * ring-0 kernel and the repository can both depend inward on one file instead
 * of on each other.
 */

/** Just enough of a repo row to address the clone and build a blob URL. */
export interface RepoInfo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  clonePath: string | null;
}

/** One runnable script, exactly as the manifest spells it. */
export interface ManifestScript {
  name: string;
  command: string;
}

/** What `parseManifest` recovers. Nothing here is inferred or defaulted. */
export interface ManifestFacts {
  stack: string[];
  scripts: ManifestScript[];
}

/**
 * The deterministic fact set the tour is built from. Assembled by the service
 * out of I/O, then handed to the pure kernel as plain data (data-in beats
 * port-in): the kernel never learns where any of it came from.
 *
 * Absence is expressed as an empty list, EXCEPT where a budget could have
 * produced that emptiness — `factsTruncated` marks a reverse-impact walk that
 * hit its fan-out cap, so an empty endpoint list can be reported as "not
 * measured" rather than as "there are none".
 */
export interface OnboardingFacts {
  repoName: string;
  defaultBranch: string;
  manifest: ManifestFacts;
  /** Dependency chains from the highest-ranked files. */
  criticalPaths: string[][];
  /** Top files by import rank — the suggested reading order. */
  readingPath: string[];
  /** The repo skeleton, or `''` when repo intelligence could not render one. */
  repoMap: string;
  endpoints: string[];
  crons: string[];
  /** True when the endpoint/cron walk was capped, so its emptiness proves nothing. */
  factsTruncated: boolean;
  /** False while file hotness is not computed; the reading path is rank-only. */
  hotnessAvailable: boolean;
}

/** A stored tour, straight off the row. `json` is unvalidated jsonb. */
export interface StoredTour {
  json: unknown;
  generatedAt: Date;
}

/**
 * Repository port (C3) — the persistence surface `OnboardingService` depends on.
 * `OnboardingRepository` implements it; a test substitutes it through
 * `ContainerOverrides.onboarding` rather than casting into a private field.
 *
 * `getRepo` and `featureModelsSetting` read tables this module does not own.
 * That is table access, not a cross-module import — the same shape
 * `ConventionsRepository` already uses.
 */
export interface OnboardingRepositoryPort {
  /** Reads `repos`; `undefined` when the repo is absent OR in another workspace. */
  getRepo(workspaceId: string, repoId: string): Promise<RepoInfo | undefined>;
  /** Raw `settings.feature_models` value; the service validates it. */
  featureModelsSetting(workspaceId: string): Promise<unknown>;
  get(workspaceId: string, repoId: string): Promise<StoredTour | undefined>;
  upsert(workspaceId: string, repoId: string, json: unknown): Promise<StoredTour>;
}

/**
 * The six repository-intelligence reads this module makes, declared HERE rather
 * than taken from the indexer slice's own type file. Its facade satisfies this
 * interface structurally, so the container passes it straight in.
 *
 * Note what the index-state shape does NOT promise: `status` is on it only
 * because the facade returns it, and nothing in this module branches on it.
 * `status` means "nothing threw", not "the data is there" — the counters are
 * what a precondition is decided on.
 */
export interface OnboardingRepoIntelPort {
  getIndexState(repoId: string): Promise<{
    status: string;
    filesIndexed: number;
    lastIndexedSha: string;
    /** Import edges the last index actually wrote; `undefined` predates the field. */
    edgesWritten?: number;
    degraded?: boolean;
    degradedReason?: string;
  }>;
  getCriticalPaths(repoId: string): Promise<string[][]>;
  getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]>;
  getRepoMap(
    repoId: string,
    tokenBudget?: number,
  ): Promise<{ text: string; degraded?: boolean }>;
  getReverseImpact(
    repoId: string,
    files: string[],
  ): Promise<{
    rows: Array<{ file: string; endpoints: string[]; crons: string[] }>;
    /** Seeds whose expansion hit the fan-out cap — the walk under them is incomplete. */
    truncatedFrom: string[];
  }>;
  /** Every distinct indexed path — the set a cited link is verified against. */
  getIndexedPaths(repoId: string): Promise<string[]>;
}

/** Schema name passed to `completeStructured` (and keyed by test fixtures). */
export const ONBOARDING_SCHEMA_NAME = 'OnboardingGeneration';

/**
 * What the generator model is asked to emit. NOT a shared contract: none of it
 * is trusted. `title` is ignored for display, `links` are verified against the
 * indexed file set before anything is persisted, `body` renders as markdown
 * with no raw HTML, and a `diagram` reaches the screen only on the one section
 * that renders one.
 *
 * `kind` is an enum over the five section kinds, so a sixth section cannot even
 * parse — the model's merge step then has nothing to match it against.
 */
export const OnboardingGeneration = z.object({
  sections: z
    .array(
      z.object({
        kind: z.enum(SECTION_KINDS),
        title: z.string(),
        body: z.string(),
        diagram: z.string().nullish(),
        links: z
          .array(z.object({ label: z.string(), path: z.string() }))
          .max(MAX_LINKS_PER_SECTION)
          .default([]),
      }),
    )
    .max(SECTION_KINDS.length),
});
export type OnboardingGeneration = z.infer<typeof OnboardingGeneration>;
