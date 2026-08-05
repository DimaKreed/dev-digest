import type { CSSProperties } from "react";

/** Shared by the gutter and the textarea — they MUST agree or the numbers drift. */
export const LINE_HEIGHT = 21;
const FONT_SIZE = 13;
const PAD_Y = 12;

export const s = {
  shell: {
    border: "1px solid var(--border-strong)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
  } satisfies CSSProperties,

  fileName: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,

  tokens: { marginLeft: "auto", color: "var(--text-muted)" } satisfies CSSProperties,

  /** Gutter and textarea scroll as one; the gutter is translated, not scrolled. */
  pane: { display: "flex", alignItems: "flex-start", overflow: "hidden" } satisfies CSSProperties,

  gutter: {
    flex: "0 0 auto",
    padding: `${PAD_Y}px 8px ${PAD_Y}px 12px`,
    textAlign: "right",
    color: "var(--text-muted)",
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
    userSelect: "none",
    borderRight: "1px solid var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,

  textarea: {
    flex: 1,
    minWidth: 0,
    // The shell owns the frame; the editor is a bare surface inside it. `resize`
    // is off because a grabber would sit over the gutter and desync it.
    border: "none",
    outline: "none",
    resize: "none",
    background: "transparent",
    color: "var(--text-primary)",
    padding: `${PAD_Y}px 12px`,
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
    // Off so a wrapped line cannot desync the gutter, which counts real
    // newlines and has no way to know about visual wraps.
    whiteSpace: "pre",
    overflow: "auto",
  } satisfies CSSProperties,
} as const;
