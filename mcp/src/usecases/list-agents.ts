/**
 * Ring 2 — the configured reviewer agents.
 *
 * This is the only place a caller can learn a valid `agent_id`, which is why the
 * tool description points at it and why disabled agents are hidden by default:
 * an id that cannot be run is worse than no id at all.
 */
import type { AgentBrief } from '../contracts.js';
import type { DevDigestApi } from '../ports.js';
import { fail, fromApiFailure, ok, type UseCaseResult } from './result.js';

export interface ListAgentsDeps {
  api: DevDigestApi;
}

export interface ListAgentsInput {
  enabledOnly: boolean;
  limit: number;
}

export interface ListAgentsOutput {
  agents: AgentBrief[];
  returned: number;
  total: number;
  truncated: boolean;
}

export async function listAgents(
  deps: ListAgentsDeps,
  input: ListAgentsInput,
): Promise<UseCaseResult<ListAgentsOutput>> {
  const result = await deps.api.listAgents();
  if (!result.ok) return fail(fromApiFailure(result.failure));

  const matching = input.enabledOnly ? result.value.filter((agent) => agent.enabled) : result.value;
  const shown = matching.slice(0, input.limit);

  return ok({
    agents: shown,
    returned: shown.length,
    total: matching.length,
    truncated: shown.length < matching.length,
  });
}
