/**
 * Public /api/* routes — thin adapters over Store + serialize. No route builds
 * a response by hand from the truth section; everything client-facing goes
 * through serialize.ts (the I2 boundary).
 */

import type { Hono } from 'hono';
import { redis, realtime } from '@devvit/web/server';
import type {
  AccuseRequest,
  AccuseResponse,
  ArchiveResponse,
  BoardResponse,
  CaseResponse,
  ErrorResponse,
  FileRequest,
  FileResponse,
  MyShardsResponse,
  VerdictResponse,
} from '../../shared/api';
import { caseChannel } from '../../shared/api';
import type { BoardTileMessage } from '../../shared/api';
import type { ArchiveEntry } from '../../shared/case';
import { Store } from '../store';
import { getViewer } from '../viewer';
import { fileEvidenceComment } from '../postComment';
import { sanitizeNote } from '../core/filters';
import { eliminatedSuspects } from '../core/deduction';
import {
  toBoardCards,
  toCaseSummary,
  toLitContradictions,
  toShardViews,
  toSuspectStates,
  shardDocIndex,
} from '../serialize';

const store = new Store(redis);

const resolveCaseId = async (postId: string | undefined): Promise<string | undefined> => {
  const byPost = postId ? await store.caseIdForPost(postId) : undefined;
  return byPost ?? (await store.getLiveCaseId());
};

const err = (message: string): ErrorResponse => ({ status: 'error', message });

export const registerApiRoutes = (app: Hono): void => {
  app.get('/api/case', async (c) => {
    const now = Date.now();
    const viewer = getViewer();
    const caseId = await resolveCaseId(viewer.postId);
    if (!caseId) return c.json(err('no live case'), 404);
    const pub = await store.loadPublic(caseId);
    const meta = await store.loadMeta(caseId);
    const truth = await store.loadTruth(caseId);
    if (!pub || !meta) return c.json(err('case not found'), 404);

    const deal = await store.dealFor(caseId, viewer.dealerId);
    const dealt = new Set(deal.shardIds);
    const cards = await store.cards(caseId);
    const board = await store.boardSet(caseId);
    const meter = await store.meter(caseId);
    const lean = await store.suspectLean(caseId);
    const struck = truth ? eliminatedSuspects(truth, board) : new Set<string>();

    const shards = toShardViews(pub, { dealt, cards });
    // Attach the viewer's own dealt text (serialize leaves `mine` text blank so
    // it never needs shard text itself).
    for (const view of shards) {
      if (view.visibility === 'mine') {
        /* v8 ignore next -- a 'mine' shardId always came from the viewer's deal, whose ids are drawn from shardOrder, which shardText is populated 1:1 from at seed time, so the fallback can't fire */
        view.text = (await store.shardTextOf(caseId, view.shardId)) ?? '';
      }
    }

    const summary = toCaseSummary({
      pub,
      day: store.caseDay(meta.launchTs, now),
      status: meta.status,
      meter,
      filedCount: await store.filedCount(caseId),
      verdictAtUtc: store.verdictAtUtc(now),
      suspects: toSuspectStates(pub, lean, struck),
    });

    const resp: CaseResponse = {
      type: 'case',
      case: summary,
      shards,
      you: {
        username: viewer.username,
        seasonPoints: viewer.userId ? await store.seasonPoints(viewer.userId) : 0,
        citedPoints: viewer.userId ? await store.citedPoints(viewer.userId) : 0,
        accused: viewer.userId ? await store.accusationOf(caseId, viewer.userId) : false,
      },
    };
    return c.json(resp);
  });

  app.get('/api/my-shards', async (c) => {
    const viewer = getViewer();
    const caseId = await resolveCaseId(viewer.postId);
    if (!caseId) return c.json(err('no live case'), 404);
    const pub = await store.loadPublic(caseId);
    if (!pub) return c.json(err('case not found'), 404);
    const docTitle = shardDocIndex(pub);
    const deal = await store.dealFor(caseId, viewer.dealerId);
    const cards = await store.cards(caseId);
    const shards = await Promise.all(
      deal.shardIds.map(async (shardId) => ({
        shardId,
        /* v8 ignore next -- shardId comes from the viewer's deal, whose ids are drawn from shardOrder, which shardText is populated 1:1 from at seed time, so the fallback can't fire */
        text: (await store.shardTextOf(caseId, shardId)) ?? '',
        filed: cards[shardId] !== undefined,
        /* v8 ignore next -- shardId is always drawn from the case's own shardOrder, and compile.ts requires every shard to appear in exactly one doc line, so docTitle.get(shardId) is always defined here */
        docTitle: docTitle.get(shardId) ?? '',
      }))
    );
    const resp: MyShardsResponse = { type: 'my-shards', caseId, shards };
    return c.json(resp);
  });

  app.post('/api/file', async (c) => {
    const now = Date.now();
    const viewer = getViewer();
    const caseId = await resolveCaseId(viewer.postId);
    if (!caseId) return c.json(err('no live case'), 404);
    const pub = await store.loadPublic(caseId);
    if (!pub) return c.json(err('case not found'), 404);

    const body = (await c.req.json().catch(() => ({}))) as Partial<FileRequest>;
    const shardId = body.shardId;
    if (!shardId) return c.json(err('shardId required'), 400);

    const deal = await store.dealFor(caseId, viewer.dealerId);
    if (!deal.shardIds.includes(shardId)) {
      return c.json(err('you can only file a shard you hold'), 403);
    }
    const note = sanitizeNote(body.note);
    if (!note.ok) return c.json(err(note.violations.join('; ')), 400);

    const comment = await fileEvidenceComment(viewer.postId, body.via === 'user', {
      caseId,
      caseNumber: pub.number,
      shardId,
      /* v8 ignore next -- shardId was just verified to be one of the viewer's dealt shards (line above), and every dealt shard id comes from shardOrder, which shardText is populated 1:1 from at seed time, so the fallback can't fire */
      text: (await store.shardTextOf(caseId, shardId)) ?? '',
      note: note.cleaned || undefined,
    });

    const outcome = await store.fileCard(
      caseId,
      shardId,
      viewer.userId ?? viewer.dealerId,
      viewer.username,
      comment.via,
      now
    );

    if (!outcome.duplicate) {
      const tile: BoardTileMessage = {
        kind: 'card',
        shardId,
        author: viewer.username,
        /* v8 ignore next -- same shardId as above; its text is always populated (see the earlier ignore note) */
        text: (await store.shardTextOf(caseId, shardId)) ?? '',
        meterPct: outcome.meterPct,
        ts: now,
      };
      try {
        await realtime.send(caseChannel(caseId), tile);
      } catch {
        /* realtime is best-effort; the board read is the source of truth */
      }
    }

    const resp: FileResponse = {
      type: 'filed',
      shardId,
      duplicate: outcome.duplicate,
      meterPct: outcome.meterPct,
      via: outcome.via,
      ...(outcome.litContradiction ? { litContradiction: outcome.litContradiction } : {}),
      eliminatedSuspectIds: outcome.eliminatedSuspectIds,
    };
    return c.json(resp);
  });

  app.get('/api/board', async (c) => {
    const viewer = getViewer();
    const caseId = await resolveCaseId(viewer.postId);
    if (!caseId) return c.json(err('no live case'), 404);
    const cards = await store.cards(caseId);
    const board = await store.boardSet(caseId);
    const contradictions = await store.loadContradictions(caseId);
    const meter = await store.meter(caseId);
    const resp: BoardResponse = {
      type: 'board',
      caseId,
      cards: toBoardCards(cards),
      contradictions: toLitContradictions(contradictions, board, cards),
      meter,
    };
    return c.json(resp);
  });

  app.post('/api/accuse', async (c) => {
    const now = Date.now();
    const viewer = getViewer();
    if (!viewer.userId) return c.json(err('sign in to accuse'), 401);
    const caseId = await resolveCaseId(viewer.postId);
    if (!caseId) return c.json(err('no live case'), 404);
    const body = (await c.req.json().catch(() => ({}))) as Partial<AccuseRequest>;
    if (!body.suspectId || typeof body.stake !== 'number') {
      return c.json(err('suspectId and stake required'), 400);
    }
    const outcome = await store.accuse(
      caseId,
      viewer.userId,
      viewer.username,
      body.suspectId,
      Math.max(0, Math.floor(body.stake)),
      now
    );
    if (!outcome.ok) {
      return c.json(err(outcome.duplicate ? 'you already accused this case' : 'accusation failed'), 409);
    }
    const resp: AccuseResponse = {
      type: 'accused',
      suspectId: body.suspectId,
      stake: Math.max(0, Math.floor(body.stake)),
      ts: outcome.ts,
    };
    return c.json(resp);
  });

  app.get('/api/verdict', async (c) => {
    const viewer = getViewer();
    const caseId = await resolveCaseId(viewer.postId);
    if (!caseId) return c.json(err('no live case'), 404);
    const v = await store.storedVerdict(caseId);
    const resp: VerdictResponse = {
      type: 'verdict',
      caseId,
      verdict: v
        ? {
            culpritId: v.culpritId,
            culpritName: v.culpritName,
            motive: v.motive,
            reveal: v.reveal,
            closedAt: v.closedAt,
            winners: v.winners.map((w) => ({
              username: w.username,
              payout: w.payout,
              rankDelta: w.payout,
            })),
            citedCards: v.citedCards.map((cc) => ({ shardId: cc.shardId, author: cc.author, text: '' })),
          }
        : null,
    };
    return c.json(resp);
  });

  app.get('/api/archive', async (c) => {
    const ids = await store.closedCaseIds();
    const entries: ArchiveEntry[] = [];
    for (const caseId of ids) {
      const pub = await store.loadPublic(caseId);
      const v = await store.storedVerdict(caseId);
      const meta = await store.loadMeta(caseId);
      if (!pub || !v || !meta) continue;
      entries.push({
        caseId,
        number: pub.number,
        title: pub.title,
        tagline: pub.tagline,
        culpritName: v.culpritName,
        closedAt: v.closedAt,
        solveHours: Math.max(0, Math.round((v.closedAt - meta.launchTs) / 3_600_000)),
        timeline: v.reveal.map((event, t) => ({ t, event })),
        citedAuthors: [...new Set(v.citedCards.map((cc) => cc.author).filter(Boolean))],
      });
    }
    const resp: ArchiveResponse = { type: 'archive', entries };
    return c.json(resp);
  });
};
