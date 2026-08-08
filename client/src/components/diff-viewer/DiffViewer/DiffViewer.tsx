/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import type { DiffTarget } from "../helpers";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  findings,
  target,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Live findings for the whole PR — pass `liveFindings(reviews)` from
   *  `@/lib/severity`, never a raw `review.findings`, or a re-run's superseded
   *  findings and dismissed ones will mark lines that no longer carry them.
   *  Omit it and the diff renders exactly as it did before findings existed. */
  findings?: FindingRecord[];
  /** Deep-link target from `?file=…&line=44-48` — expands that file, scrolls to
   *  it and tints the line range. */
  target?: DiffTarget | null;
}) {
  const t = useTranslations("shell");

  // Grouped once here rather than filtered inside each card: a PR with 30 files
  // and 40 findings would otherwise be 1200 predicate calls per render.
  const byPath = React.useMemo(() => {
    const map = new Map<string, FindingRecord[]>();
    for (const f of findings ?? []) {
      const list = map.get(f.file);
      if (list) list.push(f);
      else map.set(f.file, [f]);
    }
    return map;
  }, [findings]);

  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f) => (
        // Keyed by path, not index: a card's collapse state is local, and an
        // index key would bind it to the slot rather than to the file.
        <FileCard
          key={f.path}
          file={f}
          commenting={commenting}
          findings={byPath.get(f.path)}
          target={target?.path === f.path ? target : null}
        />
      ))}
    </div>
  );
}
