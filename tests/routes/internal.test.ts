/**
 * /internal/* routes — scheduler crons, triggers, mod-menu actions. All are
 * idempotent and every Reddit-side effect is best-effort. Mock
 * @devvit/web/server (redis/realtime/reddit/context) end-to-end through Hono.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { RedisStub } from '../helpers/redisStub';
import { Store } from '../../src/server/store';
import { buildCommentBody } from '../../src/server/core/cardMarker';

// See tests/routes/api.test.ts for why this must be a single reused instance
// (routes/internal.ts also does `const store = new Store(redis)` once, at
// module import time).
const redis = new RedisStub();
const mockContext: { subredditName: string; postId: string | undefined } = {
  subredditName: 'RedactedGame',
  postId: undefined,
};

const submitCustomPost = vi.fn(async (..._args: unknown[]) => ({ id: 't3_newpost' }));
const submitComment = vi.fn(async (..._args: unknown[]) => ({
  id: 't1_verdict',
  distinguish: vi.fn(async (..._a: unknown[]) => {}),
}));
const setUserFlair = vi.fn(async (..._args: unknown[]) => {});
const getCurrentUsername = vi.fn(async (..._args: unknown[]) => undefined as string | undefined);
const realtimeSend = vi.fn(async (..._args: unknown[]) => {});

vi.mock('@devvit/web/server', () => ({
  get context() {
    return mockContext;
  },
  redis,
  reddit: {
    submitCustomPost: (...a: unknown[]) => submitCustomPost(...a),
    submitComment: (...a: unknown[]) => submitComment(...a),
    setUserFlair: (...a: unknown[]) => setUserFlair(...a),
    getCurrentUsername: (...a: unknown[]) => getCurrentUsername(...a),
  },
  realtime: { send: (...a: unknown[]) => realtimeSend(...a) },
}));

const { registerInternalRoutes } = await import('../../src/server/routes/internal');
const { CASE_BUNDLES } = await import('../../src/server/cases/registry');

const NOW = Date.parse('2026-07-14T12:00:00Z');

function buildApp(): Hono {
  const app = new Hono();
  registerInternalRoutes(app);
  return app;
}

const post = (app: Hono, path: string, body?: unknown) =>
  app.request(path, {
    method: 'POST',
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
      : {}),
  });

beforeEach(() => {
  redis.reset();
  vi.setSystemTime(NOW);
  mockContext.postId = undefined;
  submitCustomPost.mockReset();
  submitCustomPost.mockResolvedValue({ id: 't3_newpost' });
  submitComment.mockReset();
  submitComment.mockResolvedValue({ id: 't1_verdict', distinguish: vi.fn(async () => {}) });
  setUserFlair.mockReset();
  setUserFlair.mockResolvedValue(undefined);
  realtimeSend.mockReset();
  realtimeSend.mockResolvedValue(undefined);
});

describe('POST /internal/cron/drop', () => {
  it('launches the lowest-numbered never-seeded case and maps its new post', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/cron/drop');
    const body = await res.json();
    const lowest = [...CASE_BUNDLES].sort((a, b) => a.public.number - b.public.number)[0]!;
    expect(body.launched).toBe(lowest.public.caseId);
    expect(submitCustomPost).toHaveBeenCalledTimes(1);
    const store = new Store(redis);
    expect(await store.caseIdForPost('t3_newpost')).toBe(lowest.public.caseId);
    expect(await store.getLiveCaseId()).toBe(lowest.public.caseId);
  });

  it('launches the next case in sequence once the first is already seeded', async () => {
    const store = new Store(redis);
    const sorted = [...CASE_BUNDLES].sort((a, b) => a.public.number - b.public.number);
    await store.seedCase(sorted[0]!, NOW);
    const app = buildApp();
    const res = await post(app, '/internal/cron/drop');
    const body = await res.json();
    expect(body.launched).toBe(sorted[1]!.public.caseId);
  });

  it('reports launched:null once every compiled case has been seeded', async () => {
    const store = new Store(redis);
    for (const b of CASE_BUNDLES) await store.seedCase(b, NOW);
    const app = buildApp();
    const res = await post(app, '/internal/cron/drop');
    const body = await res.json();
    expect(body.launched).toBeNull();
  });

  it('still reports launched (does not crash) when submitCustomPost fails', async () => {
    submitCustomPost.mockRejectedValueOnce(new Error('reddit down'));
    const app = buildApp();
    const res = await post(app, '/internal/cron/drop');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.launched).not.toBeNull();
    // The case was still seeded even though the post-creation failed.
    const store = new Store(redis);
    expect(await store.getLiveCaseId()).toBe(body.launched);
  });
});

describe('POST /internal/cron/drip', () => {
  it('reports released:null with no live case', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/cron/drip');
    const body = await res.json();
    expect(body.released).toBeNull();
  });

  it('reports released:null before the hour-12 gate opens', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW);
    await store.setLiveCase(b.public.caseId);
    const app = buildApp();
    const res = await post(app, '/internal/cron/drip');
    const body = await res.json();
    expect(body.released).toBeNull();
    expect(realtimeSend).not.toHaveBeenCalled();
  });

  it('releases the highest-information shard after hour 12 and broadcasts it', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    const launch = NOW - 13 * 3_600_000;
    await store.seedCase(b, launch);
    await store.setLiveCase(b.public.caseId);
    const app = buildApp();
    const res = await post(app, '/internal/cron/drip');
    const body = await res.json();
    expect(body.released).not.toBeNull();
    expect(realtimeSend).toHaveBeenCalledTimes(1);
    expect(realtimeSend.mock.calls[0]![1]).toMatchObject({ kind: 'public-record' });
  });

  it('is idempotent within the same case-hour (guarded by hSetNX)', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    const launch = NOW - 13 * 3_600_000;
    await store.seedCase(b, launch);
    await store.setLiveCase(b.public.caseId);
    const app = buildApp();
    await post(app, '/internal/cron/drip');
    realtimeSend.mockClear();
    const res = await post(app, '/internal/cron/drip');
    const body = await res.json();
    expect(body.released).toBeNull();
    expect(realtimeSend).not.toHaveBeenCalled();
  });

  it('still returns ok when realtime.send throws (best-effort)', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    const launch = NOW - 13 * 3_600_000;
    await store.seedCase(b, launch);
    await store.setLiveCase(b.public.caseId);
    realtimeSend.mockRejectedValueOnce(new Error('down'));
    const app = buildApp();
    const res = await post(app, '/internal/cron/drip');
    expect(res.status).toBe(200);
  });
});

describe('POST /internal/cron/verdict', () => {
  it('reports verdict:null with no live case', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/cron/verdict');
    const body = await res.json();
    expect(body.verdict).toBeNull();
  });

  it('is a no-op when the case is not yet ready to close (already-closed re-run)', async () => {
    // runVerdict returns undefined only if pub/truth are missing; simulate a
    // live pointer with no seeded case at all.
    const store = new Store(redis);
    await store.setLiveCase('ghost');
    const app = buildApp();
    const res = await post(app, '/internal/cron/verdict');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('resolves the verdict, posts + distinguishes a ceremony comment, flairs winners, and broadcasts', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW - 3_600_000);
    await store.setLiveCase(b.public.caseId);
    await store.fileCard(b.public.caseId, b.shards[0]!.id, 't2_a', 'ada', 'app', NOW - 1000);
    await store.accuse(b.public.caseId, 't2_winner', 'winner', b.truth.culpritId, 5, NOW - 500);
    mockContext.postId = 't3_livepost';

    const app = buildApp();
    const res = await post(app, '/internal/cron/verdict');
    expect(res.status).toBe(200);

    expect(submitComment).toHaveBeenCalledTimes(1);
    expect(setUserFlair).toHaveBeenCalledTimes(1);
    expect(setUserFlair).toHaveBeenCalledWith(
      expect.objectContaining({ subredditName: 'RedactedGame', username: 'winner' })
    );
    expect(realtimeSend).toHaveBeenCalledTimes(1);
    expect(realtimeSend.mock.calls[0]![1]).toMatchObject({ kind: 'verdict', meterPct: 100 });

    const stored = await store.storedVerdict(b.public.caseId);
    expect(stored).toBeDefined();
  });

  it('is idempotent at the ledger — a second run never re-applies rank/rep awards', async () => {
    // Store.runVerdict persists the FIRST result and returns it verbatim on
    // every later call without re-running zIncrBy, so the season/rep ledgers
    // never double-count even though the scheduler may tick the cron again
    // after the case has already closed (the reddit ceremony comment itself
    // is re-announced each tick — see the next test).
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW - 3_600_000);
    await store.setLiveCase(b.public.caseId);
    await store.accuse(b.public.caseId, 't2_winner', 'winner', b.truth.culpritId, 5, NOW - 500);
    mockContext.postId = 't3_livepost';
    const app = buildApp();
    await post(app, '/internal/cron/verdict');
    const pointsAfterFirst = await store.seasonPoints('t2_winner');
    const res = await post(app, '/internal/cron/verdict');
    expect(res.status).toBe(200);
    expect(await store.seasonPoints('t2_winner')).toBe(pointsAfterFirst);
  });

  it('tolerates no bound postId (skips the ceremony comment) and reddit failures (best-effort)', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW - 3_600_000);
    await store.setLiveCase(b.public.caseId);
    await store.accuse(b.public.caseId, 't2_winner', 'winner', b.truth.culpritId, 5, NOW - 500);
    setUserFlair.mockRejectedValueOnce(new Error('flair down'));
    realtimeSend.mockRejectedValueOnce(new Error('rt down'));
    mockContext.postId = undefined;
    const app = buildApp();
    const res = await post(app, '/internal/cron/verdict');
    expect(res.status).toBe(200);
    expect(submitComment).not.toHaveBeenCalled();
  });

  it('caps flair updates at the first 12 winners', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW - 3_600_000);
    await store.setLiveCase(b.public.caseId);
    for (let i = 0; i < 15; i++) {
      await store.accuse(b.public.caseId, `t2_w${i}`, `winner${i}`, b.truth.culpritId, 1, NOW - 1000 + i);
    }
    const app = buildApp();
    await post(app, '/internal/cron/verdict');
    expect(setUserFlair).toHaveBeenCalledTimes(12);
  });
});

describe('POST /internal/triggers/post-create', () => {
  it('always acks with an empty body', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/triggers/post-create');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});

describe('POST /internal/triggers/on-comment', () => {
  it('no-ops on an unparsable body', async () => {
    const app = buildApp();
    const res = await app.request('/internal/triggers/on-comment', {
      method: 'POST',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('no-ops when comment.body is missing/not a string', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/triggers/on-comment', { comment: { id: 't1_x' } });
    expect(await res.json()).toEqual({});
  });

  it('no-ops on a comment with no evidence-card marker', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/triggers/on-comment', {
      comment: { id: 't1_x', body: 'just chatting', author: 'someone' },
    });
    expect(await res.json()).toEqual({});
  });

  it('no-ops when the marker names a case with no meta on this install', async () => {
    const app = buildApp();
    const body = buildCommentBody({ caseId: 'case-999', caseNumber: 999, shardId: 'SHXX', text: 't' });
    const res = await post(app, '/internal/triggers/on-comment', {
      comment: { id: 't1_x', body, author: 'someone' },
    });
    expect(await res.json()).toEqual({});
  });

  it('reconciles a real evidence-card comment onto the board and broadcasts', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW);
    const shardId = b.shards[0]!.id;
    const app = buildApp();
    const commentBody = buildCommentBody({
      caseId: b.public.caseId,
      caseNumber: b.public.number,
      shardId,
      text: 'irrelevant here',
    });
    const res = await post(app, '/internal/triggers/on-comment', {
      comment: { id: 't1_x', body: commentBody, author: 'some_redditor' },
    });
    expect(res.status).toBe(200);
    expect(realtimeSend).toHaveBeenCalledTimes(1);
    const cards = await store.cards(b.public.caseId);
    expect(cards[shardId]!.author).toBe('some_redditor');
  });

  it('defaults to "detective" when the comment has no author', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW);
    const shardId = b.shards[0]!.id;
    const app = buildApp();
    const commentBody = buildCommentBody({
      caseId: b.public.caseId,
      caseNumber: b.public.number,
      shardId,
      text: 't',
    });
    await post(app, '/internal/triggers/on-comment', { comment: { id: 't1_x', body: commentBody } });
    const cards = await store.cards(b.public.caseId);
    expect(cards[shardId]!.author).toBe('detective');
  });

  it('is a harmless duplicate on re-delivery (at-least-once triggers) and does not re-broadcast', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW);
    const shardId = b.shards[0]!.id;
    const app = buildApp();
    const commentBody = buildCommentBody({
      caseId: b.public.caseId,
      caseNumber: b.public.number,
      shardId,
      text: 't',
    });
    await post(app, '/internal/triggers/on-comment', {
      comment: { id: 't1_x', body: commentBody, author: 'first' },
    });
    realtimeSend.mockClear();
    const res = await post(app, '/internal/triggers/on-comment', {
      comment: { id: 't1_x', body: commentBody, author: 'first' },
    });
    expect(res.status).toBe(200);
    expect(realtimeSend).not.toHaveBeenCalled();
  });

  it('still 200s (best-effort) when realtime.send throws', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW);
    const shardId = b.shards[0]!.id;
    realtimeSend.mockRejectedValueOnce(new Error('down'));
    const app = buildApp();
    const commentBody = buildCommentBody({
      caseId: b.public.caseId,
      caseNumber: b.public.number,
      shardId,
      text: 't',
    });
    const res = await post(app, '/internal/triggers/on-comment', {
      comment: { id: 't1_x', body: commentBody, author: 'someone' },
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /internal/menu/seed-demo', () => {
  it('seeds case-017 (or the first compiled bundle) at the deterministic ~61% mark', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/menu/seed-demo');
    const body = await res.json();
    expect(body.showToast.text).toContain('Seeded');
    const store = new Store(redis);
    expect(await store.getLiveCaseId()).toBeDefined();
  });
});

describe('POST /internal/menu/bonus-case', () => {
  it('launches the next unlaunched case', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/menu/bonus-case');
    const body = await res.json();
    expect(body.showToast.text).toContain('Launched');
  });

  it('toasts "no unlaunched cases left" once everything is seeded', async () => {
    const store = new Store(redis);
    for (const b of CASE_BUNDLES) await store.seedCase(b, NOW);
    const app = buildApp();
    const res = await post(app, '/internal/menu/bonus-case');
    const body = await res.json();
    expect(body.showToast.text).toBe('no unlaunched cases left');
  });
});

describe('POST /internal/menu/approve-forge', () => {
  it('toasts "forge queue empty" when nothing is queued', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/menu/approve-forge');
    const body = await res.json();
    expect(body.showToast.text).toBe('forge queue empty');
  });

  it('pops and approves the oldest queued forge submission', async () => {
    await redis.zAdd('forge:queue', { member: 'bundle-a', score: 1 }, { member: 'bundle-b', score: 2 });
    const app = buildApp();
    const res = await post(app, '/internal/menu/approve-forge');
    const body = await res.json();
    expect(body.showToast.text).toBe('Approved bundle-a');
    expect(await redis.zCard('forge:queue')).toBe(1);
  });
});

describe('POST /internal/menu/hide-card', () => {
  it('toasts "no live case" with no live case', async () => {
    const app = buildApp();
    const res = await post(app, '/internal/menu/hide-card');
    const body = await res.json();
    expect(body.showToast.text).toBe('no live case');
  });

  it('toasts "no reported cards" when nothing was reported', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW);
    await store.setLiveCase(b.public.caseId);
    const app = buildApp();
    const res = await post(app, '/internal/menu/hide-card');
    const body = await res.json();
    expect(body.showToast.text).toBe('no reported cards');
  });

  it('hides the most-reported card from the board and card hash', async () => {
    const store = new Store(redis);
    const b = CASE_BUNDLES[0]!;
    await store.seedCase(b, NOW);
    await store.setLiveCase(b.public.caseId);
    const shardId = b.shards[0]!.id;
    await store.fileCard(b.public.caseId, shardId, 't2_a', 'ada', 'app', NOW);
    await redis.zAdd(`reports:${b.public.caseId}`, { member: shardId, score: 3 });
    const app = buildApp();
    const res = await post(app, '/internal/menu/hide-card');
    const body = await res.json();
    expect(body.showToast.text).toBe(`Hid card ${shardId}`);
    const cards = await store.cards(b.public.caseId);
    expect(cards[shardId]).toBeUndefined();
    expect(await store.boardSet(b.public.caseId)).not.toContain(shardId);
  });
});
