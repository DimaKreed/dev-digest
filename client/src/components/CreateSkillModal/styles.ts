import type { CSSProperties } from "react";

export const s = {
  /**
   * `Modal` renders children bare — every caller pads its own body (see
   * CreateAgentModal). No `gap`: `FormField` already carries marginBottom, and
   * stacking the two produced the oversized rows. Bottom padding is trimmed to
   * absorb the last field's margin.
   */
  body: { padding: "24px 24px 4px" } satisfies CSSProperties,

  /** Type + Enabled share a row, as in the design. */
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    columnGap: 20,
    alignItems: "start",
  } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,

  footerNote: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginRight: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** Provenance strip above the form — where a prefilled draft came from. */
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 12px",
    marginBottom: 20,
    borderRadius: 7,
    // A hairline, not the full-strength accent — this is context, not a
    // warning. Derived rather than a new token: the design system has no
    // accent-border, and one component does not justify adding one.
    border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
