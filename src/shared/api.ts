/** Request/response contracts between src/client and src/server. Public data only. */

import type {
  ArchiveEntry,
  BoardCard,
  CaseSummary,
  LitContradiction,
  ShardView,
} from './case';

export type ErrorResponse = {
  status: 'error';
  message: string;
};

export type CaseResponse = {
  type: 'case';
  case: CaseSummary;
  /** Per-viewer shard visibility for the dossier (mine/board/public/censored). */
  shards: ShardView[];
  you: {
    username: string;
    seasonPoints: number;
    citedPoints: number;
    accused: boolean;
  };
};

export type MyShardsResponse = {
  type: 'my-shards';
  caseId: string;
  shards: { shardId: string; text: string; filed: boolean; docTitle: string }[];
};

export type BoardResponse = {
  type: 'board';
  caseId: string;
  cards: BoardCard[];
  contradictions: LitContradiction[];
  meter: { revealed: number; total: number; pct: number };
};

export type FileRequest = {
  shardId: string;
  note?: string;
  /** consent toggle: post the evidence comment as the user, or via the app account */
  via: 'user' | 'app';
};

export type FileResponse = {
  type: 'filed';
  shardId: string;
  duplicate: boolean;
  meterPct: number;
  via: 'user' | 'app' | 'none';
  litContradiction?: { withShardId: string; note: string };
  eliminatedSuspectIds: string[];
};

export type AccuseRequest = {
  suspectId: string;
  stake: number;
};

export type AccuseResponse = {
  type: 'accused';
  suspectId: string;
  stake: number;
  ts: number;
};

export type ArchiveResponse = {
  type: 'archive';
  entries: ArchiveEntry[];
};

export type VerdictSummary = {
  culpritId: string;
  culpritName: string;
  motive: string;
  reveal: string[];
  closedAt: number;
  winners: { username: string; payout: number; rankDelta: number }[];
  citedCards: { shardId: string; author: string; text: string }[];
};

export type VerdictResponse = {
  type: 'verdict';
  caseId: string;
  verdict: VerdictSummary | null;
};

export type ForgeRequest = {
  yamlText: string;
};

export type ForgeResponse = {
  type: 'forge';
  accepted: boolean;
  errors: string[];
};

export type ReportRequest = {
  shardId: string;
};

export type ReportResponse = {
  type: 'reported';
  shardId: string;
};

/** Realtime tile pushed on the case channel when the board changes. */
export type BoardTileMessage = {
  kind: 'card' | 'public-record' | 'verdict';
  shardId?: string;
  author?: string;
  text?: string;
  meterPct: number;
  ts: number;
};

export const caseChannel = (caseId: string): string => `case-${caseId}`;
