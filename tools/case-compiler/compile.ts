/**
 * Case compiler — YAML → SealedCaseBundle.
 *
 * The truth section is SPLIT from the public docs here, at compile time, so
 * the runtime cannot serialize truth to clients by construction (I2): the
 * public half never contains truth fields, shard texts live in a separate
 * section revealed per-rules, and the truth half is written to a Redis key
 * (`case:{id}:truth`) that no /api handler reads into a response.
 */

import { parse } from 'yaml';
import type { SealedCaseBundle, SealedShard } from '../../src/server/cases/types';
import type { DocLine, PublicCaseBundle, PublicDoc } from '../../src/shared/case';
import { barWidthFor } from '../../src/server/core/hash';
import type { YamlCase } from './types';

export class CompileError extends Error {
  issues: string[];
  constructor(caseRef: string, issues: string[]) {
    super(`case ${caseRef}: ${issues.length} structural error(s)\n  - ${issues.join('\n  - ')}`);
    this.issues = issues;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const parseYamlCase = (yamlText: string): YamlCase => {
  const raw: unknown = parse(yamlText);
  if (!isRecord(raw)) throw new CompileError('<unparsed>', ['YAML root must be a mapping']);
  // Structural validation happens in validateCase; the cast boundary is here,
  // immediately re-checked field by field.
  return raw as unknown as YamlCase;
};

export const validateCase = (c: YamlCase): string[] => {
  const issues: string[] = [];
  const need = (cond: boolean, msg: string): void => {
    if (!cond) issues.push(msg);
  };

  need(c.format === 1, 'format must be 1');
  need(typeof c.id === 'string' && /^case-\d{3}$/.test(c.id), 'id must match case-NNN');
  need(typeof c.number === 'number' && c.number > 0, 'number must be a positive integer');
  for (const field of ['title', 'tagline', 'author', 'era', 'question'] as const) {
    need(typeof c[field] === 'string' && c[field].length > 0, `${field} is required`);
  }
  need(Array.isArray(c.suspects) && c.suspects.length >= 3, 'need >= 3 suspects');
  need(Array.isArray(c.docs) && c.docs.length >= 2, 'need >= 2 documents');
  need(Array.isArray(c.shards) && c.shards.length >= 20, 'need >= 20 shards');
  need(Array.isArray(c.facts) && c.facts.length >= 4, 'need >= 4 facts');
  need(Array.isArray(c.eliminations), 'eliminations required');
  need(Array.isArray(c.contradictions), 'contradictions required');
  need(Array.isArray(c.pivots) && c.pivots.length >= 1, 'need >= 1 pivot shard');
  need(isRecord(c.truth), 'truth section required');
  if (issues.length > 0) return issues; // stop before deref crashes

  const dupCheck = (kind: string, ids: string[]): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push(`duplicate ${kind} id: ${id}`);
      seen.add(id);
    }
  };
  const suspectIds = c.suspects.map((s) => s.id);
  const docIds = c.docs.map((d) => d.id);
  const shardIds = c.shards.map((s) => s.id);
  const factIds = c.facts.map((f) => f.id);
  dupCheck('suspect', suspectIds);
  dupCheck('doc', docIds);
  dupCheck('shard', shardIds);
  dupCheck('fact', factIds);

  const shardSet = new Set(shardIds);
  const factSet = new Set(factIds);
  const suspectSet = new Set(suspectIds);
  const docSet = new Set(docIds);

  for (const s of c.shards) {
    if (!docSet.has(s.doc)) issues.push(`shard ${s.id}: unknown doc ${s.doc}`);
    if (typeof s.text !== 'string' || s.text.trim().length < 8) {
      issues.push(`shard ${s.id}: text missing/too short`);
    }
    for (const f of s.supports ?? []) {
      if (!factSet.has(f)) issues.push(`shard ${s.id}: unknown fact ${f}`);
    }
  }

  // every shard appears in exactly one doc line; no doc line references unknown shards
  const lineRefs = new Map<string, number>();
  for (const d of c.docs) {
    for (const line of d.lines) {
      const hasText = typeof line.text === 'string';
      const hasShard = typeof line.shard === 'string';
      if (hasText === hasShard) {
        issues.push(`doc ${d.id}: each line must have exactly one of text|shard`);
        continue;
      }
      if (hasShard) {
        const id = line.shard!;
        if (!shardSet.has(id)) issues.push(`doc ${d.id}: unknown shard ${id}`);
        lineRefs.set(id, (lineRefs.get(id) ?? 0) + 1);
      }
    }
  }
  for (const id of shardIds) {
    const n = lineRefs.get(id) ?? 0;
    if (n !== 1) issues.push(`shard ${id}: referenced by ${n} doc lines (must be exactly 1)`);
  }

  const elimSeen = new Set<string>();
  for (const e of c.eliminations) {
    if (!suspectSet.has(e.suspect)) issues.push(`elimination: unknown suspect ${e.suspect}`);
    if (elimSeen.has(e.suspect)) issues.push(`elimination: duplicate entry for ${e.suspect}`);
    elimSeen.add(e.suspect);
    if (!Array.isArray(e.paths) || e.paths.length === 0) {
      issues.push(`elimination ${e.suspect}: needs >= 1 path`);
      continue;
    }
    for (const p of e.paths) {
      if (!Array.isArray(p) || p.length === 0) {
        issues.push(`elimination ${e.suspect}: empty path`);
        continue;
      }
      for (const f of p) {
        if (!factSet.has(f)) issues.push(`elimination ${e.suspect}: unknown fact ${f}`);
      }
    }
  }

  for (const pair of c.contradictions) {
    if (!shardSet.has(pair.a)) issues.push(`contradiction: unknown shard ${pair.a}`);
    if (!shardSet.has(pair.b)) issues.push(`contradiction: unknown shard ${pair.b}`);
    if (pair.a === pair.b) issues.push(`contradiction: a === b (${pair.a})`);
    if (typeof pair.note !== 'string' || pair.note.length === 0) {
      issues.push(`contradiction ${pair.a}/${pair.b}: note required`);
    }
  }

  for (const p of c.pivots) {
    if (!shardSet.has(p)) issues.push(`pivot: unknown shard ${p}`);
  }
  dupCheck('pivot', c.pivots);

  if (!suspectSet.has(c.truth.culprit)) {
    issues.push(`truth.culprit ${c.truth.culprit} is not a suspect`);
  }
  if (elimSeen.has(c.truth.culprit)) {
    issues.push(`truth.culprit ${c.truth.culprit} must NOT have an elimination entry`);
  }
  for (const s of suspectIds) {
    if (s !== c.truth.culprit && !elimSeen.has(s)) {
      issues.push(`suspect ${s} is not the culprit but has no elimination entry`);
    }
  }
  if (c.reserve !== undefined) {
    if (!Array.isArray(c.reserve)) {
      issues.push('reserve must be an array of suspect ids');
    } else {
      for (const sid of c.reserve) {
        if (!suspectSet.has(sid)) issues.push(`reserve: unknown suspect ${sid}`);
        if (sid === c.truth.culprit) {
          issues.push(`reserve: ${sid} is the culprit (reserve only non-culprits)`);
        }
      }
    }
  }
  if (!Array.isArray(c.truth.reveal) || c.truth.reveal.length < 2) {
    issues.push('truth.reveal needs >= 2 ceremony beats');
  }
  for (const field of ['motive', 'summary'] as const) {
    if (typeof c.truth[field] !== 'string' || c.truth[field].length === 0) {
      issues.push(`truth.${field} is required`);
    }
  }

  return issues;
};

export const compileCase = (c: YamlCase): SealedCaseBundle => {
  const issues = validateCase(c);
  if (issues.length > 0) throw new CompileError(c.id ?? '<no id>', issues);

  const docs: PublicDoc[] = c.docs.map((d) => ({
    id: d.id,
    title: d.title,
    lines: d.lines.map((line): DocLine => {
      if (typeof line.shard === 'string') {
        return { kind: 'shard', shardId: line.shard, barWidth: barWidthFor(line.shard) };
      }
      return { kind: 'text', text: line.text! };
    }),
  }));

  const pub: PublicCaseBundle = {
    caseId: c.id,
    number: c.number,
    title: c.title,
    tagline: c.tagline,
    author: c.author,
    era: c.era,
    question: c.question,
    totalShards: c.shards.length,
    docs,
    suspects: c.suspects.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb })),
  };

  const shards: SealedShard[] = c.shards.map((s) => ({
    id: s.id,
    docId: s.doc,
    text: s.text,
  }));

  return {
    formatVersion: 1,
    public: pub,
    shards,
    contradictions: c.contradictions.map((p) => ({ a: p.a, b: p.b, note: p.note })),
    pivots: [...c.pivots],
    demo: c.reserve && c.reserve.length > 0 ? { reserveSuspectIds: [...c.reserve] } : undefined,
    truth: {
      culpritId: c.truth.culprit,
      motive: c.truth.motive,
      summary: c.truth.summary,
      reveal: [...c.truth.reveal],
      facts: c.facts.map((f) => ({
        id: f.id,
        text: f.text,
        supports: c.shards.filter((s) => (s.supports ?? []).includes(f.id)).map((s) => s.id),
      })),
      eliminations: c.eliminations.map((e) => ({
        suspectId: e.suspect,
        paths: e.paths.map((p) => [...p]),
      })),
    },
  };
};
