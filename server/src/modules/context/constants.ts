/**
 * Project-context module constants (ring 0).
 *
 * The extension list, the excluded-directory NAMES and the per-file byte
 * ceiling are RESTATED here rather than imported from the indexer slice. A
 * reach into a sibling module fails the `no-cross-module` arch rule for a bare
 * constant exactly as it does for a helper, so the legal shape is a local copy
 * with a comment naming the file it must stay equal to: the walk-scope
 * constants of the repo indexer slice (its `constants.ts`). Keep those three in
 * step with that file by hand.
 *
 * `EXCLUDED_CONTEXT_PATHS` is the exception and is deliberately NOT part of
 * that correspondence — it is discovery-only, has no counterpart in the indexer
 * slice, and is path-shaped rather than name-shaped. It is kept as its own
 * constant precisely so the name list above can still be compared to the
 * indexer's line for line.
 */

/** Only markdown is attachable. */
export const CONTEXT_EXT = ['.md'] as const;

/**
 * Per-file ceiling for DISCOVERY AND ATTACHMENT ONLY.
 *
 * A document over this size is still LISTED — marked not-attachable, with the
 * reason supplied by the server so the client never learns the number. It
 * governs nothing at run time: a document attached before it grew past the
 * ceiling is still injected verbatim, with no cap and no truncation.
 */
export const MAX_CONTEXT_FILE_SIZE = 400 * 1024; // 400 KB

/**
 * Directory NAMES never descended into during discovery. Matched at any depth,
 * which is why nothing path-shaped belongs in this list.
 */
export const EXCLUDED_CONTEXT_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

/**
 * Clone-relative PATHS never descended into during discovery.
 *
 * `.devdigest/cache` holds the agent workflow's own artifacts — briefings,
 * development plans, run ledgers. Once a search root matches a directory name
 * at any depth, that cache becomes discoverable, and offering this workflow's
 * own briefing to a reviewer as the repository's "project context" is nonsense.
 *
 * Scoped to the `cache` subdirectory ON PURPOSE, and not to `.devdigest` as a
 * whole: `.devdigest/specs/` is a convention this product proposed to its own
 * users — the original empty-state copy read "Drop your PRDs, tech specs, and
 * acceptance criteria under `.devdigest/specs/`" — and under a name-matched
 * walk that path now works with no configuration at all. Excluding the parent
 * would close a door the product deliberately opened.
 *
 * A PATH and not a name, for the same reason: `cache` as a name would remove
 * every `cache/` directory in every repository under review, and `.devdigest`
 * as a name would remove the sibling above.
 */
export const EXCLUDED_CONTEXT_PATHS = ['.devdigest/cache'] as const;

/** Upper bound on the number of paths one attachment request may carry. */
export const MAX_ATTACHMENTS_PER_PARENT = 200;
