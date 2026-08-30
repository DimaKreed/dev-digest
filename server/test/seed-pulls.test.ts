import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { CONTROL_EXPERIMENT_PULLS } from '../src/db/seed-pulls.js';

/**
 * The seeded demo PRs have to be REVIEWABLE, not merely present.
 *
 * A patch whose hunk header disagrees with its body still stores fine and still
 * renders fine — it just shifts every new-side line number, so the
 * citation-grounding gate drops findings the reviewer got right. That is
 * invisible in review and shows up much later as an experiment that "did not
 * work". So the fixtures are asserted against the same parser a real run uses,
 * through the same reconstruction `diffFromPrFiles` performs.
 */

/** The three lines `modules/reviews/diff-loader.ts` prepends per file. */
function reconstruct(path: string, patch: string): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, patch].join('\n');
}

describe('seeded demo pull requests', () => {
  it('gives every PR a unique number, since the seed is insert-if-absent by number', () => {
    const numbers = CONTROL_EXPERIMENT_PULLS.map((p) => p.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('parses every file patch to exactly that one file, with at least one hunk', () => {
    for (const pull of CONTROL_EXPERIMENT_PULLS) {
      expect(pull.files.length, `#${pull.number}`).toBeGreaterThan(0);
      for (const file of pull.files) {
        const label = `#${pull.number} ${file.path}`;
        const diff = parseUnifiedDiff(reconstruct(file.path, file.patch));
        expect(diff.files.map((f) => f.path), label).toEqual([file.path]);
        expect(diff.files[0]!.hunks.length, label).toBeGreaterThan(0);
        // Every hunk must cover at least one new-side line, or nothing in this
        // file can ever be cited — the gate would drop every finding on it.
        for (const hunk of diff.files[0]!.hunks) {
          expect(hunk.newLineNumbers.length, label).toBeGreaterThan(0);
        }
      }
    }
  });

  it('carries a patch that already includes its own diff header nowhere', () => {
    // The loader prepends `diff --git` / `---` / `+++`. A patch that repeats
    // them parses as a second file whose path is read off the wrong line.
    for (const pull of CONTROL_EXPERIMENT_PULLS) {
      for (const file of pull.files) {
        expect(file.patch.startsWith('@@'), `#${pull.number} ${file.path}`).toBe(true);
        expect(file.patch, `#${pull.number} ${file.path}`).not.toContain('diff --git');
      }
    }
  });

  it('declares hunk lengths that match the hunk bodies', () => {
    // The header's `-old,len +new,len` is what seeds the parser's line cursor.
    // A mismatch silently renumbers everything after it.
    for (const pull of CONTROL_EXPERIMENT_PULLS) {
      for (const file of pull.files) {
        const label = `#${pull.number} ${file.path}`;
        const lines = file.patch.split('\n');
        let header: { oldLen: number; newLen: number } | null = null;
        let oldSeen = 0;
        let newSeen = 0;

        const check = () => {
          if (!header) return;
          expect(oldSeen, `${label} old length`).toBe(header.oldLen);
          expect(newSeen, `${label} new length`).toBe(header.newLen);
        };

        for (const line of lines) {
          const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
          if (m) {
            check();
            header = { oldLen: m[2] ? Number(m[2]) : 1, newLen: m[4] ? Number(m[4]) : 1 };
            oldSeen = 0;
            newSeen = 0;
            continue;
          }
          if (!header) continue;
          if (line.startsWith('+')) newSeen++;
          else if (line.startsWith('-')) oldSeen++;
          else {
            oldSeen++;
            newSeen++;
          }
        }
        check();
      }
    }
  });

  it('reports additions and deletions that match the patch', () => {
    // These land on the PR row and drive the "+N −M" the UI shows; a fixture
    // whose counters disagree with its own diff teaches the wrong thing.
    for (const pull of CONTROL_EXPERIMENT_PULLS) {
      for (const file of pull.files) {
        const label = `#${pull.number} ${file.path}`;
        const body = file.patch.split('\n').filter((l) => !l.startsWith('@@'));
        const additions = body.filter((l) => l.startsWith('+')).length;
        const deletions = body.filter((l) => l.startsWith('-')).length;
        expect(file.additions, `${label} additions`).toBe(additions);
        expect(file.deletions, `${label} deletions`).toBe(deletions);
      }
    }
  });
});

describe('PR #485 — the prompt-ablation fixture', () => {
  const pr = CONTROL_EXPERIMENT_PULLS.find((p) => p.number === 485)!;

  it('exists and touches both halves of the experiment', () => {
    expect(pr).toBeDefined();
    const paths = pr.files.map((f) => f.path);
    // The four intended `must_find` locations…
    expect(paths).toContain('src/api/public/partner-webhooks.ts');
    expect(paths).toContain('src/api/public/relay.ts');
    expect(paths).toContain('src/api/admin/purge.ts');
    expect(paths).toContain('src/config/partners.ts');
    // …and the four intended `must_not_flag` ones. Without these, precision on
    // the resulting set is permanently 1 and the ablation cannot show up in it.
    expect(paths).toContain('src/config/limits.ts');
    expect(paths).toContain('src/lib/format.ts');
    expect(paths).toContain('test/fixtures/partner.fixture.ts');
    expect(paths).toContain('test/relay.test.ts');
  });

  it('keeps the live-looking secret out of the fixture file and vice versa', () => {
    // The decoy only works if the two prefixes are the right way round.
    const live = pr.files.find((f) => f.path === 'src/config/partners.ts')!;
    const fixture = pr.files.find((f) => f.path === 'test/fixtures/partner.fixture.ts')!;
    expect(live.patch).toContain('whsec_live_');
    expect(fixture.patch).toContain('whsec_test_');
    expect(fixture.patch).not.toContain('whsec_live_');
  });

  it('leaves the verification call in place on the bypass file', () => {
    // If the diff simply deleted `verifySignature`, a keyword scan would catch
    // it and the case would stop discriminating between prompts.
    const bypass = pr.files.find((f) => f.path === 'src/api/public/partner-webhooks.ts')!;
    expect(bypass.patch).toContain('+    verifySignature(raw, signature);');
    expect(bypass.patch).toContain('} catch {');
  });
});
