import { describe, expect, it } from 'vitest';
import { litContradictions, newlyLitBy } from '../src/server/core/contradictions';
import type { ContradictionPair } from '../src/server/cases/types';
import { demoBundle } from './helpers/bundles';

const pairs: ContradictionPair[] = [
  { a: 'X1', b: 'X2', note: 'first' },
  { a: 'Y1', b: 'Y2', note: 'second' },
];

describe('litContradictions', () => {
  it('lights a pair only when BOTH sides are on the board', () => {
    expect(litContradictions(pairs, new Set(['X1']))).toHaveLength(0);
    expect(litContradictions(pairs, new Set(['X1', 'X2']))).toHaveLength(1);
  });
  it('lights multiple independent pairs', () => {
    expect(litContradictions(pairs, new Set(['X1', 'X2', 'Y1', 'Y2']))).toHaveLength(2);
  });
});

describe('newlyLitBy', () => {
  it('reports a pair only the moment its second side is added', () => {
    const before = new Set(['X1']);
    const lit = newlyLitBy(pairs, before, 'X2');
    expect(lit).toHaveLength(1);
    expect(lit[0]!.note).toBe('first');
  });
  it('does not re-report a pair already lit', () => {
    const before = new Set(['X1', 'X2']);
    expect(newlyLitBy(pairs, before, 'Y1')).toHaveLength(0);
  });
  it('only reports pairs the added shard participates in', () => {
    const before = new Set(['X1', 'Y1']);
    expect(newlyLitBy(pairs, before, 'X2').every((p) => p.a === 'X2' || p.b === 'X2')).toBe(true);
  });
  it('authored demo case has a real, lightable first pair', () => {
    const b = demoBundle();
    const p = b.contradictions[0]!;
    expect(litContradictions(b.contradictions, new Set([p.a, p.b])).length).toBeGreaterThanOrEqual(1);
  });
});
