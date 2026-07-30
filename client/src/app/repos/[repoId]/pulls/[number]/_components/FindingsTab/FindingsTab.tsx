"use client";

import React, { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { RunStatus } from "../RunStatus";
import { RunHistory } from "../RunHistory/RunHistory";
import { ReviewRunAccordion } from "../ReviewRunAccordion";
import { s } from "./styles";
import type {
  FindingRecord,
  ReviewRecord,
  RunSummary,
  PrCommit,
  Severity,
} from "@devdigest/shared";
import type { UseMutationResult } from "@tanstack/react-query";

interface FindingsTabProps {
  prId: string | null;
  liveRunIds: string[];
  reviewRunning: boolean;
  lethalTrifecta: FindingRecord[];
  /** Already narrowed by the severity filter upstream (page.tsx). */
  runs: ReviewRecord[];
  /** Active severity filter, or null. Narrows the timeline and each panel. */
  severity: Severity | null;
  prRuns: RunSummary[] | undefined;
  prCommits: PrCommit[];
  cancelMutation: UseMutationResult<any, any, string, any>;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  onOpenTrace: (id: string) => void;
  onDelete: (id: string) => void;
  onRunDone: () => void;
}

export function FindingsTab({
  prId,
  liveRunIds,
  reviewRunning,
  lethalTrifecta,
  runs,
  severity,
  prRuns,
  prCommits,
  cancelMutation,
  repoFullName,
  headSha,
  onOpenTrace,
  onDelete,
  onRunDone,
}: FindingsTabProps) {
  const t = useTranslations("prReview");
  const handleCancelAll = useCallback(() => {
    liveRunIds.forEach((id) => cancelMutation.mutate(id));
  }, [liveRunIds, cancelMutation]);

  const handleOpenFirstTrace = useCallback(() => {
    if (liveRunIds[0]) onOpenTrace(liveRunIds[0]);
  }, [liveRunIds, onOpenTrace]);

  const handleOpenTrace = useCallback(
    (id: string) => {
      onOpenTrace(id);
    },
    [onOpenTrace],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
    },
    [onDelete],
  );

  // Timeline → Review-runs navigation: clicking an agent name in the timeline
  // opens + scrolls to that run's accordion below. The nonce re-triggers the
  // scroll even when the same run is clicked twice.
  const [target, setTarget] = React.useState<{ runId: string; n: number } | null>(null);
  const handleGoToReview = useCallback((runId: string) => {
    setTarget((p) => ({ runId, n: (p?.n ?? 0) + 1 }));
  }, []);

  // Run cost lives on the run row, not on the review — join the two here by
  // run_id so each review-run header can show what that run cost.
  const costByRunId = React.useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of prRuns ?? []) m.set(r.run_id, r.cost_usd);
    return m;
  }, [prRuns]);

  // Findings live on the review, the timeline renders RunSummary rows — join
  // the two by run_id so a run card can peek at what it found (same trick as
  // costByRunId above).
  const findingsByRunId = React.useMemo(() => {
    const m = new Map<string, FindingRecord[]>();
    for (const r of runs) if (r.run_id) m.set(r.run_id, r.findings);
    return m;
  }, [runs]);

  // Under a severity filter the timeline shows only the runs still listed
  // below. `runs` arrives pre-filtered, so its run_ids are the allowlist —
  // same join-by-run_id trick as costByRunId. Commits always stay: they're
  // the chronological markers the run rows are read against.
  const timelineRuns = React.useMemo(() => {
    const all = prRuns ?? [];
    if (!severity) return all;
    const keep = new Set(runs.map((r) => r.run_id).filter((id): id is string => id != null));
    return all.filter((r) => keep.has(r.run_id));
  }, [prRuns, runs, severity]);

  return (
    <section>
      {liveRunIds.length > 0 && (
        <div style={s.liveRunSection}>
          <SectionLabel
            icon="Sparkles"
            right={
              <div style={s.cancelActions}>
                <Button
                  kind="danger"
                  size="sm"
                  icon="X"
                  loading={cancelMutation.isPending}
                  onClick={handleCancelAll}
                >
                  Cancel
                </Button>
                <Button kind="ghost" size="sm" icon="FileText" onClick={handleOpenFirstTrace}>
                  Open run trace
                </Button>
              </div>
            }
          >
            Live review
          </SectionLabel>
          <RunStatus runIds={liveRunIds} onDone={onRunDone} />
        </div>
      )}

      {reviewRunning && (
        <div style={s.reviewInProgress}>
          <Icon.RefreshCw size={16} style={{ color: "var(--accent)", animation: "ddspin 1s linear infinite" }} />
          <span style={s.reviewInProgressText}>Review in progress…</span>
          <span style={s.reviewInProgressSub}>
            the agent is analyzing the diff — this can take a while on large PRs.
          </span>
        </div>
      )}

      {lethalTrifecta.length > 0 && (
        <div style={s.lethalTrifecta}>
          <Icon.Shield size={16} style={{ color: "var(--crit)" }} />
          <span style={s.lethalTrifectaTitle}>Lethal Trifecta detected</span>
          <Badge color="var(--crit)" bg="transparent">
            {lethalTrifecta.length} finding(s)
          </Badge>
        </div>
      )}

      {(timelineRuns.length > 0 || prCommits.length > 0) && (
        <div style={s.timelineSection}>
          <SectionLabel
            icon="Activity"
            right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>runs &amp; commits · newest first</span>}
          >
            Timeline
          </SectionLabel>
          <RunHistory
            runs={timelineRuns}
            findingsByRunId={findingsByRunId}
            repoFullName={repoFullName}
            headSha={headSha}
            commits={prCommits}
            onOpenTrace={handleOpenTrace}
            onGoToReview={handleGoToReview}
            onDelete={handleDelete}
          />
        </div>
      )}

      <SectionLabel
        icon="AlertOctagon"
        right={<span style={{ fontSize: 12, color: "var(--text-muted)" }}>grouped by run · newest first</span>}
      >
        Review runs
      </SectionLabel>
      {runs.length === 0 ? (
        severity ? (
          <EmptyState
            icon="Filter"
            title={t("severityFilter.emptyTitle", { severity })}
            body={t("severityFilter.emptyBody")}
          />
        ) : reviewRunning || liveRunIds.length > 0 ? null : (
          <EmptyState
            icon="Sparkles"
            title="No findings yet"
            body="Run a review to generate findings. Use Run Review ▾ above (run all enabled agents or a specific one)."
          />
        )
      ) : (
        prId &&
        runs.map((review, i) => (
          <ReviewRunAccordion
            key={review.id}
            review={review}
            prId={prId}
            defaultOpen={i === 0}
            repoFullName={repoFullName}
            headSha={headSha}
            severity={severity}
            costUsd={review.run_id ? costByRunId.get(review.run_id) ?? null : null}
            targetRunId={target?.runId ?? null}
            targetNonce={target?.n ?? 0}
          />
        ))
      )}
    </section>
  );
}
