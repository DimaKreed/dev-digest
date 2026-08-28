# server/docs

Durable explanation of **why** the API is built the way it is: design decisions and their
trade-offs, request/data flows, ADRs.

Not here:
- What the API exposes, env vars, how to run it → [../README.md](../README.md)
- Reviewer prompt authoring → [../../docs/agent-prompts/README.md](../../docs/agent-prompts/README.md)
  (that stays the single home for prompt conventions — don't fork it here)
- Intended behavior of something not built yet → [../specs/](../specs/)
- Something you learned while debugging → [../insights.md](../insights.md)

## Index

- [Smart Diff](./smart-diff.md) — why the risk ordering is a pure classifier, why the slice
  ships no `repository.ts`, and the three copies of the "last review" formula.
- [Project context](./project-context.md) — why attached documents are stored as paths and
  read fresh per run, why the injected block has no size cap, and why the type badge is data
  rather than translated copy.
- [Onboarding Generator](./onboarding-generator.md) — why the tour is a blocking POST rather
  than a job, why the derivation is a pure ring-0 kernel, and why the four degradation cases
  stay apart.
