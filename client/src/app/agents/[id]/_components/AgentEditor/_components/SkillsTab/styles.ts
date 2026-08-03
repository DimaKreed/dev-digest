import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  filter: { marginLeft: "auto", width: 220 } satisfies CSSProperties,
  hint: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginBottom: 4,
  } satisfies CSSProperties,
  row: (linked: boolean, attachable: boolean, dragging: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid " + (linked ? "var(--border-strong)" : "var(--border)"),
    borderRadius: 8,
    background: linked ? "var(--bg-hover)" : "var(--bg-elevated)",
    marginBottom: 6,
    // A disabled skill cannot be attached at all, so it reads as inert.
    opacity: attachable ? (dragging ? 0.4 : 1) : 0.5,
  }),
  // Insertion marker: the row being dragged over grows a top edge.
  dropTarget: { boxShadow: "inset 0 2px 0 0 var(--accent)" } satisfies CSSProperties,
  handle: (enabled: boolean): CSSProperties => ({
    background: "none",
    border: "none",
    padding: "2px 0",
    lineHeight: 0,
    cursor: enabled ? "grab" : "default",
    color: enabled ? "var(--text-muted)" : "transparent",
    display: "inline-flex",
    flexShrink: 0,
  }),
  name: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  disabledNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  tokens: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
