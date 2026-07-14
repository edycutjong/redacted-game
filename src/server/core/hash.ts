/** Pure deterministic hashing + PRNG. No platform imports. */

/** FNV-1a 32-bit over a UTF-16 string (stable across platforms for our inputs). */
export const fnv1a = (input: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** mulberry32 — tiny deterministic PRNG seeded from a 32-bit int. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Deterministic partial Fisher–Yates: pick k items from pool using rng. */
export const pickK = <T>(pool: readonly T[], k: number, rng: () => number): T[] => {
  const arr = [...pool];
  const n = Math.min(k, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    const a = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = a;
  }
  return arr.slice(0, n);
};

/** Stable censor-bar width in ch units derived from the shard id, NOT its text. */
export const barWidthFor = (shardId: string): number => 14 + (fnv1a(`bar‖${shardId}`) % 17);
