#!/usr/bin/env node
/**
 * Submission readiness gate for REDACTED.
 *
 * Runs every hard gate (type-check, tests, solvability lint, build) and checks
 * that the required deliverables exist. Exits non-zero if anything fails, so it
 * can guard a commit / a "record the video now" moment.
 *
 *   npm run check:submission
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const record = (name, ok, detail = '') => checks.push({ name, ok, detail });

const run = (name, cmd) => {
  try {
    const out = execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    record(name, true, cmd);
    return out;
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').slice(-4).join(' | ');
    record(name, false, out || cmd);
    return '';
  }
};

const fileExists = (name, rel) => record(name, existsSync(join(root, rel)), rel);

console.log('REDACTED — submission readiness\n');

// ---- hard gates ----
run('type-check (tsc --noEmit)', 'npm run --silent type-check');
const testOut = run('tests (vitest run)', 'npm test --silent');
const lintOut = run('solvability lint (all cases)', 'npm run --silent lint:cases');
run('build (vite → dist)', 'npm run --silent build');

// ---- build outputs ----
fileExists('dist/client/splash.html', 'dist/client/splash.html');
fileExists('dist/client/game.html', 'dist/client/game.html');
fileExists('dist/server/index.cjs', 'dist/server/index.cjs');

// ---- compiled cases + registry ----
for (const id of ['case-017', 'case-018', 'case-019']) {
  fileExists(`compiled ${id}`, `cases/compiled/${id}.bundle.json`);
}
fileExists('generated case registry', 'src/server/cases/registry.ts');

// ---- required deliverables ----
for (const [name, rel] of [
  ['README.md', 'README.md'],
  ['cases/README.md (Forge guide)', 'cases/README.md'],
  ['DEMO.md', 'DEMO.md'],
  ['docs/friction-log.md', 'docs/friction-log.md'],
  ['devvit.json', 'devvit.json'],
  ['server entry', 'src/server/index.ts'],
  ['client entry', 'src/client/main.tsx'],
]) {
  fileExists(name, rel);
}

// ---- content assertions ----
if (existsSync(join(root, 'README.md'))) {
  const first = readFileSync(join(root, 'README.md'), 'utf8').split('\n')[0].trim();
  record(
    'README opening line',
    first === 'not trivia — closed-world deduction; zero AI, handcrafted linted cases',
    first
  );
}
record('lint reports MC 1000/1000', /MC 1000\/1000/.test(lintOut) && !/✗/.test(lintOut), 'all cases solvable');
const testMatch = testOut.match(/Tests\s+(\d+)\s+passed/);
record('test count', Boolean(testMatch), testMatch ? `${testMatch[1]} passed` : 'could not parse count');

// ---- report ----
console.log('');
let failed = 0;
for (const c of checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : `  — ${c.detail}`}`);
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed > 0) {
  console.error(`\n${failed} check(s) failed — not submission-ready.`);
  process.exit(1);
}
console.log('\nAll gates green. Remaining human step: devvit login + playtest (see README “First playtest checklist”).');
