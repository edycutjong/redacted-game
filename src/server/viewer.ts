/**
 * Per-request viewer identity, read from the Devvit `context` singleton.
 * Kept tiny and defensive: logged-out visitors have no userId, so we fall back
 * to the stable logged-out id (loid) for dealing, and never assume a username.
 */

import { context } from '@devvit/web/server';

export type Viewer = {
  /** stable id used for the deterministic deal — real userId or logged-out id */
  dealerId: string;
  userId: string | undefined;
  username: string;
  postId: string | undefined;
  subredditName: string;
};

export const getViewer = (): Viewer => {
  const userId = context.userId as string | undefined;
  const loid = (context.loid as string | undefined) ?? undefined;
  return {
    dealerId: userId ?? loid ?? 'anon',
    userId,
    username: context.username ?? 'detective',
    postId: context.postId as string | undefined,
    subredditName: context.subredditName,
  };
};
