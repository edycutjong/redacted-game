import { describe, expect, it } from 'vitest';
import { caseChannel } from '../src/shared/api';
import { rankForCites } from '../src/shared/case';
import { K } from '../src/server/keys';

describe('caseChannel', () => {
  it('namespaces the realtime channel by caseId', () => {
    expect(caseChannel('case-017')).toBe('case-case-017');
  });
});

describe('rankForCites', () => {
  it('is Beat Cop below 150', () => {
    expect(rankForCites(0)).toBe('Beat Cop');
    expect(rankForCites(149)).toBe('Beat Cop');
  });
  it('is Detective from 150 up to (not including) 400', () => {
    expect(rankForCites(150)).toBe('Detective');
    expect(rankForCites(399)).toBe('Detective');
  });
  it('is Inspector at 400+', () => {
    expect(rankForCites(400)).toBe('Inspector');
    expect(rankForCites(10_000)).toBe('Inspector');
  });
});

describe('K.reports', () => {
  it('namespaces the reported-cards zset by case', () => {
    expect(K.reports('case-017')).toBe('reports:case-017');
  });
});
