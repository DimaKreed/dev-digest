/* ContextAttachList — pick and order the repository documents a prompt carries.
   Lives in src/components/ because two routes consume it: the agent editor's
   Context tab and the skill editor's. Every token figure on screen is a
   server-counted number; this component sums, and counts nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Markdown, Skeleton, TextInput } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { docTypeBadge } from "@/lib/doc-type";
import {
  useContextAttachments,
  useContextFile,
  useContextFiles,
  useSetContextAttachments,
  type ContextParentKind,
} from "@/lib/hooks";
import { moveId, orderChanged, reorder } from "@/lib/ordering";
import { attachedPaths, baseName, dirOf, matchesFilter, rowsFor, totalTokens } from "./helpers";
import { s } from "./styles";

export function ContextAttachList({
  kind,
  parentId,
  repoId,
}: {
  kind: ContextParentKind;
  parentId: string;
  repoId: string | null;
}) {
  const t = useTranslations("context");
  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  // Live order while a drag is in flight; null when not dragging. Local so the
  // list reorders under the cursor without a round-trip.
  const [draft, setDraft] = React.useState<string[] | null>(null);
  const [dragPath, setDragPath] = React.useState<string | null>(null);

  const listing = useContextFiles(repoId);
  const attachments = useContextAttachments(kind, parentId, repoId);
  const preview = useContextFile(repoId, previewPath);
  const setAttachments = useSetContextAttachments(kind, parentId, repoId);

  const savedPaths = attachedPaths(attachments.data ?? []);
  const paths = draft ?? savedPaths;

  const commit = (next: string[]) => setAttachments.mutate(next);

  const toggle = (path: string, on: boolean) =>
    commit(on ? [...paths, path] : paths.filter((p) => p !== path));

  // ---- drag and drop (native HTML5 — no dnd dependency in this repo) -------
  const onDragStart = (path: string) => {
    setDragPath(path);
    setDraft(savedPaths);
  };
  const onDragOverRow = (overPath: string) => {
    if (!dragPath || dragPath === overPath) return;
    setDraft((cur) => reorder(cur ?? savedPaths, dragPath, overPath));
  };
  const onDragEnd = () => {
    // A drag that lands where it started must not write.
    if (draft && orderChanged(draft, savedPaths)) commit(draft);
    setDraft(null);
    setDragPath(null);
  };

  // Keyboard equivalent on the same handle — without it, ordering is mouse-only.
  const onHandleKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const next = moveId(savedPaths, path, e.key === "ArrowUp" ? -1 : 1);
    if (orderChanged(next, savedPaths)) commit(next);
  };

  if (!repoId) return <p style={s.note}>{t("tab.noRepo")}</p>;
  if (listing.isLoading || attachments.isLoading) return <Skeleton height={200} />;
  if (listing.error) return <p style={s.note}>{t("tab.loadError")}</p>;

  const docs = listing.data ?? [];
  const rows = rowsFor(docs, paths);
  const query = filter.trim().toLowerCase();
  const visible = rows.filter((row) => matchesFilter(row, query));
  const attachableTotal = docs.filter((d) => d.attachable !== false).length;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("tab.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("tab.attachedCount", { attached: paths.length, total: attachableTotal })}
        </Badge>
        <div style={s.filter}>
          <TextInput
            value={filter}
            onChange={setFilter}
            placeholder={t("tab.filterPlaceholder")}
            aria-label={t("tab.filterPlaceholder")}
          />
        </div>
      </div>
      <p style={s.hint}>{t("tab.hint")}</p>

      {docs.length === 0 && <p style={s.note}>{t("tab.empty")}</p>}

      {visible.map((row) => {
        const attachable = row.doc ? row.doc.attachable !== false : false;
        const dragging = dragPath === row.path;
        // Only an attached row has a position, so only an attached row drags.
        const draggable = row.attached;
        return (
          <div
            key={row.path}
            draggable={draggable}
            onDragStart={draggable ? () => onDragStart(row.path) : undefined}
            onDragOver={
              dragPath
                ? (e) => {
                    e.preventDefault();
                    onDragOverRow(row.path);
                  }
                : undefined
            }
            onDrop={(e) => e.preventDefault()}
            onDragEnd={onDragEnd}
            style={{
              ...s.row(row.attached, attachable || row.attached, dragging),
              ...(dragPath && dragPath !== row.path && row.attached ? s.dropTarget : {}),
            }}
          >
            <button
              type="button"
              disabled={!draggable}
              aria-label={t("tab.dragHandle", { name: baseName(row.path) })}
              onKeyDown={(e) => onHandleKeyDown(e, row.path)}
              style={s.handle(draggable)}
            >
              <Icon.Menu size={14} />
            </button>

            <input
              type="checkbox"
              checked={row.attached}
              // A document the server marked not-attachable cannot be checked;
              // one already attached stays detachable whatever its state.
              disabled={!attachable && !row.attached}
              aria-label={row.path}
              onChange={(e) => toggle(row.path, e.target.checked)}
              style={s.checkbox}
            />

            <span className="mono" style={s.name}>
              {baseName(row.path)}
            </span>

            {row.doc ? (
              <>
                <span className="mono" style={s.dir}>
                  {dirOf(row.doc)}
                </span>
                {row.doc.doc_type && (
                  // Data, not copy: the badge is the matched root's own
                  // directory name, so it is rendered as it arrives rather than
                  // looked up in a namespace. Sentences stay translated.
                  <Badge {...docTypeBadge(row.doc.doc_type)}>{row.doc.doc_type}</Badge>
                )}
                {row.doc.not_attachable_reason === "too_large" && (
                  <span style={s.reason}>{t("tooLarge")}</span>
                )}
                <span className="tnum" style={s.tokens}>
                  {t("doc.tokens", { count: row.doc.tokens ?? 0 })}
                </span>
              </>
            ) : (
              // Attached, but no longer in the repository. Still detachable.
              <span style={s.reason}>{t("missing")}</span>
            )}

            <button
              type="button"
              aria-label={t("doc.preview", { name: baseName(row.path) })}
              onClick={() => setPreviewPath(row.path === previewPath ? null : row.path)}
              style={s.handle(true)}
            >
              <Icon.Eye size={14} />
            </button>
          </div>
        );
      })}

      {previewPath && (
        <div style={s.previewPane}>
          <div style={s.previewHead}>
            <span className="mono" style={s.previewName}>
              {previewPath}
            </span>
          </div>
          {preview.isLoading ? (
            <Skeleton height={120} />
          ) : (
            <Markdown>{(preview.data as SpecFile | undefined)?.content ?? ""}</Markdown>
          )}
        </div>
      )}

      <div style={s.footer}>
        <span className="tnum" style={s.footerTotal}>
          {t("tab.totalTokens", { count: totalTokens(rows) })}
        </span>
        <span style={s.footerUntrusted}>{t("tab.untrusted")}</span>
      </div>
    </div>
  );
}
