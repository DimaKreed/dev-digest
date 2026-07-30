import type { CSSProperties } from "react";

export const s = {
  root: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
} as const;
