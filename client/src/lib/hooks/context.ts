/* hooks/context.ts — an agent's or skill's project-context attachment set.
   The document LISTING (`useContextFiles` / `useContextFile`) lives in
   `core.ts` next to the other repo-scoped platform reads; these two are the
   per-parent set, which only the Context tab needs. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContextAttachment } from "@devdigest/shared";
import { api } from "../api";

/** `agent` and `skill` share one endpoint shape, so they share one hook. */
export type ContextParentKind = "agent" | "skill";

const basePath = (kind: ContextParentKind, parentId: string) =>
  `/${kind === "agent" ? "agents" : "skills"}/${parentId}/context`;

export function useContextAttachments(
  kind: ContextParentKind,
  parentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["context-attachments", kind, parentId, repoId],
    queryFn: () =>
      api.get<ContextAttachment[]>(`${basePath(kind, parentId!)}?repo_id=${repoId}`),
    enabled: !!parentId && !!repoId,
  });
}

/**
 * Replace the whole ordered set in ONE request: the array's position IS the
 * injection order, so attaching, detaching and reordering are the same call.
 * Last write wins — the response is what was persisted, and invalidating the
 * query is what lets a tab that lost a race see the winner.
 */
export function useSetContextAttachments(
  kind: ContextParentKind,
  parentId: string | null | undefined,
  repoId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) =>
      api.put<ContextAttachment[]>(basePath(kind, parentId!), {
        repo_id: repoId,
        paths,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-attachments", kind, parentId, repoId] });
      // `used_by` on every document row of this repo can change.
      qc.invalidateQueries({ queryKey: ["context", repoId] });
    },
  });
}
