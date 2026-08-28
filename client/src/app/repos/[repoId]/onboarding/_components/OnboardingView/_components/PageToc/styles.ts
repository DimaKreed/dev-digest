import type { CSSProperties } from "react";

/** Co-located styles for PageToc. */
export const s = {
  nav: {
    position: "sticky",
    // Matches s.main's top padding. NOT --sticky-header-h: that token is the
    // PR detail page's sticky header height and this page has no sticky header,
    // so using it would park the list 180px down against empty space.
    top: 14,
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
