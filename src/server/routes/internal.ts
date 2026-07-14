/**
 * /internal/* routes — scheduler crons, triggers, and mod menu actions. All are
 * idempotent (Store enforces this) and every Reddit-side effect is best-effort
 * (wrapped) so a platform hiccup never corrupts the authoritative board state.
 *
 * The onComment handler is a DEFENSIVE ADAPTER: the exact CommentCreate payload
 * shape is only confirmed at runtime (docs-cache/triggers.md), so it reads every
 * field optionally and no-ops on anything it does not recognise.
 */

import type { Hono } from 'hono';
import { redis, realtime, reddit, context } from '@devvit/web/server';
import type { OnCommentCreateRequest, UiResponse } from '@devvit/web/shared';
import { caseChannel } from '../../shared/api';
import type { BoardTileMessage } from '../../shared/api';
import { rankForCites } from '../../shared/case';
import { Store } from '../store';
import { parseCardMarker } from '../core/cardMarker';
import { CASE_BUNDLES, bundleById } from '../cases/registry';

const store = new Store(redis);

const toast = (text: string): UiResponse => ({ showToast: { text, appearance: 'success' } });

/** Lowest-numbered compiled case that has never been seeded on this install. */
const nextUnlaunchedCase = async (): Promise<string | undefined> => {
  const sorted = [...CASE_BUNDLES].sort((a, b) => a.public.number - b.public.number);
  for (const b of sorted) {
    const meta = await store.loadMeta(b.public.caseId);
    if (!meta) return b.public.caseId;
  }
  return undefined;
};

const launchCase = async (caseId: string, now: number): Promise<string | undefined> => {
  const bundle = bundleById(caseId);
  /* v8 ignore next -- launchCase is only ever called with an id nextUnlaunchedCase() (or seed-demo's own bundleById lookup) just drew from CASE_BUNDLES itself, so the lookup can never miss */
  if (!bundle) return undefined;
  await store.seedCase(bundle, now);
  await store.setLiveCase(caseId);
  try {
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: `CASE #${bundle.public.number} — ${bundle.public.title.toUpperCase()}`,
      entry: 'game',
    });
    await store.mapPostToCase(post.id, caseId);
    return post.id;
  } catch {
    return undefined;
  }
};

export const registerInternalRoutes = (app: Hono): void => {
  // ---- scheduler crons ----
  app.post('/internal/cron/drop', async (c) => {
    const now = Date.now();
    const next = await nextUnlaunchedCase();
    if (next) await launchCase(next, now);
    return c.json({ status: 'ok', launched: next ?? null });
  });

  app.post('/internal/cron/drip', async (c) => {
    const now = Date.now();
    const caseId = await store.getLiveCaseId();
    if (!caseId) return c.json({ status: 'ok', released: null });
    const { released, meterPct } = await store.runDrip(caseId, now);
    if (released) {
      const tile: BoardTileMessage = { kind: 'public-record', shardId: released, meterPct, ts: now };
      try {
        await realtime.send(caseChannel(caseId), tile);
      } catch {
        /* best-effort */
      }
    }
    return c.json({ status: 'ok', released });
  });

  app.post('/internal/cron/verdict', async (c) => {
    const now = Date.now();
    const caseId = await store.getLiveCaseId();
    if (!caseId) return c.json({ status: 'ok', verdict: null });
    const result = await store.runVerdict(caseId, now);
    if (result) {
      try {
        const body = [`# VERDICT — ${result.culpritName}`, '', ...result.reveal.map((r) => `> ${r}`)].join('\n');
        const postId = context.postId as `t3_${string}` | undefined;
        if (postId) {
          const comment = await reddit.submitComment({ id: postId, text: body, runAs: 'APP' });
          await comment.distinguish(true);
        }
      } catch {
        /* ceremony comment is best-effort */
      }
      // Flair the crowned early accusers (best-effort).
      for (const w of result.winners.slice(0, 12)) {
        try {
          const cited = await store.citedPoints(w.userId);
          await reddit.setUserFlair({
            subredditName: context.subredditName,
            username: w.username,
            text: rankForCites(cited),
          });
        } catch {
          /* flair is cosmetic */
        }
      }
      const tile: BoardTileMessage = { kind: 'verdict', meterPct: 100, ts: now };
      try {
        await realtime.send(caseChannel(caseId), tile);
      } catch {
        /* best-effort */
      }
    }
    return c.json({ status: 'ok' });
  });

  // ---- triggers ----
  app.post('/internal/triggers/post-create', async (c) => {
    // Nothing to reconcile on our own post creation; ack so retries settle.
    return c.json({});
  });

  app.post('/internal/triggers/on-comment', async (c) => {
    const now = Date.now();
    const input = (await c.req.json().catch(() => ({}))) as Partial<OnCommentCreateRequest>;
    const comment = input.comment as { id?: string; body?: string; author?: string } | undefined;
    const body = comment?.body;
    if (typeof body !== 'string') return c.json({});
    const marker = parseCardMarker(body);
    if (!marker) return c.json({}); // not one of our evidence cards
    const meta = await store.loadMeta(marker.caseId);
    if (!meta) return c.json({});
    const author = typeof comment?.author === 'string' && comment.author.length > 0 ? comment.author : 'detective';
    // Reconcile thread → board. fileCard is first-write-wins, so re-delivery of
    // the same comment (triggers are at-least-once) is a harmless duplicate.
    const outcome = await store.fileCard(marker.caseId, marker.shardId, '', author, 'user', now);
    if (!outcome.duplicate) {
      const tile: BoardTileMessage = { kind: 'card', shardId: marker.shardId, author, meterPct: outcome.meterPct, ts: now };
      try {
        await realtime.send(caseChannel(marker.caseId), tile);
      } catch {
        /* best-effort */
      }
    }
    return c.json({});
  });

  // ---- mod menu actions ----
  app.post('/internal/menu/seed-demo', async (c) => {
    const now = Date.now();
    /* v8 ignore next -- CASE_BUNDLES is a generated non-empty array (3 authored cases compiled in); case-017 is always among them, and even the ?? CASE_BUNDLES[0] fallback can't be undefined for a non-empty registry */
    const bundle = bundleById('case-017') ?? CASE_BUNDLES[0];
    /* v8 ignore next -- see above: bundle can never be undefined given the generated registry */
    if (!bundle) return c.json(toast('no cases compiled'));
    const { meterPct } = await store.seedDemoState(bundle, now, now);
    return c.json(toast(`Seeded ${bundle.public.title} at ${meterPct}%`));
  });

  app.post('/internal/menu/bonus-case', async (c) => {
    const now = Date.now();
    const next = await nextUnlaunchedCase();
    if (!next) return c.json(toast('no unlaunched cases left'));
    await launchCase(next, now);
    return c.json(toast(`Launched ${next}`));
  });

  app.post('/internal/menu/approve-forge', async (c) => {
    // Thin adapter: pop the oldest pending forge bundle. Full Forge intake
    // (YAML → same linter → queue) is a post-launch lane (SPEC §3).
    const pending = await redis.zRange('forge:queue', 0, 0, { by: 'rank' });
    if (pending.length === 0) return c.json(toast('forge queue empty'));
    await redis.zRem('forge:queue', [pending[0]!.member]);
    return c.json(toast(`Approved ${pending[0]!.member}`));
  });

  app.post('/internal/menu/hide-card', async (c) => {
    const caseId = await store.getLiveCaseId();
    if (!caseId) return c.json(toast('no live case'));
    const reported = await redis.zRange(`reports:${caseId}`, 0, 0, { by: 'rank', reverse: true });
    if (reported.length === 0) return c.json(toast('no reported cards'));
    await redis.hDel(`card:${caseId}`, [reported[0]!.member]);
    await redis.zRem(`board:${caseId}`, [reported[0]!.member]);
    await redis.zRem(`reports:${caseId}`, [reported[0]!.member]);
    return c.json(toast(`Hid card ${reported[0]!.member}`));
  });
};
