/**
 * getViewer reads the Devvit `context` singleton defensively (logged-out
 * fallback to loid, then 'anon'; username default 'detective'). Mock
 * @devvit/web/server's context so every branch is exercised without a live
 * platform.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockContext: Record<string, unknown> = {};

vi.mock('@devvit/web/server', () => ({
  get context() {
    return mockContext;
  },
}));

const { getViewer } = await import('../src/server/viewer');

beforeEach(() => {
  for (const k of Object.keys(mockContext)) delete mockContext[k];
});

describe('getViewer', () => {
  it('uses the real userId as dealerId when logged in', () => {
    mockContext.userId = 't2_alice';
    mockContext.username = 'alice';
    mockContext.postId = 't3_abc';
    mockContext.subredditName = 'RedactedGame';
    const v = getViewer();
    expect(v).toEqual({
      dealerId: 't2_alice',
      userId: 't2_alice',
      username: 'alice',
      postId: 't3_abc',
      subredditName: 'RedactedGame',
    });
  });

  it('falls back to the logged-out id (loid) when there is no userId', () => {
    mockContext.loid = 't2_loid123';
    const v = getViewer();
    expect(v.dealerId).toBe('t2_loid123');
    expect(v.userId).toBeUndefined();
  });

  it('falls back to "anon" when neither userId nor loid is present', () => {
    const v = getViewer();
    expect(v.dealerId).toBe('anon');
  });

  it('defaults username to "detective" when context has none', () => {
    const v = getViewer();
    expect(v.username).toBe('detective');
  });
});
