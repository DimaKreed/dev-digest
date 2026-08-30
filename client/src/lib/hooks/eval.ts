/* hooks/eval.ts — React Query hooks for the eval pipeline (SPEC-04).

   Every server call in this feature goes through here; no component calls
   fetch. Anything that finishes a run invalidates the case list, the history
   and both dashboards together, because a run changes all four surfaces at
   once and a stale one of them is how a person concludes their prompt edit
   did nothing.

   The two mutations that START a run are the exception: they answer 202 with
   an empty `running` batch, so at that moment there is nothing new to read.
   The invalidation belongs to whoever polls that batch to `done` — see
   `useEvalBatch`. Invalidating on the mutation instead would refetch four
   endpoints to re-read exactly the numbers already on screen. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalAgentDashboard,
  EvalBatch,
  EvalBatchSummary,
  EvalCaseDraft,
  EvalCaseRecord,
  EvalCaseRun,
  EvalDashboardAll,
  EvalExpectation,
  EvalExpectationKind,
} from "@devdigest/shared";

/** Every query key this feature owns, so an invalidation can name them all. */
const keys = {
  cases: (agentId: string) => ["eval-cases", agentId] as const,
  runs: (agentId: string) => ["eval-runs", agentId] as const,
  agentDash: (agentId: string) => ["eval-dashboard", agentId] as const,
  caseRuns: ["eval-case-runs"] as const,
  dash: ["eval-dashboard-all"] as const,
};

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: keys.cases(agentId ?? ""),
    queryFn: () => api.get<EvalCaseRecord[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: keys.runs(agentId ?? ""),
    queryFn: () => api.get<EvalBatchSummary[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

export function useEvalAgentDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: keys.agentDash(agentId ?? ""),
    queryFn: () => api.get<EvalAgentDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

export function useEvalDashboard() {
  return useQuery({
    queryKey: keys.dash,
    queryFn: () => api.get<EvalDashboardAll>("/eval/dashboard"),
  });
}

/**
 * Every run of ONE case, newest first — expected vs actual over time.
 *
 * `missed` and `violations` on each row come from the SCORER, not from
 * re-matching in the browser: there is one implementation of "same file,
 * overlapping lines" and a second copy here would drift from the metric.
 */
export function useEvalCaseRuns(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case-runs", caseId],
    queryFn: () => api.get<EvalCaseRun[]>(`/eval-cases/${caseId}/runs`),
    enabled: !!caseId,
  });
}

/**
 * One batch, polled while it is still running.
 *
 * A run of the set is executed in the background by the server, which answers
 * 202 immediately; this is how the browser learns it finished. `cases_done`
 * grows a case at a time because each case persists its own row as it lands,
 * so the poll carries real progress rather than a spinner.
 *
 * `refetchInterval` returns false once the batch is `done`, which is what stops
 * the poll — there is no separate teardown to forget. 2s against a step that
 * takes ~11s is roughly five polls per case, cheap enough that a slower cadence
 * would only make the last case look like it hung.
 */
export function useEvalBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batch", batchId],
    queryFn: () => api.get<EvalBatch>(`/eval/batches/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });
}

/**
 * The case a finding WOULD become — resolved by the server, persisted by
 * nobody. A GET, because opening the editor must not create anything: a case
 * that exists because a dialog was opened is a case nobody chose to keep.
 */
export function useEvalCaseDraft(findingId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case-draft", findingId],
    queryFn: () => api.get<EvalCaseDraft>(`/findings/${findingId}/eval-case/draft`),
    enabled: !!findingId,
    // A draft freezes the diff at read time; re-reading it under the user while
    // they edit would silently swap the input the case is about to assert on.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Dry-run a case's content: same engine, same scorer, no row written.
 *
 * Deliberately NOT invalidating anything on success — there is nothing to
 * invalidate, and a preview that refreshed the dashboards would imply a
 * measurement that was never recorded.
 */
export function useEvalPreview() {
  return useMutation({
    mutationFn: ({
      agentId,
      input,
    }: {
      agentId: string;
      input: {
        expectation_kind: EvalExpectationKind;
        input_diff: string;
        input_meta?: unknown;
        expected_output: EvalExpectation[];
      };
    }) => api.post<EvalCaseRun>(`/agents/${agentId}/eval-preview`, input),
  });
}

export interface EvalCaseInputBody {
  name: string;
  expectation_kind: EvalExpectationKind;
  input_diff: string;
  input_meta?: unknown;
  expected_output: EvalExpectation[];
  notes?: string | null;
  source_finding_id?: string | null;
}

/** Everything a run or an edit can stale, invalidated as one. */
function useInvalidateEval() {
  const qc = useQueryClient();
  return (agentId: string) => {
    qc.invalidateQueries({ queryKey: keys.cases(agentId) });
    qc.invalidateQueries({ queryKey: keys.runs(agentId) });
    qc.invalidateQueries({ queryKey: keys.agentDash(agentId) });
    qc.invalidateQueries({ queryKey: keys.dash });
    // Keyed by CASE id, not agent id, so this invalidates every case's history
    // at once — a run of the set touches all of them anyway.
    qc.invalidateQueries({ queryKey: keys.caseRuns });
  };
}

export function useCreateEvalCase() {
  const invalidate = useInvalidateEval();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: EvalCaseInputBody }) =>
      api.post<EvalCaseRecord>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: (data) => invalidate(data.owner_id),
  });
}

export function useUpdateEvalCase() {
  const invalidate = useInvalidateEval();
  return useMutation({
    mutationFn: ({ caseId, patch }: { caseId: string; patch: Partial<EvalCaseInputBody> }) =>
      api.put<EvalCaseRecord>(`/eval-cases/${caseId}`, patch),
    onSuccess: (data) => invalidate(data.owner_id),
  });
}

export function useDeleteEvalCase() {
  const invalidate = useInvalidateEval();
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string; agentId: string }) =>
      api.del<{ ok: boolean }>(`/eval-cases/${caseId}`),
    onSuccess: (_d, vars) => invalidate(vars.agentId),
  });
}

/**
 * Create a case from a finding in ONE request, with no editor in between.
 *
 * The UI does not take this path any more — the button opens the editor over a
 * draft so the case can be RUN before it is kept (SPEC-04 AC-18). This stays
 * because it is the whole flow in one call, which is what a script or an MCP
 * tool wants, and because the draft route and this one share their validation.
 *
 * The polarity is NOT sent either way: the server reads it off the finding's
 * own accept/dismiss timestamps, so it cannot disagree with the decision
 * already recorded on that finding.
 */
export function useEvalCaseFromFinding() {
  const invalidate = useInvalidateEval();
  return useMutation({
    mutationFn: ({
      findingId,
      body,
    }: {
      findingId: string;
      body?: { name?: string; expectation_kind?: EvalExpectationKind };
    }) => api.post<EvalCaseRecord>(`/findings/${findingId}/eval-case`, body ?? {}),
    onSuccess: (data) => invalidate(data.owner_id),
  });
}

/**
 * Start one case. Returns a batch of one, so both run paths poll identically.
 *
 * "Started", not "ran": the response is a `running` batch with no cases in it.
 * The caller keeps its `batch_id` and hands it to `useEvalBatch`.
 */
export function useRunEvalCase() {
  return useMutation({
    mutationFn: ({ caseId }: { caseId: string; agentId: string }) =>
      api.post<EvalBatch>(`/eval-cases/${caseId}/run`),
  });
}

/** Start the whole set (AC-05). Same contract as above: poll the batch. */
export function useRunEvalSet() {
  return useMutation({
    mutationFn: (agentId: string) => api.post<EvalBatch>(`/agents/${agentId}/eval-runs`),
  });
}

/**
 * Refetch everything a finished batch changed. Exported because the component
 * that polls the batch is the only thing that knows when a run is over.
 */
export function useEvalRunFinished() {
  return useInvalidateEval();
}
