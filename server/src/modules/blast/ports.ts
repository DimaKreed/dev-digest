/**
 * Ports for the blast module (ring 1).
 *
 * This slice ships NO `repository.ts`. `pull_requests` and `pr_files` are owned
 * by `ReviewRepository`; `file_edges`, `file_facts` and `symbols` are owned by
 * `RepoIntelRepository`. A second repository over either set would break onion
 * rule C2. The composition root hands in `container.reviewRepo` and
 * `container.repoIntel`, which satisfy these ports STRUCTURALLY — no adapter,
 * no mapper, and nothing to keep in sync.
 *
 * Every shape below is restated rather than imported from `../repo-intel/types.js`
 * or `db/rows.js`. dependency-cruiser counts a type-only import as an edge, so
 * the first would trip `no-cross-module` and the second `c5-pure-helpers` (which
 * `helpers.ts` would inherit by reading these types). The slice therefore has
 * zero cross-module and zero `db/` import edges.
 */

// --- Review-domain reads ----------------------------------------------------

/** One merged PR that also touched the files this PR changes. */
export interface BlastPriorPr {
  number: number;
  title: string;
  author: string;
  mergedAt: Date | null;
  filesOverlap: string[];
}

/** Exactly the reads blast performs against the review domain (H11). */
export interface BlastPullReads {
  /** Workspace-scoped. THIS is the authorization boundary — a miss must 404. */
  getPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ id: string; repoId: string; number: number; title: string } | undefined>;
  getPrFiles(prId: string): Promise<{ path: string }[]>;
  getPriorPrs(
    repoId: string,
    prId: string,
    paths: string[],
    limit: number,
  ): Promise<BlastPriorPr[]>;
}

// --- repo-intel facade reads ------------------------------------------------

export interface BlastChangedSymbolRead {
  file: string;
  name: string;
  kind: string;
}

export interface BlastCallerRead {
  file: string;
  symbol: string;
  /** Which changed symbol this caller reaches. */
  viaSymbol: string;
  line: number;
  /** file_rank.rank of the caller file; 0 on the degraded path. */
  rank: number;
}

export interface BlastRadiusRead {
  changedSymbols: BlastChangedSymbolRead[];
  callers: BlastCallerRead[];
  impactedEndpoints: string[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  /**
   * Changed symbols whose caller list a cap cut short, plus `'__total__'` for
   * the whole-response ceiling. A capped list presented as complete is the same
   * lie as an empty one, so this turns into `partial` rather than nothing.
   */
  cappedSymbols?: string[];
  degraded?: boolean;
  reason?: string;
}

export interface ReverseImpactRead {
  rows: {
    file: string;
    depth: number;
    originFiles: string[];
    endpoints: string[];
    crons: string[];
  }[];
  truncatedFrom: string[];
}

export interface IndexStateRead {
  status: 'full' | 'partial' | 'degraded' | 'failed';
  /** Files the last run indexed. Zero means there was nothing to build from. */
  filesIndexed: number;
  /**
   * Import edges the last run wrote. Zero over a non-empty file set means the
   * graph is missing however healthy `status` claims to be — and without it no
   * reference resolves, so no caller can ever be found.
   */
  edgesWritten?: number;
  reason?: string;
  degradedReason?: string;
}

/** Exactly the four facade methods blast calls, of the facade's eleven (H11). */
export interface BlastIntelReads {
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastRadiusRead>;
  getReverseImpact(repoId: string, files: string[]): Promise<ReverseImpactRead>;
  getIndexState(repoId: string): Promise<IndexStateRead>;
  /**
   * Reference counts per name, resolved or not — what separates "nothing
   * mentions this symbol" from "mentioned, but no mention could be tied to this
   * declaration". Both arrive as an empty caller list; only the first is a
   * finding.
   */
  getSymbolMentions(repoId: string, names: string[]): Promise<Map<string, number>>;
}
