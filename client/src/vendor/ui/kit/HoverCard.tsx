import React from "react";

/**
 * HoverCard — a peek panel anchored to a trigger, opened by hover or focus.
 *
 * Deliberately NOT built on `Dropdown`: that one is click-only and its body is
 * hard-wired to `DropdownItemDef[]`, and it positions with `position: absolute`,
 * which any ancestor with `overflow: hidden` clips (the PR list's table card
 * does exactly that). This uses `position: fixed` with coordinates read from the
 * trigger's bounding rect — fixed descendants escape `overflow: hidden` — and
 * flips above the trigger when there isn't room below.
 *
 * The panel keeps itself open while the cursor is inside it, so a scrollable
 * body is reachable; a short close delay bridges the gap between the two.
 */

/** Gap between trigger and panel, and the viewport margin when clamping. */
const OFFSET = 6;
const EDGE = 8;
/** Cursor travel budget between trigger and panel before the panel closes. */
const CLOSE_DELAY = 150;

type Coords = { top: number; left: number };

export function HoverCard({
  trigger,
  children,
  width = 380,
  maxHeight = 360,
  openDelay = 120,
  disabled,
  block,
  onOpenChange,
}: {
  trigger: React.ReactNode;
  /** Pass a function to build the body only while open (skips work when closed). */
  children: React.ReactNode | (() => React.ReactNode);
  width?: number;
  maxHeight?: number;
  openDelay?: number;
  /** No panel at all — the trigger renders bare. */
  disabled?: boolean;
  /** Full-width anchor, for a trigger that is a block-level row rather than an
   *  inline control. Without it the wrapper shrink-wraps and the row collapses. */
  block?: boolean;
  /** Fired when the panel opens/closes — lets a caller fetch the body lazily. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [coords, setCoords] = React.useState<Coords | null>(null);
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => clearTimer, []);

  const place = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Flip above when the panel wouldn't fit below the trigger.
    const below = rect.bottom + OFFSET;
    const flip = below + maxHeight > window.innerHeight && rect.top - OFFSET > maxHeight;
    setCoords({
      top: flip ? Math.max(EDGE, rect.top - OFFSET - maxHeight) : below,
      left: Math.min(Math.max(EDGE, rect.left), window.innerWidth - width - EDGE),
    });
    onOpenChange?.(true);
  };

  const open = (delay: number) => {
    clearTimer();
    if (disabled) return;
    timer.current = setTimeout(place, delay);
  };
  const close = (delay: number) => {
    clearTimer();
    timer.current = setTimeout(() => {
      setCoords(null);
      onOpenChange?.(false);
    }, delay);
  };

  return (
    <>
      <span
        ref={anchorRef}
        style={block ? { display: "block", width: "100%" } : { display: "inline-flex" }}
        onMouseEnter={() => open(openDelay)}
        onMouseLeave={() => close(CLOSE_DELAY)}
        // Focus reaches this wrapper from the focusable trigger inside it, so
        // keyboard users get the same peek without a pointer.
        onFocus={() => open(0)}
        onBlur={() => close(0)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close(0);
        }}
      >
        {trigger}
      </span>
      {coords && (
        <div
          role="tooltip"
          onMouseEnter={clearTimer}
          onMouseLeave={() => close(CLOSE_DELAY)}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width,
            maxHeight,
            overflowY: "auto",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 9,
            boxShadow: "var(--shadow-modal)",
            padding: 10,
            zIndex: 40,
            animation: "ddpop .12s ease",
          }}
        >
          {typeof children === "function" ? children() : children}
        </div>
      )}
    </>
  );
}
