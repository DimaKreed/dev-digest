import type { CSSProperties } from "react";

/** Co-located styles for the collapsible scan report. */
export const s = {
  panel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
  } satisfies CSSProperties,
  headTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  headSummary: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  headAction: { marginLeft: "auto" } satisfies CSSProperties,
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "4px 16px 16px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  funnel: {
    display: "flex",
    gap: 10,
    paddingTop: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  bigStat: (accent: boolean): CSSProperties => ({
    flex: "1 1 140px",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid " + (accent ? "var(--accent)" : "var(--border)"),
    background: accent ? "var(--accent-bg)" : "var(--bg-surface)",
  }),
  bigNum: (accent: boolean): CSSProperties => ({
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1.2,
    color: accent ? "var(--accent-text)" : "var(--text-primary)",
  }),
  bigLabel: {
    fontSize: 12,
    color: "var(--text-secondary)",
    marginTop: 2,
  } satisfies CSSProperties,
  dropRow: (zero: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    padding: "5px 0",
    borderBottom: "1px solid var(--border)",
    color: zero ? "var(--text-muted)" : "var(--text-secondary)",
  }),
  dropCount: (zero: boolean): CSSProperties => ({
    marginLeft: "auto",
    fontWeight: 700,
    color: zero ? "var(--text-muted)" : "var(--warn)",
  }),
  meta: {
    display: "flex",
    gap: 18,
    flexWrap: "wrap",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metaItem: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  configFiles: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
} as const;
