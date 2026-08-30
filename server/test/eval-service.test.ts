import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LLMProvider } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { EvalService } from '../src/modules/eval/service.js';
import type {
  EvalAgent,
  EvalAgentReads,
  EvalCaseRow,
  EvalFindingContext,
  EvalFindingReads,
  EvalRepositoryPort,
  EvalRunRow,
  EvalRunWrite,
} from '../src/modules/eval/ports.js';
import { BUILT_EVAL_CASES } from '../src/db/seed-evals.js';
import { EVAL_CASE_TIMEOUT_MS, EVAL_CONCURRENCY } from '../src/modules/eval/constants.js';

/**
 * The eval pipeline end to end, with a fake repository and a mock model
 * (SPEC-04). Hermetic: no Docker, no provider key, no network.
 *
 * What is worth proving here rather than in the scorer's own tests is the
 * BATCH: that one run of the set writes one row per case under one batch id,
 * that a case which throws is isolated instead of poisoning the metrics, and
 * that the agent config in force is snapshotted onto every row.
 */

const AGENT: EvalAgent = {
  id: 'a1',
  name: 'Security Reviewer',
  provider: 'openai',
  model: 'gpt-4.1',
  systemPrompt: 'You are a security-focused PR reviewer.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  version: 7,
  enabled: true,
};

/** A minimal in-memory repository. Only what the service actually calls. */
class FakeRepo implements EvalRepositoryPort {
  cases: EvalCaseRow[] = [];
  runs: EvalRunRow[] = [];
  private seq = 0;

  async listCases(_w: string, ownerId: string) {
    return this.cases.filter((c) => c.ownerId === ownerId);
  }
  async getCase(workspaceId: string, caseId: string) {
    // Scoped, like the real repository: a fake that ignores the workspace turns
    // every tenancy assertion written against it into a test of nothing.
    return this.cases.find((c) => c.id === caseId && c.workspaceId === workspaceId);
  }
  async countCasesByOwner() {
    const m = new Map<string, number>();
    for (const c of this.cases) m.set(c.ownerId, (m.get(c.ownerId) ?? 0) + 1);
    return m;
  }
  async insertCase(workspaceId: string, ownerId: string, values: Parameters<EvalRepositoryPort['insertCase']>[2]) {
    const row: EvalCaseRow = {
      id: `c${++this.seq}`,
      workspaceId,
      ownerKind: 'agent',
      ownerId,
      name: values.name,
      inputDiff: values.inputDiff,
      inputMeta: values.inputMeta,
      expectedOutput: values.expectedOutput,
      notes: values.notes,
      expectationKind: values.expectationKind,
      sourceFindingId: values.sourceFindingId,
      createdAt: new Date(),
    };
    this.cases.push(row);
    return row;
  }
  async updateCase(_w: string, caseId: string, values: Record<string, unknown>) {
    const row = this.cases.find((c) => c.id === caseId);
    if (!row) return undefined;
    Object.assign(row, values);
    return row;
  }
  async deleteCase(_w: string, caseId: string) {
    const before = this.cases.length;
    this.cases = this.cases.filter((c) => c.id !== caseId);
    return this.cases.length < before;
  }
  async insertRun(values: EvalRunWrite) {
    const row: EvalRunRow = {
      id: `r${++this.seq}`,
      caseId: values.caseId,
      ranAt: new Date(Date.now() + this.seq),
      actualOutput: values.actualOutput,
      pass: values.pass,
      recall: values.recall,
      precision: values.precision,
      citationAccuracy: values.citationAccuracy,
      durationMs: values.durationMs,
      costUsd: values.costUsd,
      batchId: values.batchId,
      agentVersion: values.agentVersion,
      systemPrompt: values.systemPrompt,
      model: values.model,
      counts: values.counts,
      error: values.error,
    };
    this.runs.push(row);
    return row;
  }
  async listRuns(_w: string, ownerId: string) {
    const ids = new Set(this.cases.filter((c) => c.ownerId === ownerId).map((c) => c.id));
    return this.runs
      .filter((r) => ids.has(r.caseId))
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
      .map((run) => ({ run, case: this.cases.find((c) => c.id === run.caseId)! }));
  }
  async latestRunPerCase(w: string, ownerId: string) {
    const out = new Map<string, EvalRunRow>();
    for (const { run } of await this.listRuns(w, ownerId)) {
      if (!out.has(run.caseId)) out.set(run.caseId, run);
    }
    return out;
  }
  async listRunsForOwners(w: string, ownerIds: string[]) {
    const all = await Promise.all(ownerIds.map((id) => this.listRuns(w, id)));
    return all.flat();
  }
  async listRunsForCase(_w: string, caseId: string) {
    return this.runs
      .filter((r) => r.caseId === caseId)
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
      .map((run) => ({ run, case: this.cases.find((c) => c.id === run.caseId)! }));
  }
  async getBatch(_w: string, batchId: string) {
    return this.runs
      .filter((r) => r.batchId === batchId)
      .map((run) => ({ run, case: this.cases.find((c) => c.id === run.caseId)! }));
  }
}

const agents: EvalAgentReads = {
  async getById(_w, id) {
    return id === AGENT.id ? AGENT : undefined;
  },
  async list() {
    return [AGENT];
  },
  async linkedSkills() {
    return [];
  },
};

const noFindings: EvalFindingReads = {
  async findingContext() {
    return undefined;
  },
  async getPrFiles() {
    return [];
  },
};

/** The stripe case's diff, and a model that reports exactly that location. */
const STRIPE = BUILT_EVAL_CASES.find((c) => c.name === 'stripe-key-leak')!;
const CLEAN = BUILT_EVAL_CASES.find((c) => c.name === 'clean-refactor-no-flags')!;

function llmReporting(file: string, line: number): LLMProvider {
  return new MockLLMProvider('openai', {
    structured: {
      verdict: 'request_changes',
      summary: 'found it',
      score: 20,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded secret',
          file,
          start_line: line,
          end_line: line,
          rationale: 'a literal key',
          confidence: 0.95,
        },
      ],
    },
  });
}

const llmSilent: LLMProvider = new MockLLMProvider('openai', {
  structured: { verdict: 'approve', summary: 'nothing to report', score: 100, findings: [] },
});

function makeService(repo: FakeRepo, llm: LLMProvider, findings = noFindings) {
  return new EvalService({
    repo,
    agents,
    findings,
    engine: { llm: async () => llm, parseDiff: parseUnifiedDiff },
  });
}

async function seedCase(repo: FakeRepo, built: typeof STRIPE) {
  return repo.insertCase('w1', AGENT.id, {
    name: built.name,
    expectationKind: built.expectationKind,
    inputDiff: built.inputDiff,
    inputMeta: null,
    expectedOutput: [built.expectation],
    notes: null,
    sourceFindingId: null,
  });
}

describe('EvalService — running the set', () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
  });

  it('writes one row per case under one batch id (AC-05)', async () => {
    await seedCase(repo, STRIPE);
    await seedCase(repo, CLEAN);
    const batch = await makeService(repo, llmSilent).runAll('w1', AGENT.id);

    expect(repo.runs).toHaveLength(2);
    expect(new Set(repo.runs.map((r) => r.batchId)).size).toBe(1);
    expect(batch.cases).toHaveLength(2);
    expect(batch.metrics.traces_total).toBe(2);
  });

  it('snapshots the agent version, prompt and model onto every row (AC-08)', async () => {
    await seedCase(repo, STRIPE);
    await makeService(repo, llmSilent).runAll('w1', AGENT.id);

    for (const r of repo.runs) {
      expect(r.agentVersion).toBe(7);
      expect(r.systemPrompt).toBe(AGENT.systemPrompt);
      expect(r.model).toBe('gpt-4.1');
    }
  });

  it('scores a must_find case as found when the model cites the right line', async () => {
    await seedCase(repo, STRIPE);
    const llm = llmReporting(STRIPE.expectation.file, STRIPE.expectation.start_line);
    const batch = await makeService(repo, llm).runAll('w1', AGENT.id);

    expect(batch.metrics.recall).toBe(1);
    expect(batch.metrics.traces_passed).toBe(1);
  });

  it('scores a must_find case as missed when the model stays silent', async () => {
    await seedCase(repo, STRIPE);
    const batch = await makeService(repo, llmSilent).runAll('w1', AGENT.id);

    expect(batch.metrics.recall).toBe(0);
    expect(batch.metrics.traces_passed).toBe(0);
    // Precision is untouched: producing nothing is not producing noise.
    expect(batch.metrics.precision).toBe(1);
  });

  it('drops precision when the agent flags a must_not_flag location', async () => {
    // This is the movement the lesson's "break the prompt on purpose" step
    // depends on, so it is asserted rather than assumed.
    await seedCase(repo, CLEAN);
    const llm = llmReporting(CLEAN.expectation.file, CLEAN.expectation.start_line);
    const batch = await makeService(repo, llm).runAll('w1', AGENT.id);

    expect(batch.metrics.precision).toBe(0);
    expect(batch.metrics.traces_passed).toBe(0);
  });

  it('isolates a case whose model call failed and still returns the batch (AC-07)', async () => {
    await seedCase(repo, STRIPE);
    // A case whose stored diff parses to nothing throws inside `runOne` — the
    // same path a provider rejection takes, with no network involved.
    await repo.insertCase('w1', AGENT.id, {
      name: 'unparseable',
      expectationKind: 'must_find',
      inputDiff: 'not a diff at all',
      inputMeta: null,
      expectedOutput: [{ file: 'x.ts', start_line: 1, end_line: 1 }],
      notes: null,
      sourceFindingId: null,
    });

    const llm = llmReporting(STRIPE.expectation.file, STRIPE.expectation.start_line);
    const batch = await makeService(repo, llm).runAll('w1', AGENT.id);

    expect(batch.errors).toBe(1);
    // The healthy case is scored, and the broken one drags nothing down.
    expect(batch.metrics.traces_total).toBe(1);
    expect(batch.metrics.recall).toBe(1);
    expect(repo.runs.find((r) => r.error)?.pass).toBeNull();
  });

  it('refuses to run an agent with no cases rather than reporting a perfect score', async () => {
    await expect(makeService(repo, llmSilent).runAll('w1', AGENT.id)).rejects.toThrow(
      /no eval cases/i,
    );
  });

  it('reads the stored diff and never re-fetches the pull request (AC-13)', async () => {
    // `findings` here would throw if touched: a run must not reach the review
    // domain at all, which is what keeps two runs months apart comparable.
    const tripwire: EvalFindingReads = {
      async findingContext() {
        throw new Error('a run must not read the pull request');
      },
      async getPrFiles() {
        throw new Error('a run must not read the pull request');
      },
    };
    await seedCase(repo, STRIPE);
    const batch = await makeService(repo, llmSilent, tripwire).runAll('w1', AGENT.id);
    expect(batch.cases).toHaveLength(1);
  });
});

/**
 * Make the fake repository hold every `insertRun` until the test releases it,
 * so a batch can be observed WHILE it is in flight.
 *
 * The whole point of `startAll` is that it returns before the cases have run;
 * a test that could only see the finished state could not tell it apart from
 * the synchronous `runAll` it replaced on the route.
 */
function holdRuns(repo: FakeRepo, expected: number) {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let settle!: () => void;
  const finished = new Promise<void>((r) => (settle = r));
  let remaining = expected;

  const inner = repo.insertRun.bind(repo);
  repo.insertRun = async (values: EvalRunWrite) => {
    await held;
    const row = await inner(values);
    if (--remaining === 0) settle();
    return row;
  };
  return { release, finished };
}

describe('EvalService — running cases in parallel', () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
  });

  /** Seed n cases and count how many model calls are ever in flight at once. */
  async function runWithProbe(n: number) {
    for (let i = 0; i < n; i++) {
      await repo.insertCase('w1', AGENT.id, {
        name: `case-${i}`,
        expectationKind: 'must_find',
        inputDiff: STRIPE.inputDiff,
        inputMeta: null,
        expectedOutput: [STRIPE.expectation],
        notes: null,
        sourceFindingId: null,
      });
    }

    let inFlight = 0;
    let peak = 0;
    const probe: LLMProvider = {
      ...llmSilent,
      completeStructured: async (...args: Parameters<LLMProvider['completeStructured']>) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // One macrotask, so every worker that CAN start has started before the
        // first one finishes — otherwise the probe would measure the event
        // loop's scheduling rather than the pool's width.
        await new Promise((r) => setTimeout(r, 5));
        try {
          return await llmSilent.completeStructured(...args);
        } finally {
          inFlight--;
        }
      },
    } as LLMProvider;

    const batch = await makeService(repo, probe).runAll('w1', AGENT.id);
    return { batch, peak };
  }

  it('runs several cases at once instead of one at a time', async () => {
    const { peak } = await runWithProbe(8);
    expect(peak).toBeGreaterThan(1);
  });

  it('never exceeds the configured pool width', async () => {
    // The bound is the whole safety argument: the provider's rate limit is what
    // this protects, and a 429 costs a case its entire run.
    const { peak } = await runWithProbe(12);
    expect(peak).toBeLessThanOrEqual(EVAL_CONCURRENCY);
  });

  it('takes the pool width as the ceiling, not the floor, for a small set', async () => {
    const { peak, batch } = await runWithProbe(2);
    expect(peak).toBeLessThanOrEqual(2);
    expect(batch.cases).toHaveLength(2);
  });

  it('lists the batch in case order, not in the order the calls answered', async () => {
    // Collected by index on purpose: with a pool, completion order is whichever
    // model call happened to answer first, and two runs of one set would list
    // their cases differently for no reason a reader could see.
    for (let i = 0; i < 6; i++) {
      await repo.insertCase('w1', AGENT.id, {
        name: `case-${i}`,
        expectationKind: 'must_find',
        inputDiff: STRIPE.inputDiff,
        inputMeta: null,
        expectedOutput: [STRIPE.expectation],
        notes: null,
        sourceFindingId: null,
      });
    }
    // Later cases answer FASTER, so completion order is close to reversed.
    const seen: string[] = [];
    const jittered: LLMProvider = {
      ...llmSilent,
      completeStructured: async (...args: Parameters<LLMProvider['completeStructured']>) => {
        const n = seen.length;
        seen.push(String(n));
        await new Promise((r) => setTimeout(r, Math.max(0, 20 - n * 3)));
        return llmSilent.completeStructured(...args);
      },
    } as LLMProvider;

    const batch = await makeService(repo, jittered).runAll('w1', AGENT.id);
    expect(batch.cases.map((c) => c.case_name)).toEqual([
      'case-0',
      'case-1',
      'case-2',
      'case-3',
      'case-4',
      'case-5',
    ]);
  });

  it('still isolates a failing case when its neighbours are in flight (AC-07)', async () => {
    // The pool does not change AC-07, and this is the test that says so: each
    // worker catches its own case, so one failure lands as one readable row.
    await seedCase(repo, STRIPE);
    await repo.insertCase('w1', AGENT.id, {
      name: 'unparseable',
      expectationKind: 'must_find',
      inputDiff: 'not a diff at all',
      inputMeta: null,
      expectedOutput: [STRIPE.expectation],
      notes: null,
      sourceFindingId: null,
    });
    await seedCase(repo, CLEAN);

    const batch = await makeService(repo, llmSilent).runAll('w1', AGENT.id);

    expect(repo.runs).toHaveLength(3);
    const failed = batch.cases.filter((c) => c.error != null);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.case_name).toBe('unparseable');
    // The errored case is in no metric's denominator.
    expect(batch.errors).toBe(1);
    expect(batch.metrics.traces_total).toBe(2);
  });
});

describe('EvalService — a case that never answers', () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
  });

  /** A provider whose call never settles — the observed failure, distilled. */
  const llmHangs: LLMProvider = {
    ...llmSilent,
    completeStructured: () => new Promise(() => {}),
  } as LLMProvider;

  it('gives up on a case that never answers instead of holding the batch open', async () => {
    // Measured before this existed: one case sat unanswered for 9+ minutes
    // while the other nine finished in 56 s. The provider nests three attempts
    // inside its own three SDK retries at 90 s each, so the real ceiling was
    // 13.5 minutes per case, and nothing at this layer bounded it.
    vi.useFakeTimers();
    try {
      await seedCase(repo, STRIPE);
      const run = makeService(repo, llmHangs).runAll('w1', AGENT.id);
      await vi.advanceTimersByTimeAsync(EVAL_CASE_TIMEOUT_MS + 1);
      const batch = await run;

      expect(batch.cases).toHaveLength(1);
      expect(batch.cases[0]?.error).toMatch(/timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts a timed-out case in no metric, like any other failure (AC-07)', async () => {
    // "We never got an answer" is not "the agent answered wrongly". A pass of
    // `false` here would drag recall down as if the agent had missed the bug.
    vi.useFakeTimers();
    try {
      await seedCase(repo, STRIPE);
      await repo.insertCase('w1', AGENT.id, {
        name: 'answers-fine',
        expectationKind: 'must_not_flag',
        inputDiff: CLEAN.inputDiff,
        inputMeta: null,
        expectedOutput: [CLEAN.expectation],
        notes: null,
        sourceFindingId: null,
      });

      // Only the FIRST case hangs; the second answers at once, so the batch has
      // to come back with one error row and one scored row.
      let calls = 0;
      const llmHangsOnce: LLMProvider = {
        ...llmSilent,
        completeStructured: ((...args: Parameters<LLMProvider['completeStructured']>) =>
          calls++ === 0
            ? new Promise(() => {})
            : llmSilent.completeStructured(...args)) as LLMProvider['completeStructured'],
      } as LLMProvider;

      const run = makeService(repo, llmHangsOnce).runAll('w1', AGENT.id);
      await vi.advanceTimersByTimeAsync(EVAL_CASE_TIMEOUT_MS + 1);
      const batch = await run;

      expect(batch.errors).toBe(1);
      expect(batch.metrics.traces_total).toBe(1);
      const timedOut = batch.cases.find((c) => c.error != null);
      expect(timedOut?.pass).toBeNull();
      expect(timedOut?.recall).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds the dry run too, which holds a request open while it waits', async () => {
    vi.useFakeTimers();
    try {
      const preview = makeService(repo, llmHangs).previewCase('w1', AGENT.id, {
        expectation_kind: 'must_find',
        input_diff: STRIPE.inputDiff,
        expected_output: [STRIPE.expectation],
      });
      await vi.advanceTimersByTimeAsync(EVAL_CASE_TIMEOUT_MS + 1);
      const run = await preview;
      expect(run.error).toMatch(/timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EvalService — accepting a run without waiting for it', () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
  });

  it('answers with an empty running batch instead of holding until the set is done', async () => {
    await seedCase(repo, STRIPE);
    await seedCase(repo, CLEAN);
    const gate = holdRuns(repo, 2);
    const svc = makeService(repo, llmSilent);

    // Nothing can be written while the gate is shut, so this resolving at all
    // is the assertion: the caller is not waiting on the model calls.
    const accepted = await svc.startAll('w1', AGENT.id);

    expect(accepted.status).toBe('running');
    expect(accepted.cases_total).toBe(2);
    expect(accepted.cases_done).toBe(0);
    expect(accepted.cases).toEqual([]);
    expect(repo.runs).toHaveLength(0);

    gate.release();
    await gate.finished;
  });

  it('reports a batch that has produced no row yet as running, not as missing', async () => {
    await seedCase(repo, STRIPE);
    const gate = holdRuns(repo, 1);
    const svc = makeService(repo, llmSilent);
    const accepted = await svc.startAll('w1', AGENT.id);

    // A 404 on the client's very first poll would read as "the run never
    // happened", which is the opposite of what is going on.
    const inFlight = await svc.getBatch('w1', accepted.batch_id);
    expect(inFlight.status).toBe('running');
    expect(inFlight.cases_done).toBe(0);
    expect(inFlight.cases_total).toBe(1);

    gate.release();
    await gate.finished;
  });

  it('reaches done with every case once the batch finishes', async () => {
    await seedCase(repo, STRIPE);
    await seedCase(repo, CLEAN);
    const gate = holdRuns(repo, 2);
    const svc = makeService(repo, llmSilent);
    const accepted = await svc.startAll('w1', AGENT.id);

    gate.release();
    await gate.finished;
    // The batch is removed from the in-flight register in a `finally`, which
    // runs a tick after the last insert resolves.
    await new Promise((r) => setTimeout(r, 0));

    const done = await svc.getBatch('w1', accepted.batch_id);
    expect(done.status).toBe('done');
    expect(done.cases_done).toBe(2);
    expect(done.cases_total).toBe(2);
    expect(done.cases).toHaveLength(2);
  });

  it('does not expose a pending batch to another workspace', async () => {
    // The in-flight register is keyed by batch id alone, so without the
    // workspace check on the entry a guessed id would return a live progress
    // bar for another tenant's run.
    await seedCase(repo, STRIPE);
    const gate = holdRuns(repo, 1);
    const svc = makeService(repo, llmSilent);
    const accepted = await svc.startAll('w1', AGENT.id);

    await expect(svc.getBatch('w2', accepted.batch_id)).rejects.toThrow(/not found/i);

    gate.release();
    await gate.finished;
  });

  it('starts a single case as a batch of one, so both run paths are polled alike', async () => {
    const row = await seedCase(repo, STRIPE);
    const gate = holdRuns(repo, 1);
    const accepted = await makeService(repo, llmSilent).startCase('w1', row.id);

    expect(accepted.status).toBe('running');
    expect(accepted.cases_total).toBe(1);

    gate.release();
    await gate.finished;
  });

  it('fails the request, not a background task, when the batch cannot be set up', async () => {
    // An unknown provider or a missing key surfaces from `engine.llm`, which is
    // resolved BEFORE the 202 — otherwise the client would poll a batch that
    // was never going to write anything.
    await seedCase(repo, STRIPE);
    const svc = new EvalService({
      repo,
      agents,
      findings: noFindings,
      engine: {
        llm: async () => {
          throw new Error('no API key for openai');
        },
        parseDiff: parseUnifiedDiff,
      },
    });

    await expect(svc.startAll('w1', AGENT.id)).rejects.toThrow(/no API key/);
    expect(repo.runs).toHaveLength(0);
  });
});

describe('EvalService — seeding a case from a finding', () => {
  const PATCH = ['@@ -10,4 +10,5 @@', ' const config = {', '+  key: "sk_live_x",', ' };'].join(
    '\n',
  );

  function findingReads(over: Partial<EvalFindingContext['finding']> = {}, agentId: string | null = AGENT.id): EvalFindingReads {
    return {
      async findingContext() {
        return {
          finding: {
            id: 'f1',
            file: 'src/config.ts',
            startLine: 12,
            endLine: 12,
            severity: 'CRITICAL',
            category: 'security',
            title: 'Hardcoded Stripe secret key',
            acceptedAt: new Date(),
            dismissedAt: null,
            ...over,
          },
          review: { id: 'rev1', agentId },
          pull: {
            id: 'p1',
            workspaceId: 'w1',
            number: 482,
            title: 'Add rate limiting',
            headSha: 'abc',
          },
        };
      },
      async getPrFiles() {
        return [{ path: 'src/config.ts', patch: PATCH }];
      },
    };
  }

  it('reads must_find off an accepted finding (AC-02)', async () => {
    const repo = new FakeRepo();
    const created = await makeService(repo, llmSilent, findingReads()).seedFromFinding('w1', 'f1');
    expect(created.expectation_kind).toBe('must_find');
    expect(created.expected_output[0]).toMatchObject({ file: 'src/config.ts', start_line: 12 });
    expect(created.source_finding_id).toBe('f1');
  });

  it('reads must_not_flag off a dismissed finding (AC-02)', async () => {
    const repo = new FakeRepo();
    const reads = findingReads({ acceptedAt: null, dismissedAt: new Date() });
    const created = await makeService(repo, llmSilent, reads).seedFromFinding('w1', 'f1');
    expect(created.expectation_kind).toBe('must_not_flag');
  });

  it('freezes the diff so the case is runnable with no pull request (AC-13)', async () => {
    const repo = new FakeRepo();
    const created = await makeService(repo, llmSilent, findingReads()).seedFromFinding('w1', 'f1');
    const parsed = parseUnifiedDiff(created.input_diff);
    expect(parsed.files.map((f) => f.path)).toEqual(['src/config.ts']);
  });

  it('rejects a finding whose review has no owning agent (AC-03)', async () => {
    const repo = new FakeRepo();
    const reads = findingReads({}, null);
    await expect(
      makeService(repo, llmSilent, reads).seedFromFinding('w1', 'f1'),
    ).rejects.toThrow(/no owning agent/i);
    expect(repo.cases).toHaveLength(0);
  });

  it('rejects a finding whose file has no stored patch, rather than storing an unusable case', async () => {
    const repo = new FakeRepo();
    const reads: EvalFindingReads = {
      ...findingReads(),
      async getPrFiles() {
        return [{ path: 'src/config.ts', patch: null }];
      },
    };
    await expect(
      makeService(repo, llmSilent, reads).seedFromFinding('w1', 'f1'),
    ).rejects.toThrow(/no stored patch/i);
    expect(repo.cases).toHaveLength(0);
  });

  it('refuses to seed from another workspace’s finding', async () => {
    const repo = new FakeRepo();
    await expect(
      makeService(repo, llmSilent, findingReads()).seedFromFinding('other-ws', 'f1'),
    ).rejects.toThrow(/not found/i);
  });
});

describe('EvalService — draft and dry run (the editor opens on nothing)', () => {
  const PATCH = ['@@ -10,4 +10,5 @@', ' const config = {', '+  key: "sk_live_x",', ' };'].join(
    '\n',
  );

  function findingReads(
    over: Partial<EvalFindingContext['finding']> = {},
    agentId: string | null = AGENT.id,
  ): EvalFindingReads {
    return {
      async findingContext() {
        return {
          finding: {
            id: 'f1',
            file: 'src/config.ts',
            startLine: 12,
            endLine: 12,
            severity: 'CRITICAL',
            category: 'security',
            title: 'Hardcoded Stripe secret key',
            acceptedAt: new Date(),
            dismissedAt: null,
            ...over,
          },
          review: { id: 'rev1', agentId },
          pull: {
            id: 'p1',
            workspaceId: 'w1',
            number: 482,
            title: 'Add rate limiting',
            headSha: 'abc',
          },
        };
      },
      async getPrFiles() {
        return [{ path: 'src/config.ts', patch: PATCH }];
      },
    };
  }

  it('returns the case a finding WOULD become and writes nothing', async () => {
    const repo = new FakeRepo();
    const draft = await makeService(repo, llmSilent, findingReads()).draftFromFinding('w1', 'f1');

    expect(draft).toMatchObject({
      agent_id: AGENT.id,
      agent_name: AGENT.name,
      expectation_kind: 'must_find',
      source_finding_id: 'f1',
    });
    expect(draft.expected_output[0]).toMatchObject({ file: 'src/config.ts', start_line: 12 });
    expect(draft.input_diff).toContain('src/config.ts');
    // The whole point: opening an editor is not a decision to keep a case.
    expect(repo.cases).toHaveLength(0);
  });

  it('rejects a draft on the same grounds it would reject the save', async () => {
    // Otherwise the editor opens over a case that can never be saved, and the
    // user finds out only after filling it in.
    const repo = new FakeRepo();
    await expect(
      makeService(repo, llmSilent, findingReads({}, null)).draftFromFinding('w1', 'f1'),
    ).rejects.toThrow(/no owning agent/i);

    const noPatch: EvalFindingReads = {
      ...findingReads(),
      async getPrFiles() {
        return [{ path: 'src/config.ts', patch: null }];
      },
    };
    await expect(
      makeService(repo, llmSilent, noPatch).draftFromFinding('w1', 'f1'),
    ).rejects.toThrow(/no stored patch/i);
  });

  it('dry-runs a case that does not exist, and persists nothing', async () => {
    const repo = new FakeRepo();
    const llm = llmReporting(STRIPE.expectation.file, STRIPE.expectation.start_line);
    const run = await makeService(repo, llm).previewCase('w1', AGENT.id, {
      expectation_kind: 'must_find',
      input_diff: STRIPE.inputDiff,
      expected_output: [STRIPE.expectation],
    });

    expect(run.pass).toBe(true);
    expect(run.findings).toHaveLength(1);
    expect(run.counts).toMatchObject({ tp: 1, fn: 0 });
    // No row, and therefore no history and no effect on any metric.
    expect(repo.runs).toHaveLength(0);
    expect(repo.cases).toHaveLength(0);
    // The ids are empty on purpose: there is nothing to address.
    expect(run.id).toBe('');
    expect(run.case_id).toBe('');
  });

  it('scores a dry run exactly as the saved case will score', async () => {
    // A preview that measured differently from the case it previews would be
    // worse than no preview at all.
    const repo = new FakeRepo();
    const llm = llmReporting(STRIPE.expectation.file, STRIPE.expectation.start_line);
    const svc = makeService(repo, llm);

    const preview = await svc.previewCase('w1', AGENT.id, {
      expectation_kind: STRIPE.expectationKind,
      input_diff: STRIPE.inputDiff,
      expected_output: [STRIPE.expectation],
    });
    await seedCase(repo, STRIPE);
    const saved = await svc.runAll('w1', AGENT.id);

    expect(preview.pass).toBe(saved.cases[0]!.pass);
    expect(preview.counts).toEqual(saved.cases[0]!.counts);
  });

  it('reports an unusable draft as an errored run, not as a thrown request', async () => {
    // The message belongs beside the field that caused it, in the editor.
    const repo = new FakeRepo();
    const run = await makeService(repo, llmSilent).previewCase('w1', AGENT.id, {
      expectation_kind: 'must_find',
      input_diff: 'not a diff at all',
      expected_output: [STRIPE.expectation],
    });
    expect(run.error).toMatch(/no file changes/i);
    expect(run.pass).toBeNull();
    expect(repo.runs).toHaveLength(0);
  });

  it('404s a preview for an agent in another workspace', async () => {
    const repo = new FakeRepo();
    await expect(
      makeService(repo, llmSilent).previewCase('w1', 'not-this-agent', {
        expectation_kind: 'must_find',
        input_diff: STRIPE.inputDiff,
        expected_output: [],
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('EvalService — expected vs actual', () => {
  it('persists what the scorer MISSED, not just the counts', async () => {
    // The case editor renders this rather than re-matching in the browser, so a
    // run that scored 0 recall has to be able to say WHICH expectation went
    // unmatched — a count alone cannot answer "what did it say instead?".
    const repo = new FakeRepo();
    await seedCase(repo, STRIPE);
    await makeService(repo, llmSilent).runAll('w1', AGENT.id);

    const [row] = await makeService(repo, llmSilent).listCaseRuns('w1', repo.cases[0]!.id);
    expect(row!.missed).toHaveLength(1);
    expect(row!.missed[0]).toMatchObject({ file: STRIPE.expectation.file });
    expect(row!.findings).toHaveLength(0);
    expect(row!.violations).toHaveLength(0);
  });

  it('persists the findings that violated a must_not_flag case', async () => {
    const repo = new FakeRepo();
    await seedCase(repo, CLEAN);
    const llm = llmReporting(CLEAN.expectation.file, CLEAN.expectation.start_line);
    await makeService(repo, llm).runAll('w1', AGENT.id);

    const [row] = await makeService(repo, llm).listCaseRuns('w1', repo.cases[0]!.id);
    expect(row!.violations).toHaveLength(1);
    expect(row!.violations[0]).toMatchObject({ file: CLEAN.expectation.file });
    expect(row!.missed).toHaveLength(0);
    expect(row!.pass).toBe(false);
  });

  it('carries the whole newest run on the case record, not a summary of it', async () => {
    const repo = new FakeRepo();
    await seedCase(repo, STRIPE);
    const llm = llmReporting(STRIPE.expectation.file, STRIPE.expectation.start_line);
    await makeService(repo, llm).runAll('w1', AGENT.id);

    const [record] = await makeService(repo, llm).listCases('w1', AGENT.id);
    expect(record!.last_run?.findings).toHaveLength(1);
    expect(record!.last_run?.pass).toBe(true);
    expect(record!.last_run?.counts).toMatchObject({ tp: 1, fn: 0 });
  });

  it('lists a case history newest first, so two runs can be read against each other', async () => {
    const repo = new FakeRepo();
    await seedCase(repo, STRIPE);
    const found = llmReporting(STRIPE.expectation.file, STRIPE.expectation.start_line);
    await makeService(repo, found).runAll('w1', AGENT.id);
    await makeService(repo, llmSilent).runAll('w1', AGENT.id);

    const rows = await makeService(repo, llmSilent).listCaseRuns('w1', repo.cases[0]!.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.pass).toBe(false);
    expect(rows[1]!.pass).toBe(true);
  });

  it('404s for a case in another workspace rather than answering with an empty history', async () => {
    const repo = new FakeRepo();
    await seedCase(repo, STRIPE);
    await expect(
      makeService(repo, llmSilent).listCaseRuns('other-ws', repo.cases[0]!.id),
    ).rejects.toThrow(/not found/i);
  });
});

describe('EvalService — dashboards', () => {
  it('lists an agent that has never run WITHOUT metrics (AC-12)', async () => {
    const repo = new FakeRepo();
    await seedCase(repo, STRIPE);
    const dash = await makeService(repo, llmSilent).dashboard('w1');
    expect(dash.agents[0]).toMatchObject({ agent_id: 'a1', cases_total: 1, latest: null });
    expect(dash.recent_runs).toHaveLength(0);
  });

  it('reports the delta and an alert once there are two runs (AC-09/AC-10)', async () => {
    const repo = new FakeRepo();
    await seedCase(repo, STRIPE);
    const found = llmReporting(STRIPE.expectation.file, STRIPE.expectation.start_line);
    await makeService(repo, found).runAll('w1', AGENT.id);
    await makeService(repo, llmSilent).runAll('w1', AGENT.id);

    const dash = await makeService(repo, llmSilent).agentDashboard('w1', AGENT.id);
    expect(dash.batches).toHaveLength(2);
    // Newest first, and the newest one found nothing.
    expect(dash.latest?.metrics.recall).toBe(0);
    expect(dash.delta.recall).toBe(-1);
    expect(dash.alert).toMatch(/Regression/);
    // The chart reads left to right, so the trend is the other order.
    expect(dash.trend[0]?.recall).toBe(1);
  });
});
