import type { CSSProperties } from "react";

/** Co-located styles for the SmartDiffViewer. Colours are tokens, never hex. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  caption: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  large: {
    border: "1px solid var(--border)",
    borderLeft: "3px solid var(--warn)",
    borderRadius: 7,
    background: "var(--warn-bg)",
    padding: "10px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  largeTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  largeBody: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "6px 2px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  roleLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  index: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  indexRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  indexPath: {
    fontSize: 12,
    color: "var(--text-secondary)",
    maxWidth: 420,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  chip: {
    fontSize: 11,
    fontWeight: 600,
    padding: "1px 7px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    cursor: "pointer",
    lineHeight: 1.6,
  } satisfies CSSProperties,
} satisfies Record<string, CSSProperties>;

/** Chip colours for a re-derived severity; neutral tokens when there is none. */
export function chipTone(color: string | null, bg: string | null): CSSProperties {
  return {
    color: color ?? "var(--text-secondary)",
    background: bg ?? "var(--bg-hover)",
  };
}
