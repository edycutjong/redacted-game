/**
 * PUBLIC case types — everything in this file is serializable to clients.
 *
 * The truth section of a case bundle is split off at COMPILE time by
 * tools/case-compiler and lives in a server-only type (src/server/cases/types.ts).
 * Nothing here may reference it. This is invariant I2 by construction.
 */

/** A line inside a dossier document. Either plain public text or a censored shard slot. */
export type DocLine =
  | { kind: 'text'; text: string }
  | { kind: 'shard'; shardId: string; barWidth: number };

export type PublicDoc = {
  id: string;
  title: string;
  lines: DocLine[];
};

export type PublicSuspect = {
  id: string;
  name: string;
  blurb: string;
};

/** Compile-time public half of a sealed case bundle. Contains zero truth fields. */
export type PublicCaseBundle = {
  caseId: string;
  number: number;
  title: string;
  tagline: string;
  author: string;
  era: string;
  question: string;
  totalShards: number;
  docs: PublicDoc[];
  suspects: PublicSuspect[];
};

/** How a shard slot renders in the dossier for the current viewer. */
export type ShardVisibility =
  | 'censored' /* black bar — nobody (that you know of) has it */
  | 'mine' /* dealt to the current viewer, peelable */
  | 'board' /* filed by the crowd — unredacted */
  | 'public'; /* released by the drip valve — PUBLIC RECORD */

export type ShardView = {
  shardId: string;
  visibility: ShardVisibility;
  /** Only present when visibility !== 'censored'. Never present for undealt+unfiled shards. */
  text?: string;
  /** Bar width in ch units, derived from a hash — NOT from the hidden text length. */
  barWidth: number;
  /** Username of first filer, when visibility === 'board'. */
  filedBy?: string;
};

export type BoardCard = {
  shardId: string;
  text: string;
  author: string;
  ts: number;
  /** citation count carried over from closed cases + live cites */
  cites: number;
  via: 'user' | 'app' | 'none';
  publicRecord: boolean;
};

export type LitContradiction = {
  a: string;
  b: string;
  aText: string;
  bText: string;
  note: string;
};

export type SuspectState = {
  id: string;
  name: string;
  blurb: string;
  /** crowd accusation share 0..1 */
  lean: number;
  eliminated: boolean;
};

export type CaseMeter = {
  revealed: number;
  total: number;
  pct: number;
};

export type CaseSummary = {
  caseId: string;
  number: number;
  title: string;
  tagline: string;
  author: string;
  era: string;
  question: string;
  day: number;
  status: 'open' | 'closed';
  meter: CaseMeter;
  filedCount: number;
  verdictAtUtc: string;
  suspects: SuspectState[];
  docs: PublicDoc[];
};

export type ArchiveTimelineBeat = {
  t: number;
  event: string;
};

export type ArchiveEntry = {
  caseId: string;
  number: number;
  title: string;
  tagline: string;
  culpritName: string;
  closedAt: number;
  solveHours: number;
  timeline: ArchiveTimelineBeat[];
  citedAuthors: string[];
};

export type RankTier = 'Beat Cop' | 'Detective' | 'Inspector';

export const rankForCites = (cites: number): RankTier =>
  cites >= 400 ? 'Inspector' : cites >= 150 ? 'Detective' : 'Beat Cop';
