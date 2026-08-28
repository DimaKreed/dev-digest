/* ContextView — /repos/:repoId/context.
   The repository's own markdown, read-only. Discovery is a live filesystem read
   of the clone on the server, so there is nothing here to index, re-index or
   edit: no create/rename/delete affordance, no chunk count and no coverage
   score, because none of those is measured. Attaching a document to an agent or
   a skill happens in that editor's Context tab, not here. */
"use client";

import React from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, IconBtn, Badge, Markdown, Skeleton } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { docTypeBadge } from "@/lib/doc-type";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { ApiError } from "@/lib/api";
import { useContextFile, useContextFiles, useContextSearchRoots } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { baseName, dirOf, rootList } from "./helpers";
import { s } from "./styles";

const SKELETON_ROWS = 4;

export function ContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  // The selected document lives in the URL, so a preview is linkable and
  // survives a reload — it is not component state.
  const selected = search.get("path");

  const listing = useContextFiles(repoId);
  const preview = useContextFile(repoId, selected);
  // The empty state names the directories that were actually searched, so the
  // server tells us which those are. Hardcoding the shipped default would make
  // the message wrong for anyone who reconfigures the roots — and being able to
  // reconfigure them is the only reason the setting exists.
  const roots = useContextSearchRoots(repoId);

  const repoName = activeRepo?.full_name ?? t("page.repoFallback");
  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbContext") }];

  const select = (path: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (path) sp.set("path", path);
    else sp.delete("path");
    const query = sp.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("page.headingPrefix")}
            <span className="mono" style={s.repoName}>
              {repoName}
            </span>
          </h1>
          <p style={s.pageSubtitle}>{t("page.subtitle")}</p>
        </div>
      </div>

      <div style={s.main}>
        <div style={s.listPane}>
          <DocumentList
            listing={listing}
            selected={selected}
            onSelect={select}
            labels={{
              document: t("page.columns.document"),
              directory: t("page.columns.directory"),
              type: t("page.columns.type"),
              usedBy: t("page.columns.usedBy"),
            }}
            usedByLabel={(count) => t("doc.usedBy", { count })}
            emptyTitle={t("empty.title")}
            emptyBody={t("empty.body", { roots: rootList(roots.data) })}
            errorTitle={t("loadError")}
          />
        </div>

        {selected && (
          <div style={s.previewPane}>
            <div style={s.previewHead}>
              <span className="mono" style={s.previewName}>
                {selected}
              </span>
              <IconBtn icon="X" label={t("page.closePreview")} onClick={() => select(null)} />
            </div>
            <div style={s.previewBody}>
              {preview.isLoading ? (
                <Skeleton height={160} />
              ) : preview.error ? (
                <ErrorState title={t("editor.loadError")} />
              ) : (
                // Read-only by construction: rendered markdown, never an editor.
                <Markdown>{preview.data?.content ?? ""}</Markdown>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/**
 * The four render states as early returns. Extracted because the loading,
 * error and empty branches each have their own layout — the split trigger, not
 * line count.
 */
function DocumentList({
  listing,
  selected,
  onSelect,
  labels,
  usedByLabel,
  emptyTitle,
  emptyBody,
  errorTitle,
}: {
  listing: { data: SpecFile[] | undefined; isLoading: boolean; error: unknown };
  selected: string | null;
  onSelect: (path: string) => void;
  labels: { document: string; directory: string; type: string; usedBy: string };
  /** `usedByLabel` is a translated SENTENCE, so it is threaded from the parent
      that holds the translator. The type badge is not: it is the matched root's
      directory name, read straight off the row below. */
  usedByLabel: (count: number) => string;
  emptyTitle: string;
  emptyBody: string;
  errorTitle: string;
}) {
  if (listing.isLoading) {
    return (
      <div style={s.loadingStack}>
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <Skeleton key={i} height={44} />
        ))}
      </div>
    );
  }
  if (listing.error) {
    // Distinct from the empty state on purpose: "we could not look" and "there
    // is nothing there" are different answers.
    return (
      <ErrorState
        title={errorTitle}
        body={listing.error instanceof ApiError ? listing.error.message : undefined}
      />
    );
  }
  const docs = listing.data ?? [];
  if (docs.length === 0) {
    return <EmptyState icon="FileText" title={emptyTitle} body={emptyBody} />;
  }

  return (
    <>
      <div style={s.columns}>
        <span>{labels.document}</span>
        <span>{labels.directory}</span>
        <span>{labels.type}</span>
        <span>{labels.usedBy}</span>
      </div>
      {docs.map((doc) => (
        <button
          key={doc.path}
          type="button"
          onClick={() => onSelect(doc.path)}
          style={s.row(doc.path === selected)}
        >
          <span className="mono" style={s.name}>
            {baseName(doc.path)}
          </span>
          <span className="mono" style={s.dir}>
            {dirOf(doc)}
          </span>
          <span>
            {/* Guarded rather than defaulted to "": Badge paints its pill
                chrome regardless of children, so `?? ""` left a stray filled
                pill in the TYPE column for a document with no type. */}
            {doc.doc_type && <Badge {...docTypeBadge(doc.doc_type)}>{doc.doc_type}</Badge>}
          </span>
          <span style={s.usedBy}>{usedByLabel(doc.used_by ?? 0)}</span>
        </button>
      ))}
    </>
  );
}
