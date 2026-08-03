# Onion architecture — ✗ / ✓ pairs

Every ✗ is real code from this repo, not a strawman. Every ✓ is the minimum diff that fixes the
ring violation — no extra abstraction. Rule ids refer to [SKILL.md](SKILL.md).

---

## 1. SQL in a route handler — C1, C2

✗ `server/src/modules/pulls/routes.ts:26-83` — one GET handler owns tenancy SQL, a GitHub call,
an upsert loop and a read query:

```ts
// BAD: the handler is the service, the repository and the mapper
app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
  const { workspaceId } = await getContext(container, req);
  const [repo] = await container.db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
  if (!repo) throw new NotFoundError('Repo not found');

  const gh = await container.github();
  const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
  for (const pr of pulls) {
    await container.db.insert(t.pullRequests).values({ /* 12 fields */ }).onConflictDoUpdate({ … });
  }

  const rows = await container.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repo.id));
  // …70 more lines of backfill, rollups and DTO mapping
});
```

✓ `server/src/modules/repos/routes.ts:26-31` — the whole handler, and the shape every new route
takes. Note the file header states the constraint out loud: *"Transport layer only"*:

```ts
// GOOD: resolve context, call one service method, map the status code
app.post('/repos', { schema: { body: RepoInput } }, async (req, reply) => {
  const { workspaceId, userId } = await getContext(app.container, req);
  const { repo, created } = await service.add(workspaceId, userId, req.body.url);
  reply.status(created ? 201 : 200);
  return repo;
});
```

The sync-from-GitHub-then-read logic doesn't disappear — it moves to `PullsService.listForRepo()`,
and the two DB statements move to `PullsRepository`.

---

## 2. A repository with no port — C3, H8

✗ `server/src/modules/reviews/repository.ts:1-40` — a concrete class whose constructor and return
types are the persistence layer. Nothing can substitute it:

```ts
// BAD: no interface; Db and $inferSelect are the public API
import type { Db } from '../../db/client.js';
export type ReviewRow = typeof t.reviews.$inferSelect;

export class ReviewRepository {
  constructor(private db: Db) {}
  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> { … }
  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> { … }
}
```

✓ Port inward, implementation outward. The port names domain types; only the class knows `Db`:

```ts
// GOOD: modules/reviews/ports.ts (ring 1) — no Db, no $inferSelect
export interface Pull { id: string; number: number; title: string; headSha: string; body: string | null }

export interface ReviewRepositoryPort {
  getPull(workspaceId: string, prId: string): Promise<Pull | undefined>;
  insertReview(values: NewReview, tx?: TxHandle): Promise<Review>;
}

// GOOD: modules/reviews/repository.ts (ring 3) — implements it, owns the Drizzle types
export class ReviewRepository implements ReviewRepositoryPort { constructor(private db: Db) {} … }
```

Declaring the row types in `ports.ts` also fixes a real cycle: `agents/helpers.ts` imports
`AgentRow` from `agents/repository.ts`, which imports `helpers.ts` back.

---

## 3. Container as a constructor parameter — H7

✗ `server/src/modules/reviews/service.ts:33-37` — takes the world, then `new`s its own
collaborators, so nothing can be injected:

```ts
// BAD: dependencies are invisible and unsubstitutable
constructor(private container: Container) {
  this.repo = new ReviewRepository(container.db);
  this.agents = container.agentsRepo;
  this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
}
```

✓ Declare exactly what the service uses, typed by ports. The container still does the wiring — in
`platform/container.ts`, where that job belongs:

```ts
// GOOD: the signature is the dependency list
constructor(
  private deps: {
    reviews: ReviewRepositoryPort;
    agents: AgentsRepositoryPort;
    llm: (p: Provider) => Promise<LLMProvider>;
    uow: UnitOfWork;
  },
) {}
```

This is also what removes the `as never` casts from tests — see
`test/repo-intel-facade-degraded.test.ts:33-39`, which currently patches a private field to fake a
repository.

---

## 4. Persistence types above the repository — H8, M12

✗ `run-executor.ts` signatures are written in Drizzle's vocabulary, so a column rename reaches
into the application layer:

```ts
// BAD: the use case is typed by the schema
import type { PullRow } from '../../db/rows.js';
async executeRuns(pull: PullRow, repo: typeof schema.repos.$inferSelect, …) { … }
```

```ts
// GOOD: the use case is typed by the domain; the repository maps at the edge
async executeRuns(pull: Pull, repo: Repo, …) { … }

// modules/reviews/helpers.ts (ring 0) — pure mapper, sits beside the existing row→DTO mappers
export const toPull = (row: PullRow): Pull => ({
  id: row.id, number: row.number, title: row.title, headSha: row.headSha, body: row.body,
});
```

---

## 5. Non-atomic multi-write — H9

✗ `server/src/modules/pulls/routes.ts:248-282` — five statements, no transaction. A failure after
the `delete` leaves the PR with no files, and this runs on a **GET**:

```ts
// BAD: four writes and an update, each independently committed
await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
if (detail.files.length > 0) await container.db.insert(t.prFiles).values(…);
await container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
if (detail.commits.length > 0) await container.db.insert(t.prCommits).values(…);
await container.db.update(t.pullRequests).set({ body: detail.body ?? null, … }).where(…);
```

✓ One boundary, declared as a port so the use case never names a Drizzle type:

```ts
// GOOD: the service owns the boundary; repositories accept the handle
await this.deps.uow.withTransaction(async (tx) => {
  await this.deps.pulls.replaceFiles(pr.id, detail.files, tx);
  await this.deps.pulls.replaceCommits(pr.id, detail.commits, tx);
  await this.deps.pulls.updateDetail(pr.id, detail, tx);
});

// repository method — falls back to its own handle when called standalone
replaceFiles(prId: string, files: PrFile[], tx?: TxHandle) {
  const invoker = tx ?? this.db;
  return invoker.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
}
```

---

## 6. Port-in vs data-in for the pure core — M13, C5

✗ Handing the engine a client drags I/O into ring 0 — every caller then needs a git checkout, and
the engine's tests need a fake `GitClient`:

```ts
// BAD: the pure core would have to fetch its own inputs
await reviewPullRequest({ git, repoPath, prNumber, llm, … });
```

✓ `server/src/modules/reviews/run-executor.ts:98,191` — already correct. The executor resolves
everything to data first, then calls a function that only computes:

```ts
// GOOD: I/O in the application layer, data across the boundary
const diff = await runLog.step('Loading PR diff', () => loadDiff(container, repo, pull));
const callers = await buildCallersDigest(…);   // string | undefined
const outcome = await reviewPullRequest({
  systemPrompt: agent.systemPrompt, model: agent.model,
  diff, llm,                        // one port, already resolved
  ...(callers ? { callers } : {}),  // pre-resolved strings, not a CodeIndex
  onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
});
```

Cancellation and progress cross the same way — as callbacks (`onEvent`, `checkCancelled`), so the
core owns no logger, no bus and no error taxonomy.

---

## 7. Fat port — H11

✗ `vendor/shared/adapters.ts:82-88` — `reviewPullRequest` calls exactly one of these four methods,
so every fake must stub three dead ones and `OpenRouterProvider` throws `NOT_SUPPORTED` for two:

```ts
// BAD: one interface for four unrelated roles
export interface LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter';
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(texts: string[]): Promise<number[][]>;
}
```

✓ Split by role. The core declares only what it consumes; `LLMProvider` can still satisfy it:

```ts
// GOOD: the narrowest port the consumer needs
export interface StructuredCompleter {
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
```

A one-method fake is then three lines, and `test/run.test.ts` no longer needs a hand-rolled
recorder object to capture one field.

---

## Why each ✗ fails

| ✗ | Rule | What breaks |
|---|---|---|
| 1 · SQL in the handler | C1, C2 | Transport knows persistence. The rollup logic can't be unit-tested, can't be reused by the polling module, and grew to 390 lines with a write inside a read endpoint |
| 2 · repository with no port | C3, H8 | Inner ring doesn't declare the interface, so the outer one can't be swapped — tests patch private fields instead |
| 3 · `Container` injected | H7 | Real dependencies are invisible; every service can reach anything; substitution requires casting the whole container |
| 4 · `PullRow` in a use case | H8, M12 | The application layer is typed by the schema, so a column rename is an application-layer change |
| 5 · unwrapped writes | H9 | No atomicity boundary exists anywhere in the package; partial failure leaves referential garbage |
| 6 · client passed into the core | M13, C5 | Ring 0 stops being pure; the engine can no longer run in the CI runner, and its tests need I/O fakes |
| 7 · four-method port | H11 | Fakes carry dead methods, implementations throw `NOT_SUPPORTED`, and the port stops describing a role |
