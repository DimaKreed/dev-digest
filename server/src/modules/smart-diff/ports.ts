/**
 * Ports for the smart-diff module (ring 1).
 *
 * This slice deliberately ships NO `repository.ts`. `pr_files`, `pull_requests`,
 * `reviews` and `findings` are already owned by `ReviewRepository`, whose header
 * declares itself "the ONLY layer touching the DB for the review domain" — a
 * second repository over the same tables would break onion rule C2. The
 * composition root passes `container.reviewRepo` in as this port, which it
 * satisfies STRUCTURALLY: every shape below is a subset of the row it returns,
 * so there is no adapter and no mapper to keep in sync.
 *
 * The shapes are restated here rather than imported from `db/rows.ts` for two
 * reasons: H8 (no Drizzle row alias in a ring-2 signature) and `c5-pure-helpers`
 * (dependency-cruiser counts a type-only import as an edge, so `helpers.ts`
 * reaching `db/` would fail the gate). The slice therefore has ZERO `db/` import
 * edges.
 */

/** One `pr_files` row, reduced to what the classifier reads. */
export interface SmartDiffPrFile {
  path: string;
  additions: number;
  deletions: number;
}

/** One `reviews` row, reduced to the fields the "last review" formula needs. */
export interface SmartDiffReview {
  id: string;
  agentId: string | null;
  createdAt: Date;
}

/** One `findings` row, reduced to the fields the badge join needs. */
export interface SmartDiffFinding {
  file: string;
  startLine: number;
  dismissedAt: Date | null;
}

/** One review run with its findings, as `reviewsForPull` returns it. */
export interface ReviewWithFindings {
  review: SmartDiffReview;
  findings: SmartDiffFinding[];
}

/**
 * Exactly the three reads Smart Diff performs. Narrow by rule H11 — the
 * concrete `ReviewRepository` has ~30 methods, and a port that named them all
 * would force every fake to stub 27 dead ones.
 */
export interface SmartDiffReads {
  /** Workspace-scoped PR lookup. This IS the authorization boundary. */
  getPull(workspaceId: string, prId: string): Promise<{ id: string } | undefined>;
  getPrFiles(prId: string): Promise<SmartDiffPrFile[]>;
  reviewsForPull(prId: string): Promise<ReviewWithFindings[]>;
}
