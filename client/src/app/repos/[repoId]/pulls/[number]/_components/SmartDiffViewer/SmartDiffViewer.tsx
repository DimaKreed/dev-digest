/* SmartDiffViewer — the PR's changed files in risk order: `core` → `wiring` →
   `boilerplate`, each group with a finding-line index and its own DiffViewer.

   It deliberately renders NO diff rows of its own. Reordering and grouping is
   the whole feature, so it maps each group's paths back onto the real PrFile
   records and hands them to the existing <DiffViewer>; nothing under
   src/components/diff-viewer/ is touched. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SEV } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi, type DiffTarget } from "@/components/diff-viewer";
import type {
  PrFile,
  ReviewRecord,
  SmartDiff,
  SmartDiffFile,
  SmartDiffRole,
} from "@devdigest/shared";
import { COLLAPSED_ROLES, MAX_FINDING_CHIPS_PER_FILE, ROLE_LABEL_KEY } from "./constants";
import { filesByPath, groupPrFiles, roleForPath, severityForLine } from "./helpers";
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

/** One file's flagged lines, as clickable chips that deep-link into the diff. */
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
  // Past the cap the chips stop being an index and become a wall, so only the
  // count badge renders. See MAX_FINDING_CHIPS_PER_FILE.
  const chips = count > MAX_FINDING_CHIPS_PER_FILE ? [] : file.finding_lines;

  return (
    <div style={s.indexRow}>
      <span className="mono" style={s.indexPath}>
        {file.path}
      </span>
      <Badge>{t("smartDiff.findingLines", { count })}</Badge>
      {chips.map((line) => {
        const severity = severityForLine(reviews, file.path, line);
        const tone = severity ? SEV[severity] : null;
        return (
          <button
            key={line}
            type="button"
            aria-label={`${file.path}:${line}`}
            style={{ ...s.chip, ...chipTone(tone?.c ?? null, tone?.bg ?? null) }}
            className="mono tnum"
            onClick={() => onOpenFile(file.path, line, line)}
          >
            {line}
          </button>
        );
      })}
    </div>
  );
}
