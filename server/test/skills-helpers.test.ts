import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractSkill, splitFrontmatter, SkillImportError } from '../src/modules/skills/helpers.js';
import { MAX_ARCHIVE_ENTRIES } from '../src/modules/skills/constants.js';

/**
 * Hermetic tests for skill import. No DB, no fastify — `extractSkill` is a pure
 * function, which is the whole reason it lives in helpers.ts.
 *
 * The load-bearing case is "an executable entry is never read": that is the
 * product promise behind importing a stranger's skill, so it is asserted on the
 * OUTPUT (never appears in the body) and on the REPORT (surfaces as skipped).
 */

const md = (s: string) => strToU8(s);

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  );
}

const SKILL_BODY = `---
name: flaky-test-detector
description: Flag tests that can fail without a code change.
type: custom
---

# Flaky test detector

Report time-dependent assertions as WARNING.`;

describe('splitFrontmatter', () => {
  it('parses flat key: value pairs and strips the block from the body', () => {
    const { meta, body } = splitFrontmatter(SKILL_BODY);
    expect(meta['name']).toBe('flaky-test-detector');
    expect(meta['type']).toBe('custom');
    expect(body.startsWith('# Flaky test detector')).toBe(true);
    expect(body).not.toContain('---');
  });

  it('leaves a document without frontmatter untouched', () => {
    const text = '# Just a heading\n\nSome prose.';
    expect(splitFrontmatter(text)).toEqual({ meta: {}, body: text });
  });

  it('treats an unterminated frontmatter block as body, not an error', () => {
    const text = '---\nname: broken\n# no closing delimiter';
    expect(splitFrontmatter(text).meta).toEqual({});
    expect(splitFrontmatter(text).body).toBe(text);
  });
});

describe('extractSkill — plain markdown', () => {
  it('reads a .md file and takes name/description/type from frontmatter', () => {
    const out = extractSkill('flaky-test-detector.md', md(SKILL_BODY));
    expect(out.name).toBe('flaky-test-detector');
    expect(out.description).toBe('Flag tests that can fail without a code change.');
    expect(out.type).toBe('custom');
    expect(out.source_file).toBe('flaky-test-detector.md');
    expect(out.skipped).toEqual([]);
  });

  it('falls back to the first heading and paragraph when there is no frontmatter', () => {
    const out = extractSkill('rule.md', md('# No Then Chains\n\nUse async/await here.'));
    expect(out.name).toBe('No Then Chains');
    expect(out.description).toBe('Use async/await here.');
    expect(out.type).toBe('custom'); // DEFAULT_SKILL_TYPE
  });

  it('falls back to the filename when the body has no heading', () => {
    expect(extractSkill('house-rules.md', md('Just prose, no heading.')).name).toBe(
      'house-rules',
    );
  });

  it('rejects an unsupported extension', () => {
    expect(() => extractSkill('skill.exe', md('x'))).toThrow(SkillImportError);
  });

  it('rejects an empty body', () => {
    expect(() => extractSkill('empty.md', md('   \n\n'))).toThrow(SkillImportError);
  });
});

describe('extractSkill — archives', () => {
  it('never reads an executable entry, and reports it as skipped', () => {
    const archive = zip({
      'SKILL.md': SKILL_BODY,
      'scripts/detect.sh': '#!/usr/bin/env bash\necho "PWNED"\n',
      'scripts/install.ps1': 'Write-Host "PWNED"',
    });
    const out = extractSkill('flaky-test-detector.zip', archive);

    // The security property: executable content is nowhere in the result.
    expect(out.body).not.toContain('PWNED');
    expect(out.body).not.toContain('bash');
    expect(out.source_file).toBe('SKILL.md');

    const skipped = Object.fromEntries(out.skipped.map((s) => [s.path, s.reason]));
    expect(skipped).toEqual({
      'scripts/detect.sh': 'executable',
      'scripts/install.ps1': 'executable',
    });
  });

  it('prefers SKILL.md over a shallower sibling markdown file', () => {
    const out = extractSkill(
      'bundle.zip',
      zip({ 'README.md': '# Readme\n\nnope', 'nested/SKILL.md': SKILL_BODY }),
    );
    expect(out.source_file).toBe('nested/SKILL.md');
    expect(out.skipped).toEqual([{ path: 'README.md', reason: 'unused_markdown' }]);
  });

  it('falls back to the shallowest markdown file when there is no SKILL.md', () => {
    const out = extractSkill(
      'bundle.zip',
      zip({ 'docs/deep/notes.md': '# Deep', 'rule.md': '# Shallow\n\nWins.' }),
    );
    expect(out.source_file).toBe('rule.md');
  });

  it('classifies a non-markdown, non-executable entry as not_markdown', () => {
    const out = extractSkill('bundle.zip', zip({ 'SKILL.md': SKILL_BODY, 'logo.png': 'x' }));
    expect(out.skipped).toEqual([{ path: 'logo.png', reason: 'not_markdown' }]);
  });

  it('rejects an archive containing no markdown at all', () => {
    expect(() => extractSkill('bundle.zip', zip({ 'run.sh': 'echo hi' }))).toThrow(
      /No .md file found/,
    );
  });

  it('rejects a path-traversal entry', () => {
    expect(() =>
      extractSkill('evil.zip', zip({ '../../etc/passwd.md': '# nope' })),
    ).toThrow(/Unsafe archive entry path/);
  });

  it('rejects an absolute entry path', () => {
    expect(() => extractSkill('evil.zip', zip({ '/etc/passwd.md': '# nope' }))).toThrow(
      /Unsafe archive entry path/,
    );
  });

  it('rejects an archive with too many entries', () => {
    const many: Record<string, string> = { 'SKILL.md': SKILL_BODY };
    for (let i = 0; i < MAX_ARCHIVE_ENTRIES + 5; i++) many[`f${i}.txt`] = 'x';
    expect(() => extractSkill('bomb.zip', zip(many))).toThrow(/more than/);
  });

  it('rejects an archive that is too large unpacked', () => {
    // One entry declaring >2MB uncompressed. Highly compressible, so the .zip
    // itself stays tiny — exactly the zip-bomb shape the cap exists for.
    const huge = 'a'.repeat(3 * 1024 * 1024);
    expect(() => extractSkill('bomb.zip', zip({ 'SKILL.md': huge }))).toThrow(/too large/);
  });
});
