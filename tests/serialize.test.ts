import { describe, expect, it } from 'vitest';
import type { CardRecord } from '../src/server/store';
import {
  shardDocIndex,
  toBoardCards,
  toCaseSummary,
  toLitContradictions,
  toShardViews,
  toSuspectStates,
} from '../src/server/serialize';
import { eliminatedSuspects } from '../src/server/core/deduction';
import { computeMeter } from '../src/server/core/meter';
import type { CaseResponse } from '../src/shared/api';
import { demoBundle } from './helpers/bundles';

/** Assemble a client CaseResponse exactly as the /api/case route does. */
const buildCaseResponse = (): { resp: CaseResponse; json: string; undealtShardText: string } => {
  const b = demoBundle();
  const pub = b.public;
  const order = b.shards.map((s) => s.id);
  const textOf = new Map(b.shards.map((s) => [s.id, s.text]));

  const dealt = new Set([order[0]!, order[1]!, order[2]!]);
  const boardShard = order[10]!;
  const publicShard = order[11]!;
  const cards: Record<string, CardRecord> = {
    [boardShard]: {
      text: textOf.get(boardShard)!,
      author: 'rd_precinct_ada',
      authorUserId: 't2_ada',
      ts: 1,
      via: 'user',
      publicRecord: false,
    },
    [publicShard]: {
      text: textOf.get(publicShard)!,
      author: 'PUBLIC RECORD',
      authorUserId: '',
      ts: 2,
      via: 'none',
      publicRecord: true,
    },
  };

  const board = new Set(Object.keys(cards));
  const struck = eliminatedSuspects(b.truth, board);
  const shards = toShardViews(pub, { dealt, cards });
  for (const v of shards) if (v.visibility === 'mine') v.text = textOf.get(v.shardId)!;

  const resp: CaseResponse = {
    type: 'case',
    case: toCaseSummary({
      pub,
      day: 3,
      status: 'open',
      meter: computeMeter(board.size, order.length),
      filedCount: board.size,
      verdictAtUtc: new Date(0).toISOString(),
      suspects: toSuspectStates(pub, new Map(), struck),
    }),
    shards,
    you: { username: 'judge', seasonPoints: 0, citedPoints: 0, accused: false },
  };

  // An undealt, unfiled shard whose text must never leak.
  const undealt = order.find((s) => !dealt.has(s) && !board.has(s))!;
  return { resp, json: JSON.stringify(resp), undealtShardText: textOf.get(undealt)! };
};

describe('I2 — truth is never serialized to the client', () => {
  const b = demoBundle();
  const { resp, json, undealtShardText } = buildCaseResponse();

  it('the response contains no truth motive or summary', () => {
    expect(json).not.toContain(b.truth.motive);
    expect(json).not.toContain(b.truth.summary);
  });

  it('the response contains no verdict reveal beat', () => {
    for (const beat of b.truth.reveal) expect(json).not.toContain(beat);
  });

  it('the response contains no fact text and no elimination graph', () => {
    for (const f of b.truth.facts) expect(json).not.toContain(f.text);
    expect(json).not.toContain('eliminations');
    expect(json).not.toContain('"supports"');
  });

  it('never leaks the text of an undealt, unfiled shard', () => {
    expect(json).not.toContain(undealtShardText);
  });

  it('emits censored bars with NO text field', () => {
    const censored = resp.shards.filter((s) => s.visibility === 'censored');
    expect(censored.length).toBeGreaterThan(0);
    for (const s of censored) expect(s.text).toBeUndefined();
  });

  it('DOES surface the viewer own + board + public shard text (what they may see)', () => {
    expect(resp.shards.some((s) => s.visibility === 'mine' && typeof s.text === 'string')).toBe(true);
    expect(resp.shards.some((s) => s.visibility === 'board' && typeof s.text === 'string')).toBe(true);
    expect(resp.shards.some((s) => s.visibility === 'public' && typeof s.text === 'string')).toBe(true);
  });
});

describe('board serializers', () => {
  const b = demoBundle();
  const cards: Record<string, CardRecord> = {
    [b.contradictions[0]!.a]: { text: 'a-text', author: 'ada', authorUserId: 'u1', ts: 1, via: 'user', publicRecord: false },
    [b.contradictions[0]!.b]: { text: 'b-text', author: 'boyle', authorUserId: 'u2', ts: 2, via: 'app', publicRecord: false },
  };

  it('toBoardCards sorts by timestamp and masks public-record authorship', () => {
    const withPub: Record<string, CardRecord> = {
      ...cards,
      Z: { text: 'z', author: 'x', authorUserId: '', ts: 0, via: 'none', publicRecord: true },
    };
    const out = toBoardCards(withPub);
    expect(out.map((c) => c.ts)).toEqual([0, 1, 2]);
    expect(out.find((c) => c.publicRecord)!.author).toBe('PUBLIC RECORD');
  });

  it('toLitContradictions lights a pair once both sides are filed', () => {
    const board = new Set(Object.keys(cards));
    const lit = toLitContradictions(b.contradictions, board, cards);
    expect(lit.length).toBeGreaterThanOrEqual(1);
    expect(lit[0]!.aText).toBe('a-text');
  });

  it('falls back to empty text if a lit shard has no card yet (board/cards read race)', () => {
    // board and cards are two independent, non-transactional Redis reads in
    // the /api/board route; a card can file between them. toLitContradictions
    // must not throw and must degrade to '' rather than leak stale/undefined text.
    const board = new Set(Object.keys(cards));
    const lit = toLitContradictions(b.contradictions, board, {});
    expect(lit.length).toBeGreaterThanOrEqual(1);
    expect(lit[0]!.aText).toBe('');
    expect(lit[0]!.bText).toBe('');
  });

  it('toSuspectStates marks eliminated suspects', () => {
    const struck = new Set([b.public.suspects.find((s) => s.id !== b.truth.culpritId)!.id]);
    const states = toSuspectStates(b.public, new Map(), struck);
    expect(states.some((s) => s.eliminated)).toBe(true);
    expect(states.find((s) => s.id === b.truth.culpritId)!.eliminated).toBe(false);
  });

  it('shardDocIndex maps every shard to its containing document title', () => {
    const index = shardDocIndex(b.public);
    for (const doc of b.public.docs) {
      for (const line of doc.lines) {
        if (line.kind === 'shard') expect(index.get(line.shardId)).toBe(doc.title);
      }
    }
    expect(index.size).toBe(b.public.totalShards);
  });
});
