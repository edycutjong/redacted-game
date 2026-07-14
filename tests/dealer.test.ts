import { describe, expect, it } from 'vitest';
import { computeDeal, DEAL_SIZE, type DealInput } from '../src/server/core/dealer';
import { demoBundle } from './helpers/bundles';

const base = (over: Partial<DealInput> = {}): DealInput => {
  const b = demoBundle();
  return {
    userId: 'u-1',
    caseId: b.public.caseId,
    allShardIds: b.shards.map((s) => s.id),
    pivotQueue: [...b.pivots],
    firstSeen: true,
    ...over,
  };
};

describe('computeDeal — determinism (I1)', () => {
  it('same (user,case) → identical deal', () => {
    expect(computeDeal(base())).toEqual(computeDeal(base()));
  });
  it('different users generally get different deals', () => {
    const a = computeDeal(base({ userId: 'u-a', firstSeen: false, pivotQueue: [] }));
    const b = computeDeal(base({ userId: 'u-b', firstSeen: false, pivotQueue: [] }));
    expect(a.shardIds).not.toEqual(b.shardIds);
  });
  it('honours the requested deal size', () => {
    expect(computeDeal(base({ dealSize: 5, firstSeen: false, pivotQueue: [] })).shardIds).toHaveLength(5);
  });
  it('defaults to DEAL_SIZE', () => {
    expect(computeDeal(base({ firstSeen: false, pivotQueue: [] })).shardIds).toHaveLength(DEAL_SIZE);
  });
  it('deals distinct shards (no duplicates within a deal)', () => {
    const { shardIds } = computeDeal(base());
    expect(new Set(shardIds).size).toBe(shardIds.length);
  });
});

describe('computeDeal — pivot reservation (I3)', () => {
  it('a first-seen account receives the pivot pool head', () => {
    const res = computeDeal(base({ pivotQueue: ['SH31', 'SH13', 'SH16'] }));
    expect(res.pivotTaken).toBe('SH31');
    expect(res.shardIds[0]).toBe('SH31');
  });
  it('the pivot is not duplicated among the remaining picks', () => {
    const res = computeDeal(base({ pivotQueue: ['SH31', 'SH13', 'SH16'] }));
    expect(res.shardIds.filter((s) => s === 'SH31')).toHaveLength(1);
  });
  it('takes no pivot once the pool is drained', () => {
    const res = computeDeal(base({ firstSeen: true, pivotQueue: [] }));
    expect(res.pivotTaken).toBeNull();
  });
  it('a returning viewer (not first-seen) takes no pivot', () => {
    const res = computeDeal(base({ firstSeen: false }));
    expect(res.pivotTaken).toBeNull();
  });
  it('reserves pivots out of the general pool until drained', () => {
    // With pivots stocked, a first-seen deal never includes a non-head pivot by
    // chance in the "rest" picks.
    const res = computeDeal(base({ pivotQueue: ['SH31', 'SH13', 'SH16'] }));
    expect(res.shardIds.slice(1)).not.toContain('SH13');
    expect(res.shardIds.slice(1)).not.toContain('SH16');
  });
});
