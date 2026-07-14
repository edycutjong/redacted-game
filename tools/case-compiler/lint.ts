/**
 * Solvability linter — content quality as a build-time guarantee.
 *
 * L1 (solvability): every non-culprit suspect eliminable by >= 2 INDEPENDENT
 *     (shard-disjoint) combinations, and a seeded Monte-Carlo proves 1,000
 *     random 60% deals all reach the truth (all non-culprits eliminated).
 * L2 (drama):     >= 2 annotated contradiction pairs; no orphan shards —
 *     every shard participates in some elimination path.
 * L3 (safety):    profanity/link/real-user-resemblance filter over all case
 *     text; sealed bundle must stay <= 200KB.
 *
 * The MC uses the SAME deduction engine as the runtime (src/server/core),
 * and a fixed seed per case — lint results are deterministic in CI.
 */

import type { SealedCaseBundle, TruthFact } from '../../src/server/cases/types';
import { truthReached, eliminatedSuspects } from '../../src/server/core/deduction';
import { planDemoSeed } from '../../src/server/core/demoSeed';
import { fnv1a, mulberry32, pickK } from '../../src/server/core/hash';
import { textViolations } from '../../src/server/core/filters';
import type { LintIssue, LintReport } from './types';

export const MC_TRIALS = 1000;
export const MC_DEAL_RATIO = 0.6;
export const MAX_BUNDLE_BYTES = 200 * 1024;
const MAX_COMPLETIONS_PER_PATH = 4000;

/** All concrete shard-combinations (one support per fact) completing a path. */
const completionsOfPath = (
  path: readonly string[],
  factsById: ReadonlyMap<string, TruthFact>
): string[][] => {
  let acc: string[][] = [[]];
  for (const factId of path) {
    const fact = factsById.get(factId);
    if (!fact || fact.supports.length === 0) return [];
    const next: string[][] = [];
    for (const partial of acc) {
      for (const s of fact.supports) {
        if (next.length >= MAX_COMPLETIONS_PER_PATH) break;
        next.push(partial.includes(s) ? partial : [...partial, s]);
      }
    }
    acc = next;
  }
  return acc;
};

const disjoint = (a: readonly string[], b: readonly string[]): boolean => {
  const set = new Set(a);
  return b.every((x) => !set.has(x));
};

export const lintL1 = (bundle: SealedCaseBundle): {
  issues: LintIssue[];
  monteCarlo: LintReport['monteCarlo'];
} => {
  const issues: LintIssue[] = [];
  const truth = bundle.truth;
  const factsById = new Map(truth.facts.map((f) => [f.id, f]));
  const suspectIds = bundle.public.suspects.map((s) => s.id);

  // -- structural: culprit uneliminable, everyone else covered --
  if (truth.eliminations.some((e) => e.suspectId === truth.culpritId)) {
    issues.push({ level: 'L1', message: 'culprit has an elimination entry' });
  }
  for (const id of suspectIds) {
    if (id === truth.culpritId) continue;
    const elim = truth.eliminations.find((e) => e.suspectId === id);
    if (!elim) {
      issues.push({ level: 'L1', message: `suspect ${id}: no elimination entry` });
      continue;
    }
    if (elim.paths.length < 2) {
      issues.push({ level: 'L1', message: `suspect ${id}: needs >= 2 elimination paths` });
    }
    // >= 2 pairwise shard-disjoint completions (independence)
    const all: string[][] = [];
    for (const p of elim.paths) all.push(...completionsOfPath(p, factsById));
    let independent = false;
    outer: for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (disjoint(all[i]!, all[j]!)) {
          independent = true;
          break outer;
        }
      }
    }
    if (!independent) {
      issues.push({
        level: 'L1',
        message: `suspect ${id}: no two shard-disjoint elimination combinations`,
      });
    }
  }

  // -- seeded Monte-Carlo: 1,000 random 60% deals all reach truth --
  const allShards = bundle.shards.map((s) => s.id);
  const dealSize = Math.ceil(allShards.length * MC_DEAL_RATIO);
  const rng = mulberry32(fnv1a(`mc‖${bundle.public.caseId}`));
  let passed = 0;
  const sampleFailures: string[] = [];
  for (let t = 0; t < MC_TRIALS; t++) {
    const subset = new Set(pickK(allShards, dealSize, rng));
    if (truthReached(truth, suspectIds, subset)) {
      passed++;
    } else if (sampleFailures.length < 5) {
      const struck = new Set(
        truth.eliminations
          .filter((e) =>
            e.paths.some((p) =>
              p.every((fid) => factsById.get(fid)?.supports.some((s) => subset.has(s)))
            )
          )
          .map((e) => e.suspectId)
      );
      const alive = suspectIds.filter((s) => s !== truth.culpritId && !struck.has(s));
      sampleFailures.push(`trial ${t}: uneliminated ${alive.join(',')}`);
    }
  }
  if (passed !== MC_TRIALS) {
    issues.push({
      level: 'L1',
      message: `Monte-Carlo: only ${passed}/${MC_TRIALS} random ${Math.round(
        MC_DEAL_RATIO * 100
      )}% deals reach truth`,
    });
  }

  return { issues, monteCarlo: { trials: MC_TRIALS, passed, sampleFailures } };
};

export const lintL2 = (bundle: SealedCaseBundle): LintIssue[] => {
  const issues: LintIssue[] = [];
  if (bundle.contradictions.length < 2) {
    issues.push({
      level: 'L2',
      message: `needs >= 2 contradiction pairs (has ${bundle.contradictions.length})`,
    });
  }
  const seen = new Set<string>();
  for (const p of bundle.contradictions) {
    const key = [p.a, p.b].sort().join('|');
    if (seen.has(key)) issues.push({ level: 'L2', message: `duplicate contradiction ${key}` });
    seen.add(key);
  }

  // no orphan shards: every shard supports >= 1 fact used by >= 1 path
  const usedFacts = new Set<string>();
  for (const e of bundle.truth.eliminations) {
    for (const p of e.paths) for (const f of p) usedFacts.add(f);
  }
  for (const f of bundle.truth.facts) {
    if (!usedFacts.has(f.id)) {
      issues.push({ level: 'L2', message: `fact ${f.id} not used by any elimination path` });
    }
    if (f.supports.length === 0) {
      issues.push({ level: 'L2', message: `fact ${f.id} has no supporting shards` });
    }
  }
  const supportingShards = new Set<string>();
  for (const f of bundle.truth.facts) {
    if (!usedFacts.has(f.id)) continue;
    for (const s of f.supports) supportingShards.add(s);
  }
  for (const s of bundle.shards) {
    if (!supportingShards.has(s.id)) {
      issues.push({
        level: 'L2',
        message: `orphan shard ${s.id}: participates in no elimination path`,
      });
    }
  }
  return issues;
};

export const lintL3 = (bundle: SealedCaseBundle): LintIssue[] => {
  const issues: LintIssue[] = [];
  const scan = (text: string, where: string): void => {
    for (const v of textViolations(text, where)) issues.push({ level: 'L3', message: v });
  };
  const pub = bundle.public;
  scan(pub.title, 'title');
  scan(pub.tagline, 'tagline');
  scan(pub.question, 'question');
  scan(pub.era, 'era');
  for (const s of pub.suspects) {
    scan(s.name, `suspect ${s.id} name`);
    scan(s.blurb, `suspect ${s.id} blurb`);
  }
  for (const d of pub.docs) {
    scan(d.title, `doc ${d.id} title`);
    for (const line of d.lines) {
      if (line.kind === 'text') scan(line.text, `doc ${d.id} line`);
    }
  }
  for (const s of bundle.shards) scan(s.text, `shard ${s.id}`);
  for (const p of bundle.contradictions) scan(p.note, `contradiction ${p.a}/${p.b}`);
  scan(bundle.truth.motive, 'truth.motive');
  scan(bundle.truth.summary, 'truth.summary');
  for (const [i, beat] of bundle.truth.reveal.entries()) scan(beat, `truth.reveal[${i}]`);
  for (const f of bundle.truth.facts) scan(f.text, `fact ${f.id}`);

  const bytes = Buffer.byteLength(JSON.stringify(bundle), 'utf8');
  if (bytes > MAX_BUNDLE_BYTES) {
    issues.push({
      level: 'L3',
      message: `bundle is ${bytes} bytes (> ${MAX_BUNDLE_BYTES} limit)`,
    });
  }
  return issues;
};

/**
 * LD (demo): when a case declares `demo.reserveSuspectIds`, prove the witnessable
 * "I am needed" beat holds on the planned demo seed — the reserved crowd-favorite
 * is NOT already eliminated (a pivot would be inert), and at least one pivot shard
 * strikes each reserved suspect when filed. The magic moment becomes a build-time
 * guarantee, the same way solvability already is.
 */
export const lintDemo = (bundle: SealedCaseBundle): LintIssue[] => {
  const issues: LintIssue[] = [];
  const reserve = bundle.demo?.reserveSuspectIds ?? [];
  if (reserve.length === 0) return issues;

  const seedBoard = new Set(planDemoSeed(bundle));
  const struckAtSeed = eliminatedSuspects(bundle.truth, seedBoard);
  for (const sid of reserve) {
    if (struckAtSeed.has(sid)) {
      issues.push({
        level: 'L1',
        message: `demo: reserved suspect ${sid} is already eliminated at the seed — a judge's pivot would be inert`,
      });
      continue;
    }
    const strikeable = bundle.pivots.some((p) => {
      const after = new Set(seedBoard);
      after.add(p);
      return eliminatedSuspects(bundle.truth, after).has(sid);
    });
    if (!strikeable) {
      issues.push({
        level: 'L1',
        message: `demo: no pivot shard strikes reserved suspect ${sid} on file — the magic moment is not witnessable`,
      });
    }
  }
  return issues;
};

export const lintBundle = (bundle: SealedCaseBundle): LintReport => {
  const l1 = lintL1(bundle);
  const issues = [...l1.issues, ...lintL2(bundle), ...lintL3(bundle), ...lintDemo(bundle)];
  return {
    caseId: bundle.public.caseId,
    ok: issues.length === 0,
    issues,
    monteCarlo: l1.monteCarlo,
    bundleBytes: Buffer.byteLength(JSON.stringify(bundle), 'utf8'),
  };
};
