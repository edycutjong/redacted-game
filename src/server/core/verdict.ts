/**
 * Verdict resolver + citation economy. PURE — a function of the accusation
 * hash, the truth section and the board timeline. Running it twice on the
 * same inputs yields byte-identical output (the ceremony cron is idempotent
 * on top of this by persisting the first result).
 *
 * Economy (documented in README):
 * - correct accusers: payout = stake × 2, plus podium bonus 30/20/10 for the
 *   three earliest correct accusations (early-bird multiplier);
 * - wrong accusers: stake was escrowed at accusation time and is lost;
 * - citations: for every suspect the crowd eliminated, the earliest-completed
 *   elimination path wins; the earliest-filed card backing each fact on that
 *   path is CITED — its author earns +25 rep (rep:cited) and +25 season points.
 *   Public-record drips complete paths but earn no citation (no author).
 */

import type { TruthSection } from '../cases/types';
import { factIndex } from './deduction';

export const CITE_POINTS = 25;
export const PODIUM_BONUS = [30, 20, 10] as const;

export type Accusation = {
  userId: string;
  username: string;
  suspectId: string;
  stake: number;
  ts: number;
};

export type BoardEvent = {
  shardId: string;
  /** empty for public-record drips */
  authorUserId: string;
  author: string;
  ts: number;
  publicRecord: boolean;
};

export type VerdictInput = {
  truth: TruthSection;
  suspects: { id: string; name: string }[];
  accusations: Accusation[];
  boardEvents: BoardEvent[];
  closedAt: number;
};

export type CitedCard = { shardId: string; authorUserId: string; author: string };

export type VerdictResult = {
  culpritId: string;
  culpritName: string;
  motive: string;
  reveal: string[];
  closedAt: number;
  winners: { userId: string; username: string; stake: number; payout: number }[];
  citedCards: CitedCard[];
  /** rank:season deltas — winner payouts and citation bonuses combined */
  rankAwards: { userId: string; delta: number }[];
  /** rep:cited deltas */
  repAwards: { userId: string; delta: number }[];
  /** suspects the crowd actually eliminated before close */
  eliminatedSuspectIds: string[];
};

const pathCompletionTs = (
  path: readonly string[],
  factsById: ReadonlyMap<string, { supports: string[] }>,
  firstTsByShard: ReadonlyMap<string, number>
): number => {
  let completion = 0;
  for (const factId of path) {
    const fact = factsById.get(factId);
    /* v8 ignore next -- compile.ts validates every elimination-path factId against factSet at compile time, so an authored (compiled) case can never reference an unknown fact here */
    if (!fact) return Infinity;
    let factTs = Infinity;
    for (const s of fact.supports) {
      const ts = firstTsByShard.get(s);
      if (ts !== undefined && ts < factTs) factTs = ts;
    }
    if (factTs === Infinity) return Infinity;
    if (factTs > completion) completion = factTs;
  }
  return completion;
};

export const resolveVerdict = (input: VerdictInput): VerdictResult => {
  const { truth } = input;
  const factsById = factIndex(truth);
  const nameOf = new Map(input.suspects.map((s) => [s.id, s.name]));

  // first appearance of each shard on the board (any source)
  const firstTsByShard = new Map<string, number>();
  // earliest AUTHORED card per shard (citations skip public record)
  const firstCardByShard = new Map<string, BoardEvent>();
  for (const ev of [...input.boardEvents].sort((a, b) => a.ts - b.ts)) {
    if (!firstTsByShard.has(ev.shardId)) firstTsByShard.set(ev.shardId, ev.ts);
    if (!ev.publicRecord && !firstCardByShard.has(ev.shardId)) {
      firstCardByShard.set(ev.shardId, ev);
    }
  }

  // ---- citations: earliest-completed path per eliminated suspect ----
  const cited = new Map<string, CitedCard>();
  const eliminatedSuspectIds: string[] = [];
  for (const elim of truth.eliminations) {
    let bestTs = Infinity;
    let bestPath: readonly string[] | null = null;
    for (const path of elim.paths) {
      const ts = pathCompletionTs(path, factsById, firstTsByShard);
      if (ts < bestTs) {
        bestTs = ts;
        bestPath = path;
      }
    }
    if (bestPath === null || bestTs === Infinity) continue;
    eliminatedSuspectIds.push(elim.suspectId);
    for (const factId of bestPath) {
      const fact = factsById.get(factId);
      /* v8 ignore next -- bestPath is drawn from elim.paths, whose factIds compile.ts already validated against factSet; an authored (compiled) case can never reach an unknown fact here */
      if (!fact) continue;
      // earliest authored card among this fact's on-board supports
      let bestCard: BoardEvent | null = null;
      for (const s of fact.supports) {
        const card = firstCardByShard.get(s);
        if (card && (bestCard === null || card.ts < bestCard.ts)) bestCard = card;
      }
      if (bestCard && !cited.has(bestCard.shardId)) {
        cited.set(bestCard.shardId, {
          shardId: bestCard.shardId,
          authorUserId: bestCard.authorUserId,
          author: bestCard.author,
        });
      }
    }
  }

  // ---- accusation payouts ----
  const correct = input.accusations
    .filter((a) => a.suspectId === truth.culpritId)
    .sort((a, b) => a.ts - b.ts || a.userId.localeCompare(b.userId));
  const winners = correct.map((a, i) => ({
    userId: a.userId,
    username: a.username,
    stake: a.stake,
    payout: a.stake * 2 + (PODIUM_BONUS[i] ?? 0),
  }));

  // ---- award ledgers (deterministic order) ----
  const rank = new Map<string, number>();
  const rep = new Map<string, number>();
  for (const w of winners) rank.set(w.userId, (rank.get(w.userId) ?? 0) + w.payout);
  for (const c of cited.values()) {
    if (!c.authorUserId) continue;
    rank.set(c.authorUserId, (rank.get(c.authorUserId) ?? 0) + CITE_POINTS);
    rep.set(c.authorUserId, (rep.get(c.authorUserId) ?? 0) + CITE_POINTS);
  }

  return {
    culpritId: truth.culpritId,
    /* v8 ignore next -- Store.runVerdict always passes pub.suspects, and the compiler requires the culprit to be one of the bundle's authored suspects, so the fallback can never fire for a compiled case */
    culpritName: nameOf.get(truth.culpritId) ?? truth.culpritId,
    motive: truth.motive,
    reveal: truth.reveal,
    closedAt: input.closedAt,
    winners,
    citedCards: [...cited.values()].sort((a, b) => a.shardId.localeCompare(b.shardId)),
    rankAwards: [...rank.entries()]
      .map(([userId, delta]) => ({ userId, delta }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
    repAwards: [...rep.entries()]
      .map(([userId, delta]) => ({ userId, delta }))
      .sort((a, b) => a.userId.localeCompare(b.userId)),
    eliminatedSuspectIds: eliminatedSuspectIds.sort(),
  };
};
