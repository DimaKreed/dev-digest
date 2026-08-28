import type { CSSProperties } from "react";

/** Co-located styles for SectionCard. */
export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  } satisfies CSSProperties,
  heading: {
    fontSize: 16,
    fontWeight: 650,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
  body: { fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
  diagram: { marginTop: 12 } satisfies CSSProperties,
  links: {
    listStyle: "none",
    margin: "12px 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  link: {
    fontSize: 13,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
  deadLink: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
