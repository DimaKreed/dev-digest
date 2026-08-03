"use client";

import React from "react";
import { Badge, Icon } from "@devdigest/ui";
import { LINE_HEIGHT, s } from "./styles";

/** chars/4 — a rough stand-in, ALWAYS rendered with a leading "~". */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Markdown body field with editor chrome: a file header and a line-number
 * gutter.
 *
 * No syntax highlighting. Doing it without a dependency means painting a
 * highlighted copy behind a transparent textarea, and that overlay desyncs the
 * moment a line wraps or the caret scrolls — a worse defect than plain text.
 *
 * The token count is an ESTIMATE. The client has no tokenizer; the server
 * counts on save. Showing an exact-looking number for text that has not been
 * saved would be a lie, hence the tilde.
 */
export function BodyEditor({
  value,
  onChange,
  fileName,
  dirty,
  placeholder,
  unsavedLabel,
  tokensLabel,
  rows = 12,
}: {
  value: string;
  onChange: (v: string) => void;
  fileName: string;
  dirty: boolean;
  placeholder?: string;
  unsavedLabel: string;
  /** Receives the estimated count; the caller owns the wording and the "~". */
  tokensLabel: (estimate: number) => string;
  rows?: number;
}) {
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const lineCount = React.useMemo(() => value.split("\n").length, [value]);

  // Translate rather than scroll: the gutter has no scrollbar of its own, so
  // there is nothing to fight with the textarea's.
  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const g = gutterRef.current;
    if (g) g.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
  };

  return (
    <div style={s.shell}>
      <div style={s.header}>
        <Icon.FileText size={13} style={{ color: "var(--text-muted)" }} />
        <span className="mono" style={s.fileName}>
          {fileName}
        </span>
        {dirty && <Badge>{unsavedLabel}</Badge>}
        <span style={s.tokens}>{tokensLabel(estimateTokens(value))}</span>
      </div>

      <div style={{ ...s.pane, height: rows * LINE_HEIGHT + 24 }}>
        <div ref={gutterRef} className="mono" style={s.gutter} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          className="mono"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          style={{ ...s.textarea, height: "100%" }}
        />
      </div>
    </div>
  );
}
