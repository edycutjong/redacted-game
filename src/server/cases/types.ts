/**
 * SERVER-ONLY case types. The sealed bundle carries the truth section and the
 * full shard texts; it is written to Redis split across `case:{id}:public` and
 * `case:{id}:truth` and never crosses to the client as a whole.
 *
 * Client code cannot import this module (it lives under src/server and the
 * client bundle has no path to it) — invariant I2 by construction.
 */

import type { PublicCaseBundle } from '../../shared/case';

export type SealedShard = {
  id: string;
  docId: string;
  text: string;
};

export type ContradictionPair = {
  a: string;
  b: string;
  note: string;
};

export type TruthFact = {
  id: string;
  text: string;
  /** shardIds, any ONE of which establishes this fact once on the board */
  supports: string[];
};

export type TruthElimination = {
  suspectId: string;
  /** each path is a conjunction of factIds; any complete path eliminates the suspect */
  paths: string[][];
};

export type TruthSection = {
  culpritId: string;
  motive: string;
  summary: string;
  /** ordered ceremony beats for the verdict reveal */
  reveal: string[];
  facts: TruthFact[];
  eliminations: TruthElimination[];
};

export type SealedCaseBundle = {
  formatVersion: 1;
  public: PublicCaseBundle;
  shards: SealedShard[];
  contradictions: ContradictionPair[];
  /** pivot pool in drain order — reserved for first-seen accounts */
  pivots: string[];
  /**
   * Optional demo-seed directives. `reserveSuspectIds` names the non-culprit
   * suspect(s) the demo seed must leave STANDING at ~61% (the crowd-favorite),
   * so a lone judge's reserved pivot shard visibly strikes them on file. Absent
   * for cases that are never demo-seeded.
   */
  demo?: { reserveSuspectIds: string[] };
  truth: TruthSection;
};
