/**
 * Redis key schema (see ARCHITECTURE.md → Redis schema). Truth is split from
 * the public half at COMPILE time; here it also lives under a distinct key
 * (`case:{id}:truth`) that no /api handler ever reads into a response.
 *
 * Storage primitives: string, hash, sorted set + watch/multi/exec ONLY — no
 * plain redis lists/sets (hard-limit compliance).
 */

export const K = {
  live: 'live:caseId',
  pub: (id: string) => `case:${id}:public`,
  truth: (id: string) => `case:${id}:truth`,
  contradictions: (id: string) => `case:${id}:contradictions`,
  shardText: (id: string) => `case:${id}:shardText`,
  shardOrder: (id: string) => `case:${id}:shardOrder`,
  meta: (id: string) => `case:${id}:meta`,
  pivot: (id: string) => `pivot:${id}`,
  board: (id: string) => `board:${id}`,
  card: (id: string) => `card:${id}`,
  deal: (id: string) => `deal:${id}`,
  accuse: (id: string) => `accuse:${id}`,
  accuseTally: (id: string) => `accuseTally:${id}`,
  dripGuards: (id: string) => `drip:${id}:guards`,
  verdict: (id: string) => `verdict:${id}`,
  postToCase: 'postToCase',
  closed: 'closed:cases',
  forgeQueue: 'forge:queue',
  reports: (id: string) => `reports:${id}`,
  repCited: 'rep:cited',
  rankSeason: 'rank:season',
} as const;
