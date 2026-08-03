import type { CSSProperties } from "react";

/** Co-located styles for FindingSummaryRow (moved out of FindingCard/styles.ts
 *  when the collapsed-header row became shared with the findings hover panel). */
export const s = {
  root: (clickable: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    // Fills its parent row so a sibling (FindingCard's chevron) sits flush right.
    flex: 1,
    minWidth: 0,
    textAlign: "left",
    cursor: clickable ? "pointer" : "default",
  }),
  badgeWrap: { paddingTop: 1 } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: (muted: boolean, dismissed: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  acceptedTag: { fontSize: 12, fontWeight: 600, color: "var(--ok)" } satisfies CSSProperties,
  dismissedTag: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 5,
  } satisfies CSSProperties,
  /** The `↗` escape hatch to GitHub, now that file:line navigates in-app. */
  githubLink: {
    display: "inline-flex",
    alignItems: "center",
    color: "var(--text-muted)",
    marginLeft: -8,
  } satisfies CSSProperties,
  rationale: (lines: number): CSSProperties => ({
    marginTop: 6,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: lines,
    overflow: "hidden",
  }),
} as const;
