import type { CSSProperties } from "react";

/** Co-located styles for the Onboarding Tour page. */
export const s = {
  pageHeader: {
    padding: "24px 32px 10px",
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  /** The repo name inside the heading reads as an identifier, not prose. */
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    alignItems: "center",
  } satisfies CSSProperties,
  main: {
    display: "flex",
    gap: 24,
    padding: "14px 32px 44px",
    alignItems: "flex-start",
  } satisfies CSSProperties,
  column: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  banners: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  note: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  /**
   * Visually hidden, still in the accessibility tree — the regeneration outcome
   * is announced rather than shown, so it must not take layout space.
   */
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
