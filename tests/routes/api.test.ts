/**
 * Public /api/* routes — exercised end-to-end through the Hono app with
 * @devvit/web/server mocked out (context/redis/reddit/realtime), so no live
 * Devvit runtime is needed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { RedisStub } from '../helpers/redisStub';
import { demoBundle } from '../helpers/bundles';
import { Store } from '../../src/server/store';
import { K } from '../../src/server/keys';

// NOTE: routes/api.ts does `const store = new Store(redis)` ONCE at module
// import time (a module-level singleton, matching production). That means a
// per-test `let redis = new RedisStub()` reassignment would go UNSEEN by the
// route (it captured the old object reference at import). So this file keeps
// a single `redis` instance for the whole file and resets its contents
// in-place between tests instead of swapping in a new object.
const redis = new RedisStub();
const mockContext: {
  userId: string | undefined;
  loid: string | undefined;
  username: string | undefined;
  postId: string | undefined;
  subredditName: string;
} = {
  userId: undefined,
  loid: undefined,
  username: undefined,
  postId: undefined,
  subredditName: 'RedactedGame',
};

const submitComment = vi.fn(async (..._args: unknown[]) => ({ id: 't1_mock' }));
const realtimeSend = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@devvit/web/server', () => ({
  get context() {
    return mockContext;
  },
  redis,
  reddit: { submitComment: (...a: unknown[]) => submitComment(...a) },
  realtime: { send: (...a: unknown[]) => realtimeSend(...a) },
}));

const { registerApiRoutes } = await import('../../src/server/routes/api');

const NOW = Date.parse('2026-07-14T12:00:00Z');
const LAUNCH = Date.parse('2026-07-11T00:00:00Z');

function buildApp(): Hono {
  const app = new Hono();
  registerApiRoutes(app);
  return app;
}

beforeEach(() => {
  redis.reset();
  vi.setSystemTime(NOW);
  mockContext.userId = undefined;
  mockContext.loid = undefined;
  mockContext.username = undefined;
  mockContext.postId = undefined;
  submitComment.mockReset();
  submitComment.mockResolvedValue({ id: 't1_mock' });
  realtimeSend.mockReset();
  realtimeSend.mockResolvedValue(undefined);
});

describe('GET /api/case', () => {
  it('returns 404 when there is no live case and no bound post', async () => {
    const app = buildApp();
    const res = await app.request('/api/case');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.status).toBe('error');
  });

  it('resolves the case from a bound postId', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.mapPostToCase('t3_abc', b.public.caseId);
    mockContext.postId = 't3_abc';
    const app = buildApp();
    const res = await app.request('/api/case');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('case');
    expect(body.case.caseId).toBe(b.public.caseId);
  });

  it('falls back to the live case when the post is unbound', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    const app = buildApp();
    const res = await app.request('/api/case');
    const body = await res.json();
    expect(body.case.caseId).toBe(b.public.caseId);
  });

  it('404s when the case bundle vanished after the live pointer was set', async () => {
    const store = new Store(redis);
    await store.setLiveCase('ghost-case');
    const app = buildApp();
    const res = await app.request('/api/case');
    expect(res.status).toBe(404);
  });

  it('still serves the case (with no suspects struck) when the truth section is missing', async () => {
    // pub + meta seeded normally, but truth vanished (partial/corrupt state) —
    // the route must degrade rather than 500.
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    await redis.del(K.truth(b.public.caseId));
    const app = buildApp();
    const res = await app.request('/api/case');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.case.suspects.every((s: { eliminated: boolean }) => s.eliminated === false)).toBe(true);
  });

  it('reports season + cited points and accusation state for a logged-in viewer', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    mockContext.userId = 't2_alice';
    mockContext.username = 'alice';
    await store.accuse(b.public.caseId, 't2_alice', 'alice', b.truth.culpritId, 10, NOW);
    const app = buildApp();
    const res = await app.request('/api/case');
    const body = await res.json();
    expect(body.you.username).toBe('alice');
    expect(body.you.accused).toBe(true);
    expect(typeof body.you.seasonPoints).toBe('number');
  });

  it('reports zero points and no accusation for an anonymous viewer', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    const app = buildApp();
    const res = await app.request('/api/case');
    const body = await res.json();
    expect(body.you.seasonPoints).toBe(0);
    expect(body.you.citedPoints).toBe(0);
    expect(body.you.accused).toBe(false);
  });

  it('attaches the viewer own dealt text for shards marked "mine"', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const res = await app.request('/api/case');
    const body = await res.json();
    const mine = body.shards.filter((s: { visibility: string }) => s.visibility === 'mine');
    expect(mine.length).toBeGreaterThan(0);
    for (const s of mine) expect(typeof s.text).toBe('string');
  });
});

describe('GET /api/my-shards', () => {
  it('returns 404 with no live case', async () => {
    const app = buildApp();
    const res = await app.request('/api/my-shards');
    expect(res.status).toBe(404);
  });

  it('lists the dealt shards with filed status + doc title', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const res = await app.request('/api/my-shards');
    const body = await res.json();
    expect(body.type).toBe('my-shards');
    expect(body.shards.length).toBeGreaterThan(0);
    for (const s of body.shards) {
      expect(typeof s.text).toBe('string');
      expect(typeof s.docTitle).toBe('string');
      expect(typeof s.filed).toBe('boolean');
    }
  });

  it('404s when the case bundle vanished after the live pointer was set', async () => {
    const store = new Store(redis);
    await store.setLiveCase('ghost-case');
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const res = await app.request('/api/my-shards');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/file', () => {
  const setup = async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    return { store, b };
  };

  it('404s with no live case', async () => {
    const app = buildApp();
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId: 'SH01', via: 'app' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  it('404s when the case bundle vanished after the live pointer was set', async () => {
    const store = new Store(redis);
    await store.setLiveCase('ghost-case');
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId: 'SH01', via: 'app' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  it('400s when shardId is missing', async () => {
    await setup();
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('tolerates an unparsable JSON body (still 400s on missing shardId)', async () => {
    await setup();
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const res = await app.request('/api/file', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it("403s when filing a shard the viewer doesn't hold", async () => {
    await setup();
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId: 'not-a-real-shard-id', via: 'app' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(403);
  });

  it('400s when the sanitizer rejects the note', async () => {
    await setup();
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const my = await app.request('/api/my-shards');
    const myBody = await my.json();
    const shardId = myBody.shards[0].shardId;
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId, via: 'app', note: 'go check u/someuser now' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('files a held shard via the app account and broadcasts a board tile', async () => {
    await setup();
    mockContext.loid = 't2_loid_judge';
    mockContext.username = 'judge';
    const app = buildApp();
    const my = await app.request('/api/my-shards');
    const myBody = await my.json();
    const shardId = myBody.shards[0].shardId;
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId, via: 'app' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe('filed');
    expect(body.duplicate).toBe(false);
    expect(realtimeSend).toHaveBeenCalledTimes(1);
  });

  it('files under the user account when postId is bound and via:"user" succeeds', async () => {
    const { store, b } = await setup();
    await store.mapPostToCase('t3_post', b.public.caseId);
    mockContext.postId = 't3_post';
    mockContext.userId = 't2_alice';
    mockContext.username = 'alice';
    const app = buildApp();
    const my = await app.request('/api/my-shards');
    const myBody = await my.json();
    const shardId = myBody.shards[0].shardId;
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId, via: 'user' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json();
    expect(body.via).toBe('user');
    expect(submitComment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't3_post', runAs: 'USER' })
    );
  });

  it('reports a duplicate without re-broadcasting when the shard is already filed', async () => {
    await setup();
    mockContext.loid = 't2_loid_judge';
    const app = buildApp();
    const my = await app.request('/api/my-shards');
    const myBody = await my.json();
    const shardId = myBody.shards[0].shardId;
    await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId, via: 'app' }),
      headers: { 'Content-Type': 'application/json' },
    });
    realtimeSend.mockClear();
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId, via: 'app' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(realtimeSend).not.toHaveBeenCalled();
  });

  it('still returns 200 (best-effort) when realtime.send throws', async () => {
    await setup();
    mockContext.loid = 't2_loid_judge';
    realtimeSend.mockRejectedValueOnce(new Error('realtime down'));
    const app = buildApp();
    const my = await app.request('/api/my-shards');
    const myBody = await my.json();
    const shardId = myBody.shards[0].shardId;
    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId, via: 'app' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
  });

  it('surfaces a litContradiction + eliminated suspects when filing completes them', async () => {
    const { store, b } = await setup();
    mockContext.loid = 't2_loid_1';
    const app = buildApp();

    // File the demo's first contradiction partner + drive an elimination path
    // directly through Store so /api/file's own call is the one that lights it.
    const c0 = b.contradictions[0]!;
    await store.fileCard(b.public.caseId, c0.a, 't2_seed', 'seed', 'app', LAUNCH + 1);

    // Find a viewer whose deal includes c0.b.
    let dealer = 0;
    let deal = await store.dealFor(b.public.caseId, `probe-${dealer}`);
    while (!deal.shardIds.includes(c0.b) && dealer < 200) {
      dealer++;
      deal = await store.dealFor(b.public.caseId, `probe-${dealer}`);
    }
    expect(deal.shardIds).toContain(c0.b);
    mockContext.loid = `probe-${dealer}`;

    const res = await app.request('/api/file', {
      method: 'POST',
      body: JSON.stringify({ shardId: c0.b, via: 'app' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json();
    expect(body.litContradiction).toBeDefined();
    expect(body.litContradiction.withShardId).toBe(c0.a);
  });
});

describe('GET /api/board', () => {
  it('404s with no live case', async () => {
    const app = buildApp();
    const res = await app.request('/api/board');
    expect(res.status).toBe(404);
  });

  it('returns the current cards + contradictions + meter', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    await store.fileCard(b.public.caseId, b.shards[0]!.id, 't2_a', 'ada', 'app', LAUNCH + 1);
    const app = buildApp();
    const res = await app.request('/api/board');
    const body = await res.json();
    expect(body.type).toBe('board');
    expect(body.cards.length).toBe(1);
    expect(typeof body.meter.pct).toBe('number');
  });
});

describe('POST /api/accuse', () => {
  it('401s when logged out', async () => {
    const app = buildApp();
    const res = await app.request('/api/accuse', {
      method: 'POST',
      body: JSON.stringify({ suspectId: 'S1', stake: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('404s with no live case', async () => {
    mockContext.userId = 't2_alice';
    const app = buildApp();
    const res = await app.request('/api/accuse', {
      method: 'POST',
      body: JSON.stringify({ suspectId: 'S1', stake: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  it('400s when suspectId or stake is missing/malformed', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    mockContext.userId = 't2_alice';
    const app = buildApp();
    const res = await app.request('/api/accuse', {
      method: 'POST',
      body: JSON.stringify({ suspectId: 'S1', stake: 'ten' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('tolerates an unparsable JSON body (still 400s on missing suspectId/stake)', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    mockContext.userId = 't2_alice';
    const app = buildApp();
    const res = await app.request('/api/accuse', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('accuses successfully and floors/clamps a fractional negative stake', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    mockContext.userId = 't2_alice';
    mockContext.username = 'alice';
    const app = buildApp();
    const res = await app.request('/api/accuse', {
      method: 'POST',
      body: JSON.stringify({ suspectId: b.truth.culpritId, stake: -3.7 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stake).toBe(0);
  });

  it('409s on a duplicate accusation', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    mockContext.userId = 't2_alice';
    mockContext.username = 'alice';
    const app = buildApp();
    await app.request('/api/accuse', {
      method: 'POST',
      body: JSON.stringify({ suspectId: b.truth.culpritId, stake: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await app.request('/api/accuse', {
      method: 'POST',
      body: JSON.stringify({ suspectId: b.truth.culpritId, stake: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toContain('already accused');
  });

  it('409s with "accusation failed" when the escrow retry loop is exhausted (non-duplicate)', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    mockContext.userId = 't2_alice';
    mockContext.username = 'alice';
    redis.onBeforeExec = () => {
      void redis.hIncrBy(K.accuse(b.public.caseId), '__contend__', 1);
    };
    const app = buildApp();
    const res = await app.request('/api/accuse', {
      method: 'POST',
      body: JSON.stringify({ suspectId: b.truth.culpritId, stake: 10 }),
      headers: { 'Content-Type': 'application/json' },
    });
    redis.onBeforeExec = null;
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toBe('accusation failed');
  });
});

describe('GET /api/verdict', () => {
  it('404s with no live case', async () => {
    const app = buildApp();
    const res = await app.request('/api/verdict');
    expect(res.status).toBe(404);
  });

  it('returns null verdict before the case closes', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    const app = buildApp();
    const res = await app.request('/api/verdict');
    const body = await res.json();
    expect(body.verdict).toBeNull();
  });

  it('returns the resolved verdict summary once the case closes, including a winner + citations', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    let ts = 1;
    for (const s of b.shards) await store.fileCard(b.public.caseId, s.id, `u_${s.id}`, `filer_${s.id}`, 'app', LAUNCH + ts++);
    await store.accuse(b.public.caseId, 't2_winner', 'winner', b.truth.culpritId, 10, LAUNCH + 500);
    await store.runVerdict(b.public.caseId, LAUNCH + 3_600_000 * 5);
    const app = buildApp();
    const res = await app.request('/api/verdict');
    const body = await res.json();
    expect(body.verdict).not.toBeNull();
    expect(body.verdict.culpritId).toBe(b.truth.culpritId);
    expect(body.verdict.winners).toEqual([
      { username: 'winner', payout: expect.any(Number), rankDelta: expect.any(Number) },
    ]);
    expect(body.verdict.citedCards.length).toBeGreaterThan(0);
    // citedCards text is always redacted to '' in the verdict summary (server never re-serializes truth text here).
    for (const cc of body.verdict.citedCards) expect(cc.text).toBe('');
  });
});

describe('GET /api/archive', () => {
  it('returns an empty list when nothing has closed', async () => {
    const app = buildApp();
    const res = await app.request('/api/archive');
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });

  it('lists a closed case with its solve timeline, winners, and cited authors', async () => {
    const store = new Store(redis);
    const b = demoBundle();
    await store.seedCase(b, LAUNCH);
    await store.setLiveCase(b.public.caseId);
    let ts = 1;
    for (const s of b.shards) await store.fileCard(b.public.caseId, s.id, `u_${s.id}`, `filer_${s.id}`, 'app', LAUNCH + ts++);
    await store.accuse(b.public.caseId, 't2_winner', 'winner', b.truth.culpritId, 10, LAUNCH + 500);
    await store.runVerdict(b.public.caseId, LAUNCH + 3_600_000 * 5);
    const app = buildApp();
    const res = await app.request('/api/archive');
    const body = await res.json();
    expect(body.entries.length).toBe(1);
    expect(body.entries[0].caseId).toBe(b.public.caseId);
    expect(body.entries[0].solveHours).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.entries[0].timeline)).toBe(true);
    expect(body.entries[0].citedAuthors.length).toBeGreaterThan(0);
  });

  it('skips a closed caseId whose bundle/verdict/meta later vanished', async () => {
    const store = new Store(redis);
    await redis.zAdd(K.closed, { member: 'ghost-closed', score: 1 });
    void store;
    const app = buildApp();
    const res = await app.request('/api/archive');
    const body = await res.json();
    expect(body.entries).toEqual([]);
  });
});
