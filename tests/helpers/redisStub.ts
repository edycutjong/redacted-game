/**
 * In-memory Redis stub implementing exactly the RedisLike surface the store
 * uses, with real WATCH/MULTI/EXEC optimistic-concurrency semantics so the
 * single-accusation escrow (I4) is exercised under contention, not just the
 * happy path. Signatures mirror docs-cache/dts/redis/RedisClient.d.ts.
 */

import type { RedisLike, SetOptions, TxLike, ZMember, ZRangeOptions } from '../../src/server/redisLike';

type Hash = Map<string, string>;
type ZSet = Map<string, number>;

const rankSlice = (members: string[], start: number, stop: number): string[] => {
  const n = members.length;
  const s = start < 0 ? Math.max(0, n + start) : start;
  const e = stop < 0 ? n + stop : stop;
  return members.slice(s, e + 1);
};

export class RedisStub implements RedisLike {
  private strings = new Map<string, string>();
  private hashes = new Map<string, Hash>();
  private zsets = new Map<string, ZSet>();
  /** Per-key mutation counter for optimistic WATCH. */
  private versions = new Map<string, number>();

  /**
   * Test-only: wipe all state in place (same object identity). Route modules
   * capture `redis` once at import time (`const store = new Store(redis)`),
   * so per-test isolation for route tests must clear THIS instance rather
   * than swap in a fresh one — a reassigned `let redis = new RedisStub()`
   * would go unseen by any module that already captured the old reference.
   */
  reset(): void {
    this.strings.clear();
    this.hashes.clear();
    this.zsets.clear();
    this.versions.clear();
  }

  /** Test-only: a stable structural snapshot for equality assertions. */
  dump(): unknown {
    const sortObj = (m: Map<string, unknown>): Record<string, unknown> =>
      Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
    return {
      strings: sortObj(this.strings),
      hashes: sortObj(new Map([...this.hashes].map(([k, v]) => [k, sortObj(v)]))),
      zsets: sortObj(new Map([...this.zsets].map(([k, v]) => [k, sortObj(v)]))),
    };
  }

  private bump(key: string): void {
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }

  // ---- strings ----
  async get(key: string): Promise<string | undefined> {
    return this.strings.get(key);
  }
  async set(key: string, value: string, options?: SetOptions): Promise<string> {
    if (options?.nx && this.strings.has(key)) return '';
    if (options?.xx && !this.strings.has(key)) return '';
    this.strings.set(key, value);
    this.bump(key);
    return 'OK';
  }
  async del(...keys: string[]): Promise<void> {
    for (const k of keys) {
      this.strings.delete(k);
      this.hashes.delete(k);
      this.zsets.delete(k);
      this.bump(k);
    }
  }
  async exists(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.strings.has(k) || this.hashes.has(k) || this.zsets.has(k)) n++;
    }
    return n;
  }
  async incrBy(key: string, value: number): Promise<number> {
    const next = Number(this.strings.get(key) ?? '0') + value;
    this.strings.set(key, String(next));
    this.bump(key);
    return next;
  }
  async expire(_key: string, _seconds: number): Promise<void> {
    /* no-op: TTL not modelled */
  }

  // ---- hashes ----
  private hash(key: string): Hash {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    return h;
  }
  async hGet(key: string, field: string): Promise<string | undefined> {
    return this.hashes.get(key)?.get(field);
  }
  async hMGet(key: string, fields: string[]): Promise<(string | null)[]> {
    const h = this.hashes.get(key);
    return fields.map((f) => h?.get(f) ?? null);
  }
  async hSet(key: string, fieldValues: Record<string, string>): Promise<number> {
    const h = this.hash(key);
    let added = 0;
    for (const [f, v] of Object.entries(fieldValues)) {
      if (!h.has(f)) added++;
      h.set(f, v);
    }
    this.bump(key);
    return added;
  }
  async hSetNX(key: string, field: string, value: string): Promise<number> {
    const h = this.hash(key);
    if (h.has(field)) return 0;
    h.set(field, value);
    this.bump(key);
    return 1;
  }
  async hGetAll(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key)?.entries() ?? []);
  }
  async hDel(key: string, fields: string[]): Promise<number> {
    const h = this.hashes.get(key);
    if (!h) return 0;
    let n = 0;
    for (const f of fields) if (h.delete(f)) n++;
    this.bump(key);
    return n;
  }
  async hKeys(key: string): Promise<string[]> {
    return [...(this.hashes.get(key)?.keys() ?? [])];
  }
  async hIncrBy(key: string, field: string, value: number): Promise<number> {
    const h = this.hash(key);
    const next = Number(h.get(field) ?? '0') + value;
    h.set(field, String(next));
    this.bump(key);
    return next;
  }
  async hLen(key: string): Promise<number> {
    return this.hashes.get(key)?.size ?? 0;
  }

  // ---- sorted sets ----
  private zset(key: string): ZSet {
    let z = this.zsets.get(key);
    if (!z) {
      z = new Map();
      this.zsets.set(key, z);
    }
    return z;
  }
  private ranked(key: string, reverse = false): string[] {
    const z = this.zsets.get(key);
    if (!z) return [];
    const members = [...z.entries()].sort(
      ([am, as], [bm, bs]) => as - bs || am.localeCompare(bm)
    );
    const ids = members.map(([m]) => m);
    return reverse ? ids.reverse() : ids;
  }
  async zAdd(key: string, ...members: ZMember[]): Promise<number> {
    const z = this.zset(key);
    let added = 0;
    for (const m of members) {
      if (!z.has(m.member)) added++;
      z.set(m.member, m.score);
    }
    this.bump(key);
    return added;
  }
  async zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: ZRangeOptions
  ): Promise<{ member: string; score: number }[]> {
    const z = this.zsets.get(key);
    if (!z) return [];
    const ids = this.ranked(key, options?.reverse);
    const sliced =
      typeof start === 'number' && typeof stop === 'number'
        ? rankSlice(ids, start, stop)
        : ids;
    return sliced.map((m) => ({ member: m, score: z.get(m)! }));
  }
  async zRem(key: string, members: string[]): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    let n = 0;
    for (const m of members) if (z.delete(m)) n++;
    this.bump(key);
    return n;
  }
  async zScore(key: string, member: string): Promise<number | undefined> {
    return this.zsets.get(key)?.get(member);
  }
  async zRank(key: string, member: string): Promise<number | undefined> {
    const ids = this.ranked(key);
    const i = ids.indexOf(member);
    return i < 0 ? undefined : i;
  }
  async zIncrBy(key: string, member: string, value: number): Promise<number> {
    const z = this.zset(key);
    const next = (z.get(member) ?? 0) + value;
    z.set(member, next);
    this.bump(key);
    return next;
  }
  async zCard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  // ---- transactions (optimistic) ----
  async watch(...keys: string[]): Promise<TxLike> {
    const snapshot = new Map(keys.map((k) => [k, this.versions.get(k) ?? 0]));
    return new TxStub(this, snapshot);
  }

  /** Internal escape hatch used by the transaction to detect concurrent writes. */
  _version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  /**
   * Test-only hook: fires once right before exec() validates its watch set,
   * so a test can inject a deterministic racing write (bump a watched key)
   * instead of relying on real concurrency. Not one-shot by default — a test
   * that wants persistent contention (e.g. exhausting every retry attempt)
   * can re-arm it from inside the callback itself.
   */
  onBeforeExec: (() => void) | null = null;
}

type Queued = () => Promise<unknown>;

class TxStub implements TxLike {
  private queue: Queued[] = [];
  constructor(
    private readonly db: RedisStub,
    private readonly watched: Map<string, number>
  ) {}

  async multi(): Promise<void> {
    /* begins the queued block; queued ops run atomically at exec() */
  }
  async discard(): Promise<void> {
    this.queue = [];
  }
  async unwatch(): Promise<TxLike> {
    this.watched.clear();
    return this;
  }
  async exec(): Promise<unknown[] | null> {
    this.db.onBeforeExec?.();
    // Abort if any watched key changed since watch() — mirrors Redis EXEC.
    for (const [k, v] of this.watched) {
      if (this.db._version(k) !== v) return null;
    }
    const results: unknown[] = [];
    for (const op of this.queue) results.push(await op());
    return results;
  }

  private enqueue(fn: () => Promise<unknown>): this {
    this.queue.push(fn);
    return this;
  }

  async set(key: string, value: string, options?: SetOptions): Promise<TxLike> {
    return this.enqueue(() => this.db.set(key, value, options));
  }
  async incrBy(key: string, value: number): Promise<TxLike> {
    return this.enqueue(() => this.db.incrBy(key, value));
  }
  async hSet(key: string, fieldValues: Record<string, string>): Promise<TxLike> {
    return this.enqueue(() => this.db.hSet(key, fieldValues));
  }
  async hSetNX(key: string, field: string, value: string): Promise<TxLike> {
    return this.enqueue(() => this.db.hSetNX(key, field, value));
  }
  async hIncrBy(key: string, field: string, value: number): Promise<TxLike> {
    return this.enqueue(() => this.db.hIncrBy(key, field, value));
  }
  async hDel(key: string, fields: string[]): Promise<TxLike> {
    return this.enqueue(() => this.db.hDel(key, fields));
  }
  async zAdd(key: string, ...members: ZMember[]): Promise<TxLike> {
    return this.enqueue(() => this.db.zAdd(key, ...members));
  }
  async zIncrBy(key: string, member: string, value: number): Promise<TxLike> {
    return this.enqueue(() => this.db.zIncrBy(key, member, value));
  }
  async zRem(key: string, members: string[]): Promise<TxLike> {
    return this.enqueue(() => this.db.zRem(key, members));
  }
}
