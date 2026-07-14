/**
 * Response serializers — the I2 boundary made explicit.
 *
 * Every function here takes the PUBLIC case bundle plus already-projected
 * runtime state (dealt shard ids, board cards, computed lean/elimination
 * booleans) and returns only shared/api types. Nothing here imports the
 * server-only truth types, and the only shard text that can appear is text the
 * viewer is entitled to see: their own deal, filed board cards, or public-record
 * drips. Undealt+unfiled shards are emitted as bare `censored` bars with NO text.
 *
 * The truth-non-serialization invariant is unit-tested by serializing a full
 * case and asserting the JSON contains no truth string and no undealt shard text.
 */

import type {
  BoardCard,
  CaseMeter,
  CaseSummary,
  LitContradiction,
  PublicCaseBundle,
  ShardView,
  ShardVisibility,
  SuspectState,
} from '../shared/case';
import type { CardRecord } from './store';
import type { ContradictionPair } from './cases/types';
import { litContradictions } from './core/contradictions';

/** shardId → censor-bar width, read from the PUBLIC doc lines (never text length). */
export const barWidthIndex = (pub: PublicCaseBundle): Map<string, number> => {
  const out = new Map<string, number>();
  for (const doc of pub.docs) {
    for (const line of doc.lines) {
      if (line.kind === 'shard') out.set(line.shardId, line.barWidth);
    }
  }
  return out;
};

/** shardId → containing document title, for the my-shards panel. */
export const shardDocIndex = (pub: PublicCaseBundle): Map<string, string> => {
  const out = new Map<string, string>();
  for (const doc of pub.docs) {
    for (const line of doc.lines) {
      if (line.kind === 'shard') out.set(line.shardId, doc.title);
    }
  }
  return out;
};

export type ShardViewInput = {
  dealt: ReadonlySet<string>;
  cards: Readonly<Record<string, CardRecord>>;
};

export const toShardViews = (pub: PublicCaseBundle, input: ShardViewInput): ShardView[] => {
  const bar = barWidthIndex(pub);
  const views: ShardView[] = [];
  for (const doc of pub.docs) {
    for (const line of doc.lines) {
      if (line.kind !== 'shard') continue;
      const shardId = line.shardId;
      const card = input.cards[shardId];
      let visibility: ShardVisibility;
      let text: string | undefined;
      let filedBy: string | undefined;
      if (card?.publicRecord) {
        visibility = 'public';
        text = card.text;
      } else if (card) {
        visibility = 'board';
        text = card.text;
        filedBy = card.author;
      } else if (input.dealt.has(shardId)) {
        visibility = 'mine';
        // `mine` text is attached by the caller (server holds the deal text);
        // left undefined here so this pure fn never needs shard text itself.
        text = undefined;
      } else {
        visibility = 'censored';
      }
      views.push({
        shardId,
        visibility,
        ...(text !== undefined ? { text } : {}),
        /* v8 ignore next -- bar is built from barWidthIndex(pub) over the same pub.docs this loop iterates, so bar.get(shardId) is always defined here; the fallback can't fire */
        barWidth: bar.get(shardId) ?? line.barWidth,
        ...(filedBy !== undefined ? { filedBy } : {}),
      });
    }
  }
  return views;
};

export const toSuspectStates = (
  pub: PublicCaseBundle,
  lean: ReadonlyMap<string, number>,
  eliminated: ReadonlySet<string>
): SuspectState[] =>
  pub.suspects.map((s) => ({
    id: s.id,
    name: s.name,
    blurb: s.blurb,
    lean: lean.get(s.id) ?? 0,
    eliminated: eliminated.has(s.id),
  }));

export const toCaseSummary = (args: {
  pub: PublicCaseBundle;
  day: number;
  status: 'open' | 'closed';
  meter: CaseMeter;
  filedCount: number;
  verdictAtUtc: string;
  suspects: SuspectState[];
}): CaseSummary => ({
  caseId: args.pub.caseId,
  number: args.pub.number,
  title: args.pub.title,
  tagline: args.pub.tagline,
  author: args.pub.author,
  era: args.pub.era,
  question: args.pub.question,
  day: args.day,
  status: args.status,
  meter: args.meter,
  filedCount: args.filedCount,
  verdictAtUtc: args.verdictAtUtc,
  suspects: args.suspects,
  docs: args.pub.docs,
});

export const toBoardCards = (cards: Readonly<Record<string, CardRecord>>): BoardCard[] =>
  Object.entries(cards)
    .map(([shardId, c]) => ({
      shardId,
      text: c.text,
      author: c.publicRecord ? 'PUBLIC RECORD' : c.author,
      ts: c.ts,
      cites: 0,
      via: c.via,
      publicRecord: c.publicRecord,
    }))
    .sort((a, b) => a.ts - b.ts);

export const toLitContradictions = (
  pairs: readonly ContradictionPair[],
  board: ReadonlySet<string>,
  cards: Readonly<Record<string, CardRecord>>
): LitContradiction[] =>
  litContradictions(pairs, board).map((p) => ({
    a: p.a,
    b: p.b,
    aText: cards[p.a]?.text ?? '',
    bText: cards[p.b]?.text ?? '',
    note: p.note,
  }));
