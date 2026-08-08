import type { CSSProperties } from "react";
import { SEV, type Severity } from "@devdigest/ui";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    // Clears the sticky PR header when a deep link scrolls this card into view.
    scrollMarginTop: "var(--sticky-header-h)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/**
 * Row background per line kind (add/del tinted, others transparent).
 * A deep-link highlight and a finding severity both LAYER over that tint via an
 * inset rail rather than replacing the background — overwriting it would erase
 * the add/del signal and make the diff unreadable exactly where the reader is
 * looking.
 *
 * When a line carries both, the rail shows the SEVERITY colour: the deep link is
 * transient (it says "you just navigated here") while the severity is a property
 * of the code, and the accent gradient still marks the navigation.
 */
export function lineRowFor(
  kind: Line["kind"],
  highlighted?: boolean,
  severity?: Severity | null,
): CSSProperties {
  const tint = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  const sev = severity ? SEV[severity] : null;
  const layers = [
    highlighted ? "linear-gradient(var(--accent-bg), var(--accent-bg))" : null,
    sev ? `linear-gradient(${sev.bg}, ${sev.bg})` : null,
    tint,
  ].filter(Boolean);
  const rail = sev ? sev.c : highlighted ? "var(--accent)" : null;
  return {
    display: "flex",
    alignItems: "stretch",
    fontSize: 13,
    lineHeight: "20px",
    background: layers.join(", "),
    boxShadow: rail ? `inset 3px 0 0 ${rail}` : undefined,
  };
}

/** The severity tag that sits at the right edge of a flagged line. */
export function lineSeverityTagFor(severity: Severity): CSSProperties {
  const sev = SEV[severity];
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    alignSelf: "center",
    marginRight: 10,
    padding: "0 6px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: "16px",
    cursor: "help",
    color: sev.c,
    background: sev.bg,
  };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}
