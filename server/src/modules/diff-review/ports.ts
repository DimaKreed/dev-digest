/**
 * Ports for the diff-review module (ring 1).
 *
 * Like `smart-diff` and `blast`, this slice ships no `repository.ts`: `agents`
 * and `agent_skills` are owned by `AgentsRepository`, which the composition root
 * hands in and which satisfies `DiffReviewAgentReads` structurally.
 *
 * Row shapes are restated rather than imported from `db/rows.js` or from
 * `../agents/*` — dependency-cruiser counts a type-only import as an edge, so
 * the first would trip `c5-pure-helpers` and the second `no-cross-module`.
 */

/** Providers the container can build. Restated to keep `platform/` out of ring 1. */
export type DiffReviewProvider = 'openai' | 'anthropic' | 'openrouter';

/** An agent, reduced to what running the engine needs. */
export interface DiffReviewAgent {
  id: string;
  name: string;
  systemPrompt: string;
  provider: DiffReviewProvider;
  model: string;
  strategy: 'single-pass' | 'map-reduce' | 'auto' | null;
  ciFailOn: 'never' | 'critical' | 'warning' | 'any';
  enabled: boolean;
}

export interface DiffReviewAgentReads {
  listEnabled(workspaceId: string): Promise<DiffReviewAgent[]>;
  getById(workspaceId: string, id: string): Promise<DiffReviewAgent | undefined>;
  linkedSkills(agentId: string): Promise<{ skill: { body: string; enabled: boolean } }[]>;
}

