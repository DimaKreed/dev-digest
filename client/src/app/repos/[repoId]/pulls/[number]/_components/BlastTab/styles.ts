import type { CSSProperties } from "react";

/** Co-located styles for the blast-radius tab. */
export const s = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "16px 18px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  stat: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statValue: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  viewToggle: { marginLeft: "auto", display: "flex", gap: 4 } satisfies CSSProperties,
  viewToggleBtn: (active: boolean) =>
    ({
      padding: "3px 10px",
      borderRadius: 6,
      border: "1px solid var(--border)",
      cursor: "pointer",
      font: "inherit",
      fontSize: 12,
      background: active ? "var(--bg-hover)" : "transparent",
      color: active ? "var(--text-primary)" : "var(--text-muted)",
    }) satisfies CSSProperties,

  // --- tree ---------------------------------------------------------------
  symbolRow: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBottom: 10,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  symbolHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 8px",
    border: "none",
    borderRadius: 6,
    background: "var(--bg-surface)",
    cursor: "pointer",
    font: "inherit",
    textAlign: "left",
  } satisfies CSSProperties,
  symbolName: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  symbolFile: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11.5,
    color: "var(--text-muted)",
    // Long paths must not push the count off the row.
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  } satisfies CSSProperties,
  symbolCount: {
    marginLeft: "auto",
    flexShrink: 0,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingInlineStart: 20,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
  } satisfies CSSProperties,
  arrow: { color: "var(--text-muted)", fontSize: 11 } satisfies CSSProperties,
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    paddingInlineStart: 20,
  } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  // --- banners ------------------------------------------------------------
  banner: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--warn-border, var(--border))",
    background: "var(--warn-bg, var(--bg-surface))",
  } satisfies CSSProperties,
  bannerTitle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--warn-text, var(--text-primary))",
  } satisfies CSSProperties,
  bannerBody: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  meta: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  skeletons: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  // --- graph --------------------------------------------------------------
  graphWrap: { overflowX: "auto", paddingBlock: 8 } satisfies CSSProperties,
  legend: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 5,
  } satisfies CSSProperties,
  legendDot: (color: string) =>
    ({
      width: 7,
      height: 7,
      borderRadius: "50%",
      background: color,
    }) satisfies CSSProperties,

  // --- prior PRs ----------------------------------------------------------
  priorSection: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  priorToggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: 13,
    color: "var(--text-primary)",
    textAlign: "left",
  } satisfies CSSProperties,
  priorItem: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingInlineStart: 14,
    borderInlineStart: "2px solid var(--border)",
  } satisfies CSSProperties,
  priorHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  priorNumber: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    color: "var(--accent)",
  } satisfies CSSProperties,
  priorTitle: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  priorNote: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  // --- types and interfaces (their own section; `priorSection` layout) -----
  uncallableList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingInlineStart: 14,
    borderInlineStart: "2px solid var(--border)",
  } satisfies CSSProperties,
  uncallableRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
    fontSize: 12.5,
  } satisfies CSSProperties,
  uncallableName: {
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  uncallableFile: {
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
