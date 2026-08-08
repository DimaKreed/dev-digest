/* SmartDiffViewer — the PR's changed files in risk order: `core` → `wiring` →
   `boilerplate`, each group with a finding-line index and its own DiffViewer.

   It deliberately renders NO diff rows of its own. Reordering and grouping is
   the whole feature, so it maps each group's paths back onto the real PrFile
   records and hands them to the existing <DiffViewer>; nothing under
   src/components/diff-viewer/ is touched. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SEV, SeverityBadge } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi, type DiffTarget } from "@/components/diff-viewer";
import type {
  PrFile,
  ReviewRecord,
  SmartDiff,
  SmartDiffFile,
  SmartDiffRole,
} from "@devdigest/shared";
import { COLLAPSED_ROLES, MAX_FINDING_CHIPS_PER_FILE, ROLE_LABEL_KEY } from "./constants";
import { liveFindings } from "@/lib/severity";
import { filesByPath, findingsForLine, groupPrFiles, roleForPath } from "./helpers";
import { chipTone, s } from "./styles";

type OpenRoles = Record<SmartDiffRole, boolean>;

function initialOpenRoles(): OpenRoles {
  return {
    core: !COLLAPSED_ROLES.includes("core"),
    wiring: !COLLAPSED_ROLES.includes("wiring"),
    boilerplate: !COLLAPSED_ROLES.includes("boilerplate"),
  };
}

interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  files: PrFile[];
  /** Persisted reviews — the source the chip severities are re-derived from. */
  reviews: ReviewRecord[];
  commenting?: DiffCommentApi;
  /** `?file=…&line=…` deep link, threaded through unchanged (nonce included). */
  target?: DiffTarget | null;
  onOpenFile: (file: string, startLine: number, endLine: number) => void;
}

export function SmartDiffViewer({
  smartDiff,
  files,
  reviews,
  commenting,
  target,
  onOpenFile,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const [openRoles, setOpenRoles] = React.useState<OpenRoles>(initialOpenRoles);

  const byPath = React.useMemo(() => filesByPath(files), [files]);
  // Derived here rather than taken as a prop: `reviews` is already the source of
  // truth this component was given, and the diff's markers must agree with the
  // index rows above them by construction.
  const findings = React.useMemo(() => liveFindings(reviews), [reviews]);
  const { too_big: tooBig, total_lines: totalLines } = smartDiff.split_suggestion;

  // A deep link into a COLLAPSED group would otherwise die silently: FileCard
  // renders `{open && …}`, so the target line is not in the DOM at all while its
  // group is closed. This effect only EXPANDS — the scroll belongs to the target
  // CodeLine's own mount effect, which runs after the expansion has painted
  // (client/insights.md: "expanding and scrolling cannot happen in one effect").
  const targetRole = target ? roleForPath(smartDiff.groups, target.path) : null;
  const targetNonce = target?.nonce;
  React.useEffect(() => {
    if (!targetRole) return;
    setOpenRoles((cur) => (cur[targetRole] ? cur : { ...cur, [targetRole]: true }));
  }, [targetRole, targetNonce]);

  return (
    <div style={s.root}>
      <span style={s.caption}>{t("smartDiff.groupedByRole")}</span>

      {tooBig && (
        <div style={s.large}>
          <span style={s.largeTitle}>{t("smartDiff.largeTitle", { lines: totalLines })}</span>
          <span style={s.largeBody}>{t("smartDiff.largeBody")}</span>
        </div>
      )}

      {smartDiff.groups.map((group) => {
        // An empty group renders nothing at all — no header, no placeholder.
        if (group.files.length === 0) return null;
        const open = openRoles[group.role];
        const flagged = group.files.filter((f) => f.finding_lines.length > 0);

        return (
          <section key={group.role} style={s.group}>
            <button
              type="button"
              style={s.groupHeader}
              onClick={() =>
                setOpenRoles((cur) => ({ ...cur, [group.role]: !cur[group.role] }))
              }
            >
              <Icon.ChevronRight
                size={13}
                style={{ ...s.chevron, transform: open ? "rotate(90deg)" : "none" }}
              />
              <span style={s.roleLabel}>{t(ROLE_LABEL_KEY[group.role])}</span>
              <Badge>{t("smartDiff.filesCount", { count: group.files.length })}</Badge>
            </button>

            {open && (
              <>
                {flagged.length > 0 && (
                  <div style={s.index}>
                    {flagged.map((file) => (
                      <FindingIndexRow
                        key={file.path}
                        file={file}
                        reviews={reviews}
                        onOpenFile={onOpenFile}
                      />
                    ))}
                  </div>
                )}
                <DiffViewer
                  files={groupPrFiles(group, byPath)}
                  commenting={commenting}
                  findings={findings}
                  target={target}
                />
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * One file's flagged lines, as clickable rows that deep-link into the diff.
 *
 * Each row carries the finding's severity AND its title, because the diff rows
 * it links to render neither: without the title the reviewer arrives at a line
 * knowing only that something is wrong with it. `SeverityBadge` is icon + label
 * rather than a colour, so the severity survives for a colour-blind reader.
 *
 * Past MAX_FINDING_CHIPS_PER_FILE the list is truncated rather than dropped —
 * a count with nothing readable under it is the failure mode this row exists to
 * fix, so the overflow says how many are hidden and points at the Agent runs tab.
 */
function FindingIndexRow({
  file,
  reviews,
  onOpenFile,
}: {
  file: SmartDiffFile;
  reviews: ReviewRecord[];
  onOpenFile: (file: string, startLine: number, endLine: number) => void;
}) {
  const t = useTranslations("prReview");
  const count = file.finding_lines.length;
  const shown = file.finding_lines.slice(0, MAX_FINDING_CHIPS_PER_FILE);
  const hidden = count - shown.length;

  return (
    <div style={s.indexFile}>
      <div style={s.indexRow}>
        <span className="mono" style={s.indexPath}>
          {file.path}
        </span>
        <Badge>{t("smartDiff.findingLines", { count })}</Badge>
      </div>

      {shown.map((line) => {
        // The server ships line numbers only; the finding behind a line is
        // re-derived from the reviews the page already has. A flagged line with
        // no live finding left (dismissed since the response was cached) keeps
        // its number and simply has no title to show.
        const finding = findingsForLine(reviews, file.path, line)[0];
        const tone = finding ? SEV[finding.severity] : null;
        const label = finding
          ? `${tone?.label}: ${file.path}:${line} — ${finding.title}`
          : `${file.path}:${line}`;
        return (
          <button
            key={line}
            type="button"
            aria-label={label}
            style={s.findingRow}
            onClick={() => onOpenFile(file.path, line, line)}
          >
            {finding ? (
              <SeverityBadge severity={finding.severity} compact />
            ) : (
              <span style={s.findingNoSeverity} />
            )}
            <span
              className="mono tnum"
              style={{ ...s.findingLine, ...chipTone(tone?.c ?? null, tone?.bg ?? null) }}
            >
              {line}
            </span>
            {finding && <span style={s.findingTitle}>{finding.title}</span>}
          </button>
        );
      })}

      {hidden > 0 && (
        <span style={s.indexOverflow}>{t("smartDiff.findingsHidden", { count: hidden })}</span>
      )}
    </div>
  );
}
