/**
 * The exact subset of the Devvit RedisClient surface the store touches.
 *
 * The real `redis` singleton (`@devvit/web/server`) is structurally assignable
 * to `RedisLike`, and the in-memory test stub implements the same shape — so
 * store logic is exercised in vitest without the platform. Signatures mirror
 * docs-cache/dts/redis/RedisClient.d.ts. NO plain list/set commands are used
 * (hashes + sorted sets + transactions only), per the hard-limit compliance.
 */

export type ZMember = { member: string; score: number };
export type ZRangeOptions = {
  reverse?: boolean;
  by: 'score' | 'lex' | 'rank';
  limit?: { offset: number; count: number };
};
export type SetOptions = { nx?: boolean; xx?: boolean; expiration?: Date };

/** Transaction handle from `watch()`. Every queued op resolves to the handle. */
export type TxLike = {
  multi(): Promise<void>;
  exec(): Promise<unknown[] | null>;
  discard(): Promise<void>;
  unwatch(): Promise<TxLike>;
  set(key: string, value: string, options?: SetOptions): Promise<TxLike>;
  incrBy(key: string, value: number): Promise<TxLike>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<TxLike>;
  hSetNX(key: string, field: string, value: string): Promise<TxLike>;
  hIncrBy(key: string, field: string, value: number): Promise<TxLike>;
  hDel(key: string, fields: string[]): Promise<TxLike>;
  zAdd(key: string, ...members: ZMember[]): Promise<TxLike>;
  zIncrBy(key: string, member: string, value: number): Promise<TxLike>;
  zRem(key: string, members: string[]): Promise<TxLike>;
};

export type RedisLike = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, options?: SetOptions): Promise<string>;
  del(...keys: string[]): Promise<void>;
  exists(...keys: string[]): Promise<number>;
  incrBy(key: string, value: number): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hMGet(key: string, fields: string[]): Promise<(string | null)[]>;
  hSet(key: string, fieldValues: Record<string, string>): Promise<number>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hDel(key: string, fields: string[]): Promise<number>;
  hKeys(key: string): Promise<string[]>;
  hIncrBy(key: string, field: string, value: number): Promise<number>;
  hLen(key: string): Promise<number>;
  zAdd(key: string, ...members: ZMember[]): Promise<number>;
  zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: ZRangeOptions
  ): Promise<{ member: string; score: number }[]>;
  zRem(key: string, members: string[]): Promise<number>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zRank(key: string, member: string): Promise<number | undefined>;
  zIncrBy(key: string, member: string, value: number): Promise<number>;
  zCard(key: string): Promise<number>;
  watch(...keys: string[]): Promise<TxLike>;
};
