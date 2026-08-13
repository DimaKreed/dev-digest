import type { CSSProperties } from "react";

/** Co-located styles for the finding callout. Colours are tokens, never hex. */
export const fs = {
  sevPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 7px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    flexShrink: 0,
  } satisfies CSSProperties,
  title: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  subhead: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    marginTop: 8,
    marginBottom: 4,
  } satisfies CSSProperties,
} as const;
