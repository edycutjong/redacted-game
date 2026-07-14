/**
 * Safety filters — shared by the offline linter (L3) and the runtime
 * (player notes, Forge submissions). Pure module.
 */

const PROFANITY = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'asshole',
  'bastard',
  'dickhead',
  'faggot',
  'nigger',
  'retard',
  'slut',
  'whore',
];

const LINK_RE = /(https?:\/\/|www\.)/i;
const USER_MENTION_RE = /(^|[\s(])\/?u\/[A-Za-z0-9_-]{3,}/;
const SUBREDDIT_RE = /(^|[\s(])\/?r\/[A-Za-z0-9_]{2,}/;

export const textViolations = (text: string, where: string): string[] => {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const word of PROFANITY) {
    if (new RegExp(`\\b${word}`, 'i').test(lower)) {
      out.push(`${where}: profanity ("${word}")`);
    }
  }
  if (LINK_RE.test(text)) out.push(`${where}: link/URL not allowed`);
  if (USER_MENTION_RE.test(text)) {
    out.push(`${where}: u/-mention pattern (real-user resemblance) not allowed`);
  }
  if (SUBREDDIT_RE.test(text)) out.push(`${where}: r/-mention pattern not allowed`);
  return out;
};

export const NOTE_MAX_LEN = 140;

export type NoteCheck = { ok: boolean; cleaned: string; violations: string[] };

export const sanitizeNote = (note: string | undefined): NoteCheck => {
  const cleaned = (note ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX_LEN);
  if (cleaned.length === 0) return { ok: true, cleaned: '', violations: [] };
  const violations = textViolations(cleaned, 'note');
  return { ok: violations.length === 0, cleaned, violations };
};
