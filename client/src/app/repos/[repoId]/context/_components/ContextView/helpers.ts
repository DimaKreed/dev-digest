import type { ContextSearchRoot, SpecFile } from "@devdigest/shared";

/** The document's file name, without its directory. */
export function baseName(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

/**
 * The directory to display. The server sends `dir` per row; fall back to
 * deriving it from the path so a response written before that field existed
 * still renders (every new field on `SpecFile` is nullish).
 */
export function dirOf(doc: SpecFile): string {
  if (doc.dir) return doc.dir;
  const cut = doc.path.lastIndexOf("/");
  return cut < 0 ? "." : doc.path.slice(0, cut);
}

/**
 * The searched directories, as one readable phrase for the empty state.
 *
 * Formatting only — the NAMES come from the server, which is the point: the
 * shipped default is `specs`, `docs`, `insights`, but an operator can configure
 * any set and the empty state must name what was really searched. Falls back to
 * a generic phrase while the roots are still loading, rather than guessing.
 */
export function rootList(roots: readonly ContextSearchRoot[] | undefined): string {
  if (!roots || roots.length === 0) return "the configured search directories";
  return roots.map((root) => `${root.dir}/`).join(", ");
}
