/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab), the severity filter in ?severity. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import { BlastTab, type BlastView } from "./_components/BlastTab";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetail, usePulls } from "../../../../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePrReviews,
  useCancelRun,
  usePrActiveRuns,
  usePrRuns,
  useDeleteRun,
  usePrIntent,
  useDeriveIntent,
} from "../../../../../lib/hooks/reviews";
import { usePrBrief, useGenerateBrief } from "../../../../../lib/hooks/brief";
import { useActiveRepo, useRepoNotFound } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import { githubPrUrl } from "../../../../../lib/github-urls";
import { parseSeverity, latestRunPerAgent, countBySeverity, runMatches } from "@/lib/severity";
import { parseLineRange, type DiffTarget } from "@/components/diff-viewer";
import type { BriefFileRef, FindingRecord, Severity } from "@devdigest/shared";

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  // Patch several params in one replace: selecting a severity from another tab
  // has to set ?tab and ?severity together, or the first write is lost.
  const setParams = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(patch)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setParam = (key: string, val: string | null) => setParams({ [key]: val });
  const setTab = (t: string) => setParam("tab", t);

  // Reviews come newest-first; each is its own run (grouped into accordions).
  // Memoized so the derivations below have a stable dependency.
  const runs = React.useMemo(() => reviews ?? [], [reviews]);
  const allFindings: FindingRecord[] = React.useMemo(() => runs.flatMap((r) => r.findings), [runs]);
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  // Severity filter. The counters summarize the PR's CURRENT state, so they
  // read only the newest run of each agent — re-runs would double-count. To
  // keep "3 CRITICAL" equal to what clicking it reveals, an active filter also
  // drops the superseded runs from the list below.
  const severity = parseSeverity(search.get("severity"));
  const latestRuns = React.useMemo(() => latestRunPerAgent(runs), [runs]);
  const severityCounts = React.useMemo(() => countBySeverity(latestRuns), [latestRuns]);

  // Derived PR intent — one hook for BOTH tab mounts; TanStack Query dedupes.
  const { data: intent, isLoading: intentLoading } = usePrIntent(prId);
  const deriveIntent = useDeriveIntent(prId);

  // The merge-risk brief. A query for the READ (it makes no model call and
  // costs nothing) and a MUTATION for the generation, because a query refires
  // on window refocus and on remount and this one is paid (AC-38).
  const {
    data: briefData,
    isLoading: briefLoading,
    error: briefError,
  } = usePrBrief(prId);
  const generateBrief = useGenerateBrief(prId);
  // Whichever failed most recently is what the card names as its reason. The
  // generation error outranks the read error: it is the one the user just
  // caused, and a 503 `missing_model_key` has to reach the reader as itself.
  const briefFailure = generateBrief.error ?? briefError;
  const briefReason =
    briefFailure instanceof ApiError
      ? briefFailure.message
      : briefFailure
        ? String(briefFailure)
        : null;
  // Findings the reviewer marked out of scope, which the engine deferred out of
  // the score. Taken from the newest run per agent for the same reason the
  // severity tally is: a re-run would otherwise list its findings twice.
  const deferredFindings = React.useMemo(
    () =>
      latestRuns
        .flatMap((r) => r.findings)
        .filter((f) => f.out_of_scope === true && f.dismissed_at == null),
    [latestRuns],
  );
  // Which files are in THIS PR's diff. The Files tab renders only those, so a
  // blast-radius caller outside the set cannot be deep-linked there — BlastTab
  // sends those to GitHub instead of producing a link that goes nowhere.
  const prFilePaths = React.useMemo(
    () => new Set((pr?.files ?? []).map((f) => f.path)),
    [pr],
  );

  const visibleRuns = severity ? latestRuns.filter((r) => runMatches(r, severity)) : runs;
  const setSeverity = (next: Severity | null) =>
    setParams({ severity: next ? next.toLowerCase() : null, tab: "findings" });

  // Deep links into the two tabs. A nonce makes re-selecting the SAME target
  // scroll again — the URL wouldn't change, so nothing downstream would react.
  const [targetNonce, bumpNonce] = React.useReducer((n: number) => n + 1, 0);
  const targetFindingId = search.get("finding");
  const targetRunIdForFinding =
    runs.find((r) => r.findings.some((f) => f.id === targetFindingId))?.run_id ?? null;

  // File order on the Files changed tab lives in the URL, not component state, so
  // a shared link preserves the order the sender was looking at. Smart is the
  // default; only the explicit opt-out is written to `?order`.
  const order = search.get("order") === "original" ? "original" : "smart";
  const setOrder = (next: "smart" | "original") =>
    setParam("order", next === "smart" ? null : next);

  // Blast radius view (tree | graph), in the URL for the same reason as ?order.
  const blastView: BlastView = search.get("view") === "graph" ? "graph" : "tree";
  const setBlastView = (next: BlastView) =>
    setParam("view", next === "tree" ? null : next);

  const lineRange = parseLineRange(search.get("line"));
  const targetFile = search.get("file");
  // A file with no `?line` is a REAL target (AC-30): the diff tab opens it,
  // expands it and scrolls to it, and tints no row because there is no row the
  // link honestly describes. Before `DiffTarget.start`/`.end` were widened to
  // `number | null` this branch produced `null` and the deep link was inert.
  const diffTarget: DiffTarget | null = targetFile
    ? {
        path: targetFile,
        start: lineRange?.start ?? null,
        end: lineRange?.end ?? null,
        nonce: targetNonce,
      }
    : null;

  const openFinding = (findingId: string) => {
    bumpNonce();
    // Clearing ?severity matters: a finding of another level would be filtered
    // off-screen and the click would silently go nowhere.
    setParams({ tab: "findings", finding: findingId, severity: null, file: null, line: null });
  };
  /**
   * Open the diff tab at a file, optionally at a line range.
   *
   * The line is optional so that one entry point serves both callers: a finding
   * or a blast-radius row always has a line, a brief's review-focus entry may
   * not. Omitting it clears `?line` rather than writing a made-up number, so a
   * reload or a shared link reopens exactly the same target (AC-29/AC-30).
   */
  const openFile = (file: string, startLine?: number | null, endLine?: number | null) => {
    bumpNonce();
    const start = startLine ?? null;
    const end = endLine ?? start;
    const line =
      start == null ? null : end !== start ? `${start}-${end}` : `${start}`;
    setParams({ tab: "diff", file, line, finding: null });
  };
  /** A brief's review-focus entry, activated. The ref is the model's, already
   *  verified server-side against the assembled input before it was stored. */
  const openBriefFocus = (ref: BriefFileRef) => openFile(ref.path, ref.line ?? null);

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        severityCounts={severityCounts}
        severity={severity}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetSeverity={setSeverity}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && (
          <OverviewTab
            prBody={pr.body}
            intent={intent}
            intentLoading={intentLoading}
            deferredFindings={deferredFindings}
            onRederiveIntent={() => deriveIntent.mutate()}
            rederivingIntent={deriveIntent.isPending}
            brief={briefData?.brief ?? null}
            briefStale={briefData?.stale}
            briefLoading={briefLoading}
            briefGenerating={generateBrief.isPending}
            briefError={briefReason}
            briefAvailability={briefData?.availability ?? null}
            onGenerateBrief={() => generateBrief.mutate()}
            onOpenFocus={openBriefFocus}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={visibleRuns}
            severity={severity}
            targetFindingId={targetFindingId}
            targetRunIdForFinding={targetRunIdForFinding}
            targetNonce={targetNonce}
            onOpenFinding={openFinding}
            onOpenFile={openFile}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              refetchReviews();
            }}
          />
        )}

        {tab === "blast" && (
          <BlastTab
            prId={prId}
            prFilePaths={prFilePaths}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            onOpenFile={openFile}
            view={blastView}
            onSetView={setBlastView}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            target={diffTarget}
            order={order}
            onSetOrder={setOrder}
            onOpenFile={openFile}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
