/* EvalAgentView — one agent's regression history (SPEC-04 AC-09/AC-10).

   The metrics of the newest run, the trend across every run, and the run table
   from which exactly two runs can be picked and compared. Running the set from
   here is the same call the Evals tab makes; the two surfaces differ in what
   they are FOR — curating the set there, reading the movement here. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  ErrorState,
  Icon,
  LineChart,
  MetricCard,
  Skeleton,
} from "@devdigest/ui";
import type { EvalBatchSummary } from "@devdigest/shared";
import { AppShell } from "../../../../../components/app-shell";
import { useEvalAgentDashboard, useRunEvalSet } from "../../../../../lib/hooks/eval";
import { useToast } from "../../../../../lib/toast";
import { CompareModal } from "./CompareModal";
import { s } from "./styles";

const COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

export function EvalAgentView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data, isLoading, isError, refetch } = useEvalAgentDashboard(agentId);
  const runSet = useRunEvalSet();

  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/eval" },
    { label: data?.agent_name ?? t("page.crumbEvals") },
  ];

  if (isError) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("page.crumbEvalDashboard")}
          body={t("agentPage.loadError")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  const batches = data?.batches ?? [];
  const latest = data?.latest ?? null;

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id)
        ? cur.filter((x) => x !== id)
        : // Cap at two: the comparison is pairwise, and silently dropping the
          // OLDEST selection keeps clicking down the table doing the obvious
          // thing rather than requiring an unselect first.
          [...cur, id].slice(-2),
    );

  const pair = selected
    .map((id) => batches.find((b) => b.batch_id === id))
    .filter((b): b is EvalBatchSummary => !!b)
    // Older first, so the modal always reads old → new whatever the click order.
    .sort((a, b) => a.ran_at.localeCompare(b.ran_at));

  const trend = data?.trend ?? [];
  const series = [
    { name: "Recall", color: COLORS.recall, data: trend.map((p) => p.recall) },
    { name: "Precision", color: COLORS.precision, data: trend.map((p) => p.precision) },
    { name: "Citation", color: COLORS.citation, data: trend.map((p) => p.citation_accuracy) },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <Link href="/eval" style={s.back}>
          <Icon.ChevronLeft size={14} />
          {t("agentPage.allAgents")}
        </Link>

        <div style={s.head}>
          <div>
            <h1 style={s.title}>
              {data?.agent_name ?? ""}
              {data && (
                <Badge color="var(--text-secondary)" mono>
                  {data.model}
                </Badge>
              )}
            </h1>
            <div style={s.subtitle}>
              {data
                ? t("agentPage.subtitle", { runs: batches.length, cases: data.cases_total })
                : ""}
            </div>
          </div>
          <div style={s.headActions}>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              disabled={runSet.isPending || (data?.cases_total ?? 0) === 0}
              onClick={() =>
                runSet.mutate(agentId, {
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : t("evalsTab.runFailed")),
                })
              }
            >
              {runSet.isPending ? t("agentPage.running") : t("agentPage.runEval")}
            </Button>
          </div>
        </div>

        {data?.alert && (
          <div style={s.alert(data.alert.startsWith("Regression"))}>
            <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{data.alert}</span>
          </div>
        )}

        {isLoading ? (
          <Skeleton height={320} />
        ) : (data?.cases_total ?? 0) === 0 ? (
          <div style={s.empty}>
            {t("agentPage.noCases")}{" "}
            <Link href={`/agents/${agentId}?tab=evals`} style={{ color: "var(--accent)" }}>
              {t("agentPage.openCases")}
            </Link>
          </div>
        ) : (
          <>
            <div style={s.tiles}>
              <MetricCard
                label={t("dashboard.metrics.recall")}
                value={latest ? Math.round(latest.metrics.recall * 100) : "—"}
                suffix="%"
                delta={data?.delta.recall}
                color={COLORS.recall}
                trend={trend.map((p) => p.recall)}
              />
              <MetricCard
                label={t("dashboard.metrics.precision")}
                value={latest ? Math.round(latest.metrics.precision * 100) : "—"}
                suffix="%"
                delta={data?.delta.precision}
                color={COLORS.precision}
                trend={trend.map((p) => p.precision)}
              />
              <MetricCard
                label={t("dashboard.metrics.citationAccuracy")}
                value={latest ? Math.round(latest.metrics.citation_accuracy * 100) : "—"}
                suffix="%"
                delta={data?.delta.citation_accuracy}
                color={COLORS.citation}
                trend={trend.map((p) => p.citation_accuracy)}
              />
            </div>

            {trend.length > 1 && (
              <div style={s.chartCard}>
                <div style={s.chartHead}>
                  <Icon.TrendingUp size={13} />
                  {t("dashboard.metricTrend")}
                  <span style={s.legend}>
                    <span>
                      <span style={s.legendDot(COLORS.recall)} />
                      {t("dashboard.legend.recall")}
                    </span>
                    <span>
                      <span style={s.legendDot(COLORS.precision)} />
                      {t("dashboard.legend.precision")}
                    </span>
                    <span>
                      <span style={s.legendDot(COLORS.citation)} />
                      {t("dashboard.legend.citation")}
                    </span>
                  </span>
                </div>
                <LineChart series={series} w={1080} h={220} yMin={0} yMax={1} />
              </div>
            )}

            <div style={s.sectionLabel}>
              <Icon.History size={13} />
              {t("agentPage.recentRuns")}
              <span style={{ marginLeft: 10, fontWeight: 500, letterSpacing: 0 }}>
                {selected.length > 0
                  ? t("agentPage.selected", { count: selected.length })
                  : t("agentPage.compareHint")}
              </span>
              <span style={{ marginLeft: "auto" }}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="GitMerge"
                  disabled={pair.length !== 2}
                  onClick={() => setComparing(true)}
                >
                  {t("agentPage.compare")}
                </Button>
              </span>
            </div>

            {batches.length === 0 ? (
              <div style={s.empty}>{t("agentPage.noRuns")}</div>
            ) : (
              <div style={s.table}>
                <div style={s.th}>
                  <span style={s.colCheck} />
                  <span style={s.colWhen}>{t("agentPage.table.ranAt")}</span>
                  <span style={s.colVersion}>{t("agentPage.table.version")}</span>
                  <span style={s.colMetric}>{t("agentPage.table.recall")}</span>
                  <span style={s.colMetric}>{t("agentPage.table.precision")}</span>
                  <span style={s.colMetric}>{t("agentPage.table.citation")}</span>
                  <span style={s.colPass}>{t("agentPage.table.pass")}</span>
                  <span style={s.colCost}>{t("agentPage.table.cost")}</span>
                </div>
                {batches.map((b) => (
                  <BatchRow
                    key={b.batch_id}
                    b={b}
                    selected={selected.includes(b.batch_id)}
                    onToggle={() => toggle(b.batch_id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {comparing && pair.length === 2 && (
        <CompareModal from={pair[0]!} to={pair[1]!} onClose={() => setComparing(false)} />
      )}
    </AppShell>
  );
}

function BatchRow({
  b,
  selected,
  onToggle,
}: {
  b: EvalBatchSummary;
  selected: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("eval");
  const when = new Date(b.ran_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const whenLabel = Number.isNaN(when.getTime())
    ? b.ran_at
    : `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;

  return (
    <div style={s.tr(selected)}>
      <span style={s.colCheck}>
        <Checkbox checked={selected} onChange={onToggle} />
      </span>
      <span className="mono" style={{ ...s.colWhen, ...s.muted }}>
        {whenLabel}
      </span>
      <span className="mono" style={{ ...s.colVersion, color: "var(--accent)" }}>
        {b.agent_version == null ? "—" : `v${b.agent_version}`}
      </span>
      <Cell value={b.metrics.recall} color={COLORS.recall} />
      <Cell value={b.metrics.precision} color={COLORS.precision} />
      <Cell value={b.metrics.citation_accuracy} color={COLORS.citation} />
      <span className="tnum" style={{ ...s.colPass, fontWeight: 600 }}>
        {b.metrics.traces_passed}/{b.metrics.traces_total}
        {/* An errored case is in neither number, so it is named separately
            rather than quietly shrinking the denominator with no explanation. */}
        {b.errors > 0 && (
          <span style={{ ...s.muted, fontWeight: 400 }} title={t("agentPage.errorsNote", { count: b.errors })}>
            {" "}
            !{b.errors}
          </span>
        )}
      </span>
      <span className="tnum" style={{ ...s.colCost, ...s.muted }}>
        {b.cost_usd == null ? "—" : `$${b.cost_usd.toFixed(2)}`}
      </span>
    </div>
  );
}

function Cell({ value, color }: { value: number; color: string }) {
  return (
    <span style={s.colMetric}>
      <span
        style={{
          display: "inline-block",
          width: 56,
          height: 5,
          borderRadius: 3,
          background: "var(--border)",
          marginRight: 8,
          verticalAlign: "middle",
        }}
      >
        <span
          style={{
            display: "block",
            height: 5,
            borderRadius: 3,
            width: `${Math.round(value * 56)}px`,
            background: color,
          }}
        />
      </span>
      <span className="tnum">{Math.round(value * 100)}%</span>
    </span>
  );
}
