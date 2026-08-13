/* The tree view of a blast radius: one collapsible row per changed symbol,
   expanding to its callers as file:line links and the endpoints and jobs they
   sit behind. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, MonoLink } from "@devdigest/ui";
import type { DownstreamNode } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

export interface BlastLinkContext {
  /** Paths in THIS PR's diff. A caller outside it cannot be deep-linked there. */
  prFilePaths: Set<string>;
  repoFullName: string | null;
  headSha: string | null;
  onOpenFile: (file: string, startLine: number, endLine: number) => void;
}

/**
 * One `file:line` link, pointed at whichever target can actually show the line.
 *
 * The Files-changed tab renders only this PR's own files, so sending a caller
 * that is not in the diff there switches the tab and then shows nothing. Callers
 * outside the diff — which is most of them, that being the point of a blast
 * radius — go to the blob on GitHub instead. With neither available the path is
 * still shown, just not as an affordance that would do nothing.
 */
function CallerLink({
  file,
  line,
  ctx,
}: {
  file: string;
  line: number | null;
  ctx: BlastLinkContext;
}) {
  const t = useTranslations("blast");
  const label = line == null ? file : `${file}:${line}`;
  const inDiff = ctx.prFilePaths.has(file);

  if (inDiff) {
    const at = line ?? 1;
    const href =
      ctx.repoFullName && ctx.headSha
        ? githubBlobUrl(ctx.repoFullName, ctx.headSha, file, at, at)
        : undefined;
    return (
      <>
        <MonoLink onClick={() => ctx.onOpenFile(file, at, at)}>{label}</MonoLink>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={t("openInGithub")}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon.ExternalLink size={12} />
          </a>
        )}
      </>
    );
  }

  if (ctx.repoFullName && ctx.headSha) {
    const at = line ?? 1;
    return (
      <MonoLink href={githubBlobUrl(ctx.repoFullName, ctx.headSha, file, at, at)}>
        {label}
      </MonoLink>
    );
  }

  return <span className="mono">{label}</span>;
}

function SymbolRow({ node, ctx }: { node: DownstreamNode; ctx: BlastLinkContext }) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(false);

  return (
    <div style={s.symbolRow}>
      <button
        type="button"
        style={s.symbolHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.ChevronRight
          size={13}
          style={{ transform: open ? "rotate(90deg)" : undefined }}
        />
        <span style={s.symbolName}>{node.symbol}()</span>
        <span style={s.symbolCount}>
          {t("callerCount", { count: node.callers.length })}
        </span>
      </button>

      {open && (
        <>
          {node.callers.length > 0 ? (
            <div style={s.callerList}>
              {node.callers.map((c) => (
                <div key={`${c.file}:${c.line}:${c.name}`} style={s.callerRow}>
                  <span style={s.arrow}>↳</span>
                  <CallerLink file={c.file} line={c.line} ctx={ctx} />
                </div>
              ))}
            </div>
          ) : (
            <span style={{ ...s.empty, paddingInlineStart: 20 }}>
              {t("symbol.noCallers")}
            </span>
          )}

          {(node.endpoints_affected.length > 0 || node.crons_affected.length > 0) && (
            <div style={s.chipRow}>
              {node.endpoints_affected.map((e) => (
                <Badge key={e} icon="Globe" mono color="var(--accent-text)">
                  {e}
                </Badge>
              ))}
              {node.crons_affected.map((c) => (
                <Badge key={c} icon="Clock" mono color="var(--warn-text)">
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function BlastTree({
  downstream,
  ctx,
}: {
  downstream: DownstreamNode[];
  ctx: BlastLinkContext;
}) {
  return (
    <div>
      {downstream.map((node) => (
        <SymbolRow key={node.symbol} node={node} ctx={ctx} />
      ))}
    </div>
  );
}
