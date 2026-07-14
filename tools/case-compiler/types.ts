/** YAML case format — the authoring schema. See cases/README.md for the guide. */

export type YamlSuspect = { id: string; name: string; blurb: string };

export type YamlDocLine = { text?: string; shard?: string };

export type YamlDoc = { id: string; title: string; lines: YamlDocLine[] };

export type YamlShard = {
  id: string;
  doc: string;
  text: string;
  /** factIds this shard supports (any one supporting shard establishes a fact) */
  supports?: string[];
};

export type YamlFact = { id: string; text: string };

export type YamlElimination = { suspect: string; paths: string[][] };

export type YamlContradiction = { a: string; b: string; note: string };

export type YamlTruth = {
  culprit: string;
  motive: string;
  summary: string;
  reveal: string[];
};

export type YamlCase = {
  format: number;
  id: string;
  number: number;
  title: string;
  tagline: string;
  author: string;
  era: string;
  question: string;
  suspects: YamlSuspect[];
  docs: YamlDoc[];
  shards: YamlShard[];
  facts: YamlFact[];
  eliminations: YamlElimination[];
  contradictions: YamlContradiction[];
  pivots: string[];
  /** demo-seed: non-culprit suspect ids to leave standing at the ~61% seed */
  reserve?: string[];
  truth: YamlTruth;
};

export type LintIssue = {
  level: 'L0' | 'L1' | 'L2' | 'L3';
  message: string;
};

export type LintReport = {
  caseId: string;
  ok: boolean;
  issues: LintIssue[];
  monteCarlo: { trials: number; passed: number; sampleFailures: string[] };
  bundleBytes: number;
};
