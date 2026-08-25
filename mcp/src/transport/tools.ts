/**
 * Ring 4 — the MCP surface. This package's equivalent of a `routes.ts`.
 *
 * Each handler resolves its input, calls exactly one use case, and wraps the
 * result in the MCP envelope. No data access, no waiting, no business rules: if
 * logic appears here it belongs in `src/usecases/` instead.
 *
 * The descriptions and the error strings below are copied verbatim from the plan
 * and are part of the contract with the calling model. They are sized against the
 * 2 KB truncation a client applies to each description, and they lead with the
 * load-bearing sentence because truncation cuts from the end. Reword them and the
 * tool behaves differently even though no code changed.
 *
 * UNTRUSTED CONTENT: pull request titles, file paths, finding titles, rationales
 * and convention snippets all originate in the repository under review. They flow
 * into `content` and `structuredContent`, which a client renders as data. They are
 * never placed in the server instructions, and nothing here interprets them.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  apiTooSlow,
  blastIndexIncomplete,
  blastNoCallers,
  blastNoSymbols,
  blastNotIndexed,
  neverScanned,
  noFindingAtSeverity,
  noReviewYet,
  rateLimited,
  reviewFoundNothing,
  reviewsFoundNothing,
  runDidNotComplete,
  runTimedOut,
  unknownAgent,
  unknownPull,
  unknownRepo,
  unreachable,
} from '../domain/errors.js';
import {
  formatAgents,
  formatBlastRadius,
  formatConventions,
  formatReviews,
  formatRunResult,
  type ResponseFormat,
} from '../domain/format.js';
import { CALLERS_PER_SYMBOL, LIMITS } from '../domain/limits.js';
import type { Clock, DevDigestApi } from '../ports.js';
import { getBlastRadius } from '../usecases/get-blast-radius.js';
import { getConventions } from '../usecases/get-conventions.js';
import { getFindings } from '../usecases/get-findings.js';
import { listAgents } from '../usecases/list-agents.js';
import type { UseCaseFailure } from '../usecases/result.js';
import { runAgentOnPr } from '../usecases/run-agent-on-pr.js';

export interface ToolDeps {
  api: DevDigestApi;
  clock: Clock;
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function text(body: string, structured?: Record<string, unknown>): ToolResult {
  return structured
    ? { content: [{ type: 'text', text: body }], structuredContent: structured }
    : { content: [{ type: 'text', text: body }] };
}

/**
 * A business-logic failure. Signalled with `isError` inside a well-formed result,
 * never as a JSON-RPC error — the caller needs to read the recovery advice, and a
 * protocol error is not a place a model can read anything.
 */
function errorText(body: string, structured?: Record<string, unknown>): ToolResult {
  return structured
    ? { content: [{ type: 'text', text: body }], structuredContent: structured, isError: true }
    : { content: [{ type: 'text', text: body }], isError: true };
}

function failureText(failure: UseCaseFailure): string {
  switch (failure.kind) {
    case 'unreachable':
      return unreachable(failure.baseUrl);
    case 'slow':
      return apiTooSlow(failure.baseUrl, failure.timeoutMs);
    case 'unknown_repo':
      return unknownRepo(failure.repo);
    case 'unknown_pull':
      return unknownPull(failure.repo, failure.prNumber);
    case 'unknown_agent':
      return unknownAgent(failure.agentId);
    case 'rate_limited':
      return rateLimited();
    case 'timeout':
      return runTimedOut(failure.runId, failure.repo, failure.prNumber);
    case 'run_failed':
      return runDidNotComplete(failure.runId, failure.status, failure.error);
    case 'api_error':
      return `DevDigest returned an error: ${failure.message}.`;
  }
}

const REPO_FIELD = z
  .string()
  .describe(
    'Repository as "owner/name", spelled exactly as on GitHub, e.g. "acme/payments-api". Not a URL and not a UUID.',
  );

const PR_NUMBER_FIELD = z
  .number()
  .int()
  .min(1)
  .describe('The pull request number shown on GitHub, e.g. 482. Not an internal id.');

export function registerTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'devdigest_list_agents',
    {
      description:
        'List the reviewer agents configured in DevDigest. This is where a valid agent_id for devdigest_run_agent_on_pr comes from — call this first if you do not already have one. Read-only, instant, and free: no model call and no repository access. Returns each agent\'s id, name, and whether it is enabled. This tells you nothing about any particular pull request; use devdigest_get_findings for that.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        enabled_only: z
          .boolean()
          .optional()
          .describe(
            'Return only agents that are enabled and can actually be run. Set to false to also list disabled agents.',
          ),
        response_format: z
          .enum(['concise', 'detailed'])
          .optional()
          .describe(
            'concise: id, name, enabled. detailed: adds description, provider, model, strategy, and ci_fail_on.',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.agents.max)
          .optional()
          .describe(
            'Maximum number of agents to return. If the list is truncated the response says how many were omitted.',
          ),
      },
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? 'concise';
      const result = await listAgents(deps, {
        enabledOnly: args.enabled_only ?? true,
        limit: args.limit ?? LIMITS.agents.default,
      });
      if (!result.ok) return errorText(failureText(result.failure));

      const { agents, returned, total, truncated } = result.value;
      return text(formatAgents(agents, total, format), { agents, returned, total, truncated });
    },
  );

  server.registerTool(
    'devdigest_run_agent_on_pr',
    {
      description:
        'Run one reviewer agent over a pull request, WAIT for it to finish, and return the findings. This is the only tool here that writes anything, costs money, and takes time: it blocks for up to 120 seconds. Use it when the user asks for a NEW review. Do NOT use it to read a review that already exists — devdigest_get_findings does that instantly and for free. agent_id must come from devdigest_list_agents; an agent name will not work. If the 120-second cap is reached this tool returns an error naming the run_id, the run keeps going on the server, and you should wait about a minute and call devdigest_get_findings for the same repo and pr_number rather than running it again.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: {
        repo: REPO_FIELD,
        pr_number: PR_NUMBER_FIELD,
        agent_id: z
          .string()
          .describe(
            'Which reviewer agent to run. Get this from devdigest_list_agents — an agent name will not work here.',
          ),
        response_format: z
          .enum(['concise', 'detailed'])
          .optional()
          .describe(
            'concise: verdict, score, and one line per finding. detailed: adds each finding\'s rationale and suggested fix.',
          ),
      },
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? 'concise';
      const result = await runAgentOnPr(deps, {
        repo: args.repo,
        prNumber: args.pr_number,
        agentId: args.agent_id,
      });
      if (!result.ok) return errorText(failureText(result.failure));

      const run = result.value;
      return text(
        formatRunResult(run.agentName, run.verdict, run.score, run.findings, format),
        {
          run_id: run.runId,
          agent_id: run.agentId,
          agent_name: run.agentName,
          status: 'done',
          verdict: run.verdict,
          score: run.score,
          blockers: run.blockers,
          findings_count: run.findings.length,
          duration_ms: run.durationMs,
          findings: run.findings,
        },
      );
    },
  );

  server.registerTool(
    'devdigest_get_findings',
    {
      description:
        'Read the verdict and findings of a review that has ALREADY finished for a pull request. Instant and free — no model call, nothing is written. Use it to answer "what did the review say?", and to recover after devdigest_run_agent_on_pr timed out. It returns the newest completed review per agent. If no review has ever been run for the pull request it says so; run devdigest_run_agent_on_pr to create one.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        repo: REPO_FIELD,
        pr_number: PR_NUMBER_FIELD,
        agent_id: z
          .string()
          .optional()
          .describe(
            'Limit the result to one agent\'s review. Omit to get the newest review from every agent that has run. Ids come from devdigest_list_agents.',
          ),
        severity: z
          .enum(['CRITICAL', 'WARNING', 'SUGGESTION'])
          .optional()
          .describe('Return only findings at this severity. Omit for all severities.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.findings.max)
          .optional()
          .describe(
            'Maximum number of findings to return, most severe first. If the list is truncated the response says how to narrow the request.',
          ),
        response_format: z
          .enum(['concise', 'detailed'])
          .optional()
          .describe(
            'concise: verdict, score, severity counts, and one line per finding (severity, file:line, title). detailed: adds each finding\'s rationale and suggested fix.',
          ),
      },
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? 'concise';
      const result = await getFindings(deps, {
        repo: args.repo,
        prNumber: args.pr_number,
        agentId: args.agent_id,
        severity: args.severity,
        limit: args.limit ?? LIMITS.findings.default,
      });
      if (!result.ok) return errorText(failureText(result.failure));

      const found = result.value;
      const base = {
        repo: args.repo,
        pr_number: args.pr_number,
        returned: found.returned,
        total: found.total,
        truncated: found.truncated,
      };

      const structured = {
        ...base,
        reviews: found.reviews,
        findings: found.findings,
        counts: found.counts,
        total_live: found.totalLive,
        empty_reason: found.emptyReason,
      };

      // THREE empty cases, not two, and each is a different fact:
      // nobody reviewed this / it was reviewed and is clean / it is not clean
      // but the caller's own filter hid everything.
      if (found.emptyReason === 'never_run') {
        return text(noReviewYet(args.repo, args.pr_number), { ...structured, reviews: [] });
      }

      if (found.emptyReason === 'clean') {
        const first = found.reviews[0];
        if (found.reviews.length > 1) {
          return text(
            reviewsFoundNothing(found.reviews.length, args.repo, args.pr_number),
            structured,
          );
        }
        const name = first?.agent_name ?? first?.agent_id ?? 'The reviewer';
        return text(
          // Real stored values — a review whose findings were all dismissed still
          // carries request_changes, and claiming approve/100 there is a lie.
          reviewFoundNothing(
            name,
            args.repo,
            args.pr_number,
            first?.verdict ?? 'n/a',
            first?.score ?? null,
          ),
          structured,
        );
      }

      if (found.emptyReason === 'filtered_out') {
        return text(
          noFindingAtSeverity(
            args.repo,
            args.pr_number,
            args.severity ?? 'the requested level',
            found.totalLive,
            found.counts,
          ),
          structured,
        );
      }

      return text(
        formatReviews(found.reviews, found.findings, found.total, found.counts, format),
        structured,
      );
    },
  );

  server.registerTool(
    'devdigest_get_conventions',
    {
      description:
        'List the house coding conventions DevDigest mined from a repository\'s own code. Read-only and free — this reads an existing scan and does not start one. Every convention comes with verified evidence: real file paths and line numbers where the pattern was actually found and counted, not guessed, and a rule is only reported if it appears in at least two distinct files. Use it to answer "what are this repository\'s rules?" or to check a proposed change against them. If the repository has never been scanned it says so.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        repo: REPO_FIELD,
        status: z
          .enum(['pending', 'accepted', 'rejected'])
          .optional()
          .describe(
            'Filter by triage state. Use "accepted" for the rules the team has actually adopted. Omit for all.',
          ),
        category: z
          .enum([
            'naming',
            'error-handling',
            'async',
            'imports',
            'structure',
            'api-design',
            'testing',
            'typing',
            'logging',
            'data-access',
          ])
          .optional()
          .describe('Filter to one area of the codebase\'s rules. Omit for all categories.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.conventions.max)
          .optional()
          .describe(
            'Maximum number of conventions to return, highest confidence first. If the list is truncated the response says how many were omitted.',
          ),
        response_format: z
          .enum(['concise', 'detailed'])
          .optional()
          .describe(
            'concise: the rule text, its category, and how many files it was found in. detailed: adds the primary evidence file, its line range, and the verified snippet.',
          ),
      },
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? 'concise';
      const result = await getConventions(deps, {
        repo: args.repo,
        status: args.status,
        category: args.category,
        limit: args.limit ?? LIMITS.conventions.default,
      });
      if (!result.ok) return errorText(failureText(result.failure));

      const found = result.value;
      const structured = {
        repo: args.repo,
        last_scan_at: found.lastScanAt,
        conventions: found.conventions,
        returned: found.returned,
        total: found.total,
        truncated: found.truncated,
      };

      if (found.neverScanned) return text(neverScanned(args.repo), structured);

      return text(
        formatConventions(found.conventions, found.total, found.lastScanAt, format),
        structured,
      );
    },
  );

  server.registerTool(
    'devdigest_get_blast_radius',
    {
      description:
        "Trace what a pull request's changed code can reach: the symbols it changed, the callers of those symbols elsewhere in the repository, and the HTTP endpoints and scheduled jobs those callers sit behind. Instant and free — it reads the repository's existing code index and never builds one. Use it to answer \"what else could this break?\". It reports how complete that index was, and returns an ERROR rather than an empty list when the index could not answer, because a short answer from this tool would otherwise read as a measured \"small impact\". The repository must be imported and indexed in DevDigest first.",
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        repo: REPO_FIELD,
        pr_number: PR_NUMBER_FIELD,
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.blast.max)
          .optional()
          .describe(
            `Maximum affected symbols to return, widest reach first (default ${LIMITS.blast.default}). If the list is cut the response says how many were omitted; the counts are always over all of them.`,
          ),
        response_format: z
          .enum(['concise', 'detailed'])
          .optional()
          .describe(
            'concise: the counts, one line per affected symbol, and the endpoints and jobs affected. detailed: adds each caller\'s file:line and the endpoints that caller specifically reaches.',
          ),
      },
    },
    async (args) => {
      const format: ResponseFormat = args.response_format ?? 'concise';
      const result = await getBlastRadius(deps, {
        repo: args.repo,
        prNumber: args.pr_number,
        limit: args.limit ?? LIMITS.blast.default,
      });
      if (!result.ok) return errorText(failureText(result.failure));

      const blast = result.value;
      const structured = {
        repo: args.repo,
        pr_number: args.pr_number,
        index_state: blast.indexState,
        index_reason: blast.indexReason,
        changed_symbols: blast.changedSymbols,
        downstream: blast.downstream,
        endpoints_affected: blast.endpoints,
        crons_affected: blast.crons,
        summary: blast.summary,
        returned: blast.returned,
        total: blast.total,
        truncated: blast.truncated,
        total_callers: blast.totalCallers,
        empty_reason: blast.emptyReason,
      };

      // An index that could not answer is the one case that must NOT be a
      // success. The stub errored on every input for this reason; implemented,
      // it errors on exactly the inputs where the emptiness means nothing.
      if (blast.emptyReason === 'not_indexed') {
        return errorText(
          blastNotIndexed(args.repo, args.pr_number, blast.indexState, blast.indexReason),
          structured,
        );
      }
      if (blast.emptyReason === 'no_symbols') {
        return text(blastNoSymbols(args.repo, args.pr_number), structured);
      }
      if (blast.emptyReason === 'no_callers') {
        return text(
          blastNoCallers(args.repo, args.pr_number, blast.changedSymbols.length),
          structured,
        );
      }

      const body = formatBlastRadius(
        {
          symbolCount: blast.changedSymbols.length,
          downstream: blast.downstream,
          total: blast.total,
          totalCallers: blast.totalCallers,
          endpoints: blast.endpoints,
          crons: blast.crons,
          summary: blast.summary,
          callersPerSymbol: CALLERS_PER_SYMBOL,
        },
        format,
      );

      // The qualifier goes FIRST. Truncation cuts from the end, so a caller who
      // reads only the head of a long answer must still learn that the numbers
      // below it are a lower bound.
      return text(
        blast.indexState === 'ok'
          ? body
          : `${blastIndexIncomplete(blast.indexState, blast.indexReason)}\n${body}`,
        structured,
      );
    },
  );
}
