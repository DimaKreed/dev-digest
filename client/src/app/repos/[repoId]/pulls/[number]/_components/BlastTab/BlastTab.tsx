/* Blast radius: what else this PR's changes can reach.

   The branch ORDER here is load-bearing. An empty caller list rendered the same
   way whether the index was complete or broken tells the reviewer "this change
   is contained" — true in the first case, a lie the UI told in the second. So
   the degraded branch is checked before the empty one, and when both apply the
   empty state says the index is incomplete rather than that nothing was found. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { BlastGraph } from "./_components/BlastGraph";
import { BlastTree, type BlastLinkContext } from "./_components/BlastTree";
import { PriorPrs } from "./_components/PriorPrs";
import { UncallableSymbols } from "./_components/UncallableSymbols";
import { partitionByResolution } from "./helpers";
import { s } from "./styles";

/** The two renderings of the same data. A closed set, so it is a union. */
export type BlastView = "tree" | "graph";
export const BLAST_VIEWS: readonly BlastView[] = ["tree", "graph"];

interface BlastTabProps {
  prId: string | null;
  /** Paths in this PR's diff — decides whether a caller can be opened in-app. */
  prFilePaths: Set<string>;
  repoFullName: string | null;
  headSha: string | null;
  onOpenFile: (file: string, startLine: number, endLine: number) => void;
  view: BlastView;
  onSetView: (view: BlastView) => void;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span style={s.stat}>
      <span style={s.statValue}>{value}</span>
      {label}
    </span>
  );
}

export function BlastTab({
  prId,
  prFilePaths,
  repoFullName,
  headSha,
  onOpenFile,
  view,
  onSetView,
}: BlastTabProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, refetch } = useBlastRadius(prId);

  if (isLoading) {
    return (
      <section style={s.card}>
        <SectionLabel icon="Target">{t("stat.callers")}</SectionLabel>
        <div style={s.skeletons}>
          <Skeleton height={16} />
          <Skeleton height={120} />
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => refetch()} />
    );
  }

  const degraded = data.state === "degraded";
  const partial = data.state === "partial";
  const hasContent = data.downstream.some((d) => d.callers.length > 0);

  // A Set, not a sum: the same endpoint reached through two symbols is one
  // endpoint, and counting it twice inflates the first number a reviewer reads.
  const endpoints = new Set(data.downstream.flatMap((d) => d.endpoints_affected));
  const crons = new Set(data.downstream.flatMap((d) => d.crons_affected));
  const callerCount = data.downstream.reduce((n, d) => n + d.callers.length, 0);

  // Types are set aside into their own section rather than listed in the tree:
  // the index resolves invocations, so a caller count on an interface is a
  // question that does not apply. They are still shown, and still counted — set
  // aside is not the same as dropped.
  const { callable, uncallable } = partitionByResolution(data.downstream, data.changed_symbols);

  // Over anything short of a complete index a zero is ignorance, not a finding,
  // and the rows say so instead of printing a number they cannot support.
  const measured = data.state === "ok";

  const ctx: BlastLinkContext = { prFilePaths, repoFullName, headSha, onOpenFile };

  return (
    <section style={s.card}>
      <div style={s.head}>
        <Stat value={data.changed_symbols.length} label={t("stat.symbols")} />
        <Stat value={callerCount} label={t("stat.callers")} />
        <Stat value={endpoints.size} label={t("stat.endpoints")} />
        <Stat value={crons.size} label={t("stat.crons")} />

        <div style={s.viewToggle}>
          {BLAST_VIEWS.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              onClick={() => onSetView(mode)}
              style={s.viewToggleBtn(view === mode)}
            >
              {t(`view.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      {(degraded || partial) && (
        <div style={s.banner}>
          <span style={s.bannerTitle}>
            <Icon.AlertTriangle size={13} />
            {degraded ? t("degraded.title") : t("partial.title")}
          </span>
          <span style={s.bannerBody}>{degraded ? t("degraded.body") : t("partial.body")}</span>
          {data.reason && <span style={s.meta}>{t("reason", { reason: data.reason })}</span>}
        </div>
      )}

      {hasContent ? (
        view === "graph" ? (
          <BlastGraph downstream={callable} />
        ) : (
          <BlastTree downstream={callable} ctx={ctx} measured={measured} />
        )
      ) : (
        // Keyed on `measured`, not on `degraded`. `partial` is not degraded, so
        // this used to fall through to the neutral copy and report a measured
        // "no downstream impact" over an index that had admitted, one element
        // higher up the page, that it could not see everything.
        <EmptyState
          icon="Target"
          title={measured ? t("empty.title") : t("empty.degradedTitle")}
          body={
            measured
              ? t("noDownstream", { count: data.changed_symbols.length })
              : t("empty.degradedBody")
          }
        />
      )}

      {view === "tree" && <UncallableSymbols items={uncallable} />}

      <PriorPrs prId={prId} items={data.prior_prs} />
    </section>
  );
}
