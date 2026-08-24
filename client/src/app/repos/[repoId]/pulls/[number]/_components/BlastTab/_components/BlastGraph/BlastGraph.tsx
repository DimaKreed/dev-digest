/* The graph view of a blast radius: changed symbols on the left, their callers
   in the middle, the endpoints those callers reach on the right.

   This file is the rendering only — the layout maths lives in `helpers.ts` so
   the bezier can be tested directly, and the column geometry in `constants.ts`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamNode } from "@devdigest/shared";
import { s } from "../../styles";
import { BOX_H, BOX_W, COL_ENDPOINT, MAX_LABEL_CHARS } from "./constants";
import { buildLayout, edgePath, type GraphNode } from "./helpers";

function Box({ node, stroke }: { node: GraphNode; stroke: string }) {
  const label =
    node.label.length > MAX_LABEL_CHARS
      ? `${node.label.slice(0, MAX_LABEL_CHARS - 1)}…`
      : node.label;
  return (
    <g>
      <rect
        x={node.x}
        y={node.y}
        width={BOX_W}
        height={BOX_H}
        rx={5}
        fill="var(--bg-surface)"
        stroke={stroke}
      />
      <text
        x={node.x + 10}
        y={node.y + BOX_H / 2 + 4}
        fontSize={11.5}
        fontFamily="var(--font-mono, monospace)"
        fill="var(--text-primary)"
      >
        {label}
      </text>
    </g>
  );
}

export function BlastGraph({ downstream }: { downstream: DownstreamNode[] }) {
  const t = useTranslations("blast");
  const { symbols, callers, endpoints, edges, height } = React.useMemo(
    () => buildLayout(downstream),
    [downstream],
  );

  if (callers.length === 0) {
    return <span style={s.empty}>{t("graph.empty")}</span>;
  }

  return (
    <div>
      <div style={s.graphWrap}>
        <svg
          role="img"
          aria-label={t("graph.ariaLabel")}
          width={COL_ENDPOINT + BOX_W + 20}
          height={height}
        >
          {edges.map((e, i) => (
            <path
              key={`${e.from.id}->${e.to.id}-${i}`}
              data-edge={e.kind}
              d={edgePath(e.from, e.to)}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {symbols.map((n) => (
            <Box key={n.id} node={n} stroke="var(--accent)" />
          ))}
          {callers.map((n) => (
            <Box key={n.id} node={n} stroke="var(--border)" />
          ))}
          {endpoints.map((n) => (
            <Box key={n.id} node={n} stroke="var(--accent-text)" />
          ))}
        </svg>
      </div>

      <div style={s.legend}>
        <span style={s.legendItem}>
          <span style={s.legendDot("var(--accent)")} />
          {t("legend.symbol")}
        </span>
        <span style={s.legendItem}>
          <span style={s.legendDot("var(--text-muted)")} />
          {t("legend.callers")}
        </span>
        <span style={s.legendItem}>
          <span style={s.legendDot("var(--accent-text)")} />
          {t("legend.endpoints")}
        </span>
      </div>
    </div>
  );
}
