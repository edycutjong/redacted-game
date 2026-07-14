/**
 * Contradiction computer — red string is computed, not moderated.
 * A pair lights up when BOTH sides are on the public board. Pure.
 */

import type { ContradictionPair } from '../cases/types';

export type LitPair = ContradictionPair;

export const litContradictions = (
  pairs: readonly ContradictionPair[],
  board: ReadonlySet<string>
): LitPair[] => pairs.filter((p) => board.has(p.a) && board.has(p.b));

/** Pairs newly lit by adding `shardId` to the board (for the FILED stamp moment). */
export const newlyLitBy = (
  pairs: readonly ContradictionPair[],
  boardBefore: ReadonlySet<string>,
  shardId: string
): LitPair[] => {
  const after = new Set(boardBefore);
  after.add(shardId);
  const litBefore = new Set(
    litContradictions(pairs, boardBefore).map((p) => `${p.a}|${p.b}`)
  );
  return litContradictions(pairs, after).filter(
    (p) => !litBefore.has(`${p.a}|${p.b}`) && (p.a === shardId || p.b === shardId)
  );
};
