import type { CSSProperties } from "react";

/** Co-located styles for one convention candidate card. */
export const s = {
  /** Accepted cards carry a left accent border; rejected ones read as set aside. */
  card: (accepted: boolean, rejected: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "16px 18px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accepted ? "var(--accent)" : "var(--border)"}`,
    background: "var(--bg-elevated)",
    opacity: rejected ? 0.55 : 1,
    transition: "border-color .12s, opacity .12s",
  }),
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  confidence: { marginLeft: "auto", width: 150 } satisfies CSSProperties,
  ruleRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  } satisfies CSSProperties,
  rule: {
    flex: 1,
    fontSize: 14.5,
    fontStyle: "italic",
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  editWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  editActions: { display: "flex", gap: 8 } satisfies CSSProperties,
  evidence: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,
  githubLink: {
    display: "inline-flex",
    alignItems: "center",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  snippet: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.6,
    whiteSpace: "pre",
    overflowX: "auto",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
} as const;
