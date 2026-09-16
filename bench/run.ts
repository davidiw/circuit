/**
 * Model selection benchmark. Correctness first, then latency, then cost.
 *   npx tsx bench/run.ts --dry --reps 1
 *   ANTHROPIC_API_KEY=... GEMINI_API_KEY=... npx tsx bench/run.ts --reps 3 [--models a,b] [--cases race_car]
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registry } from '../src/data';
import { evaluate } from '../src/eval/evaluate';
import { createProvider } from '../src/ai/provider';
import { FakeProvider } from '../src/ai/fake';
import { reviewProject, type ReviewResult } from '../src/ai/review';
import type { Provider } from '../src/ai/provider';
import { cases, type BenchCase, type Expected } from './cases';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('--dry');
const REPS = Number(opt('--reps') ?? 3);
const MODEL_FILTER = opt('--models')?.split(',').map((s) => s.trim());
const CASE_FILTER = opt('--cases');

const CANDIDATES: { provider: 'anthropic' | 'gemini'; model: string; envKey: string }[] = [
  { provider: 'anthropic', model: 'claude-sonnet-5', envKey: 'ANTHROPIC_API_KEY' },
  { provider: 'anthropic', model: 'claude-haiku-4-5', envKey: 'ANTHROPIC_API_KEY' },
  { provider: 'gemini', model: 'gemini-3.8-flash', envKey: 'GEMINI_API_KEY' },
  { provider: 'gemini', model: 'gemini-3.1-pro-preview', envKey: 'GEMINI_API_KEY' },
];

type Prices = { as_of: string; models: Record<string, { input: number; output: number; approximate: boolean }> };
const prices: Prices = JSON.parse(readFileSync(join(here, 'prices.json'), 'utf8'));
const costOf = (model: string, usage: { input: number; output: number }) => {
  const p = prices.models[model]; if (!p) return NaN;
  return (usage.input * p.input + usage.output * p.output) / 1e6;
};

type RunRecord = {
  model: string; caseId: string; rep: number; latencyMs: number; usage: { input: number; output: number }; cost: number;
  recall: number; expectedCount: number; contradictions: number; claimsUnsupported: number; schemaFailures: number; dropped: number; observations: number; error?: string;
};

function score(c: BenchCase, r: ReviewResult): Pick<RunRecord, 'recall' | 'expectedCount' | 'contradictions' | 'claimsUnsupported' | 'schemaFailures'> {
  const det = evaluate(c.project, registry);
  const detRules = new Set(det.findings.map((f) => f.ruleId));
  const hit = (e: Expected) => r.observations.some((o) => o.category === e.category && (!e.affectedInstance || o.affected.some((a) => a.instanceId === e.affectedInstance)));
  const recall = c.expected.length ? c.expected.filter(hit).length / c.expected.length : 1;
  const contradictions = r.observations.filter((o) => o.ruleId !== 'ai_review' && detRules.has(o.ruleId)).length;
  const notEvaluated = new Set(det.coverage.filter((x) => x.status === 'not_evaluated' || x.status === 'unsupported').map((x) => x.dimension));
  const claimsUnsupported = r.observations.filter((o) => (o.category === 'thermal' && notEvaluated.has('thermal')) || (o.category === 'emi' && notEvaluated.has('transients_emi')))
    .filter((o) => o.severity !== 'unknown' && o.severity !== 'unsupported').length;
  const schemaFailures = r.dropReasons.filter((d) => d.startsWith('parse')).length;
  return { recall, expectedCount: c.expected.length, contradictions, claimsUnsupported, schemaFailures };
}

/** Dry-run provider: answers each case with one observation per expected finding. Proves the plumbing, yields recall 1. */
function dryProvider(c: BenchCase): Provider {
  return new FakeProvider(() => ({ observations: c.expected.map((e) => ({
    title: `dry ${e.ruleId}`, severity: e.severity, category: e.category, affected: e.affectedInstance ? [{ instanceId: e.affectedInstance }] : [],
    rationale: 'scripted', consequence: 'scripted', remediation: [], confidence: 0.5,
  })) }), 'fake-1');
}

const pct = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function main() {
  const selected = cases.filter((c) => !CASE_FILTER || c.id.includes(CASE_FILTER));
  const models: { model: string; make: (c: BenchCase) => Provider }[] = [];
  if (DRY) models.push({ model: 'fake-1', make: dryProvider });
  else for (const cand of CANDIDATES) {
    if (MODEL_FILTER && !MODEL_FILTER.includes(cand.model)) continue;
    const key = process.env[cand.envKey];
    if (!key) { console.log(`skip ${cand.model}: ${cand.envKey} not set`); continue; }
    const p = createProvider(cand.provider, cand.model, key);
    models.push({ model: cand.model, make: () => p });
  }
  if (!models.length) { console.error('No candidate models available. Set ANTHROPIC_API_KEY and/or GEMINI_API_KEY, or pass --dry.'); process.exit(1); }

  const records: RunRecord[] = [];
  for (const m of models) for (const c of selected) for (let rep = 0; rep < REPS; rep++) {
    const t0 = Date.now();
    try {
      const r = await reviewProject(c.project, registry, m.make(c));
      const s = score(c, r);
      records.push({ model: m.model, caseId: c.id, rep, latencyMs: r.latencyMs, usage: r.usage, cost: costOf(m.model, r.usage), dropped: r.dropped, observations: r.observations.length, ...s });
      process.stdout.write(`${m.model} ${c.id} #${rep} recall=${s.recall.toFixed(2)} obs=${r.observations.length} drop=${r.dropped} ${r.latencyMs}ms\n`);
    } catch (e) {
      records.push({ model: m.model, caseId: c.id, rep, latencyMs: Date.now() - t0, usage: { input: 0, output: 0 }, cost: 0, recall: 0, expectedCount: c.expected.length, contradictions: 0, claimsUnsupported: 0, schemaFailures: 1, dropped: 0, observations: 0, error: String(e) });
      process.stdout.write(`${m.model} ${c.id} #${rep} ERROR ${String(e).slice(0, 120)}\n`);
    }
  }

  const summary = models.map((m) => {
    const rs = records.filter((r) => r.model === m.model);
    const mean = (f: (r: RunRecord) => number) => rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length);
    const lat = rs.map((r) => r.latencyMs);
    return {
      model: m.model, runs: rs.length, meanRecall: mean((r) => r.recall), contradictions: rs.reduce((s, r) => s + r.contradictions, 0),
      claimsUnsupported: rs.reduce((s, r) => s + r.claimsUnsupported, 0), schemaFailures: rs.reduce((s, r) => s + r.schemaFailures, 0),
      errors: rs.filter((r) => r.error).length, p50Ms: pct(lat, 0.5), p95Ms: pct(lat, 0.95), meanCostUsd: mean((r) => r.cost), meanObservations: mean((r) => r.observations),
      priceApproximate: prices.models[m.model]?.approximate ?? true,
    };
  });
  const penalty = (s: (typeof summary)[number]) => s.contradictions + s.schemaFailures + s.claimsUnsupported + s.errors;
  summary.sort((a, b) => b.meanRecall - a.meanRecall || penalty(a) - penalty(b) || a.p50Ms - b.p50Ms || a.meanCostUsd - b.meanCostUsd);
  const chosen = summary[0];
  const providerOf = (model: string) => CANDIDATES.find((c) => c.model === model)?.provider ?? 'fake';

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(here, 'results'); mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify({ ranAt: new Date().toISOString(), dry: DRY, reps: REPS, cases: selected.map((c) => c.id), pricesAsOf: prices.as_of, summary, records }, null, 2));
  const md = [
    `# Benchmark ${DRY ? '(dry run) ' : ''}${new Date().toISOString()}`, '',
    `${selected.length} cases x ${REPS} reps. Prices as of ${prices.as_of}. Ranked by mean recall, then contradictions + schema failures + unsupported claims + errors, then p50 latency, then cost.`, '',
    '| Model | Runs | Mean recall | Contradictions | Unsupported claims | Schema failures | Errors | p50 ms | p95 ms | Mean cost USD | Mean obs |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summary.map((s) => `| ${s.model} | ${s.runs} | ${s.meanRecall.toFixed(3)} | ${s.contradictions} | ${s.claimsUnsupported} | ${s.schemaFailures} | ${s.errors} | ${s.p50Ms} | ${s.p95Ms} | ${s.meanCostUsd.toFixed(5)}${s.priceApproximate ? ' (approx)' : ''} | ${s.meanObservations.toFixed(1)} |`),
    '', `## Chosen: ${chosen.model}`, '', '```', `AI_PROVIDER=${providerOf(chosen.model)}`, `AI_MODEL=${chosen.model}`, '```', '',
    DRY ? 'Dry run with a scripted provider: recall is 1.0 by construction. Run with real keys to select a model.' : '',
  ].join('\n');
  writeFileSync(join(outDir, 'latest.md'), md);
  console.log('\n' + md);
}

main().catch((e) => { console.error(e); process.exit(1); });
