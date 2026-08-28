/**
 * Badge colours for a project-context document's type.
 *
 * The type is the matched search root's own directory name (AC-41), and the set
 * of roots is CONFIGURABLE — `DEVDIGEST_CONTEXT_ROOTS` may name any directory —
 * so this is a lookup over the shipped defaults with a neutral fallback, NOT an
 * exhaustive `Record` over a closed union. A custom root such as `adr` renders
 * in the fallback colour; its badge text still tells it apart from `rfc`, which
 * is what AC-41 actually requires. Colour is a hint here, never the distinction.
 *
 * It lives in `lib/` rather than beside either component because two routes
 * render this badge — the Project Context page and the `Context` tab in both the
 * agent and skill editors — and one route's `_components/` is not an import
 * target for another.
 *
 * `@devdigest/ui` deliberately stays out of it. `SEV` and `CAT` in the design
 * system map CLOSED unions that the system itself owns; a search root is a
 * product concept with an open value set, and the kit should not learn about it.
 */
const DOC_TYPE_COLOURS: Record<string, { color: string; bg: string }> = {
  specs: { color: "var(--accent)", bg: "var(--accent-bg)" },
  docs: { color: "var(--info)", bg: "var(--info-bg)" },
  insights: { color: "var(--warn)", bg: "var(--warn-bg)" },
};

/** Badge default pair, for a configured root outside the shipped three. */
const FALLBACK = { color: "var(--text-secondary)", bg: "var(--bg-hover)" } as const;

/** `color`/`bg` props for a document type's badge. Spread straight onto `Badge`. */
export function docTypeBadge(docType: string | null | undefined): {
  color: string;
  bg: string;
} {
  return (docType ? DOC_TYPE_COLOURS[docType] : undefined) ?? FALLBACK;
}
