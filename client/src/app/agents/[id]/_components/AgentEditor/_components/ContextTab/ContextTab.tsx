/* Agent editor → Context tab. A thin wrapper: the list itself is shared with
   the skill editor and lives in src/components/ContextAttachList/.
   The repository is the one selected in the sidebar (useActiveRepo) — the same
   source every other repo-scoped surface uses, so there is no second selector
   here to disagree with it. */
"use client";

import React from "react";
import type { Agent } from "@devdigest/shared";
import { ContextAttachList } from "@/components/ContextAttachList";
import { useActiveRepo } from "@/lib/repo-context";

export function ContextTab({ agent }: { agent: Agent }) {
  const { activeRepo } = useActiveRepo();
  return (
    <ContextAttachList kind="agent" parentId={agent.id} repoId={activeRepo?.id ?? null} />
  );
}
