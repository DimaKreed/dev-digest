import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "6px 0 16px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  row: (current: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    border: "1px solid " + (current ? "var(--border-strong)" : "var(--border)"),
    borderRadius: 8,
    background: current ? "var(--bg-hover)" : "var(--bg-elevated)",
    marginBottom: 8,
  }),
  versionChip: {
    fontSize: 12,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 4,
    background: "var(--accent-bg)",
    color: "var(--accent)",
  } satisfies CSSProperties,
  meta: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  note: {
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  diffBody: {
    maxHeight: "60vh",
    overflow: "auto",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  diffLine: (kind: "same" | "added" | "removed"): CSSProperties => ({
    display: "block",
    fontSize: 12.5,
    lineHeight: 1.6,
    padding: "0 10px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background:
      kind === "added"
        ? "color-mix(in srgb, var(--ok) 14%, transparent)"
        : kind === "removed"
          ? "color-mix(in srgb, var(--critical) 14%, transparent)"
          : "transparent",
    color: kind === "same" ? "var(--text-muted)" : "var(--text-primary)",
  }),
  identical: { fontSize: 13, color: "var(--text-muted)", padding: 14 } satisfies CSSProperties,
} as const;
