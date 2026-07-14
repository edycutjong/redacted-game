import { describe, expect, it } from 'vitest';
import { computeMeter } from '../src/server/core/meter';
import { caseDay, DAY_MS, nextVerdictTs, utcDateKey, VERDICT_HOUR_UTC } from '../src/server/core/time';

describe('computeMeter', () => {
  it('computes a rounded percentage', () => {
    expect(computeMeter(30, 49).pct).toBe(61);
  });
  it('clamps revealed into [0,total]', () => {
    expect(computeMeter(-5, 40)).toEqual({ revealed: 0, total: 40, pct: 0 });
    expect(computeMeter(99, 40)).toEqual({ revealed: 40, total: 40, pct: 100 });
  });
  it('treats a zero-shard case as 0%', () => {
    expect(computeMeter(0, 0)).toEqual({ revealed: 0, total: 0, pct: 0 });
  });
});

describe('time helpers', () => {
  const launch = Date.UTC(2026, 6, 14, 0, 0, 0);
  it('caseDay starts at 1 and advances each day', () => {
    expect(caseDay(launch, launch)).toBe(1);
    expect(caseDay(launch, launch + DAY_MS)).toBe(2);
    expect(caseDay(launch, launch + 3 * DAY_MS + 5000)).toBe(4);
  });
  it('caseDay never drops below 1', () => {
    expect(caseDay(launch, launch - DAY_MS)).toBe(1);
  });
  it('nextVerdictTs lands on VERDICT_HOUR_UTC', () => {
    const ts = nextVerdictTs(Date.UTC(2026, 6, 14, 9, 0, 0));
    expect(new Date(ts).getUTCHours()).toBe(VERDICT_HOUR_UTC);
  });
  it('nextVerdictTs rolls to the next day once the hour has passed', () => {
    const now = Date.UTC(2026, 6, 14, 22, 0, 0);
    const ts = nextVerdictTs(now);
    expect(ts).toBeGreaterThan(now);
    expect(new Date(ts).getUTCDate()).toBe(15);
  });
  it('utcDateKey is a stable YYYY-MM-DD idempotency key', () => {
    expect(utcDateKey(Date.UTC(2026, 6, 4, 3, 2, 1))).toBe('2026-07-04');
  });
});
