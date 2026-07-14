/**
 * The deduction engine — single source of truth for "what does the board prove?"
 * Used by the runtime (meter, suspect strikes, drip, verdict) AND by the
 * offline solvability linter, so gameplay and lint can never diverge.
 * Pure module: no platform imports.
 */

import type { TruthFact, TruthElimination, TruthSection } from '../cases/types';

export type BoardSet = ReadonlySet<string>;

export const factEstablished = (fact: TruthFact, board: BoardSet): boolean =>
  fact.supports.some((s) => board.has(s));

export const pathComplete = (
  path: readonly string[],
  factsById: ReadonlyMap<string, TruthFact>,
  board: BoardSet
): boolean =>
  path.every((factId) => {
    const fact = factsById.get(factId);
    return fact !== undefined && factEstablished(fact, board);
  });

export const factIndex = (truth: TruthSection): Map<string, TruthFact> =>
  new Map(truth.facts.map((f) => [f.id, f]));

export const suspectEliminated = (
  elim: TruthElimination | undefined,
  factsById: ReadonlyMap<string, TruthFact>,
  board: BoardSet
): boolean =>
  elim !== undefined && elim.paths.some((p) => pathComplete(p, factsById, board));

/** Set of eliminated suspectIds given the current board. */
export const eliminatedSuspects = (truth: TruthSection, board: BoardSet): Set<string> => {
  const factsById = factIndex(truth);
  const out = new Set<string>();
  for (const elim of truth.eliminations) {
    if (suspectEliminated(elim, factsById, board)) out.add(elim.suspectId);
  }
  return out;
};

/**
 * Truth is reached when every suspect EXCEPT the culprit is eliminated —
 * the culprit uniquely remains. The culprit has no elimination entry by
 * construction (linted), so they can never be struck.
 */
export const truthReached = (
  truth: TruthSection,
  allSuspectIds: readonly string[],
  board: BoardSet
): boolean => {
  const struck = eliminatedSuspects(truth, board);
  return allSuspectIds.every((id) => id === truth.culpritId || struck.has(id));
};
