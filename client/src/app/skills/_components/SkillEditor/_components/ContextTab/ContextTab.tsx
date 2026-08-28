/* Skill editor → Context tab. Thin wrapper over the shared attach list; a
   skill's documents are injected after the agent's own, whenever this skill is
   linked to an agent and enabled. Repository comes from the sidebar. */
"use client";

import React from "react";
import type { Skill } from "@devdigest/shared";
import { ContextAttachList } from "@/components/ContextAttachList";
import { useActiveRepo } from "@/lib/repo-context";

export function ContextTab({ skill }: { skill: Skill }) {
  const { activeRepo } = useActiveRepo();
  return (
    <ContextAttachList kind="skill" parentId={skill.id} repoId={activeRepo?.id ?? null} />
  );
}
