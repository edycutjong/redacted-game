/**
 * Deterministic shard dealing (invariants I1 + I3).
 *
 * deal(userId, caseId) = shards[H(userId‖caseId) mod space] over the general
 * pool, with a pivot pool reserved for first-seen accounts: while pivots
 * remain, every NEW viewer receives the next pivot shard (drain order), so
 * every new visitor — including every judge — adds board-absent information.
 *
 * This function is PURE: given the same inputs it always returns the same
 * deal. Real-world stability across pool drain is guaranteed by persisting
 * the first deal (store layer, first-write-wins).
 */

import { fnv1a, mulberry32, pickK } from './hash';

export const DEAL_SIZE = 3;

export type DealInput = {
  userId: string;
  caseId: string;
  /** all shard ids in authored order */
  allShardIds: readonly string[];
  /** remaining pivot pool in drain order (subset of allShardIds) */
  pivotQueue: readonly string[];
  /** true if this user has never been dealt shards on this case */
  firstSeen: boolean;
  dealSize?: number;
};

export type DealResult = {
  shardIds: string[];
  /** pivot shard consumed from the pool head, if any */
  pivotTaken: string | null;
};

export const computeDeal = (input: DealInput): DealResult => {
  const size = input.dealSize ?? DEAL_SIZE;
  const pivotSet = new Set(input.pivotQueue);
  const general = input.allShardIds.filter((s) => !pivotSet.has(s));
  const rng = mulberry32(fnv1a(`${input.userId}‖${input.caseId}`));

  if (input.firstSeen && input.pivotQueue.length > 0) {
    const pivot = input.pivotQueue[0]!;
    const rest = pickK(
      general.filter((s) => s !== pivot),
      size - 1,
      rng
    );
    return { shardIds: [pivot, ...rest], pivotTaken: pivot };
  }

  // Pool drained (or returning user who somehow lost their persisted deal):
  // pure hash deal over every shard, pivots included once drained.
  const pool = input.pivotQueue.length > 0 ? general : [...input.allShardIds];
  return { shardIds: pickK(pool, size, rng), pivotTaken: null };
};
