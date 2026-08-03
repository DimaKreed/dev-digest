import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  tiles: { display: "flex", gap: 14, flexWrap: "wrap" } satisfies CSSProperties,
  scopeNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    maxWidth: 760,
  } satisfies CSSProperties,
  panels: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 14,
  } satisfies CSSProperties,
  panel: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  panelTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    marginBottom: 12,
  } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 0",
    borderTop: "1px solid var(--border)",
    fontSize: 13,
  } satisfies CSSProperties,
  agentName: { flex: 1 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
