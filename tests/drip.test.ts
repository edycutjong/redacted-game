import { describe, expect, it } from 'vitest';
import {
  DRIP_START_HOUR,
  dripActive,
  dripHourIndex,
  informationGain,
  pickDripShard,
} from '../src/server/core/drip';
import { computeDeal } from '../src/server/core/dealer';
import { truthReached } from '../src/server/core/deduction';
import { loadBundles } from './helpers/bundles';

describe('drip gating (hour-12 valve)', () => {
  const launch = 1_000_000_000_000;
  it('is inactive before DRIP_START_HOUR', () => {
    expect(dripActive(launch, launch + (DRIP_START_HOUR - 1) * 3_600_000)).toBe(false);
  });
  it('activates at DRIP_START_HOUR', () => {
    expect(dripActive(launch, launch + DRIP_START_HOUR * 3_600_000)).toBe(true);
  });
  it('reports an increasing hour index', () => {
    expect(dripHourIndex(launch, launch + 13 * 3_600_000)).toBe(13);
  });
});

describe('information gain — already-complete paths contribute zero gain', () => {
  for (const b of loadBundles()) {
    it(`${b.public.caseId}: a shard cannot re-complete a path that is already complete`, () => {
      const elim = b.truth.eliminations[0]!;
      const path = elim.paths[0]!;
      // Fully establish every fact on this path first.
      const board = new Set(path.map((fid) => b.truth.facts.find((f) => f.id === fid)!.supports[0]!));
      // Any other unfiled shard: the path was already complete beforehand, so
      // it contributes nothing to `completes` for this already-solved path.
      const other = b.shards.map((s) => s.id).find((s) => !board.has(s))!;
      const before = board.has(other) ? board : board;
      void before;
      const g = informationGain(b.truth, board, other);
      // completes only counts paths that flip from incomplete->complete; this
      // one was already complete, so it cannot be counted again.
      expect(g.completes).toBe(0);
    });
  }
});

describe('pickDripShard ignores a candidate that is already on the board', () => {
  it('skips an already-filed candidate defensively, even if the caller forgot to pre-filter', () => {
    const b = loadBundles()[0]!;
    const order = b.shards.map((s) => s.id);
    const board = new Set(order.slice(0, 3));
    // Deliberately include an on-board shard in the candidates list.
    const candidates = [order[0]!, ...order.filter((s) => !board.has(s))];
    const pick = pickDripShard(b.truth, board, candidates, order);
    expect(pick).not.toBeNull();
    expect(board.has(pick!)).toBe(false);
  });
});

describe('information gain + selection', () => {
  for (const b of loadBundles()) {
    it(`${b.public.caseId}: a shard that completes a path has positive gain`, () => {
      const elim = b.truth.eliminations[0]!;
      const path = elim.paths[0]!;
      const supports = path.map((fid) => b.truth.facts.find((f) => f.id === fid)!.supports[0]!);
      const missing = supports[supports.length - 1]!;
      const board = new Set(supports.slice(0, -1));
      const g = informationGain(b.truth, board, missing);
      expect(g.completes + g.advances).toBeGreaterThan(0);
    });

    it(`${b.public.caseId}: pickDripShard only returns an unfiled candidate`, () => {
      const order = b.shards.map((s) => s.id);
      const board = new Set(order.slice(0, 5));
      const candidates = order.filter((s) => !board.has(s));
      const pick = pickDripShard(b.truth, board, candidates, order);
      expect(pick).not.toBeNull();
      expect(board.has(pick!)).toBe(false);
    });

    it(`${b.public.caseId}: returns null when there is nothing left to release`, () => {
      const order = b.shards.map((s) => s.id);
      expect(pickDripShard(b.truth, new Set(order), [], order)).toBeNull();
    });
  }
});

/**
 * Population-elasticity valve (COMPLEXITY §5): a case must close at ANY community
 * size. Small communities under-cover the shard space from filing alone, so the
 * hourly drip has to carry them to truth. We assert closure for 10 / 100 / 1000
 * players against every authored case.
 */
describe('drip closes every case at 10 / 100 / 1000 players', () => {
  const fileBoard = (b: ReturnType<typeof loadBundles>[number], players: number): Set<string> => {
    const board = new Set<string>();
    const all = b.shards.map((s) => s.id);
    for (let i = 0; i < players; i++) {
      const deal = computeDeal({
        userId: `sim-${i}`,
        caseId: b.public.caseId,
        allShardIds: all,
        pivotQueue: [],
        firstSeen: false,
      });
      for (const s of deal.shardIds) board.add(s);
    }
    return board;
  };

  const dripToClose = (b: ReturnType<typeof loadBundles>[number], board: Set<string>): number => {
    const order = b.shards.map((s) => s.id);
    const suspects = b.public.suspects.map((s) => s.id);
    let steps = 0;
    while (!truthReached(b.truth, suspects, board) && steps <= order.length) {
      const candidates = order.filter((s) => !board.has(s));
      const pick = pickDripShard(b.truth, board, candidates, order);
      if (pick === null) break;
      board.add(pick);
      steps++;
    }
    return steps;
  };

  for (const b of loadBundles()) {
    for (const players of [10, 100, 1000]) {
      it(`${b.public.caseId} closes with ${players} players`, () => {
        const board = fileBoard(b, players);
        dripToClose(b, board);
        expect(truthReached(b.truth, b.public.suspects.map((s) => s.id), board)).toBe(true);
      });
    }

    it(`${b.public.caseId}: a 10-player board genuinely needs the valve (or already closes)`, () => {
      const board = fileBoard(b, 10);
      const suspects = b.public.suspects.map((s) => s.id);
      const before = truthReached(b.truth, suspects, board);
      const steps = dripToClose(b, board);
      // Either it closed from filing (before) or the drip finished the job.
      expect(before || steps > 0).toBe(true);
      expect(truthReached(b.truth, suspects, board)).toBe(true);
    });
  }
});
