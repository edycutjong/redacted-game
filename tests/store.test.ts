import { describe, expect, it } from 'vitest';
import { RedisStub } from './helpers/redisStub';
import { Store } from '../src/server/store';
import { K } from '../src/server/keys';
import type { SealedCaseBundle } from '../src/server/cases/types';
import { eliminatedSuspects } from '../src/server/core/deduction';
import { demoBundle } from './helpers/bundles';

const LAUNCH = Date.UTC(2026, 6, 14, 0, 0, 0);

const freshSeeded = async (b: SealedCaseBundle, launchTs = LAUNCH): Promise<{ store: Store; db: RedisStub }> => {
  const db = new RedisStub();
  const store = new Store(db);
  await store.seedCase(b, launchTs);
  return { store, db };
};

describe('Store.dealFor — determinism + persistence (I1)', () => {
  it('returns the identical deal on repeat calls for the same viewer', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const first = await store.dealFor(b.public.caseId, 'viewer-1');
    const again = await store.dealFor(b.public.caseId, 'viewer-1');
    expect(again).toEqual(first);
  });

  it('keeps a viewer deal stable even after the pivot pool drains', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const first = await store.dealFor(b.public.caseId, 'viewer-1'); // takes a pivot
    // Drain the rest of the pool with other fresh viewers.
    await store.dealFor(b.public.caseId, 'viewer-2');
    await store.dealFor(b.public.caseId, 'viewer-3');
    await store.dealFor(b.public.caseId, 'viewer-4');
    expect(await store.dealFor(b.public.caseId, 'viewer-1')).toEqual(first);
  });
});

describe('Store.dealFor — pivot pool drain (I3)', () => {
  it('hands each fresh viewer the next pivot until the pool is empty', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    expect(await store.pivotRemaining(id)).toBe(b.pivots.length);

    const p1 = await store.dealFor(id, 'a');
    expect(p1.pivotTaken).toBe(b.pivots[0]);
    expect(p1.shardIds).toContain(b.pivots[0]);
    expect(await store.pivotRemaining(id)).toBe(b.pivots.length - 1);

    const p2 = await store.dealFor(id, 'b');
    expect(p2.pivotTaken).toBe(b.pivots[1]);

    const p3 = await store.dealFor(id, 'c');
    expect(p3.pivotTaken).toBe(b.pivots[2]);
    expect(await store.pivotRemaining(id)).toBe(0);

    // Pool drained: subsequent fresh viewers get no pivot (hash deal only).
    const p4 = await store.dealFor(id, 'd');
    expect(p4.pivotTaken).toBeNull();
  });

  it('every fresh viewer holds a board-absent shard while pivots remain', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    for (let i = 0; i < b.pivots.length; i++) {
      const deal = await store.dealFor(b.public.caseId, `judge-${i}`);
      expect(deal.pivotTaken).not.toBeNull();
    }
  });
});

describe('Store.accuse — single-accusation escrow (I4)', () => {
  it('accepts the first accusation and rejects a re-accusation', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    const first = await store.accuse(id, 'u1', 'ada', b.truth.culpritId, 20, 1);
    expect(first).toMatchObject({ ok: true, duplicate: false });
    const second = await store.accuse(id, 'u1', 'ada', b.public.suspects[0]!.id, 20, 2);
    expect(second).toMatchObject({ ok: false, duplicate: true });
    expect(await store.accusations(id)).toHaveLength(1);
  });

  it('escrows the stake exactly once', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    await store.accuse(id, 'u1', 'ada', b.truth.culpritId, 20, 1);
    await store.accuse(id, 'u1', 'ada', b.truth.culpritId, 20, 2); // rejected
    expect(await store.seasonPoints('u1')).toBe(-20);
  });

  it('under concurrency a single user still lands exactly one accusation', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    const results = await Promise.all([
      store.accuse(id, 'u1', 'ada', b.truth.culpritId, 10, 1),
      store.accuse(id, 'u1', 'ada', b.public.suspects[0]!.id, 10, 2),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await store.accusations(id)).toHaveLength(1);
  });

  it('distinct users each land their own accusation despite key contention', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    const results = await Promise.all([
      store.accuse(id, 'u1', 'ada', b.truth.culpritId, 10, 1),
      store.accuse(id, 'u2', 'boyle', b.truth.culpritId, 10, 2),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(await store.accusations(id)).toHaveLength(2);
  });
});

describe('Store.fileCard — board writes', () => {
  it('is first-write-wins per shard and ticks the meter', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    const shardId = b.shards[0]!.id;
    const first = await store.fileCard(id, shardId, 'u1', 'ada', 'user', 1);
    expect(first.duplicate).toBe(false);
    expect(first.meterPct).toBeGreaterThan(0);
    const dup = await store.fileCard(id, shardId, 'u2', 'boyle', 'user', 2);
    expect(dup.duplicate).toBe(true);
    expect(await store.filedCount(id)).toBe(1);
  });

  it('lights a contradiction when the second side is filed (a first, then b)', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    const pair = b.contradictions[0]!;
    const a = await store.fileCard(id, pair.a, 'u1', 'ada', 'user', 1);
    expect(a.litContradiction).toBeUndefined();
    const bres = await store.fileCard(id, pair.b, 'u2', 'boyle', 'user', 2);
    expect(bres.litContradiction).toMatchObject({ withShardId: pair.a });
  });

  it('lights a contradiction from the other direction too (b first, then a)', async () => {
    // fileCard's `other` pick is a ternary on which side the newly-filed
    // shard is; filing order determines which branch runs, so exercise both.
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    const pair = b.contradictions[0]!;
    await store.fileCard(id, pair.b, 'u1', 'ada', 'user', 1);
    const ares = await store.fileCard(id, pair.a, 'u2', 'boyle', 'user', 2);
    expect(ares.litContradiction).toMatchObject({ withShardId: pair.b });
  });

  it('tolerates filing a shard id with no known text (defensive fallback)', async () => {
    // The onComment trigger reconciles whatever shardId a marker regex parsed
    // out of untrusted comment text; it never validates the id against the
    // case's own shardText hash before calling fileCard.
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    const out = await store.fileCard(id, 'not-a-real-shard-id', '', 'someone', 'user', 1);
    expect(out.duplicate).toBe(false);
    const cards = await store.cards(id);
    expect(cards['not-a-real-shard-id']!.text).toBe('');
  });

  it('reports no eliminations when the truth section is missing (partial/corrupt seed)', async () => {
    const b = demoBundle();
    const { store, db } = await freshSeeded(b);
    const id = b.public.caseId;
    await db.del(K.truth(id));
    const shardId = b.shards[0]!.id;
    const out = await store.fileCard(id, shardId, 'u1', 'ada', 'user', 1);
    expect(out.eliminatedSuspectIds).toEqual([]);
  });

  it('reports an elimination delta once a suspect path completes', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    const elim = b.truth.eliminations[0]!;
    const path = elim.paths[0]!;
    const supports = path.map((fid) => b.truth.facts.find((f) => f.id === fid)!.supports[0]!);
    const seen = new Set<string>();
    let ts = 1;
    for (const shardId of supports) {
      const out = await store.fileCard(id, shardId, `u${ts}`, 'ada', 'app', ts++);
      for (const s of out.eliminatedSuspectIds) seen.add(s);
    }
    expect(seen.has(elim.suspectId)).toBe(true);
  });
});

describe('Store.runDrip — idempotent hourly release', () => {
  it('releases one public-record shard and refuses a second in the same hour', async () => {
    const b = demoBundle();
    const dripTime = LAUNCH + 13 * 3_600_000; // past the hour-12 gate
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;

    const r1 = await store.runDrip(id, dripTime);
    expect(r1.released).not.toBeNull();
    const cards = await store.cards(id);
    expect(cards[r1.released!]!.publicRecord).toBe(true);

    const r2 = await store.runDrip(id, dripTime);
    expect(r2.released).toBeNull(); // same hour → guarded
  });

  it('does not drip before the hour-12 gate', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const early = LAUNCH + 2 * 3_600_000;
    expect((await store.runDrip(b.public.caseId, early)).released).toBeNull();
  });
});

describe('Store.runVerdict — idempotent ceremony', () => {
  const setup = async (): Promise<{ store: Store; id: string; b: SealedCaseBundle }> => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    // File every shard as authored cards so all non-culprits are eliminable.
    let ts = 1;
    for (const s of b.shards) await store.fileCard(id, s.id, `u_${s.id}`, `filer_${s.id}`, 'app', ts++);
    await store.accuse(id, 'winner', 'ada', b.truth.culpritId, 10, 10_000);
    return { store, id, b };
  };

  it('returns a byte-identical result on re-run', async () => {
    const { store, id } = await setup();
    const v1 = await store.runVerdict(id, 20_000);
    const v2 = await store.runVerdict(id, 30_000);
    expect(JSON.stringify(v2)).toBe(JSON.stringify(v1));
  });

  it('applies citation + payout ledgers exactly once', async () => {
    const { store, id, b } = await setup();
    const v = (await store.runVerdict(id, 20_000))!;
    const citedAuthor = v.citedCards[0]!.authorUserId;
    const afterFirst = await store.citedPoints(citedAuthor);
    await store.runVerdict(id, 30_000); // must not double-award
    expect(await store.citedPoints(citedAuthor)).toBe(afterFirst);
    // Closing the case is reflected in meta + the closed set.
    expect((await store.loadMeta(id))!.status).toBe('closed');
    expect(await store.closedCaseIds()).toContain(id);
    expect(v.culpritId).toBe(b.truth.culpritId);
  });
});

describe('Store.seedDemoState — deterministic + idempotent (SEED_DATA.md)', () => {
  it('re-seeding produces byte-identical Redis state', async () => {
    const b = demoBundle();
    const db = new RedisStub();
    const store = new Store(db);
    await store.seedDemoState(b, LAUNCH, LAUNCH);
    const dumpA = JSON.stringify(db.dump());
    await store.seedDemoState(b, LAUNCH, LAUNCH);
    const dumpB = JSON.stringify(db.dump());
    expect(dumpB).toBe(dumpA);
  });

  it('two independent installs seed to identical board + meter', async () => {
    const b = demoBundle();
    const s1 = new RedisStub();
    const s2 = new RedisStub();
    const r1 = await new Store(s1).seedDemoState(b, LAUNCH, LAUNCH);
    const r2 = await new Store(s2).seedDemoState(b, LAUNCH, LAUNCH);
    expect(r1.filled).toEqual(r2.filled);
    expect(r1.meterPct).toBe(r2.meterPct);
  });

  it('lands near the ~61% demo mark', async () => {
    const b = demoBundle();
    const { meterPct } = await new Store(new RedisStub()).seedDemoState(b, LAUNCH, LAUNCH);
    expect(meterPct).toBeGreaterThanOrEqual(55);
    expect(meterPct).toBeLessThanOrEqual(67);
  });

  it('keeps the pivot pool full and reserves the pivots off the board', async () => {
    const b = demoBundle();
    const db = new RedisStub();
    const store = new Store(db);
    await store.seedDemoState(b, LAUNCH, LAUNCH);
    expect(await store.pivotRemaining(b.public.caseId)).toBe(b.pivots.length);
    const board = await store.boardSet(b.public.caseId);
    for (const p of b.pivots) expect(board.has(p)).toBe(false);
  });

  it('lights the first contradiction pair on sight', async () => {
    const b = demoBundle();
    const store = new Store(new RedisStub());
    await store.seedDemoState(b, LAUNCH, LAUNCH);
    const board = await store.boardSet(b.public.caseId);
    const c0 = b.contradictions[0]!;
    expect(board.has(c0.a) && board.has(c0.b)).toBe(true);
  });

  it('sets the case live', async () => {
    const b = demoBundle();
    const store = new Store(new RedisStub());
    await store.seedDemoState(b, LAUNCH, LAUNCH);
    expect(await store.getLiveCaseId()).toBe(b.public.caseId);
  });
});

describe('Store.seedDemoState — the witnessable "I am needed" beat (real case-017)', () => {
  it('leaves the reserved crowd-favorite STANDING while striking every other non-culprit', async () => {
    const b = demoBundle();
    const reserve = b.demo?.reserveSuspectIds ?? [];
    expect(reserve.length).toBeGreaterThan(0); // #17 must declare its crowd-favorite
    const store = new Store(new RedisStub());
    await store.seedDemoState(b, LAUNCH, LAUNCH);
    const truth = (await store.loadTruth(b.public.caseId))!;
    const struck = eliminatedSuspects(truth, await store.boardSet(b.public.caseId));
    for (const sid of reserve) expect(struck.has(sid)).toBe(false);
    for (const s of b.public.suspects) {
      if (s.id === truth.culpritId || reserve.includes(s.id)) continue;
      expect(struck.has(s.id)).toBe(true); // the crowd has already cleared the rest
    }
  });

  it('filing ANY reserved pivot shard strikes a suspect and ticks the meter (61 -> 63)', async () => {
    const b = demoBundle();
    for (const pivot of b.pivots) {
      const store = new Store(new RedisStub());
      const { meterPct } = await store.seedDemoState(b, LAUNCH, LAUNCH);
      const out = await store.fileCard(b.public.caseId, pivot, 't2_judge', 'judge', 'user', LAUNCH + 1000);
      expect(out.eliminatedSuspectIds.length).toBeGreaterThan(0); // a suspect visibly falls
      expect(out.meterPct).toBeGreaterThan(meterPct); // and the meter ticks up
    }
  });

  it('reserves the pivots off the board, so a first-seen judge is dealt one', async () => {
    const b = demoBundle();
    const store = new Store(new RedisStub());
    await store.seedDemoState(b, LAUNCH, LAUNCH);
    const board = await store.boardSet(b.public.caseId);
    for (const p of b.pivots) expect(board.has(p)).toBe(false);
    const deal = await store.dealFor(b.public.caseId, 'fresh-judge');
    expect(deal.pivotTaken).not.toBeNull();
  });
});

describe('Store — reads on an unseeded/unknown caseId degrade to empty, not throw', () => {
  it('shardOrder / loadContradictions parse a missing key as their empty fallback', async () => {
    const db = new RedisStub();
    const store = new Store(db);
    expect(await store.shardOrder('nope')).toEqual([]);
    expect(await store.loadContradictions('nope')).toEqual([]);
  });
});

describe('Store.seedCase — degenerate bundles (no shards / no pivots)', () => {
  const minimalBundle = (overrides: Partial<SealedCaseBundle> = {}): SealedCaseBundle => ({
    formatVersion: 1,
    public: {
      caseId: 'case-empty',
      number: 1,
      title: 't',
      tagline: 't',
      author: 'a',
      era: 'e',
      question: 'q',
      totalShards: 0,
      docs: [],
      suspects: [],
    },
    shards: [],
    contradictions: [],
    pivots: [],
    truth: { culpritId: 'X', motive: 'm', summary: 's', reveal: [], facts: [], eliminations: [] },
    ...overrides,
  });

  it('skips the shardText hSet when there are zero shards', async () => {
    const db = new RedisStub();
    const store = new Store(db);
    const b = minimalBundle();
    await store.seedCase(b, LAUNCH);
    expect(await store.shardOrder(b.public.caseId)).toEqual([]);
    expect(await db.hLen(K.shardText(b.public.caseId))).toBe(0);
  });

  it('skips the pivot zAdd when there are zero pivots', async () => {
    const db = new RedisStub();
    const store = new Store(db);
    const b = minimalBundle();
    await store.seedCase(b, LAUNCH);
    expect(await store.pivotRemaining(b.public.caseId)).toBe(0);
  });
});

describe('Store.loadMeta — tolerates a partial hash (corrupt/hand-written record)', () => {
  it('defaults missing number/launchTs/status fields', async () => {
    const db = new RedisStub();
    const store = new Store(db);
    // Write a single unrelated field so the hash exists (non-empty) but the
    // number/launchTs/status fields are absent, exercising each `??` fallback.
    await db.hSet(K.meta('partial-case'), { closedAt: '123' });
    const meta = await store.loadMeta('partial-case');
    expect(meta).toEqual({ number: 0, launchTs: 0, status: 'open', closedAt: 123 });
  });
});

describe('Store.dealFor — loses the first-write-wins race', () => {
  it('returns the persisted winner deal when hSetNX loses to a concurrent request', async () => {
    const b = demoBundle();
    const { store, db } = await freshSeeded(b);
    const id = b.public.caseId;
    // Simulate another request winning the race: once this dealFor call
    // computes its own deal and is about to persist it, a rival deal for the
    // same (case,user) has already landed first.
    const rivalDeal = { shardIds: ['SH-RIVAL'], pivotTaken: null };
    let armed = true;
    db.onBeforeExec = null; // dealFor doesn't use watch/multi/exec, only hSetNX
    const originalHSetNX = db.hSetNX.bind(db);
    db.hSetNX = async (key: string, field: string, value: string) => {
      if (armed && key === K.deal(id)) {
        armed = false;
        await db.hSet(key, { [field]: JSON.stringify(rivalDeal) });
        return 0; // "someone else already wrote it"
      }
      return originalHSetNX(key, field, value);
    };
    const result = await store.dealFor(id, 'racer');
    expect(result).toEqual(rivalDeal);
  });
});

describe('Store.accuse — exhausts every retry under persistent contention', () => {
  it('gives up after 4 attempts and reports ok:false, duplicate:false', async () => {
    const b = demoBundle();
    const { store, db } = await freshSeeded(b);
    const id = b.public.caseId;
    // Bump the watched key on every exec attempt, forever — a worst-case
    // "someone else always wins" scenario the retry loop must give up on.
    db.onBeforeExec = () => {
      void db.hIncrBy(K.accuse(id), '__contend__', 1);
    };
    const out = await store.accuse(id, 'u1', 'ada', b.truth.culpritId, 5, 1);
    expect(out).toEqual({ ok: false, duplicate: false, ts: 1 });
  });
});

describe('Store.runDrip — additional gates', () => {
  it('returns released:null when the truth section is missing (partial seed)', async () => {
    const b = demoBundle();
    const { store, db } = await freshSeeded(b);
    const id = b.public.caseId;
    await db.del(K.truth(id));
    const dripTime = LAUNCH + 13 * 3_600_000;
    expect((await store.runDrip(id, dripTime)).released).toBeNull();
  });

  it('returns released:null once the board is already fully filed', async () => {
    const b = demoBundle();
    const { store } = await freshSeeded(b);
    const id = b.public.caseId;
    let ts = 1;
    for (const s of b.shards) await store.fileCard(id, s.id, `u${ts}`, `filer${ts}`, 'app', ts++);
    const dripTime = LAUNCH + 13 * 3_600_000;
    const { released } = await store.runDrip(id, dripTime);
    expect(released).toBeNull();
  });
});

describe('Store.seasonPoints / citedPoints — a brand-new user has zero of both', () => {
  it('defaults to 0 with no zset entry at all', async () => {
    const db = new RedisStub();
    const store = new Store(db);
    expect(await store.seasonPoints('never-seen')).toBe(0);
    expect(await store.citedPoints('never-seen')).toBe(0);
  });
});

describe('Store.dateKey', () => {
  it('formats a UTC date key from an epoch ms timestamp', async () => {
    const store = new Store(new RedisStub());
    expect(store.dateKey(Date.UTC(2026, 6, 14, 23, 59, 0))).toBe('2026-07-14');
  });
});
