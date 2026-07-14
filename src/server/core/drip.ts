/**
 * Population-elasticity valve — the drip selector. Pure.
 *
 * After hour 12 of a case, one unfiled shard is released to the public board
 * per hour. Selection = maximum information gain:
 *   1. `completes` — number of (suspect, path) pairs this shard would complete
 *      (path currently incomplete, complete after adding the shard);
 *   2. tiebreak `advances` — number of (suspect, path, fact) triples where the
 *      fact is unestablished and this shard supports it (path not yet complete);
 *   3. tiebreak authored shard order (stable, deterministic).
 */

import type { TruthSection } from '../cases/types';
import { factIndex, pathComplete, factEstablished } from './deduction';

export type DripGain = { shardId: string; completes: number; advances: number };

export const informationGain = (
  truth: TruthSection,
  board: ReadonlySet<string>,
  shardId: string
): Omit<DripGain, 'shardId'> => {
  const factsById = factIndex(truth);
  const after = new Set(board);
  after.add(shardId);
  let completes = 0;
  let advances = 0;
  for (const elim of truth.eliminations) {
    for (const path of elim.paths) {
      const wasComplete = pathComplete(path, factsById, board);
      if (wasComplete) continue;
      if (pathComplete(path, factsById, after)) completes++;
      for (const factId of path) {
        const fact = factsById.get(factId);
        /* v8 ignore next -- compile.ts validates every elimination-path factId against factSet at compile time, so an authored (compiled) case can never reference an unknown fact here */
        if (!fact) continue;
        if (!factEstablished(fact, board) && fact.supports.includes(shardId)) {
          advances++;
        }
      }
    }
  }
  return { completes, advances };
};

/** Pick the next shard for the public record, or null if nothing is left to release. */
export const pickDripShard = (
  truth: TruthSection,
  board: ReadonlySet<string>,
  candidates: readonly string[],
  authoredOrder: readonly string[]
): string | null => {
  const order = new Map(authoredOrder.map((s, i) => [s, i]));
  let best: DripGain | null = null;
  for (const shardId of candidates) {
    if (board.has(shardId)) continue;
    const g = informationGain(truth, board, shardId);
    const cand: DripGain = { shardId, ...g };
    if (
      best === null ||
      cand.completes > best.completes ||
      (cand.completes === best.completes && cand.advances > best.advances) ||
      (cand.completes === best.completes &&
        cand.advances === best.advances &&
        (order.get(cand.shardId) ?? Infinity) < (order.get(best.shardId) ?? Infinity))
    ) {
      best = cand;
    }
  }
  return best?.shardId ?? null;
};

/** Hour-12 gate: drip only runs once a case has been open for 12h. */
export const DRIP_START_HOUR = 12;

export const dripHourIndex = (launchTs: number, now: number): number =>
  Math.floor((now - launchTs) / 3_600_000);

export const dripActive = (launchTs: number, now: number): boolean =>
  dripHourIndex(launchTs, now) >= DRIP_START_HOUR;
