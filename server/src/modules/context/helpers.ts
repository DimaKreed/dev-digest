import type { RepoFileEntry, SpecFile } from '@devdigest/shared';
import type { ContextAttachmentRow } from './ports.js';

/**
 * Pure helpers for the project-context module (ring 0).
 *
 * Type derivation from the matched root, the directory label, path-shape
 * validation and the row→DTO mappers. No filesystem, no clock, no environment,
 * no database — everything here takes data in and returns data out.
 */

/**
 * The name of the NEAREST ancestor directory of `path` whose own name is a
 * configured root, or `undefined` when the document sits under none of them.
 *
 * A root is a directory NAME matched at any depth, not a top-level path, so
 * `server/specs/api.md` matches the root `specs`. Searching from the deepest
 * segment outwards is what makes the nearest one win: `docs/specs/x.md` is a
 * `specs` document, not a `docs` one.
 *
 * Matching is exact and case-sensitive, like the badge it produces — nothing
 * here folds or normalises a configured name.
 */
export function nearestRootName(
  path: string,
  rootNames: ReadonlySet<string>,
): string | undefined {
  const segments = path.split('/');
  // `length - 2` skips the file name itself: a FILE called `specs` is not a
  // search root (matching file names as well as directory names is a separate,
  // unmade decision).
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment !== undefined && rootNames.has(segment)) return segment;
  }
  return undefined;
}

/** The directory a document lives in; `'.'` for one at the clone root. */
export function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '.' : path.slice(0, cut);
}

/**
 * Whether a path may be attached at all.
 *
 * Deliberately shape-only, and deliberately NOT "is it in the discovered set":
 * a document attached and then deleted from the repository must stay in the set
 * long enough for the user to detach it, so an undiscovered path is allowed
 * through while a traversing, absolute or non-markdown one is not.
 */
export function isAttachablePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  if (path.includes('\\') || path.includes('\0')) return false;
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;
  return path.toLowerCase().endsWith('.md');
}

/** Why a discovered document cannot be attached. `null` when it can. */
export type NotAttachableReason = 'too_large';

export interface DiscoveredDoc {
  entry: RepoFileEntry;
  /** The matched directory's own NAME — the displayed type. Never its path. */
  docType: string;
}

/**
 * Keep the documents that sit under some configured root, each tagged with the
 * nearest matching directory's name.
 *
 * One pass over one walk of the clone. There is nothing to deduplicate: the
 * walk visits every path once, which is the point of classifying after a single
 * traversal rather than walking once per configured root. `entries` arrives
 * sorted by path and that order is preserved.
 */
export function classifyByRoot(
  entries: readonly RepoFileEntry[],
  rootNames: ReadonlySet<string>,
): DiscoveredDoc[] {
  const out: DiscoveredDoc[] = [];
  for (const entry of entries) {
    const docType = nearestRootName(entry.path, rootNames);
    if (docType !== undefined) out.push({ entry, docType });
  }
  return out;
}

/**
 * A discovered document as the API reports it.
 *
 * `not_attachable_reason` is an ENUM, never a sentence carrying the byte
 * ceiling: the threshold is a server-side number and putting it in a response
 * would duplicate it into both `vendor/shared` copies and into the UI copy.
 * `tokens` is whatever the caller counted with the tokenizer adapter — the
 * client counts nothing.
 */
export function toDocument(
  doc: DiscoveredDoc,
  extra: { tokens: number | null; usedBy: number; reason: NotAttachableReason | null },
): SpecFile {
  return {
    path: doc.entry.path,
    content: null,
    size: doc.entry.size,
    updated_at: doc.entry.updatedAt,
    dir: dirOf(doc.entry.path),
    // The matched directory's own name, verbatim — not a mapped label, and
    // not its path: `server/specs/api.md` displays `specs`.
    doc_type: doc.docType,
    tokens: extra.tokens,
    used_by: extra.usedBy,
    attachable: extra.reason === null,
    not_attachable_reason: extra.reason,
  };
}

export function toAttachment(row: ContextAttachmentRow): { path: string; order: number } {
  return { path: row.path, order: row.order };
}
