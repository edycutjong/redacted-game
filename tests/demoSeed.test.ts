/**
 * planDemoSeed — synthetic bundles targeting branches the 3 authored (linted)
 * cases never happen to exercise: no `demo` block at all (plain ratio fill),
 * and a first contradiction pair that overlaps a reserved pivot shard (so the
 * "light it on sight" shortcut must NOT fire, or it would spoil the pivot).
 */
import { describe, expect, it } from 'vitest';
import { planDemoSeed } from '../src/server/core/demoSeed';
import type { SealedCaseBundle } from '../src/server/cases/types';
import { demoBundle } from './helpers/bundles';

const basePublic = (): SealedCaseBundle['public'] => ({
  caseId: 'case-synthetic',
  number: 999,
  title: 'Synthetic',
  tagline: 't',
  author: 'a',
  era: 'e',
  question: 'q',
  totalShards: 4,
  docs: [],
  suspects: [
    { id: 'S1', name: 'One', blurb: '' },
    { id: 'S2', name: 'Two', blurb: '' },
  ],
});

describe('planDemoSeed — no demo block (plain ratio fill)', () => {
  it('falls back to a plain ratio fill and still lights the first contradiction', () => {
    const bundle: SealedCaseBundle = {
      formatVersion: 1,
      public: basePublic(),
      shards: [
        { id: 'A', docId: 'D1', text: 'a' },
        { id: 'B', docId: 'D1', text: 'b' },
        { id: 'C', docId: 'D1', text: 'c' },
        { id: 'D', docId: 'D1', text: 'd' },
      ],
      contradictions: [{ a: 'A', b: 'B', note: 'n' }],
      pivots: ['D'],
      // no `demo` field at all
      truth: {
        culpritId: 'S1',
        motive: 'm',
        summary: 's',
        reveal: [],
        facts: [{ id: 'F1', text: 'f', supports: ['C'] }],
        eliminations: [{ suspectId: 'S2', paths: [['F1']] }],
      },
    };
    const plan = planDemoSeed(bundle);
    // A and B (the first contradiction pair) are lit because neither is the
    // pivot and neither is held out (no reserve => no holdouts at all).
    expect(plan).toContain('A');
    expect(plan).toContain('B');
    // The pivot itself is never pre-filled.
    expect(plan).not.toContain('D');
  });
});

describe('planDemoSeed — first contradiction pair overlaps a reserved pivot', () => {
  it('does NOT light the contradiction shortcut when a pivot shard is one side of it', () => {
    const bundle: SealedCaseBundle = {
      formatVersion: 1,
      public: basePublic(),
      shards: [
        { id: 'A', docId: 'D1', text: 'a' },
        { id: 'B', docId: 'D1', text: 'b' },
        { id: 'C', docId: 'D1', text: 'c' },
      ],
      // A is BOTH the reserved pivot and one side of the first contradiction.
      contradictions: [{ a: 'A', b: 'B', note: 'n' }],
      pivots: ['A'],
      demo: { reserveSuspectIds: ['S2'] },
      truth: {
        culpritId: 'S1',
        motive: 'm',
        summary: 's',
        reveal: [],
        facts: [{ id: 'F1', text: 'f', supports: ['C'] }],
        eliminations: [{ suspectId: 'S2', paths: [['F1']] }],
      },
    };
    const plan = planDemoSeed(bundle);
    // The contradiction shortcut itself does not fire (A is a pivot, so the
    // guard is false) — B still ends up filled, but via the ordinary ratio
    // pool-fill, not the "light it on sight" shortcut. The pivot A is never
    // pre-filled by either path.
    expect(plan).toContain('B');
    expect(plan).not.toContain('A');
  });
});

describe('planDemoSeed — real demo case sanity (case-017)', () => {
  it('is deterministic across repeated calls', () => {
    const b = demoBundle();
    expect(planDemoSeed(b)).toEqual(planDemoSeed(b));
  });
});
