/**
 * fileEvidenceComment: consent-gated comment post with a fallback to the app
 * account, and a final via:'none' if even that fails (the card still lands
 * on the board without a Reddit comment). Mock reddit.submitComment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitComment = vi.fn();

vi.mock('@devvit/web/server', () => ({
  reddit: { submitComment: (...a: unknown[]) => submitComment(...a) },
}));

const { fileEvidenceComment } = await import('../src/server/postComment');

const card = {
  caseId: 'case-017',
  caseNumber: 17,
  shardId: 'SH01',
  text: 'the pawn ticket was dated the 14th',
};

beforeEach(() => {
  submitComment.mockReset();
});

describe('fileEvidenceComment', () => {
  it('returns via:"none" with no postId (never calls reddit)', async () => {
    const res = await fileEvidenceComment(undefined, true, card);
    expect(res).toEqual({ via: 'none' });
    expect(submitComment).not.toHaveBeenCalled();
  });

  it('posts as the user when consent is given and the call succeeds', async () => {
    submitComment.mockResolvedValueOnce({ id: 't1_user' });
    const res = await fileEvidenceComment('t3_post', true, card);
    expect(res).toEqual({ via: 'user', commentId: 't1_user' });
    expect(submitComment).toHaveBeenCalledTimes(1);
    expect(submitComment).toHaveBeenCalledWith({ id: 't3_post', text: expect.any(String), runAs: 'USER' });
  });

  it('falls back to the app account when the asUser call fails', async () => {
    submitComment.mockRejectedValueOnce(new Error('no scope')).mockResolvedValueOnce({ id: 't1_app' });
    const res = await fileEvidenceComment('t3_post', true, card);
    expect(res).toEqual({ via: 'app', commentId: 't1_app' });
    expect(submitComment).toHaveBeenCalledTimes(2);
    expect(submitComment).toHaveBeenLastCalledWith({ id: 't3_post', text: expect.any(String), runAs: 'APP' });
  });

  it('returns via:"none" when both the asUser and app calls fail', async () => {
    submitComment.mockRejectedValueOnce(new Error('no scope')).mockRejectedValueOnce(new Error('down'));
    const res = await fileEvidenceComment('t3_post', true, card);
    expect(res).toEqual({ via: 'none' });
  });

  it('posts directly as the app account when consent is withheld', async () => {
    submitComment.mockResolvedValueOnce({ id: 't1_app2' });
    const res = await fileEvidenceComment('t3_post', false, card);
    expect(res).toEqual({ via: 'app', commentId: 't1_app2' });
    expect(submitComment).toHaveBeenCalledTimes(1);
    expect(submitComment).toHaveBeenCalledWith({ id: 't3_post', text: expect.any(String), runAs: 'APP' });
  });

  it('returns via:"none" when the app-account call fails without consent', async () => {
    submitComment.mockRejectedValueOnce(new Error('down'));
    const res = await fileEvidenceComment('t3_post', false, card);
    expect(res).toEqual({ via: 'none' });
  });
});
