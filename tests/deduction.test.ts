import { describe, expect, it } from 'vitest';
import {
  eliminatedSuspects,
  factEstablished,
  factIndex,
  pathComplete,
  truthReached,
} from '../src/server/core/deduction';
import { loadBundles } from './helpers/bundles';

const allShards = (b: ReturnType<typeof loadBundles>[number]): Set<string> =>
  new Set(b.shards.map((s) => s.id));

describe('deduction engine — per authored case', () => {
  for (const b of loadBundles()) {
    const suspects = b.public.suspects.map((s) => s.id);
    const nonCulprit = suspects.filter((s) => s !== b.truth.culpritId);

    describe(b.public.caseId, () => {
      it('the empty board eliminates no one', () => {
        expect(eliminatedSuspects(b.truth, new Set()).size).toBe(0);
        expect(truthReached(b.truth, suspects, new Set())).toBe(false);
      });

      it('the full board eliminates every non-culprit and reaches truth', () => {
        const board = allShards(b);
        const struck = eliminatedSuspects(b.truth, board);
        for (const id of nonCulprit) expect(struck.has(id)).toBe(true);
        expect(struck.has(b.truth.culpritId)).toBe(false);
        expect(truthReached(b.truth, suspects, board)).toBe(true);
      });

      it('the culprit is never eliminated (uneliminable by construction)', () => {
        expect(eliminatedSuspects(b.truth, allShards(b)).has(b.truth.culpritId)).toBe(false);
      });

      it('factEstablished needs at least one supporting shard on the board', () => {
        const withSupport = b.truth.facts.find((f) => f.supports.length > 0)!;
        expect(factEstablished(withSupport, new Set())).toBe(false);
        expect(factEstablished(withSupport, new Set([withSupport.supports[0]!]))).toBe(true);
      });

      it('pathComplete requires every fact on the path to be established', () => {
        const idx = factIndex(b.truth);
        const elim = b.truth.eliminations[0]!;
        const path = elim.paths[0]!;
        expect(pathComplete(path, idx, new Set())).toBe(false);
        const full = new Set(path.flatMap((fid) => idx.get(fid)!.supports));
        expect(pathComplete(path, idx, full)).toBe(true);
      });
    });
  }
});
