/* The graph view of a blast radius: changed symbols on the left, their callers
   in the middle, the endpoints those callers reach on the right.

   A fixed three-column layout, not a force simulation: the data is bipartite by
   construction and a settled physics layout would only make the same three
   columns harder to read.

   The caller → endpoint edges come from each caller's OWN attribution. Reading
   the flat per-symbol union instead would force every caller to be drawn against
   every endpoint — the complete product rather than the real edges. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamNode } from "@devdigest/shared";
import { s } from "./styles";

const ROW_H = 40;
const COL_SYMBOL = 20;
const COL_CALLER = 300;
const COL_ENDPOINT = 600;
const BOX_W = 190;
const BOX_H = 26;

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** Edge midpoints as a cubic bezier, so crossing edges stay distinguishable. */
function edgePath(from: Node, to: Node): string {
  const x1 = from.x + BOX_W;
  const y1 = from.y + BOX_H / 2;
  const x2 = to.x;
  const y2 = to.y + BOX_H / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export function BlastGraph({ downstream }: { downstream: DownstreamNode[] }) {
  const t = useTranslations("blast");

  const { symbols, callers, endpoints, edges, height } = React.useMemo(() => {
    const symbolNodes: Node[] = [];
    const callerNodes = new Map<string, Node>();
    const endpointNodes = new Map<string, Node>();
    const edgeList: { from: Node; to: Node }[] = [];

    let callerRow = 0;
    let endpointRow = 0;

    for (const node of downstream) {
      if (node.callers.length === 0) continue;
      const first = callerRow;

      for (const caller of node.callers) {
        const callerId = `${caller.file}:${caller.line}:${caller.name}`;
        let cn = callerNodes.get(callerId);
        if (!cn) {
          cn = {
            id: callerId,
            label: caller.name,
            x: COL_CALLER,
            y: callerRow * ROW_H,
          };
          callerNodes.set(callerId, cn);
          callerRow += 1;
        }

        for (const endpoint of caller.endpoints_affected) {
          let en = endpointNodes.get(endpoint);
          if (!en) {
            en = {
              id: endpoint,
              label: endpoint,
              x: COL_ENDPOINT,
              y: endpointRow * ROW_H,
            };
            endpointNodes.set(endpoint, en);
            endpointRow += 1;
          }
          edgeList.push({ from: cn, to: en });
        }
      }

      // Centre the symbol against the span of callers it introduced.
      const last = Math.max(first, callerRow - 1);
      symbolNodes.push({
        id: node.symbol,
        label: `${node.symbol}()`,
        x: COL_SYMBOL,
        y: ((first + last) / 2) * ROW_H,
      });
      for (const caller of node.callers) {
        const cn = callerNodes.get(`${caller.file}:${caller.line}:${caller.name}`);
        const sn = symbolNodes[symbolNodes.length - 1];
        if (cn && sn) edgeList.push({ from: sn, to: cn });
      }
    }

    const rows = Math.max(callerRow, endpointRow, symbolNodes.length, 1);
    return {
      symbols: symbolNodes,
      callers: [...callerNodes.values()],
      endpoints: [...endpointNodes.values()],
      edges: edgeList,
      height: rows * ROW_H + BOX_H,
    };
  }, [downstream]);

  if (callers.length === 0) {
    return <span style={s.empty}>{t("graph.empty")}</span>;
  }

  const box = (node: Node, stroke: string) => (
    <g key={node.id}>
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
        {node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label}
      </text>
    </g>
  );

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
              data-edge=""
              d={edgePath(e.from, e.to)}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {symbols.map((n) => box(n, "var(--accent)"))}
          {callers.map((n) => box(n, "var(--border)"))}
          {endpoints.map((n) => box(n, "var(--accent-text)"))}
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
