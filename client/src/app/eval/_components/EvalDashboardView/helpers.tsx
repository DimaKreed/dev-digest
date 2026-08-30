import React from "react";
import { s } from "./styles";

/** Shared presentational helpers for the eval dashboard views. */

/** A rate (0–1) as whole percent, or an em dash when it was never measured. */
export function pctLabel(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** An ISO timestamp as `YYYY-MM-DD HH:MM`, matching the run tables' density. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** `v7`, or an em dash for a run written before versions were snapshotted. */
export function versionLabel(v: number | null | undefined): string {
  return v == null ? "—" : `v${v}`;
}

/** A cost, or an em dash. Never `$0.00` for an unknown cost — see `groupBatches`. */
export function costLabel(v: number | null | undefined): string {
  return v == null ? "—" : `$${v.toFixed(2)}`;
}

/** A metric as a fixed-width bar plus its percentage. */
export function MetricBar({ value, color }: { value: number; color: string }) {
  return (
    <span>
      <span style={s.barTrack}>
        <span style={{ ...s.bar(value, color), marginRight: 0, display: "block" }} />
      </span>
      <span className="tnum">{Math.round(value * 100)}%</span>
    </span>
  );
}

/** The three metric colours, used identically on every eval surface. */
export const METRIC_COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;
