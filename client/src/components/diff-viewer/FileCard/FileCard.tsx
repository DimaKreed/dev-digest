/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { SEVERITY_LEVELS } from "@/lib/severity";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, lineInRange, type Line, type DiffTarget } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/**
 * Findings whose new-side range covers a given parsed line, most severe first.
 *
 * Matched with `lineInRange` — the same predicate the deep-link highlight uses —
 * so a finding's marker lands on exactly the rows `?file=&line=` would tint.
 */
function findingsForRenderedLine(ln: Line, findings: FindingRecord[]): FindingRecord[] {
  if (findings.length === 0) return [];
  return findings
    .filter((f) => lineInRange(ln, f.start_line, f.end_line))
    .sort((a, b) => SEVERITY_LEVELS.indexOf(a.severity) - SEVERITY_LEVELS.indexOf(b.severity));
}

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  findings,
  target,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** This file's live findings (the caller filters by path). */
  findings?: FindingRecord[];
  /** Non-null only for the deep-linked file. */
  target?: DiffTarget | null;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // A large file starts collapsed, and while collapsed its lines aren't in the
  // DOM at all — so expanding is a precondition for scrolling to one. The
  // scroll itself belongs to the target CodeLine's mount effect, which by
  // definition runs after this expansion has painted.
  const targetNonce = target?.nonce;
  React.useEffect(() => {
    if (target) setOpen(true);
  }, [target, targetNonce]);

  /** Index of the first row inside the target range, or -1. */
  const scrollToIdx = React.useMemo(
    () => (target ? lines.findIndex((ln) => lineInRange(ln, target.start, target.end)) : -1),
    [lines, target],
  );

  // Fallback when the target line isn't in the diff at all (a finding can point
  // at a line outside the patch hunks) — at least land on the right file.
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!target || scrollToIdx !== -1) return;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [target, targetNonce, scrollToIdx]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  // Two maps, keyed by row index: `covered` tints every row inside a finding's
  // range, `tagged` carries the badge on the FIRST rendered row of that range
  // only. "First rendered" rather than `start_line`, because a finding can start
  // above the hunk this patch shows — the badge then lands on the first row the
  // reader can actually see, instead of vanishing.
  const { covered, tagged } = React.useMemo(() => {
    const list = findings ?? [];
    const covered = new Map<number, FindingRecord[]>();
    const tagged = new Map<number, FindingRecord[]>();
    if (list.length === 0) return { covered, tagged };

    const firstRowOf = new Map<string, number>();
    lines.forEach((ln, i) => {
      const hits = findingsForRenderedLine(ln, list);
      if (hits.length === 0) return;
      covered.set(i, hits);
      for (const f of hits) if (!firstRowOf.has(f.id)) firstRowOf.set(f.id, i);
    });

    for (const f of list) {
      const row = firstRowOf.get(f.id);
      if (row == null) continue;
      const at = tagged.get(row);
      if (at) at.push(f);
      else tagged.set(row, [f]);
    }
    // Same order the row tint uses, so the badge names the finding that coloured
    // the line rather than whichever one happened to be listed first.
    for (const group of tagged.values()) {
      group.sort((a, b) => SEVERITY_LEVELS.indexOf(a.severity) - SEVERITY_LEVELS.indexOf(b.severity));
    }
    return { covered, tagged };
  }, [findings, lines]);

  return (
    <div ref={rootRef} data-file-path={file.path} style={s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findings={covered.get(i)}
                tagFindings={tagged.get(i)}
                highlighted={!!target && lineInRange(ln, target.start, target.end)}
                scrollTo={i === scrollToIdx ? targetNonce : undefined}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
