import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    maxWidth: 820,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 2,
  } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  enabledLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  // Header strip above the body textarea: filename, dirty flag, token count.
  bodyHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    border: "1px solid var(--border)",
    borderBottom: "none",
    borderRadius: "6px 6px 0 0",
    background: "var(--bg-surface)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  bodyFile: { fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  bodyTokens: { marginLeft: "auto" } satisfies CSSProperties,
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  } satisfies CSSProperties,
  savedNote: { fontSize: 13, color: "var(--ok)" } satisfies CSSProperties,
} as const;
