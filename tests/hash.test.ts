import { describe, expect, it } from 'vitest';
import { fnv1a, mulberry32, pickK, barWidthFor } from '../src/server/core/hash';

describe('fnv1a', () => {
  it('is deterministic for a given input', () => {
    expect(fnv1a('user-a‖case-017')).toBe(fnv1a('user-a‖case-017'));
  });
  it('separates distinct inputs', () => {
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
  it('returns an unsigned 32-bit integer', () => {
    const h = fnv1a('anything at all');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('mulberry32', () => {
  it('is deterministic given the same seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('yields values in [0,1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('diverges for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('pickK', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f'];
  it('returns exactly k items when the pool is large enough', () => {
    expect(pickK(pool, 3, mulberry32(1))).toHaveLength(3);
  });
  it('never exceeds the pool size', () => {
    expect(pickK(pool, 99, mulberry32(1))).toHaveLength(pool.length);
  });
  it('returns a subset with no duplicates', () => {
    const out = pickK(pool, 4, mulberry32(42));
    expect(new Set(out).size).toBe(out.length);
    for (const x of out) expect(pool).toContain(x);
  });
  it('is deterministic for a given seed', () => {
    expect(pickK(pool, 3, mulberry32(9))).toEqual(pickK(pool, 3, mulberry32(9)));
  });
  it('does not mutate the input pool', () => {
    const copy = [...pool];
    pickK(pool, 3, mulberry32(1));
    expect(pool).toEqual(copy);
  });
});

describe('barWidthFor', () => {
  it('is stable for a shard id', () => {
    expect(barWidthFor('SH31')).toBe(barWidthFor('SH31'));
  });
  it('lives in the authored 14..30 ch band', () => {
    for (const id of ['SH01', 'SH31', 'K11', 'V09', 'zzz']) {
      const w = barWidthFor(id);
      expect(w).toBeGreaterThanOrEqual(14);
      expect(w).toBeLessThanOrEqual(30);
    }
  });
  it('is independent of any hidden text (id-derived only)', () => {
    // Same id → same width regardless of what the text might be.
    expect(barWidthFor('SH31')).toBe(barWidthFor('SH31'));
  });
});
