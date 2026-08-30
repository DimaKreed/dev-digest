import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 1000,
  } satisfies CSSProperties,
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  sub: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  tiles: { display: "flex", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  tile: {
    flex: "1 1 180px",
    minWidth: 160,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 14,
  } satisfies CSSProperties,
  tileLabel: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  tileValue: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginTop: 8,
    fontSize: 26,
    fontWeight: 700,
  } satisfies CSSProperties,
  delta: (v: number): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color: v === 0 ? "var(--text-muted)" : v > 0 ? "var(--ok)" : "var(--crit)",
  }),
  list: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  row: (pass: boolean | null, errored: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
    borderLeft: `3px solid ${
      errored
        ? "var(--warn)"
        : pass === true
          ? "var(--ok)"
          : pass === false
            ? "var(--crit)"
            : "var(--border-strong)"
    }`,
  }),
  caseName: {
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
  } satisfies CSSProperties,
  caseMeta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  rowMain: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 },
  rowActions: { display: "flex", alignItems: "center", gap: 4 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 } satisfies CSSProperties,
  // --- expected vs actual ---------------------------------------------------
  singlePane: { minWidth: 0 } satisfies CSSProperties,
  /** The editor supplies its own heading for the actual pane. */
  hidden: { display: "none" } satisfies CSSProperties,
  runOnSave: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  polarityRow: { display: "flex", gap: 8, marginTop: 10 } satisfies CSSProperties,
  assertion: (positive: boolean): CSSProperties => ({
    padding: "10px 14px",
    borderRadius: 8,
    border: `1px solid ${positive ? "var(--accent)" : "var(--crit)"}`,
    background: "var(--bg-surface)",
  }),
  assertionLabel: (positive: boolean): CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.07em",
    color: positive ? "var(--accent)" : "var(--crit)",
  }),
  assertionBody: { fontSize: 12.5, marginTop: 4, lineHeight: 1.45 } satisfies CSSProperties,
  compareGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    minWidth: 0,
  } satisfies CSSProperties,
  paneLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  paneMeta: {
    fontSize: 11,
    fontWeight: 400,
    letterSpacing: 0,
    textTransform: "none",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  locRow: (state: "good" | "bad" | "neutral" | "unknown"): CSSProperties => ({
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${
      state === "good"
        ? "var(--ok)"
        : state === "bad"
          ? "var(--crit)"
          : state === "neutral"
            ? "var(--warn)"
            : "var(--border-strong)"
    }`,
    background: "var(--bg-surface)",
  }),
  locHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  locFile: { fontSize: 12, color: "var(--text-secondary)", flex: 1, minWidth: 0, wordBreak: "break-all" } satisfies CSSProperties,
  locSeverity: (sev: string): CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color:
      sev === "CRITICAL" ? "var(--crit)" : sev === "WARNING" ? "var(--warn)" : "var(--sugg)",
  }),
  locTitle: { fontSize: 12.5, marginTop: 3, lineHeight: 1.4 } satisfies CSSProperties,
  errorBox: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--warn)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  verdict: (pass: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    padding: "9px 12px",
    borderRadius: 7,
    fontSize: 12.5,
    border: `1px solid ${pass ? "var(--ok)" : "var(--crit)"}`,
    background: pass
      ? "var(--ok-bg, rgba(30,140,80,0.10))"
      : "var(--crit-bg, rgba(180,50,50,0.10))",
  }),
  expandRow: {
    padding: "12px 14px 14px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  caseShell: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  // --- modal ---------------------------------------------------------------
  form: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 18,
    padding: "18px 24px",
  } satisfies CSSProperties,
  col: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } satisfies CSSProperties,
  label: { fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  hint: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  expRow: {
    display: "flex",
    gap: 6,
    alignItems: "flex-end",
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifyContent: "flex-end",
  } satisfies CSSProperties,
  polarity: (active: boolean, positive: boolean): CSSProperties => ({
    flex: 1,
    padding: "10px 12px",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
    fontSize: 12,
    lineHeight: 1.45,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    background: active ? "var(--bg-hover)" : "transparent",
    border: `1px solid ${
      active ? (positive ? "var(--ok)" : "var(--crit)") : "var(--border)"
    }`,
  }),
} as const;
