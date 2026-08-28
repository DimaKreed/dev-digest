import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { BriefRisk, BriefReviewFocus } from '@devdigest/shared';
import {
  DROP_ORDER,
  FILE_LIST_HEAD_N,
  MAX_BLAST_ITEMS,
  MAX_CONTEXT_DOC_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_ISSUE_CHARS,
  type BriefDroppableInput,
} from './constants.js';
import type {
  BriefBlastRead,
  BriefFacts,
  BriefGrounding,
  BriefIndexStateRead,
  PrBriefGeneration,
} from './ports.js';

/**
 * Pure kernel for the brief module (ring 0).
 *
 * Every function here is a total function of its arguments: no clock, no
 * filesystem, no environment, no network. That is what makes the token-budget
 * behaviour, the drop order and the grounding check testable in the hermetic
 * lane with no container and no Docker — and `c5-pure-helpers` enforces it
 * mechanically over this file.
 *
 * Everything that came out of the repository under review — the PR title and
 * description, the changed-file paths, the issue text, the project-context
 * documents — is DATA, and is wrapped as untrusted before it enters the model
 * input. `notes-service.ts` wraps the very same fields the same way.
 */

// --- issue references -------------------------------------------------------

/** `#123` and `github.com/<owner>/<repo>/(issues|pull)/123` references. */
export interface IssueRef {
  owner: string;
  name: string;
  number: number;
  /** Our own reconstruction of the reference, safe to interpolate into a header. */
  ref: string;
}

/**
 * Issue references in a piece of PR text.
 *
 * Restated here rather than imported from `modules/reviews/intent.ts`, which
 * already has an identical function: `no-cross-module` blocks a sibling slice's
 * helper. Keep equal to `extractIssueRefs` there.
 *
 * A bare `#123` always means the PR's own repository. A cross-repository
 * reference is returned with its own owner/name so the CALLER can refuse to
 * follow it — the confused-deputy guard is not made here.
 */
export function extractIssueRefs(text: string, self: { owner: string; name: string }): IssueRef[] {
  const out: IssueRef[] = [];
  const seen = new Set<string>();
  const push = (owner: string, name: string, number: number, ref: string) => {
    const key = `${owner}/${name}#${number}`;
    if (seen.has(key) || Number.isNaN(number) || number <= 0) return;
    seen.add(key);
    out.push({ owner, name, number, ref });
  };

  const urlRe = /https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/g;
  for (const m of text.matchAll(urlRe)) {
    push(m[1] ?? '', m[2] ?? '', Number(m[3]), m[0]);
  }
  for (const m of text.matchAll(/(?:^|[^\w/#])#(\d+)\b/g)) {
    push(self.owner, self.name, Number(m[1]), `#${m[1] ?? ''}`);
  }
  return out;
}

// --- the blast-radius paragraph ---------------------------------------------

/**
 * The one-paragraph blast-radius summary, rendered from the two facade reads
 * this slice makes — never from `modules/blast`, which `no-cross-module`
 * forbids reaching and which this feature does not touch.
 *
 * Returns `''` when there is nothing honest to say. An empty string is the
 * signal the caller turns into a recorded degraded source (AC-07/AC-08); it is
 * never rendered as "nothing is affected", because a missing graph and an
 * unaffected change arrive here looking identical.
 */
export function summariseBlast(blast: BriefBlastRead, index: BriefIndexStateRead): string {
  // `status` means "nothing threw", not "the data is there" — the edge builder
  // degrades to an empty graph without throwing. Branch on the counter.
  const graphMissing = index.filesIndexed > 0 && (index.edgesWritten ?? 0) === 0;
  if (blast.degraded || graphMissing) return '';
  if (blast.changedSymbols.length === 0 && blast.callers.length === 0) return '';

  const symbols = blast.changedSymbols.slice(0, MAX_BLAST_ITEMS).map((s) => `${s.name} (${s.file})`);
  const callerFiles = [...new Set(blast.callers.map((c) => c.file))];
  const endpoints = blast.impactedEndpoints.slice(0, MAX_BLAST_ITEMS);

  const parts = [
    `The change touches ${blast.changedSymbols.length} indexed symbol(s)` +
      (symbols.length > 0 ? `, including ${symbols.join(', ')}` : '') +
      '.',
    `${blast.callers.length} call site(s) across ${callerFiles.length} file(s) reach them.`,
  ];
  if (endpoints.length > 0) {
    parts.push(`Endpoints downstream of the change: ${endpoints.join(', ')}.`);
  }
  return parts.join(' ');
}

// --- assembling the model input ---------------------------------------------

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}

/**
 * The user message for the one generation call, assembled from `facts` alone
 * (AC-02). Nothing else is read and no hunk body appears anywhere (AC-03).
 *
 * The section HEADERS are ours and are trusted framing; everything that came
 * out of the repository sits inside an `<untrusted>` block so the model is told
 * where data ends and instructions do not begin.
 */
export function buildBriefPayload(facts: BriefFacts): string {
  const sections: string[] = [
    `## Pull request\n#${facts.prNumber} in ${facts.repoFullName}`,
    `## Its title\n${wrapUntrusted('pr-title', facts.title)}`,
  ];

  if (facts.description.trim().length > 0) {
    sections.push(
      `## Its description\n${wrapUntrusted(
        'pr-description',
        clip(facts.description, MAX_DESCRIPTION_CHARS),
      )}`,
    );
  }

  // Never dropped for the cap (AC-05).
  if (facts.intent) {
    sections.push(
      [
        '## Derived intent (produced by our own classifier, not by the author)',
        facts.intent.intent,
        `In scope: ${facts.intent.in_scope.join(', ') || '(none stated)'}`,
        `Out of scope: ${facts.intent.out_of_scope.join(', ') || '(none stated)'}`,
      ].join('\n'),
    );
  }

  // Never dropped for the cap (AC-05).
  sections.push(
    '## Diff stats\n' +
      `${facts.diffStats.filesChanged} file(s) changed, ` +
      `+${facts.diffStats.additions} / -${facts.diffStats.deletions} line(s). ` +
      'The hunk bodies are deliberately not provided.',
  );

  if (facts.changedFiles.length > 0) {
    sections.push(
      `## Files it changes\n${wrapUntrusted('file-list', facts.changedFiles.join('\n'))}`,
    );
  }

  if (facts.blastSummary.length > 0) {
    sections.push(`## What the change reaches\n${facts.blastSummary}`);
  }

  for (const issue of facts.issues) {
    // The TITLE goes INSIDE the wrapper with the body: `wrapUntrusted` escapes
    // `</untrusted>` only within what it wraps, so a title interpolated into
    // the header would be unescaped attacker text in structural position.
    // `issue.ref` is safe in the header — it is our own reconstruction.
    sections.push(
      `## Linked issue ${issue.ref}\n${wrapUntrusted(
        'github-issue',
        clip(`${issue.title}\n\n${issue.body}`, MAX_ISSUE_CHARS),
      )}`,
    );
  }

  for (const doc of facts.contextDocs) {
    sections.push(
      `## Project context document ${doc.path}\n${wrapUntrusted(
        'project-context',
        clip(doc.text, MAX_CONTEXT_DOC_CHARS),
      )}`,
    );
  }

  return sections.join('\n\n');
}

/** One step of the drop order, as a pure transform over the fact set. */
const DROP_STEP: Record<BriefDroppableInput, (facts: BriefFacts) => BriefFacts> = {
  project_context: (f) => ({ ...f, contextDocs: [] }),
  issue_body: (f) => ({ ...f, issues: f.issues.map((i) => ({ ...i, body: '' })) }),
  file_list_tail: (f) => ({ ...f, changedFiles: f.changedFiles.slice(0, FILE_LIST_HEAD_N) }),
  blast_downstream: (f) => ({ ...f, blastSummary: '' }),
};

/** Whether a drop step would change anything — a no-op is not a dropped input. */
const DROP_APPLIES: Record<BriefDroppableInput, (facts: BriefFacts) => boolean> = {
  project_context: (f) => f.contextDocs.length > 0,
  issue_body: (f) => f.issues.some((i) => i.body.length > 0),
  file_list_tail: (f) => f.changedFiles.length > FILE_LIST_HEAD_N,
  blast_downstream: (f) => f.blastSummary.length > 0,
};

export interface FittedPayload {
  /** The fact set actually sent, after any drops. */
  facts: BriefFacts;
  payload: string;
  /** The inputs dropped, in `DROP_ORDER` sequence. Recorded by name (AC-06). */
  dropped: BriefDroppableInput[];
}

/**
 * Bring the assembled input under `cap` counted tokens by dropping inputs in
 * the fixed order of `DROP_ORDER` (AC-04, AC-05).
 *
 * Stops the moment it fits, so a payload that already fits drops nothing. A
 * step that would change nothing is skipped rather than recorded — reporting
 * "the project context was dropped" for a PR that has none is a lie the reader
 * cannot check. The derived intent and the diff stats are not members of
 * `DROP_ORDER`, so they cannot be dropped by construction rather than by care.
 *
 * `count` is injected rather than imported: the tokenizer is an adapter and
 * ring 0 may not reach one. It may be the real encoder or its permanent
 * character-estimate fallback, and this function does not care which.
 */
export function fitToBudget(
  facts: BriefFacts,
  count: (text: string) => number,
  cap: number,
): FittedPayload {
  let current = facts;
  let payload = buildBriefPayload(current);
  const dropped: BriefDroppableInput[] = [];

  for (const name of DROP_ORDER) {
    if (count(payload) <= cap) break;
    if (!DROP_APPLIES[name](current)) continue;
    current = DROP_STEP[name](current);
    payload = buildBriefPayload(current);
    dropped.push(name);
  }

  return { facts: current, payload, dropped };
}

// --- grounding --------------------------------------------------------------

/**
 * Every path that was present in the input actually assembled for the call.
 * Built from the POST-drop fact set, so a document dropped to fit the budget
 * does not ground a reference to itself.
 */
export function groundingFrom(facts: BriefFacts): BriefGrounding {
  const paths = new Set<string>(facts.changedFiles);
  for (const doc of facts.contextDocs) paths.add(doc.path);
  return { paths };
}

export interface VerifiedEntries {
  risks: BriefRisk[];
  review_focus: BriefReviewFocus[];
  /** How many entries were dropped for naming a path that was not in the input. */
  dropped: number;
}

/**
 * Drop every risk and review-focus entry that names a path the model was not
 * shown, and count the drops (AC-13).
 *
 * An entry naming ANY unknown path goes entirely, rather than having the bad
 * ref filtered out of it: the claim is anchored to something that is not there,
 * so keeping the prose and quietly deleting its evidence is the silent failure
 * this criterion exists to prevent. A risk carrying NO ref at all is kept — it
 * references nothing, so there is nothing to falsify, and the spec's grounding
 * rule is about references rather than about claims.
 */
export function verifyRefs(
  output: PrBriefGeneration,
  grounding: BriefGrounding,
): VerifiedEntries {
  let dropped = 0;
  const known = (path: string) => grounding.paths.has(path);

  const risks: BriefRisk[] = [];
  for (const risk of output.risks) {
    if (risk.refs.length > 0 && !risk.refs.every((r) => known(r.path))) {
      dropped += 1;
      continue;
    }
    risks.push(risk);
  }

  const review_focus: BriefReviewFocus[] = [];
  for (const entry of output.review_focus) {
    if (!known(entry.ref.path)) {
      dropped += 1;
      continue;
    }
    review_focus.push(entry);
  }

  return { risks, review_focus, dropped };
}
