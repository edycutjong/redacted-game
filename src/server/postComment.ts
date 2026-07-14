/**
 * Consent-gated evidence-card comment.
 *
 * The player's filed card is posted as a structured, app-formatted comment
 * (cardMarker.buildCommentBody) carrying a machine marker so the onCommentCreate
 * trigger can reconcile the thread with the board. When the player consents we
 * post it under THEIR name (asUser SUBMIT_COMMENT, declared in devvit.json); if
 * that call fails (scope/permission/anything) we fall back to the app account,
 * and if even that fails the card still lands on the board with via:'none'.
 */

import { reddit } from '@devvit/web/server';
import { buildCommentBody, type CardCommentInput } from './core/cardMarker';

export type CommentResult = { via: 'user' | 'app' | 'none'; commentId?: string };

export const fileEvidenceComment = async (
  postId: string | undefined,
  consentUser: boolean,
  card: CardCommentInput
): Promise<CommentResult> => {
  if (!postId) return { via: 'none' };
  const text = buildCommentBody(card);
  if (consentUser) {
    try {
      const c = await reddit.submitComment({ id: postId as `t3_${string}`, text, runAs: 'USER' });
      return { via: 'user', commentId: c.id };
    } catch {
      /* fall through to the app account */
    }
  }
  try {
    const c = await reddit.submitComment({ id: postId as `t3_${string}`, text, runAs: 'APP' });
    return { via: 'app', commentId: c.id };
  } catch {
    return { via: 'none' };
  }
};
