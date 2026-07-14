/**
 * Evidence-card comment format + machine marker.
 *
 * Filed cards are app-formatted comments (structured template, not free
 * prose). The last line carries an invisible-ish markdown marker so the
 * onCommentCreate trigger can reconcile thread ↔ board without guessing.
 * Pure module.
 */

export type CardCommentInput = {
  caseId: string;
  caseNumber: number;
  shardId: string;
  text: string;
  note?: string;
};

const markerLine = (caseId: string, shardId: string): string =>
  `[](/rd-card/${caseId}/${shardId})`;

export const buildCommentBody = (input: CardCommentInput): string => {
  const lines = [
    `**EVIDENCE FILED — CASE #${input.caseNumber}**`,
    '',
    `> ${input.text}`,
  ];
  if (input.note && input.note.trim().length > 0) {
    lines.push('', `*note: ${input.note.trim()}*`);
  }
  lines.push(
    '',
    `^(REDACTED evidence card · shard ${input.shardId} · filed from the dossier)`,
    markerLine(input.caseId, input.shardId)
  );
  return lines.join('\n');
};

const MARKER_RE = /\[\]\(\/rd-card\/([a-z0-9-]+)\/([A-Za-z0-9_-]+)\)/;

export const parseCardMarker = (
  body: string
): { caseId: string; shardId: string } | null => {
  const m = MARKER_RE.exec(body);
  if (!m) return null;
  return { caseId: m[1]!, shardId: m[2]! };
};
