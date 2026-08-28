import type { CSSProperties } from "react";

/** Co-located styles for CodeBlock. */
export const s = {
  block: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 6,
    background: "var(--bg-hover)",
    color: "var(--text-secondary)",
    fontSize: 12,
    lineHeight: 1.5,
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
} as const;
