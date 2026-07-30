import type { CSSProperties } from "react";

export const s = {
  stack: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  item: {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
