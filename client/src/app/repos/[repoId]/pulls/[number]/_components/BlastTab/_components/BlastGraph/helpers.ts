/* Pure layout maths for the blast graph. Separated so the bezier can be tested
   directly — an SVG path is invisible to every RTL query. */
import type { DownstreamNode } from "@devdigest/shared";
import { BOX_H, BOX_W, COL_CALLER, COL_ENDPOINT, COL_SYMBOL, ROW_H } from "./constants";

/** Named `GraphNode`, not `Node`: the DOM's global `Node` is in scope in a file of SVG. */
export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

/** Which of the two columns an edge spans. Asserted separately in the tests. */
export type EdgeKind = "symbol-caller" | "caller-endpoint";

export interface GraphEdge {
  from: GraphNode;
  to: GraphNode;
  kind: EdgeKind;
}

export interface GraphLayout {
  symbols: GraphNode[];
  callers: GraphNode[];
  endpoints: GraphNode[];
  edges: GraphEdge[];
  height: number;
}

/** A cubic bezier between two box edges, so crossing edges stay distinguishable. */
export function edgePath(from: GraphNode, to: GraphNode): string {
  const x1 = from.x + BOX_W;
  const y1 = from.y + BOX_H / 2;
  const x2 = to.x;
  const y2 = to.y + BOX_H / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

const callerKey = (c: DownstreamNode["callers"][number]) => `${c.file}:${c.line}:${c.name}`;

/**
 * Place every node and derive the edges.
 *
 * `caller → endpoint` edges come from each caller's OWN attribution. Reading the
 * flat per-symbol union instead would force every caller to be drawn against
 * every endpoint — the complete product rather than the real edges.
 */
export function buildLayout(downstream: DownstreamNode[]): GraphLayout {
  const symbols: GraphNode[] = [];
  const callerNodes = new Map<string, GraphNode>();
  const endpointNodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  let callerRow = 0;
  let endpointRow = 0;

  for (const node of downstream) {
    if (node.callers.length === 0) continue;
    const first = callerRow;

    for (const caller of node.callers) {
      const key = callerKey(caller);
      let cn = callerNodes.get(key);
      if (!cn) {
        cn = { id: key, label: caller.name, x: COL_CALLER, y: callerRow * ROW_H };
        callerNodes.set(key, cn);
        callerRow += 1;
      }

      for (const endpoint of caller.endpoints_affected) {
        let en = endpointNodes.get(endpoint);
        if (!en) {
          en = { id: endpoint, label: endpoint, x: COL_ENDPOINT, y: endpointRow * ROW_H };
          endpointNodes.set(endpoint, en);
          endpointRow += 1;
        }
        edges.push({ from: cn, to: en, kind: "caller-endpoint" });
      }
    }

    // Centre the symbol against the span of callers it introduced. The id carries
    // the position because `DownstreamNode` has only a name, and two changed FILES
    // can each declare the same symbol — the server dedupes by name+file.
    const last = Math.max(first, callerRow - 1);
    const sn: GraphNode = {
      id: `${node.symbol}#${symbols.length}`,
      label: `${node.symbol}()`,
      x: COL_SYMBOL,
      y: ((first + last) / 2) * ROW_H,
    };
    symbols.push(sn);

    for (const caller of node.callers) {
      const cn = callerNodes.get(callerKey(caller));
      if (cn) edges.push({ from: sn, to: cn, kind: "symbol-caller" });
    }
  }

  const rows = Math.max(callerRow, endpointRow, symbols.length, 1);
  return {
    symbols,
    callers: [...callerNodes.values()],
    endpoints: [...endpointNodes.values()],
    edges,
    height: rows * ROW_H + BOX_H,
  };
}
