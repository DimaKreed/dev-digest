import type { CSSProperties } from "react";

/** Co-located styles for PageToc. */
export const s = {
  nav: {
    position: "sticky",
    top: "var(--sticky-header-h)",
    width: 200,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  heading: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,
  link: {
    fontSize: 13,
    color: "var(--text-secondary)",
    textDecoration: "none",
    padding: "4px 0",
  } satisfies CSSProperties,
} as const;
