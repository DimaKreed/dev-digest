import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  } satisfies CSSProperties,
  tabsBar: {
    borderBottom: "1px solid var(--border)",
    marginTop: 12,
  } satisfies CSSProperties,
  body: { padding: 28 } satisfies CSSProperties,
} as const;
