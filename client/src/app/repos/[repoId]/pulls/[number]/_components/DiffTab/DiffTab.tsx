"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi, type DiffTarget } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, usePrReviews, useSmartDiff } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import { SmartDiffViewer } from "../SmartDiffViewer";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** `?file=…&line=…` deep link from a finding's file reference. */
  target?: DiffTarget | null;
  /** File order, from `?order`. `"smart"` is the default; `"original"` opts out. */
  order: "smart" | "original";
  onSetOrder: (order: "smart" | "original") => void;
  /** Deep-links a finding chip into the diff — bumps the target nonce upstream. */
  onOpenFile: (file: string, startLine: number, endLine: number) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  target,
  order,
  onSetOrder,
  onOpenFile,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Both hooks are already called by the page / other tabs; TanStack Query
  // dedupes on the key, so this is one fetch, not two.
  const { data: smartDiff, isLoading: smartDiffLoading, isError: smartDiffError } =
    useSmartDiff(prId);
  const { data: reviews } = usePrReviews(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // Smart Diff must never be able to hide the diff: loading, an error, or an
  // empty group set all fall back to the plain, previous rendering.
  const smartUsable =
    !smartDiffLoading && !smartDiffError && (smartDiff?.groups.length ?? 0) > 0;
  const showSmart = order === "smart" && smartUsable;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Button
              kind="ghost"
              size="sm"
              active={order === "smart"}
              disabled={!smartUsable}
              onClick={() => onSetOrder("smart")}
            >
              {t("smartDiff.smartOrder")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              active={order === "original"}
              onClick={() => onSetOrder("original")}
            >
              {t("smartDiff.originalOrder")}
            </Button>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
          </div>
        }
      >
        Files changed · {filesCount} files
      </SectionLabel>
      {showSmart && smartDiff ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          reviews={reviews ?? []}
          commenting={commenting}
          target={target}
          onOpenFile={onOpenFile}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} target={target} />
      )}
    </section>
  );
}
