import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  } satisfies CSSProperties,
  /** Info strip above the form — explains where a prefilled draft came from. */
  banner: {
    display: "flex",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--accent)",
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
