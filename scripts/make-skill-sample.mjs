#!/usr/bin/env node
/**
 * Pack a folder under docs/skill-samples/ into an importable .zip.
 *
 * The archive is a build artifact, not a source file — the unpacked folder is
 * what lives in git (so its contents are reviewable), and the .zip is produced
 * on demand for the import demo.
 *
 *   node scripts/make-skill-sample.mjs flaky-test-detector
 *   → docs/skill-samples/flaky-test-detector.zip
 *
 * Uses `fflate` (already a server dependency) rather than the `zip` binary,
 * which is not present on a stock Windows dev box.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] ?? 'flaky-test-detector';
const src = join(root, 'docs', 'skill-samples', name);
const out = join(root, 'docs', 'skill-samples', `${name}.zip`);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const { zipSync } = await import(
  pathToFileURL(join(root, 'server', 'node_modules', 'fflate', 'esm', 'browser.js')).href
).catch(() => {
  console.error('fflate not found — run `pnpm install` in server/ first.');
  process.exit(1);
});

let files;
try {
  files = walk(src);
} catch {
  console.error(`No such sample: ${src}`);
  process.exit(1);
}

// Entries are relative to the sample folder (SKILL.md, scripts/…), so the
// preview reads cleanly without a leading directory. Always forward slashes:
// a backslash in a zip entry name is not portable.
const entries = Object.fromEntries(
  files.map((f) => [relative(src, f).split('\\').join('/'), new Uint8Array(readFileSync(f))]),
);

writeFileSync(out, zipSync(entries));
console.log(`✓ ${relative(root, out)}`);
for (const path of Object.keys(entries)) console.log(`    ${path}`);
