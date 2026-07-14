/** Compile the authored YAML cases at test time (also exercises the compiler). */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compileCase, parseYamlCase } from '../../tools/case-compiler/compile';
import type { SealedCaseBundle } from '../../src/server/cases/types';

const casesDir = join(process.cwd(), 'cases');

let cache: SealedCaseBundle[] | null = null;

export const loadBundles = (): SealedCaseBundle[] => {
  if (cache) return cache;
  const files = readdirSync(casesDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();
  cache = files.map((f) => compileCase(parseYamlCase(readFileSync(join(casesDir, f), 'utf8'))));
  return cache;
};

export const bundleByNumber = (n: number): SealedCaseBundle => {
  const b = loadBundles().find((x) => x.public.number === n);
  if (!b) throw new Error(`no compiled bundle #${n}`);
  return b;
};

/** The engineered demo case (#17 — The Larchmont Fire). */
export const demoBundle = (): SealedCaseBundle => bundleByNumber(17);

/** A cheap deep clone so a test can mutate a bundle without touching the cache. */
export const cloneBundle = (b: SealedCaseBundle): SealedCaseBundle =>
  JSON.parse(JSON.stringify(b)) as SealedCaseBundle;
