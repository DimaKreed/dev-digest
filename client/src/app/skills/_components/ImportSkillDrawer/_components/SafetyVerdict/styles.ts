import type { CSSProperties } from "react";

/**
 * Verdict → the CSS variable its box is tinted with. `unscanned` is a real
 * tone, not the absence of one: a null verdict must look like a distinct state,
 * never like an unstyled `safe`.
 */
export const TONE_COLOR = {
  safe: "var(--ok)",
  suspicious: "var(--warning)",
  unsafe: "var(--critical)",
  unscanned: "var(--text-muted)",
} as const;

export type Tone = keyof typeof TONE_COLOR;

export const s = {
  box: (tone: Tone): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 14,
    borderRadius: 8,
    border: `1px solid color-mix(in srgb, ${TONE_COLOR[tone]} 40%, var(--border))`,
    background: `color-mix(in srgb, ${TONE_COLOR[tone]} 8%, transparent)`,
  }),
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  title: (tone: Tone): CSSProperties => ({
    fontSize: 13,
    fontWeight: 600,
    color: TONE_COLOR[tone],
  }),
  label: {
    marginLeft: "auto",
    fontSize: 11.5,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  summary: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  reasonsTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  reason: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    paddingLeft: 10,
    borderLeft: "2px solid var(--border-strong)",
  } satisfies CSSProperties,
  quote: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  category: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  gate: {
    marginTop: 2,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
} as const;
