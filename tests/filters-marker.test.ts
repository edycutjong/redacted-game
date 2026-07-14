import { describe, expect, it } from 'vitest';
import { NOTE_MAX_LEN, sanitizeNote, textViolations } from '../src/server/core/filters';
import { buildCommentBody, parseCardMarker } from '../src/server/core/cardMarker';

describe('textViolations (L3 safety filter)', () => {
  it('flags profanity', () => {
    expect(textViolations('what the fuck', 'x').some((v) => v.includes('profanity'))).toBe(true);
  });
  it('flags links', () => {
    expect(textViolations('see http://x.io', 'x').some((v) => v.includes('link'))).toBe(true);
    expect(textViolations('see www.x.io', 'x').some((v) => v.includes('link'))).toBe(true);
  });
  it('flags u/ and r/ mention patterns (real-user resemblance)', () => {
    expect(textViolations('ask u/spez', 'x').some((v) => v.includes('u/-mention'))).toBe(true);
    expect(textViolations('go to r/pics', 'x').some((v) => v.includes('r/-mention'))).toBe(true);
  });
  it('passes clean noir prose', () => {
    expect(textViolations('the pawn ticket was dated the 14th', 'x')).toEqual([]);
  });
});

describe('sanitizeNote', () => {
  it('accepts and trims a clean note', () => {
    const r = sanitizeNote('  two   days   after the fire  ');
    expect(r.ok).toBe(true);
    expect(r.cleaned).toBe('two days after the fire');
  });
  it('treats an empty/undefined note as ok', () => {
    expect(sanitizeNote(undefined)).toEqual({ ok: true, cleaned: '', violations: [] });
  });
  it('rejects a note with violations', () => {
    expect(sanitizeNote('visit www.spam.io').ok).toBe(false);
  });
  it('caps the note at NOTE_MAX_LEN', () => {
    expect(sanitizeNote('a'.repeat(500)).cleaned.length).toBe(NOTE_MAX_LEN);
  });
});

describe('evidence-card marker round-trip', () => {
  it('embeds a parseable marker in the comment body', () => {
    const body = buildCommentBody({ caseId: 'case-017', caseNumber: 17, shardId: 'SH31', text: 'the pawn ticket' });
    const parsed = parseCardMarker(body);
    expect(parsed).toEqual({ caseId: 'case-017', shardId: 'SH31' });
  });
  it('includes the shard text as a quote and the case number', () => {
    const body = buildCommentBody({ caseId: 'case-018', caseNumber: 18, shardId: 'K11', text: 'the october line is blank' });
    expect(body).toContain('> the october line is blank');
    expect(body).toContain('CASE #18');
  });
  it('carries an optional note when present', () => {
    const body = buildCommentBody({ caseId: 'case-019', caseNumber: 19, shardId: 'V09', text: 'a line', note: 'my hunch' });
    expect(body).toContain('note: my hunch');
  });
  it('returns null for a comment with no marker', () => {
    expect(parseCardMarker('just a normal reddit comment')).toBeNull();
  });
});
