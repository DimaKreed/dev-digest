import {
  FEATURE_MODELS,
  FeatureModelChoice,
  Onboarding,
  type GitClient,
  type LLMProvider,
  type Provider,
  type RepoRef,
  type SecretsProvider,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { renderPrompt } from '../../platform/prompts.js';
import {
  ONBOARDING_SCHEMA_NAME,
  OnboardingGeneration,
  type OnboardingFacts,
  type OnboardingRepoIntelPort,
  type OnboardingRepositoryPort,
  type RepoInfo,
} from './ports.js';
import {
  buildFactsPayload,
  buildSkeleton,
  buildTour,
  mergeModelSections,
  parseManifest,
  verifyLinks,
  type ModelSection,
} from './helpers.js';
import {
  MANIFEST_PATH,
  MAX_FACT_ITEMS,
  ONBOARDING_TIMEOUT_MS,
  READING_PATH_N,
  REPO_MAP_TOKEN_BUDGET,
  SECRET_KEY_BY_PROVIDER,
  SECTION_KINDS,
} from './constants.js';

/**
 * Onboarding service — one five-section tour per repository.
 *
 * The shape of a tour is decided by facts, not by the model: the deterministic
 * skeleton is built first and is the whole answer on its own, and the single
 * model call only enriches sections that already exist. So a model that fails
 * costs prose, never structure — which is why AC-11's fact-only tour needs no
 * separate code path.
 *
 * Everything read out of the repository — the manifest, the repo skeleton, the
 * file paths — and everything the model returns is DATA. None of it selects a
 * code path here, none of it is executed, and every path the model cites is
 * checked against the indexed file set before it is persisted.
 */

/** Per-request envelope. Not a shared contract — only the tour is persisted. */
export interface OnboardingGenerateResult {
  tour: Onboarding;
  dropped_links: number;
  usage: {
    calls: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number | null;
  };
}

/** Why the generate action is unavailable, or `null` when it is available. */
export type UnavailableReason = 'missing_key' | 'index_missing' | 'flag_off';

/** Per-request envelope for a read. Makes no model call and writes nothing. */
export interface OnboardingReadResult {
  tour: Onboarding | null;
  generated_at: string | null;
  /** The repository's head right now — the client compares it to `tour.sha`. */
  current_sha: string | null;
  availability: {
    can_generate: boolean;
    reason: UnavailableReason | null;
    provider: Provider;
  };
}

/**
 * Exactly what this service needs (H7), all of it a port or a plain value.
 * Assembled in `routes.ts` from the container — the service never sees the
 * container, so every dependency can be substituted in a test.
 */
export interface OnboardingDeps {
  onboarding: OnboardingRepositoryPort;
  repoIntel: OnboardingRepoIntelPort;
  /** Lazy: resolving a provider needs a key, and a tour may never be generated. */
  llm: (provider: Provider) => Promise<LLMProvider>;
  git: GitClient;
  /** Key PRESENCE only — no value is ever read into a response. */
  secrets: SecretsProvider;
  /**
   * Whether repository intelligence is switched on at all.
   *
   * Passed in as a value because the flag is a configuration fact, not a port,
   * and because the index state cannot answer the question: `flag_off` is a
   * declared degraded reason that nothing in the codebase ever produces, so a
   * disabled layer is otherwise indistinguishable from an unindexed repo.
   */
  repoIntelEnabled: boolean;
}

export class OnboardingService {
  constructor(private deps: OnboardingDeps) {}

  // ---- read ----------------------------------------------------------------

  /**
   * The stored tour plus everything the view needs to be honest about it.
   *
   * Strictly I/O and comparison — no model call and no write, so opening the
   * page costs nothing and a demo's call count stays deterministic.
   */
  async read(workspaceId: string, repoId: string): Promise<OnboardingReadResult> {
    const repo = await this.mustGetRepo(workspaceId, repoId);
    const stored = await this.deps.onboarding.get(workspaceId, repoId);
    const choice = await this.resolveModel(workspaceId);

    return {
      tour: stored ? parseStoredTour(stored.json) : null,
      generated_at: stored ? stored.generatedAt.toISOString() : null,
      current_sha: await this.headOf(repo),
      availability: await this.availability(repoId, choice),
    };
  }

  // ---- generate ------------------------------------------------------------

  async generate(workspaceId: string, repoId: string): Promise<OnboardingGenerateResult> {
    const repo = await this.mustGetRepo(workspaceId, repoId);
    await this.assertGenerable(repoId);

    const facts = await this.gatherFacts(repo, repoId);
    const sha = await this.headOf(repo);
    const skeleton = buildSkeleton(facts);

    const choice = await this.resolveModel(workspaceId);
    const system = await renderPrompt('onboarding.system.md', {
      sections: SECTION_KINDS.map((k) => `- ${k}`).join('\n'),
      language: 'English',
    });

    // AC-02 — EXACTLY one structured call, in one try. A failure after the
    // provider's own retries falls through to the fact-only tour; it never
    // reaches for a second call or a fallback model.
    let modelSections: ModelSection[] = [];
    let generatedWithoutModel = true;
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd: number | null = null;
    let calls = 0;
    try {
      const llm = await this.deps.llm(choice.provider);
      calls = 1;
      const result = await llm.completeStructured({
        model: choice.model,
        schemaName: ONBOARDING_SCHEMA_NAME,
        schema: OnboardingGeneration,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: buildFactsPayload(facts) },
        ],
        temperature: 0,
        timeoutMs: ONBOARDING_TIMEOUT_MS,
      });
      modelSections = result.data.sections;
      generatedWithoutModel = false;
      tokensIn = result.tokensIn;
      tokensOut = result.tokensOut;
      costUsd = result.costUsd;
    } catch {
      // AC-11 — the tour still exists; it is simply the facts alone.
      generatedWithoutModel = true;
    }

    const merged = mergeModelSections(skeleton, modelSections);
    const indexed = new Set(await this.indexedPaths(repoId));
    const verified = verifyLinks(merged, indexed);

    const tour = buildTour({
      sections: verified.sections,
      sha,
      droppedLinks: verified.droppedLinks,
      generatedWithoutModel,
      // AC-13 — file hotness is not computed anywhere in this repository, so
      // the reading path is import rank alone and says so.
      hotnessAvailable: false,
    });

    await this.deps.onboarding.upsert(workspaceId, repoId, tour);

    return {
      tour,
      dropped_links: verified.droppedLinks,
      usage: { calls, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: costUsd },
    };
  }

  // ---- preconditions -------------------------------------------------------

  /**
   * AC-08 / AC-09 / AC-12 — refuse only when the graph the tour is built on is
   * genuinely missing.
   *
   * Never branches on the index's `status`: that field means "nothing threw",
   * and the edge builder degrades to an empty graph without throwing. The
   * counter the pipeline actually wrote is what decides. Zero indexed files is
   * NOT a refusal — the indexer supports a subset of languages, so a repository
   * in any other one indexes to zero and is not broken.
   */
  private async assertGenerable(repoId: string): Promise<void> {
    const reason = await this.blockingReason(repoId);
    if (reason === 'flag_off') {
      throw new AppError(
        'repo_intel_disabled',
        'Repository intelligence is disabled by configuration, so there are no indexed facts to build a tour from. Enable it and index this repository first.',
        409,
      );
    }
    if (reason === 'index_missing') {
      throw new AppError(
        'repo_not_indexed',
        'This repository has no usable code index — the import graph is empty. Run POST /repos/:id/resync to index it, then generate the tour again.',
        409,
      );
    }
  }

  /** The index-side reason generation is blocked, or `null` when it is not. */
  private async blockingReason(repoId: string): Promise<UnavailableReason | null> {
    if (!this.deps.repoIntelEnabled) return 'flag_off';
    const state = await this.deps.repoIntel.getIndexState(repoId);
    if (state.degradedReason === 'flag_off') return 'flag_off';
    // No row at all: the facade synthesises one whose reason says so.
    if (state.degradedReason === 'no_data') return 'index_missing';
    // A graph that was never written, over files that were: AC-08.
    if (state.filesIndexed > 0 && (state.edgesWritten ?? 0) === 0) return 'index_missing';
    return null;
  }

  /**
   * AC-10 — is the generate action offered at all, and if not, why.
   *
   * The key is only ever tested for PRESENCE. No secret value leaves this
   * method, and the provider name that does is the resolved choice, not
   * anything the caller supplied.
   */
  private async availability(
    repoId: string,
    choice: FeatureModelChoice,
  ): Promise<OnboardingReadResult['availability']> {
    const blocked = await this.blockingReason(repoId);
    if (blocked) return { can_generate: false, reason: blocked, provider: choice.provider };
    const configured = Boolean(
      await this.deps.secrets.get(SECRET_KEY_BY_PROVIDER[choice.provider]),
    );
    return {
      can_generate: configured,
      reason: configured ? null : 'missing_key',
      provider: choice.provider,
    };
  }

  // ---- fact gathering ------------------------------------------------------

  /**
   * Everything the tour is built from, all of it precomputed by the indexer or
   * read straight out of the manifest. Every read is best-effort: a degraded
   * layer or an unreadable manifest is an absent claim, never a failed request.
   */
  private async gatherFacts(repo: RepoInfo, repoId: string): Promise<OnboardingFacts> {
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const [criticalPaths, readingPath, repoMap, manifestText] = await Promise.all([
      safely(() => this.deps.repoIntel.getCriticalPaths(repoId), [] as string[][]),
      safely(() => this.deps.repoIntel.getTopFilesByRank(repoId, READING_PATH_N), [] as string[]),
      safely(async () => {
        const map = await this.deps.repoIntel.getRepoMap(repoId, REPO_MAP_TOKEN_BUDGET);
        return map.degraded ? '' : map.text;
      }, ''),
      safely(() => this.deps.git.readFile(ref, MANIFEST_PATH), ''),
    ]);

    // AC-03 — endpoints and crons come off the precomputed per-file facts of
    // everything that reaches the reading path, not from reading source.
    const impact = await safely(
      () => this.deps.repoIntel.getReverseImpact(repoId, readingPath),
      { rows: [], truncatedFrom: [] as string[] },
    );
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    for (const row of impact.rows) {
      for (const e of row.endpoints) endpoints.add(e);
      for (const c of row.crons) crons.add(c);
    }

    return {
      repoName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      manifest: parseManifest(manifestText),
      criticalPaths,
      readingPath,
      repoMap,
      endpoints: [...endpoints].slice(0, MAX_FACT_ITEMS),
      crons: [...crons].slice(0, MAX_FACT_ITEMS),
      // A capped walk means an empty list proves nothing, so the emptiness is
      // reported as unmeasured rather than as "there are none".
      factsTruncated: impact.truncatedFrom.length > 0,
      hotnessAvailable: false,
    };
  }

  private async indexedPaths(repoId: string): Promise<string[]> {
    return safely(() => this.deps.repoIntel.getIndexedPaths(repoId), [] as string[]);
  }

  // ---- internals -----------------------------------------------------------

  private async mustGetRepo(workspaceId: string, repoId: string): Promise<RepoInfo> {
    const repo = await this.deps.onboarding.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /** Current head, or null when the clone cannot answer. Never fatal. */
  private async headOf(repo: RepoInfo): Promise<string | null> {
    return safely(
      () => this.deps.git.currentHead({ owner: repo.owner, name: repo.name }),
      null as string | null,
    );
  }

  /**
   * Provider+model for this tour: the workspace's `feature_models.onboarding`
   * override, else the registry default.
   *
   * This duplicates the settings module's own resolver deliberately — the
   * `no-cross-module` arch rule forbids importing it, and reading the `settings`
   * TABLE through this module's own repository is the legal equivalent. The
   * conventions service carries the same duplication for the same reason.
   */
  private async resolveModel(workspaceId: string): Promise<FeatureModelChoice> {
    const fallback = FEATURE_MODELS.find((f) => f.id === 'onboarding')!;
    const raw = await this.deps.onboarding.featureModelsSetting(workspaceId);
    const chosen = (raw as Record<string, unknown> | null | undefined)?.['onboarding'];
    const parsed = FeatureModelChoice.safeParse(chosen);
    return parsed.success
      ? parsed.data
      : { provider: fallback.defaultProvider, model: fallback.defaultModel };
  }
}

/**
 * A stored document is jsonb, so it may predate any field this feature added.
 * `safeParse` keeps an unreadable row from taking the whole page down — an
 * undisplayable tour reads as "no tour", which the empty state already covers.
 */
function parseStoredTour(json: unknown): Onboarding | null {
  const parsed = Onboarding.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Best-effort read: a degraded source is an absent claim, never a thrown request. */
async function safely<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}
