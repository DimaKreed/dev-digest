/* EvalsTab — the agent's regression harness (SPEC-04).

   Three things live here and nowhere else: the metrics of the agent's newest
   run of the set, the case set itself, and the buttons that run either one
   case or all of them. The history and the run-to-run comparison live on the
   Eval Dashboard, linked from the header — this tab is where the SET is
   curated, that page is where two runs are read against each other. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Badge, Button, EmptyState, Icon, IconBtn, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCaseRecord, EvalCaseRun } from "@devdigest/shared";
import {
  useDeleteEvalCase,
  useEvalAgentDashboard,
  useEvalBatch,
  useEvalCases,
  useEvalRunFinished,
  useRunEvalCase,
  useRunEvalSet,
} from "../../../../../../../lib/hooks/eval";
import { useToast } from "../../../../../../../lib/toast";
import { EvalCaseModal } from "./EvalCaseModal";
import { ExpectedVsActual } from "./ExpectedVsActual";
import { deltaPoints, pct } from "./helpers";
import { s } from "./styles";

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data: cases, isLoading } = useEvalCases(agent.id);
  const { data: dash } = useEvalAgentDashboard(agent.id);
  const runSet = useRunEvalSet();
  const runOne = useRunEvalCase();
  const remove = useDeleteEvalCase();
  const runFinished = useEvalRunFinished();

  const [editing, setEditing] = React.useState<EvalCaseRecord | null>(null);
  const [creating, setCreating] = React.useState(false);

  /* The batch this tab started and is now watching. `caseId` is the single case
     it covers, or null for a run of the whole set — the only thing that differs
     between the two run paths, since the server answers both with a batch. */
  const [active, setActive] = React.useState<{ id: string; caseId: string | null } | null>(
    null,
  );
  const { data: batch } = useEvalBatch(active?.id ?? null);

  /* A finished batch is the moment the case list, the history and both
     dashboards go stale — the run is over, so this is where they get refetched.
     Doing it when the run STARTED would have refetched them to re-read exactly
     what was already on screen. */
  React.useEffect(() => {
    if (!active || batch?.status !== "done") return;
    runFinished(agent.id);
    setActive(null);
  }, [active, batch?.status, agent.id, runFinished]);

  const list = cases ?? [];

  /* Rows from the batch in flight, which are fresher than `last_run` on the
     case: the case list is not refetched until the batch is done, so without
     this every row would sit unchanged for two minutes and then all change at
     once. A case appears here the moment its own row is persisted. */
  const liveRuns = React.useMemo(
    () => new Map<string, EvalCaseRun>((batch?.cases ?? []).map((c) => [c.case_id, c])),
    [batch],
  );

  const setRunning = active != null && active.caseId == null;
  const casesDone = batch?.cases_done ?? 0;
  const casesTotal = batch?.cases_total ?? list.length;
  const passing = list.filter((c) => c.last_run?.pass === true).length;
  const ranCount = list.filter((c) => c.last_run != null).length;

  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : t("evalsTab.runFailed"));

  const runAll = () =>
    runSet.mutate(agent.id, {
      onError,
      // 202: the set has been accepted, not run. From here the batch id is the
      // only handle on it, and `useEvalBatch` above does the waiting.
      onSuccess: (b) => setActive({ id: b.batch_id, caseId: null }),
    });

  const runCase = (caseId: string) =>
    runOne.mutate(
      { caseId, agentId: agent.id },
      { onError, onSuccess: (b) => setActive({ id: b.batch_id, caseId }) },
    );

  /* Busy means "this case is in the batch that is running and has not landed
     yet" — a case that already produced its row is done even though the set
     around it is not, and showing it as still running would misreport it. */
  const isBusy = (caseId: string) =>
    active != null &&
    (active.caseId === null || active.caseId === caseId) &&
    !liveRuns.has(caseId);

  const metrics = dash?.latest?.metrics ?? null;

  return (
    <div style={s.wrap}>
      {/* ---- metrics of the newest run of the set ------------------------- */}
      <div>
        <div style={s.sectionHead}>
          <Icon.Gauge size={15} style={{ color: "var(--text-muted)" }} />
          <div style={s.h2}>{t("evalsTab.metricsTitle")}</div>
          <div style={s.spacer}>
            <Link href={`/eval/${agent.id}`} style={{ fontSize: 13, color: "var(--accent)" }}>
              {t("evalsTab.viewDashboard")}
            </Link>
          </div>
        </div>
        <div style={{ ...s.sub, margin: "4px 0 12px" }}>{t("evalsTab.metricsSubtitle")}</div>

        {metrics ? (
          <div style={s.tiles}>
            <MetricTile
              label={t("dashboard.metrics.recall")}
              value={pct(metrics.recall)}
              delta={dash ? deltaPoints(dash.delta.recall) : 0}
              color="var(--accent)"
            />
            <MetricTile
              label={t("dashboard.metrics.precision")}
              value={pct(metrics.precision)}
              delta={dash ? deltaPoints(dash.delta.precision) : 0}
              color="var(--ok)"
            />
            <MetricTile
              label={t("dashboard.metrics.citationAccuracy")}
              value={pct(metrics.citation_accuracy)}
              delta={dash ? deltaPoints(dash.delta.citation_accuracy) : 0}
              color="var(--warn)"
            />
            <div style={s.tile}>
              <div style={s.tileLabel}>{t("evalsTab.tracesPassed")}</div>
              <div style={s.tileValue}>
                {metrics.traces_passed}/{metrics.traces_total}
              </div>
            </div>
          </div>
        ) : (
          <div style={s.empty}>{t("evalsTab.noMetrics")}</div>
        )}

        {dash?.alert && (
          <div style={{ ...s.sub, marginTop: 10 }}>{dash.alert}</div>
        )}
      </div>

      {/* ---- the case set ------------------------------------------------- */}
      <div>
        <div style={s.sectionHead}>
          <div style={s.h2}>{t("evalsTab.casesHeading")}</div>
          {ranCount > 0 && (
            <Badge color="var(--ok)">
              {t("evalsTab.passingCount", { passed: passing, total: ranCount })}
            </Badge>
          )}
          <div style={s.spacer}>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={active != null || runSet.isPending || list.length === 0}
              onClick={runAll}
            >
              {setRunning
                ? t("evalsTab.runningProgress", { done: casesDone, total: casesTotal })
                : runSet.isPending
                  ? t("evalsTab.runningAll")
                  : t("evalsTab.runAll")}
            </Button>
            <Button kind="primary" size="sm" icon="Plus" onClick={() => setCreating(true)}>
              {t("evalsTab.newCase")}
            </Button>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          {isLoading ? (
            <Skeleton height={140} />
          ) : list.length === 0 ? (
            <EmptyState
              icon="FlaskConical"
              title={t("evalsTab.casesHeading")}
              body={t("evalsTab.emptyCases")}
            />
          ) : (
            <div style={s.list}>
              {list.map((c) => (
                <CaseRow
                  key={c.id}
                  c={c}
                  live={liveRuns.get(c.id) ?? null}
                  busy={isBusy(c.id)}
                  onRun={() => runCase(c.id)}
                  onEdit={() => setEditing(c)}
                  onDelete={() => {
                    if (!window.confirm(t("evalsTab.deleteConfirm", { name: c.name }))) return;
                    remove.mutate({ caseId: c.id, agentId: agent.id }, { onError });
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && (
        <EvalCaseModal
          agentId={agent.id}
          {...(editing ? { existing: editing } : {})}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  delta,
  color,
}: {
  label: string;
  value: number | null;
  delta: number;
  color: string;
}) {
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileValue}>
        <span className="tnum" style={{ color }}>
          {value ?? "—"}
          <span style={{ fontSize: 15, color: "var(--text-muted)" }}>%</span>
        </span>
        {/* A delta of 0 is shown as 0, not hidden: "did not move" is the answer
            a prompt edit most often gets, and hiding it reads as "not measured". */}
        <span style={s.delta(delta)}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "±"} {Math.abs(delta)}pt
        </span>
      </div>
    </div>
  );
}

function CaseRow({
  c,
  live,
  busy,
  onRun,
  onEdit,
  onDelete,
}: {
  c: EvalCaseRecord;
  /** This case's row from the batch in flight, if it has landed already. */
  live: EvalCaseRun | null;
  busy: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  // Collapsed by default, and expanded IN PLACE rather than in a dialog: after
  // a run the question is "which cases moved", and answering it should not cost
  // one modal open per case.
  const [open, setOpen] = React.useState(false);
  const last = live ?? c.last_run;
  const errored = !!last?.error;

  const status = errored
    ? t("evalsTab.errored")
    : last == null
      ? t("evalsTab.neverRun")
      : last.pass
        ? t("evalsTab.passed")
        : t("evalsTab.failed");

  return (
    <div style={s.caseShell}>
      <div style={s.row(last?.pass ?? null, errored)} onClick={() => setOpen((o) => !o)}>
        <Icon.ChevronDown
          size={14}
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform .12s",
            flexShrink: 0,
          }}
        />
        <div style={s.rowMain}>
          <div style={s.caseName}>{c.name}</div>
          <div style={s.caseMeta}>
            {status}
            {last && !errored
              ? ` · ${t("evalsTab.expected", {
                  count: c.expected_output.length,
                  found: last.findings.length,
                })}`
              : ""}
            {errored ? ` · ${last?.error ?? ""}` : ""}
          </div>
        </div>
        <Badge color={c.expectation_kind === "must_find" ? "var(--ok)" : "var(--crit)"}>
          {t(`expectation.${c.expectation_kind}`)}
        </Badge>
        {/* The actions sit inside the clickable header, so each one stops the
            click that would otherwise also toggle the panel. */}
        <div style={s.rowActions} onClick={(e) => e.stopPropagation()}>
          <IconBtn
            icon="Play"
            label={busy ? t("evalsTab.running") : t("evalsTab.run")}
            active={busy}
            onClick={busy ? undefined : onRun}
          />
          <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={onEdit} />
          <IconBtn icon="Trash" label={t("evalsTab.delete")} onClick={onDelete} />
        </div>
      </div>

      {open && (
        <div style={s.expandRow}>
          <ExpectedVsActual
            expected={c.expected_output}
            kind={c.expectation_kind}
            run={last}
          />
        </div>
      )}
    </div>
  );
}
