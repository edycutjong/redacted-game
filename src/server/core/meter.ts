/** Case meter — % of shards unredacted on the public board. Pure. */

export type Meter = { revealed: number; total: number; pct: number };

export const computeMeter = (revealedCount: number, totalShards: number): Meter => {
  const revealed = Math.max(0, Math.min(revealedCount, totalShards));
  const pct = totalShards === 0 ? 0 : Math.round((revealed / totalShards) * 100);
  return { revealed, total: totalShards, pct };
};
