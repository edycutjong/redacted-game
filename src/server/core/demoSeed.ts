/**
 * Demo-seed planner — the "I am needed" beat made deterministic. PURE.
 *
 * The demo seed cannot simply pre-fill ~61% of the shards: for a rich case, that
 * board already eliminates every non-culprit, so a lone judge's pivot shard is
 * deductively inert (nothing to strike). Instead we plan a board that leaves the
 * authored "crowd-favorite" suspect(s) (`bundle.demo.reserveSuspectIds`) STILL
 * STANDING, with every other non-culprit struck — so filing a reserved pivot
 * shard visibly cracks the case.
 *
 * Construction: for each reserved suspect, keep at least one fact unestablished
 * on every elimination path (a hitting set). Where a path contains a fact a pivot
 * shard can (re)establish, we hold out THAT fact — the reserved pivot then supplies
 * it and completes the path on file. Where no pivot covers a path, we hold out the
 * whole path (a dead hold-out) so the crowd cannot pre-solve it either. Every
 * held-out fact's non-pivot supporting shards are withheld from the board; the rest
 * fill in authored order to the target ratio.
 *
 * Verified against the real cases by lint (demo check) and unit tests.
 */

import type { SealedCaseBundle, TruthSection } from '../cases/types';

export const DEMO_FILL_RATIO = 0.61;

/** factId → true if any pivot shard can establish it. */
const pivotFactSet = (truth: TruthSection, pivots: ReadonlySet<string>): Set<string> => {
  const out = new Set<string>();
  for (const f of truth.facts) if (f.supports.some((s) => pivots.has(s))) out.add(f.id);
  return out;
};

/** shardId → the factIds it supports. */
const shardSupportIndex = (truth: TruthSection): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const f of truth.facts) {
    for (const s of f.supports) {
      const list = out.get(s);
      if (list) list.push(f.id);
      else out.set(s, [f.id]);
    }
  }
  return out;
};

/**
 * Ordered list of shard ids to pre-file for the demo seed. Deterministic +
 * idempotent (a pure function of the bundle). Falls back to a plain ratio fill
 * when the case declares no reserved suspects.
 */
export const planDemoSeed = (bundle: SealedCaseBundle, ratio = DEMO_FILL_RATIO): string[] => {
  const truth = bundle.truth;
  const order = bundle.shards.map((s) => s.id);
  const pivots = new Set(bundle.pivots);
  const reserve = new Set(bundle.demo?.reserveSuspectIds ?? []);
  const target = Math.round(order.length * ratio);

  // Facts to keep unestablished so reserved suspects stay un-struck at the seed.
  const pivotFacts = pivotFactSet(truth, pivots);
  const holdoutFacts = new Set<string>();
  if (reserve.size > 0) {
    for (const elim of truth.eliminations) {
      if (!reserve.has(elim.suspectId)) continue;
      for (const path of elim.paths) {
        const pivotHits = path.filter((f) => pivotFacts.has(f));
        // Prefer to block a pivot-suppliable fact (the pivot re-supplies it on
        // file → strike); otherwise block the whole path (no pivot covers it).
        if (pivotHits.length > 0) for (const f of pivotHits) holdoutFacts.add(f);
        else for (const f of path) holdoutFacts.add(f);
      }
    }
  }

  const supportsOf = shardSupportIndex(truth);
  const heldOut = (shardId: string): boolean =>
    /* v8 ignore next -- every real (linted) case satisfies L2 "no orphan shards": every shard supports >=1 fact, so supportsOf.get() is never undefined for an authored case's shard ids */
    (supportsOf.get(shardId) ?? []).some((f) => holdoutFacts.has(f));

  const pool = order.filter((s) => !pivots.has(s) && !heldOut(s));
  const fill = new Set(pool.slice(0, Math.min(target, pool.length)));

  // Teach the red-string mechanic on sight: light the first contradiction pair
  // (both sides), provided neither side is reserved for a pivot or held out.
  const c0 = bundle.contradictions[0];
  if (c0 && !pivots.has(c0.a) && !pivots.has(c0.b) && !heldOut(c0.a) && !heldOut(c0.b)) {
    fill.add(c0.a);
    fill.add(c0.b);
  }

  return order.filter((s) => fill.has(s));
};
