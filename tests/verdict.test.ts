import { describe, expect, it } from 'vitest';
import {
  CITE_POINTS,
  PODIUM_BONUS,
  resolveVerdict,
  type Accusation,
  type BoardEvent,
  type VerdictInput,
} from '../src/server/core/verdict';
import type { TruthSection } from '../src/server/cases/types';
import { demoBundle } from './helpers/bundles';

const authoredBoard = (shardIds: string[]): BoardEvent[] =>
  shardIds.map((shardId, i) => ({
    shardId,
    authorUserId: `u_${shardId}`,
    author: `filer_${shardId}`,
    ts: 1000 + i,
    publicRecord: false,
  }));

describe('resolveVerdict — real demo case, full board', () => {
  const b = demoBundle();
  const culprit = b.truth.culpritId;
  const nonCulprit = b.public.suspects.map((s) => s.id).filter((s) => s !== culprit);

  const accusations: Accusation[] = [
    { userId: 'w1', username: 'ada', suspectId: culprit, stake: 10, ts: 100 },
    { userId: 'w2', username: 'boyle', suspectId: culprit, stake: 10, ts: 200 },
    { userId: 'w3', username: 'cole', suspectId: culprit, stake: 10, ts: 300 },
    { userId: 'w4', username: 'dane', suspectId: culprit, stake: 10, ts: 400 },
    { userId: 'lose', username: 'nope', suspectId: nonCulprit[0]!, stake: 10, ts: 150 },
  ];
  const input: VerdictInput = {
    truth: b.truth,
    suspects: b.public.suspects.map((s) => ({ id: s.id, name: s.name })),
    accusations,
    boardEvents: authoredBoard(b.shards.map((s) => s.id)),
    closedAt: 9999,
  };

  it('is a pure function — two runs are byte-identical', () => {
    expect(JSON.stringify(resolveVerdict(input))).toBe(JSON.stringify(resolveVerdict(input)));
  });

  it('names the authored culprit', () => {
    const v = resolveVerdict(input);
    expect(v.culpritId).toBe(culprit);
    expect(v.culpritName).toBe(b.public.suspects.find((s) => s.id === culprit)!.name);
  });

  it('crowns correct accusers in timestamp order with podium bonuses', () => {
    const v = resolveVerdict(input);
    expect(v.winners.map((w) => w.userId)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(v.winners[0]!.payout).toBe(10 * 2 + PODIUM_BONUS[0]);
    expect(v.winners[1]!.payout).toBe(10 * 2 + PODIUM_BONUS[1]);
    expect(v.winners[2]!.payout).toBe(10 * 2 + PODIUM_BONUS[2]);
    expect(v.winners[3]!.payout).toBe(10 * 2); // 4th: no podium bonus
  });

  it('excludes wrong accusers from the winners', () => {
    expect(resolveVerdict(input).winners.some((w) => w.userId === 'lose')).toBe(false);
  });

  it('eliminates every non-culprit and cites backing cards', () => {
    const v = resolveVerdict(input);
    expect([...v.eliminatedSuspectIds].sort()).toEqual([...nonCulprit].sort());
    expect(v.citedCards.length).toBeGreaterThan(0);
  });

  it('awards citation rep to the cited authors', () => {
    const v = resolveVerdict(input);
    for (const c of v.citedCards) {
      const rep = v.repAwards.find((r) => r.userId === c.authorUserId);
      expect(rep).toBeDefined();
      expect(rep!.delta % CITE_POINTS).toBe(0);
    }
  });
});

describe('resolveVerdict — citation rules (synthetic)', () => {
  const truth: TruthSection = {
    culpritId: 'C',
    motive: 'because',
    summary: 's',
    reveal: ['one', 'two'],
    facts: [
      { id: 'F1', text: 'f1', supports: ['pub', 'auth'] },
      { id: 'F2', text: 'f2', supports: ['x'] },
    ],
    eliminations: [{ suspectId: 'A', paths: [['F1', 'F2']] }],
  };
  const input: VerdictInput = {
    truth,
    suspects: [
      { id: 'C', name: 'Cee' },
      { id: 'A', name: 'Ay' },
    ],
    accusations: [],
    boardEvents: [
      { shardId: 'pub', authorUserId: '', author: 'PUBLIC RECORD', ts: 10, publicRecord: true },
      { shardId: 'auth', authorUserId: 'uA', author: 'ada', ts: 20, publicRecord: false },
      { shardId: 'x', authorUserId: 'uX', author: 'xen', ts: 30, publicRecord: false },
    ],
    closedAt: 1,
  };

  it('a public-record drip completes the path but earns no citation', () => {
    const v = resolveVerdict(input);
    expect(v.eliminatedSuspectIds).toEqual(['A']);
    expect(v.citedCards.map((c) => c.shardId).sort()).toEqual(['auth', 'x']);
    expect(v.citedCards.some((c) => c.shardId === 'pub')).toBe(false);
  });

  it('routes citation rep only to authored filers', () => {
    const v = resolveVerdict(input);
    expect(v.repAwards.map((r) => r.userId).sort()).toEqual(['uA', 'uX']);
    expect(v.repAwards.every((r) => r.delta === CITE_POINTS)).toBe(true);
  });
});

describe('resolveVerdict — the verdict cron can close a case before it is fully solved', () => {
  // The scheduler closes at a fixed hour regardless of how much of the board
  // is filled; a suspect whose elimination path never completed is simply
  // never struck, and earns no citation (no path ever finished => no bestTs).
  const truth: TruthSection = {
    culpritId: 'C',
    motive: 'because',
    summary: 's',
    reveal: [],
    facts: [
      { id: 'F1', text: 'f1', supports: ['s1'] },
      { id: 'F2', text: 'f2', supports: ['never-filed'] },
    ],
    eliminations: [{ suspectId: 'A', paths: [['F1', 'F2']] }],
  };
  const input: VerdictInput = {
    truth,
    suspects: [
      { id: 'C', name: 'Cee' },
      { id: 'A', name: 'Ay' },
    ],
    accusations: [],
    boardEvents: [{ shardId: 's1', authorUserId: 'u1', author: 'ada', ts: 1, publicRecord: false }],
    closedAt: 5,
  };

  it('never eliminates a suspect whose path never fully completed, and cites nothing for it', () => {
    const v = resolveVerdict(input);
    expect(v.eliminatedSuspectIds).toEqual([]);
    expect(v.citedCards).toEqual([]);
  });
});

describe('resolveVerdict — a citation with no known author earns no rank/rep award', () => {
  // Reconciled via the onComment trigger with an unresolved userId (empty
  // authorUserId, via:'user', not a public-record drip) — the card is on the
  // board and can still be cited, but there is no account to credit.
  const truth: TruthSection = {
    culpritId: 'C',
    motive: 'because',
    summary: 's',
    reveal: [],
    facts: [{ id: 'F1', text: 'f1', supports: ['s1'] }],
    eliminations: [{ suspectId: 'A', paths: [['F1']] }],
  };
  const input: VerdictInput = {
    truth,
    suspects: [
      { id: 'C', name: 'Cee' },
      { id: 'A', name: 'Ay' },
    ],
    accusations: [],
    boardEvents: [{ shardId: 's1', authorUserId: '', author: 'unknown_redditor', ts: 1, publicRecord: false }],
    closedAt: 5,
  };

  it('cites the card but awards no rank or rep points (no userId to credit)', () => {
    const v = resolveVerdict(input);
    expect(v.eliminatedSuspectIds).toEqual(['A']);
    expect(v.citedCards.map((c) => c.shardId)).toEqual(['s1']);
    expect(v.rankAwards).toEqual([]);
    expect(v.repAwards).toEqual([]);
  });
});

describe('resolveVerdict — a shard re-appearing in boardEvents keeps its FIRST timestamp', () => {
  // e.g. the on-comment trigger re-delivers a comment (at-least-once) and
  // fileCard's first-write-wins means a second BoardEvent for the same shard
  // can still show up in the timeline; only the earliest ts must count.
  const truth: TruthSection = {
    culpritId: 'C',
    motive: 'because',
    summary: 's',
    reveal: [],
    facts: [{ id: 'F1', text: 'f1', supports: ['s1'] }],
    eliminations: [{ suspectId: 'A', paths: [['F1']] }],
  };
  const input: VerdictInput = {
    truth,
    suspects: [
      { id: 'C', name: 'Cee' },
      { id: 'A', name: 'Ay' },
    ],
    accusations: [],
    boardEvents: [
      { shardId: 's1', authorUserId: 'u1', author: 'ada', ts: 50, publicRecord: false },
      // A later duplicate delivery of the same shard — must not overwrite the earlier ts.
      { shardId: 's1', authorUserId: 'u1', author: 'ada', ts: 999, publicRecord: false },
    ],
    closedAt: 5,
  };

  it('uses the earliest timestamp for a duplicated board event', () => {
    const v = resolveVerdict(input);
    expect(v.eliminatedSuspectIds).toEqual(['A']);
    expect(v.citedCards.map((c) => c.shardId)).toEqual(['s1']);
  });
});

describe('resolveVerdict — a fact established only by public-record drips earns no citation', () => {
  const truth: TruthSection = {
    culpritId: 'C',
    motive: 'because',
    summary: 's',
    reveal: [],
    facts: [{ id: 'F1', text: 'f1', supports: ['pub-only'] }],
    eliminations: [{ suspectId: 'A', paths: [['F1']] }],
  };
  const input: VerdictInput = {
    truth,
    suspects: [
      { id: 'C', name: 'Cee' },
      { id: 'A', name: 'Ay' },
    ],
    accusations: [],
    boardEvents: [{ shardId: 'pub-only', authorUserId: '', author: 'PUBLIC RECORD', ts: 1, publicRecord: true }],
    closedAt: 5,
  };

  it('eliminates the suspect (the path completes) but cites no card at all', () => {
    const v = resolveVerdict(input);
    expect(v.eliminatedSuspectIds).toEqual(['A']);
    expect(v.citedCards).toEqual([]);
  });
});

describe('resolveVerdict — same-timestamp correct accusations tie-break by userId', () => {
  const truth: TruthSection = {
    culpritId: 'C',
    motive: 'm',
    summary: 's',
    reveal: [],
    facts: [],
    eliminations: [],
  };
  const input: VerdictInput = {
    truth,
    suspects: [{ id: 'C', name: 'Cee' }],
    accusations: [
      { userId: 'zed', username: 'zed', suspectId: 'C', stake: 5, ts: 100 },
      { userId: 'abe', username: 'abe', suspectId: 'C', stake: 5, ts: 100 },
    ],
    boardEvents: [],
    closedAt: 5,
  };

  it('orders identical-timestamp winners by userId ascending', () => {
    const v = resolveVerdict(input);
    expect(v.winners.map((w) => w.userId)).toEqual(['abe', 'zed']);
    expect(v.winners[0]!.payout).toBe(5 * 2 + PODIUM_BONUS[0]);
  });
});
