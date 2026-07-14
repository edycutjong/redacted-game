/** Time helpers. Pure — `now` is always injected by callers. */

export const DAY_MS = 86_400_000;

export const caseDay = (launchTs: number, now: number): number =>
  Math.max(1, Math.floor((now - launchTs) / DAY_MS) + 1);

/** UTC date key for cron idempotency guards, e.g. "2026-07-14". */
export const utcDateKey = (now: number): string => {
  const d = new Date(now);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
};

export const VERDICT_HOUR_UTC = 21;

/** Next 21:00 UTC at or after `now`. */
export const nextVerdictTs = (now: number): number => {
  const d = new Date(now);
  const today = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    VERDICT_HOUR_UTC,
    0,
    0
  );
  return now <= today ? today : today + DAY_MS;
};
