/**
 * Store — the ONLY layer that touches Redis. Every method is a thin, testable
 * adapter over the pure cores in src/server/core. Constructed with a `RedisLike`
 * so the same code runs against the platform `redis` singleton and the
 * in-memory test stub.
 *
 * Invariants enforced here:
 *   I1 deal determinism — first deal per (user,case) is persisted, first-write-wins.
 *   I2 truth non-serialization — truth is written to `case:{id}:truth` and only
 *      the pure cores (deduction/verdict/drip) read it; it never leaves via a
 *      response builder (see serialize.ts).
 *   I3 pivot drain — the pivot pool is a zset drained head-first before any
 *      hash-deal duplication begins.
 *   I4 single accusation — one accusation per (user,case), guarded under
 *      watch/multi/exec.
 */

import type { PublicCaseBundle } from '../shared/case';
import type {
  ContradictionPair,
  SealedCaseBundle,
  TruthSection,
} from './cases/types';
import type { RedisLike } from './redisLike';
import { K } from './keys';
import { computeDeal, DEAL_SIZE, type DealResult } from './core/dealer';
import { computeMeter } from './core/meter';
import { eliminatedSuspects } from './core/deduction';
import { newlyLitBy } from './core/contradictions';
import { pickDripShard, dripActive, dripHourIndex } from './core/drip';
import { planDemoSeed } from './core/demoSeed';
import {
  resolveVerdict,
  type Accusation,
  type BoardEvent,
  type VerdictResult,
} from './core/verdict';
import { caseDay, nextVerdictTs, utcDateKey } from './core/time';

const parse = <T>(s: string | null | undefined, fallback: T): T =>
  s == null ? fallback : (JSON.parse(s) as T);

export type CardRecord = {
  text: string;
  author: string;
  authorUserId: string;
  ts: number;
  via: 'user' | 'app' | 'none';
  publicRecord: boolean;
};

export type CaseMetaRecord = {
  number: number;
  launchTs: number;
  status: 'open' | 'closed';
  closedAt?: number;
};

export type FileOutcome = {
  duplicate: boolean;
  meterPct: number;
  revealed: number;
  total: number;
  via: 'user' | 'app' | 'none';
  litContradiction?: { withShardId: string; note: string };
  eliminatedSuspectIds: string[];
};

export type AccuseOutcome = {
  ok: boolean;
  duplicate: boolean;
  ts: number;
};

export class Store {
  constructor(private readonly redis: RedisLike) {}

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Seed a compiled bundle into Redis. Idempotent by construction: every key is
   * fully rewritten from the bundle, so re-seeding restores byte-identical
   * state. Board/cards/accusations/deals are NOT cleared here — see
   * `resetLiveState` for the demo restore path.
   */
  async seedCase(bundle: SealedCaseBundle, launchTs: number): Promise<void> {
    const id = bundle.public.caseId;
    await this.redis.set(K.pub(id), JSON.stringify(bundle.public));
    await this.redis.set(K.truth(id), JSON.stringify(bundle.truth));
    await this.redis.set(K.contradictions(id), JSON.stringify(bundle.contradictions));

    const shardText: Record<string, string> = {};
    const order: string[] = [];
    for (const s of bundle.shards) {
      shardText[s.id] = s.text;
      order.push(s.id);
    }
    await this.redis.del(K.shardText(id));
    if (order.length > 0) await this.redis.hSet(K.shardText(id), shardText);
    await this.redis.set(K.shardOrder(id), JSON.stringify(order));

    await this.redis.del(K.meta(id));
    await this.redis.hSet(K.meta(id), {
      number: String(bundle.public.number),
      launchTs: String(launchTs),
      status: 'open',
    });

    await this.redis.del(K.pivot(id));
    if (bundle.pivots.length > 0) {
      await this.redis.zAdd(
        K.pivot(id),
        ...bundle.pivots.map((shardId, i) => ({ member: shardId, score: i }))
      );
    }
  }

  /** Clear the mutable per-run state (board, cards, deals, accusations, drip guards). */
  async resetLiveState(caseId: string): Promise<void> {
    await this.redis.del(
      K.board(caseId),
      K.card(caseId),
      K.deal(caseId),
      K.accuse(caseId),
      K.accuseTally(caseId),
      K.dripGuards(caseId),
      K.verdict(caseId)
    );
  }

  async setLiveCase(caseId: string): Promise<void> {
    await this.redis.set(K.live, caseId);
  }

  async getLiveCaseId(): Promise<string | undefined> {
    return this.redis.get(K.live);
  }

  async mapPostToCase(postId: string, caseId: string): Promise<void> {
    await this.redis.hSet(K.postToCase, { [postId]: caseId });
  }

  async caseIdForPost(postId: string): Promise<string | undefined> {
    return this.redis.hGet(K.postToCase, postId);
  }

  async loadPublic(caseId: string): Promise<PublicCaseBundle | undefined> {
    const raw = await this.redis.get(K.pub(caseId));
    return raw ? (JSON.parse(raw) as PublicCaseBundle) : undefined;
  }

  /** SERVER-ONLY. Never feed the result into a response object. */
  async loadTruth(caseId: string): Promise<TruthSection | undefined> {
    const raw = await this.redis.get(K.truth(caseId));
    return raw ? (JSON.parse(raw) as TruthSection) : undefined;
  }

  async loadContradictions(caseId: string): Promise<ContradictionPair[]> {
    return parse<ContradictionPair[]>(await this.redis.get(K.contradictions(caseId)), []);
  }

  async loadMeta(caseId: string): Promise<CaseMetaRecord | undefined> {
    const h = await this.redis.hGetAll(K.meta(caseId));
    if (!h || Object.keys(h).length === 0) return undefined;
    return {
      number: Number(h.number ?? 0),
      launchTs: Number(h.launchTs ?? 0),
      status: (h.status as 'open' | 'closed') ?? 'open',
      closedAt: h.closedAt ? Number(h.closedAt) : undefined,
    };
  }

  async shardOrder(caseId: string): Promise<string[]> {
    return parse<string[]>(await this.redis.get(K.shardOrder(caseId)), []);
  }

  async shardTextOf(caseId: string, shardId: string): Promise<string | undefined> {
    return this.redis.hGet(K.shardText(caseId), shardId);
  }

  // ---- dealing (I1 + I3) ---------------------------------------------------

  /**
   * Deterministic deal for a viewer. First deal is persisted (first-write-wins),
   * so a returning viewer always sees the same lines even after the pivot pool
   * drains (I1). While pivots remain, a first-seen account is handed the pivot
   * pool head, which is then drained from the zset (I3).
   */
  async dealFor(caseId: string, userId: string, dealSize = DEAL_SIZE): Promise<DealResult> {
    const dealKey = K.deal(caseId);
    const existing = await this.redis.hGet(dealKey, userId);
    if (existing) return JSON.parse(existing) as DealResult;

    const pivotQueue = (
      await this.redis.zRange(K.pivot(caseId), 0, -1, { by: 'rank' })
    ).map((m) => m.member);
    const allShardIds = await this.shardOrder(caseId);

    const result = computeDeal({
      userId,
      caseId,
      allShardIds,
      pivotQueue,
      firstSeen: true,
      dealSize,
    });

    // first-write-wins: hSetNX returns 0 if another request already persisted.
    const wrote = await this.redis.hSetNX(dealKey, userId, JSON.stringify(result));
    if (wrote === 0) {
      const cur = await this.redis.hGet(dealKey, userId);
      return JSON.parse(cur!) as DealResult;
    }
    if (result.pivotTaken) {
      await this.redis.zRem(K.pivot(caseId), [result.pivotTaken]);
    }
    return result;
  }

  async pivotRemaining(caseId: string): Promise<number> {
    return this.redis.zCard(K.pivot(caseId));
  }

  // ---- board ---------------------------------------------------------------

  async boardShardIds(caseId: string): Promise<string[]> {
    const rows = await this.redis.zRange(K.board(caseId), 0, -1, { by: 'rank' });
    return rows.map((r) => r.member);
  }

  async boardSet(caseId: string): Promise<Set<string>> {
    return new Set(await this.boardShardIds(caseId));
  }

  async cards(caseId: string): Promise<Record<string, CardRecord>> {
    const h = await this.redis.hGetAll(K.card(caseId));
    const out: Record<string, CardRecord> = {};
    for (const [shardId, raw] of Object.entries(h)) out[shardId] = JSON.parse(raw) as CardRecord;
    return out;
  }

  async filedCount(caseId: string): Promise<number> {
    return this.redis.zCard(K.board(caseId));
  }

  async meter(caseId: string): Promise<{ revealed: number; total: number; pct: number }> {
    const total = (await this.shardOrder(caseId)).length;
    const revealed = await this.filedCount(caseId);
    return computeMeter(revealed, total);
  }

  /**
   * File one card onto the board. First-write-wins per shard (a shard is only
   * un-redacted once). `via` is decided by the route (asUser comment / app
   * fallback / none) and recorded verbatim. Returns the contradiction/
   * elimination delta produced by adding this shard, computed with the truth
   * section (server-side) but exposing only booleans/ids to the caller.
   */
  async fileCard(
    caseId: string,
    shardId: string,
    userId: string,
    username: string,
    via: 'user' | 'app' | 'none',
    now: number,
    opts: { publicRecord?: boolean } = {}
  ): Promise<FileOutcome> {
    const total = (await this.shardOrder(caseId)).length;
    const existing = await this.redis.hGet(K.card(caseId), shardId);
    if (existing) {
      const revealed = await this.filedCount(caseId);
      return {
        duplicate: true,
        meterPct: computeMeter(revealed, total).pct,
        revealed,
        total,
        via: (JSON.parse(existing) as CardRecord).via,
        eliminatedSuspectIds: [],
      };
    }

    const text = (await this.shardTextOf(caseId, shardId)) ?? '';
    const boardBefore = await this.boardSet(caseId);
    const record: CardRecord = {
      text,
      author: username,
      authorUserId: userId,
      ts: now,
      via,
      publicRecord: opts.publicRecord ?? false,
    };
    await this.redis.hSet(K.card(caseId), { [shardId]: JSON.stringify(record) });
    await this.redis.zAdd(K.board(caseId), { member: shardId, score: now });

    const truth = await this.loadTruth(caseId);
    const contradictions = await this.loadContradictions(caseId);
    const boardAfter = new Set(boardBefore);
    boardAfter.add(shardId);

    let litContradiction: FileOutcome['litContradiction'];
    const lit = newlyLitBy(contradictions, boardBefore, shardId);
    if (lit[0]) {
      const other = lit[0].a === shardId ? lit[0].b : lit[0].a;
      litContradiction = { withShardId: other, note: lit[0].note };
    }

    let eliminatedSuspectIds: string[] = [];
    if (truth) {
      const before = eliminatedSuspects(truth, boardBefore);
      const after = eliminatedSuspects(truth, boardAfter);
      eliminatedSuspectIds = [...after].filter((s) => !before.has(s)).sort();
    }

    const revealed = await this.filedCount(caseId);
    return {
      duplicate: false,
      meterPct: computeMeter(revealed, total).pct,
      revealed,
      total,
      via,
      litContradiction,
      eliminatedSuspectIds,
    };
  }

  // ---- accusation escrow (I4) ---------------------------------------------

  /**
   * One accusation per (user,case), locked under watch/multi/exec. Re-accusing
   * is rejected as a duplicate. On contention (a concurrent write to the same
   * accusations hash) exec aborts (null) and we retry, which then observes the
   * now-present record and reports the duplicate — the invariant holds under
   * races, not just in the happy path.
   */
  async accuse(
    caseId: string,
    userId: string,
    username: string,
    suspectId: string,
    stake: number,
    now: number
  ): Promise<AccuseOutcome> {
    const key = K.accuse(caseId);
    for (let attempt = 0; attempt < 4; attempt++) {
      const tx = await this.redis.watch(key);
      const existing = await this.redis.hGet(key, userId);
      if (existing) {
        await tx.unwatch();
        return { ok: false, duplicate: true, ts: (JSON.parse(existing) as { ts: number }).ts };
      }
      await tx.multi();
      await tx.hSet(key, {
        [userId]: JSON.stringify({ username, suspectId, stake, ts: now }),
      });
      await tx.zIncrBy(K.accuseTally(caseId), suspectId, 1);
      await tx.zIncrBy(K.rankSeason, userId, -stake); // escrow the stake
      const res = await tx.exec();
      if (res !== null) return { ok: true, duplicate: false, ts: now };
    }
    return { ok: false, duplicate: false, ts: now };
  }

  async accusations(caseId: string): Promise<Accusation[]> {
    const h = await this.redis.hGetAll(K.accuse(caseId));
    const out: Accusation[] = [];
    for (const [userId, raw] of Object.entries(h)) {
      const r = JSON.parse(raw) as { username: string; suspectId: string; stake: number; ts: number };
      out.push({ userId, username: r.username, suspectId: r.suspectId, stake: r.stake, ts: r.ts });
    }
    return out;
  }

  async accusationOf(caseId: string, userId: string): Promise<boolean> {
    return (await this.redis.hGet(K.accuse(caseId), userId)) !== undefined;
  }

  /** Crowd lean per suspect (accusation share 0..1). */
  async suspectLean(caseId: string): Promise<Map<string, number>> {
    const rows = await this.redis.zRange(K.accuseTally(caseId), 0, -1, { by: 'rank' });
    const total = rows.reduce((a, r) => a + r.score, 0);
    const out = new Map<string, number>();
    for (const r of rows) {
      /* v8 ignore next -- accuseTally rows only ever exist via accuse()'s +1 zIncrBy, so a non-empty rows set always sums to > 0; the total===0 branch can't fire alongside a populated zset */
      out.set(r.member, total === 0 ? 0 : r.score / total);
    }
    return out;
  }

  // ---- drip valve ----------------------------------------------------------

  /**
   * Release the highest-information unfiled shard to the public record. Runs at
   * most once per case-hour (hSetNX guard on the hour index → idempotent), and
   * only after DRIP_START_HOUR.
   */
  async runDrip(caseId: string, now: number): Promise<{ released: string | null; meterPct: number }> {
    const meta = await this.loadMeta(caseId);
    const meterNow = (await this.meter(caseId)).pct;
    if (!meta || meta.status === 'closed' || !dripActive(meta.launchTs, now)) {
      return { released: null, meterPct: meterNow };
    }
    const hour = dripHourIndex(meta.launchTs, now);
    const claimed = await this.redis.hSetNX(K.dripGuards(caseId), String(hour), '1');
    if (claimed === 0) return { released: null, meterPct: meterNow };

    const truth = await this.loadTruth(caseId);
    if (!truth) return { released: null, meterPct: meterNow };
    const order = await this.shardOrder(caseId);
    const board = await this.boardSet(caseId);
    const candidates = order.filter((s) => !board.has(s));
    const pick = pickDripShard(truth, board, candidates, order);
    if (!pick) return { released: null, meterPct: meterNow };

    const out = await this.fileCard(caseId, pick, '', '', 'none', now, { publicRecord: true });
    return { released: pick, meterPct: out.meterPct };
  }

  // ---- verdict ceremony ----------------------------------------------------

  /**
   * Resolve the verdict and apply the citation/payout ledgers. Idempotent: the
   * first result is persisted and every subsequent call returns it verbatim
   * without re-applying any awards.
   */
  async runVerdict(caseId: string, now: number): Promise<VerdictResult | undefined> {
    const stored = await this.redis.get(K.verdict(caseId));
    if (stored) return JSON.parse(stored) as VerdictResult;

    const pub = await this.loadPublic(caseId);
    const truth = await this.loadTruth(caseId);
    if (!pub || !truth) return undefined;

    const cards = await this.cards(caseId);
    const boardEvents: BoardEvent[] = Object.entries(cards).map(([shardId, c]) => ({
      shardId,
      authorUserId: c.authorUserId,
      author: c.author,
      ts: c.ts,
      publicRecord: c.publicRecord,
    }));

    const result = resolveVerdict({
      truth,
      suspects: pub.suspects.map((s) => ({ id: s.id, name: s.name })),
      accusations: await this.accusations(caseId),
      boardEvents,
      closedAt: now,
    });

    // Persist FIRST (the idempotency latch), then apply ledgers exactly once.
    await this.redis.set(K.verdict(caseId), JSON.stringify(result));
    for (const a of result.rankAwards) await this.redis.zIncrBy(K.rankSeason, a.userId, a.delta);
    for (const a of result.repAwards) await this.redis.zIncrBy(K.repCited, a.userId, a.delta);
    await this.redis.hSet(K.meta(caseId), { status: 'closed', closedAt: String(now) });
    await this.redis.zAdd(K.closed, { member: caseId, score: now });
    return result;
  }

  async storedVerdict(caseId: string): Promise<VerdictResult | undefined> {
    const raw = await this.redis.get(K.verdict(caseId));
    return raw ? (JSON.parse(raw) as VerdictResult) : undefined;
  }

  async closedCaseIds(): Promise<string[]> {
    const rows = await this.redis.zRange(K.closed, 0, -1, { by: 'rank', reverse: true });
    return rows.map((r) => r.member);
  }

  async seasonPoints(userId: string): Promise<number> {
    return (await this.redis.zScore(K.rankSeason, userId)) ?? 0;
  }

  async citedPoints(userId: string): Promise<number> {
    return (await this.redis.zScore(K.repCited, userId)) ?? 0;
  }

  // ---- demo seeding (deterministic + idempotent) ---------------------------

  /**
   * Restore a case to the exact ~61% mid-solve demo state (SEED_DATA.md):
   * pivot pool full (pawn-ticket reserved for first-seen judges), one
   * contradiction pair already lit red, board pre-filled from labelled founder
   * accounts. Deterministic and idempotent — re-seeding yields identical board
   * + meter (asserted in tests).
   */
  async seedDemoState(
    bundle: SealedCaseBundle,
    launchTs: number,
    now: number
  ): Promise<{ filled: string[]; meterPct: number }> {
    const id = bundle.public.caseId;
    await this.seedCase(bundle, launchTs);
    await this.resetLiveState(id);

    // Deduction-aware plan (core/demoSeed.ts): fills ~61% but leaves the
    // reserved crowd-favorite suspect STANDING, so filing a reserved pivot shard
    // visibly strikes a suspect. The first contradiction is lit on sight; the
    // second stays half-lit for a reserved pivot to complete. Deterministic.
    const ordered = planDemoSeed(bundle);
    const founders = ['rd_precinct_ada', 'rd_precinct_boyle', 'rd_precinct_cole'];
    let i = 0;
    for (const shardId of ordered) {
      const author = founders[i % founders.length]!;
      await this.fileCard(id, shardId, `t2_seed_${author}`, author, 'app', launchTs + i, {});
      i++;
    }

    await this.redis.hSet(K.meta(id), { status: 'open', launchTs: String(launchTs) });
    await this.setLiveCase(id);
    const meterPct = (await this.meter(id)).pct;
    void now;
    return { filled: ordered, meterPct };
  }

  // ---- derived case-day / verdict clock ------------------------------------

  caseDay(launchTs: number, now: number): number {
    return caseDay(launchTs, now);
  }

  verdictAtUtc(now: number): string {
    return new Date(nextVerdictTs(now)).toISOString();
  }

  dateKey(now: number): string {
    return utcDateKey(now);
  }
}
