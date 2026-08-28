import type { ContextAttachment, SpecFile } from "@devdigest/shared";

/** The document's file name, without its directory. */
export function baseName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

/** The directory to display; derived when the server did not send one. */
export function dirOf(doc: SpecFile): string {
  if (doc.dir) return doc.dir;
  const cut = doc.path.lastIndexOf("/");
  return cut < 0 ? "." : doc.path.slice(0, cut);
}

/** The persisted set as an ordered path list. */
export function attachedPaths(attachments: readonly ContextAttachment[]): string[] {
  return [...attachments].sort((a, b) => a.order - b.order).map((a) => a.path);
}

/**
 * The rows to render: attached documents first, in their PERSISTED order, then
 * everything else in discovery order. Attached-first is what makes the visible
 * order the injection order.
 *
 * A path that is attached but no longer discovered still gets a row — otherwise
 * a document deleted from the repository could never be detached. It is marked
 * `missing` and its checkbox stays checked.
 */
export interface AttachRow {
  path: string;
  doc: SpecFile | null;
  attached: boolean;
}

export function rowsFor(docs: readonly SpecFile[], attached: readonly string[]): AttachRow[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const attachedSet = new Set(attached);
  return [
    ...attached.map((path) => ({ path, doc: byPath.get(path) ?? null, attached: true })),
    ...docs
      .filter((d) => !attachedSet.has(d.path))
      .map((d) => ({ path: d.path, doc: d, attached: false })),
  ];
}

/** Case-insensitive substring match on the whole path. */
export function matchesFilter(row: AttachRow, query: string): boolean {
  return query.length === 0 || row.path.toLowerCase().includes(query);
}

/**
 * The set's total token cost: the SERVER's per-document figures, summed. The
 * client never counts tokens itself, so a document whose size the server could
 * not report contributes nothing rather than an estimate.
 */
export function totalTokens(rows: readonly AttachRow[]): number {
  return rows.reduce((sum, row) => (row.attached ? sum + (row.doc?.tokens ?? 0) : sum), 0);
}
