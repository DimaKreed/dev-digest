/**
 * repo-intel — shared contract (Tier 1).
 *
 * This is the SINGLE interface every feature codes against. Library complexity
 * (@ast-grep/napi, dependency-cruiser, graphology, tokenizer) hides behind the
 * `RepoIntel` facade; features (reviews prompt-assembly, blast, onboarding,
 * conventions, phantom-gate, smart-diff) import THIS, never the libraries.
 *
 * Adapted to real code:
 *   - `repos.id` is a `uuid`, so every `repoId` here is a `string`.
 *   - facade-level rows (SymbolRow / SignatureRow / RefRow) mirror the read model.
 *   - adapter-level extraction types live with the astgrep adapter and stay
 *     compatible with `adapters/codeindex/extract.ts` (ExtractedSymbol/Reference).
 *
 * DEGRADED CONTRACT (lead decision — resolves the read-model vs degraded-contract ambiguity):
 *   - Object-returning methods carry an inline `degraded?: boolean` (+ optional
 *     `reason`). See BlastResult / IndexState / RepoMapResult.
 *   - Array-returning methods return `[]` when degraded. Empty = "no enrichment",
 *     which is exactly what every consumer already treats as the fallback path.
 *     The degraded *status/reason* is always observable via `getIndexState()`.
 * This keeps signatures natural (no `{ degraded, data }` wrappers at call sites)
 * while still guaranteeing every consumer can fall back without throwing.
 */

export type IndexStatus = 'full' | 'partial' | 'degraded' | 'failed';

export type DegradedReason =
  | 'flag_off'
  | 'index_failed'
  | 'index_partial'
  | 'repo_too_large'
  | 'no_data';

export interface IndexResult {
  status: IndexStatus;
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
  reason?: string;
}

export interface IndexState extends IndexResult {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  updatedAt: Date;
  /**
   * Import edges the last index actually wrote, from `stats.edgesWritten`.
   * `undefined` when the run predates the field. ZERO over a non-empty file
   * set means the graph is missing, whatever `status` says — and nothing that
   * needs resolved references can work without it.
   */
  edgesWritten?: number;
  /** True when the layer is running on the ripgrep fallback. */
  degraded?: boolean;
  degradedReason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Blast radius (facade method `getBlastRadius`). Adopted by blast/service.ts in
// T2; in T1 the facade returns a degraded best-effort over container.codeIndex.
// ---------------------------------------------------------------------------

export interface BlastChangedSymbol {
  file: string;
  name: string;
  kind: string;
}

export interface BlastCallerRow {
  file: string;
  symbol: string;
  /** Which changed symbol this caller reaches. */
  viaSymbol: string;
  /**
   * Which FILE declares that symbol. A name is not an identity: a facade that
   * delegates to a split repository declares `getPull` twice, and a consumer
   * grouping on the name alone shows each declaration the other's callers.
   */
  viaFile: string;
  /** 1-based line of the reference (representative; for the BlastRadius view). */
  line: number;
  /** file_rank.rank of the caller file (0 in the degraded/ripgrep path). */
  rank: number;
}

export interface BlastResult {
  changedSymbols: BlastChangedSymbol[];
  callers: BlastCallerRow[];
  /** "METHOD /path" (via extractEndpoints / file_facts) — flat union. */
  impactedEndpoints: string[];
  /**
   * Per-caller-file precomputed facts, so consumers (blast) can attribute
   * endpoints/crons to the changed symbol whose callers live in that file.
   * Present on the persistent (non-degraded) path; absent otherwise.
   */
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  /**
   * Changed symbols whose caller list was cut by a cap, plus `'__total__'` when
   * the whole response hit `MAX_BLAST_CALLERS_TOTAL`. A capped list handed over
   * as if it were complete is the same lie as an empty one: consumers turn this
   * into a `partial` state rather than presenting a subset as the answer.
   */
  cappedSymbols?: string[];
  degraded?: boolean;
  reason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Reverse-import impact (facade method `getReverseImpact`).
//
// `getBlastRadius` attributes endpoints from the file_facts of DIRECT caller
// files only. That misses the common shape: a changed util is called by a
// service, and the route file merely imports the service — so the route's
// endpoints are one import hop beyond anything the caller set contains. This
// walk covers those hops.
// ---------------------------------------------------------------------------

export interface ReverseImpactRow {
  /** The reached file: a (transitive) importer of one of the seeds. */
  file: string;
  /** Hops from the seed. 0 = a seed itself, 1 = direct importer, 2 = its importer. */
  depth: number;
  /** Seed file(s) this row descends from, so endpoints can be attributed back. */
  originFiles: string[];
  endpoints: string[];
  crons: string[];
}

export interface ReverseImpactResult {
  rows: ReverseImpactRow[];
  /** Seeds whose expansion hit the fan-out cap — the walk under them is INCOMPLETE. */
  truncatedFrom: string[];
}

// ---------------------------------------------------------------------------
// Read-model rows.
// ---------------------------------------------------------------------------

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface SignatureRow {
  file: string;
  symbol: string;
  signature: string;
  /** file_rank.rank of the caller (0 until T3). */
  rank: number;
}

export interface RefRow {
  refFile: string;
  refLine: number;
  symbolName: string;
  /** NULL = unresolved → candidate for the Phantom-gate. */
  declFile: string | null;
}

export interface FileRankRow {
  path: string;
  percentile: number;
}

export interface RepoMapResult {
  text: string;
  tokens: number;
  cached: boolean;
  degraded?: boolean;
  reason?: DegradedReason;
}

/**
 * The facade. Studio (T2+) serves reads purely from the Postgres cache; T1 and
 * CI may parse diff-scoped on the hot path. Indexing runs through
 * JobRunner handlers in studio, inline in the CI runner.
 */
export interface RepoIntel {
  // --- Indexing -----------------------------------------------------------
  /** Full (re)index of a repo. */
  indexRepo(repoId: string): Promise<IndexResult>;
  /** Incremental update against the last indexed SHA. */
  refreshIndex(repoId: string): Promise<IndexResult>;
  /** Current index state — ALWAYS works, even degraded. */
  getIndexState(repoId: string): Promise<IndexState>;

  // --- Reads --------------------------------------------------------------
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>;
  /**
   * Who depends on `files`, up to `BFS_DEPTH` levels out, with each reached
   * file's precomputed endpoints/crons. Pure Postgres over `file_edges` +
   * `file_facts` — no clone read, no AST work. Returns empty rows when the flag
   * is off or nothing is indexed.
   */
  getReverseImpact(repoId: string, files: string[]): Promise<ReverseImpactResult>;
  /**
   * How many times each name is referenced anywhere in the index, resolved or
   * not. Separates "nothing mentions this" from "mentioned, but unresolvable",
   * which an empty caller list alone cannot say.
   */
  getSymbolMentions(repoId: string, names: string[]): Promise<Map<string, number>>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult>;
  getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]>;
  getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]>;
  getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit?: number,
  ): Promise<SignatureRow[]>;
  /**
   * Unresolved references (= Phantom-gate fuel).
   * T1: diff-scoped, ephemeral (no persistent decl_file).
   * T2/T3: persistent `references.decl_file IS NULL`.
   */
  getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]>;
  /**
   * Every distinct file path the index holds at least one symbol for. Only
   * `SUPPORTED_EXT` files are ever indexed, so a markdown or config path is
   * legitimately absent from this set. `[]` when degraded.
   */
  getIndexedPaths(repoId: string): Promise<string[]>;

  /** Top-N file paths by rank, filtered of tests/configs. */
  getConventionSamples(repoId: string, n: number): Promise<string[]>;

  // --- T3: onboarding reading-path + critical paths (graph required) ------
  getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]>;
  getCriticalPaths(repoId: string): Promise<string[][]>;
}
