/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import type { FindingRecord } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { FindingTag, FindingDetails } from "../FindingCallout";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings,
  tagFindings,
  highlighted,
  scrollTo,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Live findings whose new-side range COVERS this line, most severe first.
   *  The most severe one tints the row and draws the rail. Every covered row
   *  gets this, because the tint is what shows the extent of the range. */
  findings?: FindingRecord[];
  /** Findings whose range STARTS at this row — the only rows that get a tag.
   *  A finding spanning 15 lines would otherwise stamp 15 identical badges down
   *  the right edge, which is noise, not information. */
  tagFindings?: FindingRecord[];
  /** Inside the deep-linked line range. */
  highlighted?: boolean;
  /** Set (to the target's nonce) on the FIRST row of the range. This row
   *  scrolls itself: it only mounts once its file card has expanded, so doing
   *  it here avoids the expand-and-scroll-in-one-tick trap. */
  scrollTo?: number;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  const [showFindings, setShowFindings] = React.useState(false);
  const rowRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollTo == null) return;
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollTo]);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;

  // Most severe wins the row: one line can carry findings from several agents.
  const flagged = findings?.[0];
  const tagged = tagFindings ?? [];

  return (
    <div
      ref={rowRef}
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        data-highlighted={highlighted || undefined}
        data-severity={flagged?.severity}
        style={lineRowFor(ln.kind, highlighted, flagged?.severity)}
      >
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {tagged.length > 0 && (
          <FindingTag
            findings={tagged}
            open={showFindings}
            onToggle={() => setShowFindings((v) => !v)}
          />
        )}
      </div>

      {showFindings && tagged.length > 0 && <FindingDetails findings={tagged} />}

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
