/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import type { DiffTarget } from "../helpers";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  target,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Deep-link target from `?file=…&line=44-48` — expands that file, scrolls to
   *  it and tints the line range. */
  target?: DiffTarget | null;
}) {
  const t = useTranslations("shell");
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
          target={target?.path === f.path ? target : null}
        />
      ))}
    </div>
  );
}
