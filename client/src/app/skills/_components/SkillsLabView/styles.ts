import type { CSSProperties } from "react";

/** Two-pane Skills Lab layout. Mirrors the Agent editor page's shell so the two
 *  sections of the app feel identical (280px list + flexible editor). */
export const s = {
  // 52px = Topbar height; the real scroller is <main> in AppFrame, not the window.
  wrap: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  sidebar: {
    width: 280,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  sidebarHead: { padding: "16px 16px 12px" } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  list: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  mainHead: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  mainTitle: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  mainBody: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
  placeholder: {
    flex: 1,
    display: "grid",
    placeItems: "center",
    padding: 28,
  } satisfies CSSProperties,
  loading: {
    flex: 1,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
} as const;
