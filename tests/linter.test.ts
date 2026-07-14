import { describe, expect, it } from 'vitest';
import {
  lintBundle,
  lintDemo,
  lintL1,
  lintL2,
  lintL3,
  MAX_BUNDLE_BYTES,
  MC_TRIALS,
} from '../tools/case-compiler/lint';
import { cloneBundle, loadBundles } from './helpers/bundles';

describe('solvability linter — authored cases all pass', () => {
  for (const b of loadBundles()) {
    describe(`${b.public.caseId} "${b.public.title}"`, () => {
      const report = lintBundle(b);

      it('passes every lint level', () => {
        expect(report.issues).toEqual([]);
        expect(report.ok).toBe(true);
      });

      it(`Monte-Carlo: all ${MC_TRIALS} random 60% deals reach truth`, () => {
        expect(report.monteCarlo.trials).toBe(MC_TRIALS);
        expect(report.monteCarlo.passed).toBe(MC_TRIALS);
        expect(report.monteCarlo.sampleFailures).toEqual([]);
      });

      it('has >= 2 annotated contradiction pairs (L2 drama)', () => {
        expect(b.contradictions.length).toBeGreaterThanOrEqual(2);
      });

      it('has no orphan shards (every shard is on some elimination path)', () => {
        expect(lintL2(b).filter((i) => i.message.includes('orphan'))).toEqual([]);
      });

      it('the culprit has no elimination entry', () => {
        expect(b.truth.eliminations.some((e) => e.suspectId === b.truth.culpritId)).toBe(false);
      });

      it('every non-culprit has >= 2 shard-disjoint elimination combinations', () => {
        expect(lintL1(b).issues).toEqual([]);
      });

      it(`sealed bundle stays under the ${MAX_BUNDLE_BYTES / 1024}KB cap`, () => {
        expect(report.bundleBytes).toBeLessThanOrEqual(MAX_BUNDLE_BYTES);
      });
    });
  }
});

describe('solvability linter — catches broken cases (negative)', () => {
  it('fails when a non-culprit becomes uneliminable', () => {
    const b = cloneBundle(loadBundles()[0]!);
    // Drop an elimination entry → that suspect survives every deal.
    b.truth.eliminations = b.truth.eliminations.slice(1);
    const report = lintBundle(b);
    expect(report.ok).toBe(false);
    expect(report.monteCarlo.passed).toBeLessThan(MC_TRIALS);
  });

  it('fails when a suspect has only one elimination path', () => {
    const b = cloneBundle(loadBundles()[0]!);
    b.truth.eliminations[0]!.paths = [b.truth.eliminations[0]!.paths[0]!];
    expect(lintL1(b).issues.some((i) => i.message.includes('>= 2 elimination paths'))).toBe(true);
  });

  it('fails L2 when there are fewer than two contradiction pairs', () => {
    const b = cloneBundle(loadBundles()[0]!);
    b.contradictions = [b.contradictions[0]!];
    expect(lintL2(b).some((i) => i.message.includes('contradiction pairs'))).toBe(true);
  });

  it('fails L3 when case text contains profanity', () => {
    const b = cloneBundle(loadBundles()[0]!);
    b.shards[0]!.text = 'this shit does not belong in a fictional dossier';
    expect(lintL3(b).some((i) => i.message.includes('profanity'))).toBe(true);
  });

  it('fails L1 when the culprit is given an elimination entry', () => {
    const b = cloneBundle(loadBundles()[0]!);
    b.truth.eliminations.push({ suspectId: b.truth.culpritId, paths: [[b.truth.facts[0]!.id]] });
    expect(lintL1(b).issues.some((i) => i.message.includes('culprit has an elimination entry'))).toBe(true);
  });
});

describe('demo magic-moment lint (LD) — the "I am needed" beat is proven, not hoped', () => {
  const demoOf = () => loadBundles().find((x) => (x.demo?.reserveSuspectIds ?? []).length > 0);

  it('the reserved demo case (#17) passes the demo check', () => {
    const b = demoOf();
    expect(b).toBeDefined();
    expect(lintDemo(b!)).toEqual([]);
  });

  it('fails when no pivot shard can strike the reserved suspect on file', () => {
    const b = cloneBundle(demoOf()!);
    const rid = b.demo!.reserveSuspectIds[0]!;
    const pivotSet = new Set(b.pivots);
    const pivotFacts = new Set(
      b.truth.facts.filter((f) => f.supports.some((s) => pivotSet.has(s))).map((f) => f.id)
    );
    // Strip every elimination path a pivot could complete → the reserved suspect
    // stays standing but no judge shard can ever crack them: the beat is dead.
    const elim = b.truth.eliminations.find((e) => e.suspectId === rid)!;
    elim.paths = elim.paths.filter((p) => p.every((f) => !pivotFacts.has(f)));
    expect(elim.paths.length).toBeGreaterThan(0); // guard: mutation is meaningful
    expect(lintDemo(b).some((i) => i.message.includes('not witnessable'))).toBe(true);
  });
});
