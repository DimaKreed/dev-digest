/**
 * Shared fixtures. Shaped from the real contract fields, and parsed through the
 * narrow schemas by the fake itself — so a drift between these and the API's
 * actual payloads surfaces as a failing fake rather than as a green suite.
 */
export const REPO = {
  id: 'repo-1',
  owner: 'acme',
  name: 'payments-api',
  full_name: 'acme/payments-api',
};

export const PULL = { id: 'pr-1', number: 482, title: 'Retry failed webhook deliveries' };

export const STARTED_RUN = {
  run_id: 'run-1',
  agent_id: 'agent-1',
  agent_name: 'General Reviewer',
};

export const RUN_RUNNING = { run_id: 'run-1', status: 'running' };

export const RUN_DONE = {
  run_id: 'run-1',
  agent_id: 'agent-1',
  agent_name: 'General Reviewer',
  status: 'done',
  duration_ms: 41_000,
  findings_count: 2,
  score: 65,
  blockers: 1,
};

export const CRITICAL_FINDING = {
  id: 'f-1',
  severity: 'CRITICAL',
  category: 'bug',
  title: 'Retry loop can never terminate',
  file: 'src/webhooks/retry.ts',
  start_line: 42,
  end_line: 48,
  rationale: 'The backoff counter is reset inside the loop body.',
  suggestion: 'Move the reset above the loop.',
};

export const SUGGESTION_FINDING = {
  id: 'f-2',
  severity: 'SUGGESTION',
  category: 'style',
  title: 'Extract the magic number',
  file: 'src/webhooks/retry.ts',
  start_line: 12,
  end_line: 12,
};

export const REVIEW_WITH_FINDINGS = {
  id: 'rev-1',
  run_id: 'run-1',
  agent_id: 'agent-1',
  agent_name: 'General Reviewer',
  verdict: 'request_changes',
  score: 65,
  created_at: '2026-08-13T10:00:00.000Z',
  findings: [CRITICAL_FINDING, SUGGESTION_FINDING],
};

export const CLEAN_REVIEW = {
  id: 'rev-2',
  run_id: 'run-2',
  agent_id: 'agent-1',
  agent_name: 'General Reviewer',
  verdict: 'approve',
  score: 100,
  created_at: '2026-08-13T11:00:00.000Z',
  findings: [],
};

export const pullsFor = (rows: unknown[] = [PULL]) => ({ [REPO.id]: rows });
