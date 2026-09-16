import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Project, Registry, Finding } from '../model/schema';
import { Severity } from '../model/schema';
import { FINDING_CATEGORIES } from '../model/vocab';
import { evaluate, RULES } from '../eval/evaluate';
import type { Provider } from './provider';

const here = dirname(fileURLToPath(import.meta.url));
export const REVIEW_SYSTEM_PROMPT = readFileSync(join(here, 'prompts', 'review.system.txt'), 'utf8');

export const AIObservation = z.object({
  title: z.string(),
  severity: Severity,
  category: z.string(),
  affected: z.array(z.object({ instanceId: z.string().optional(), netId: z.string().optional() })),
  rationale: z.string(),
  consequence: z.string(),
  remediation: z.array(z.string()),
  contradicts_rule: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type AIObservation = z.infer<typeof AIObservation>;
export const AIReviewOutput = z.object({ observations: z.array(AIObservation) });

export type ReviewResult = {
  observations: Finding[];
  dropped: number;
  dropReasons: string[];
  provider: string;
  model: string;
  latencyMs: number;
  usage: { input: number; output: number };
};

const RULE_IDS = new Set(RULES.map((r) => r.id));
const CATEGORIES = new Set<string>(FINDING_CATEGORIES);

/** The structured message the model sees. Exported so the benchmark and tests can inspect it. */
export function buildReviewInput(project: Project, registry: Registry) {
  const deterministic = evaluate(project, registry);
  const { lastEvaluation: _e, mutations: _m, expectedBaseline: _b, ...design } = project;
  const ids = new Set(project.instances.map((i) => i.registryId));
  const entries = registry.components.filter((c) => ids.has(c.id));
  const user = [
    '## project', JSON.stringify(design),
    '## registry', JSON.stringify(entries),
    '## deterministic_findings', JSON.stringify(deterministic.findings.map(({ id: _i, ...f }) => f)),
    '## coverage', JSON.stringify(deterministic.coverage),
  ].join('\n');
  return { user, deterministic };
}

/**
 * Adversarial review. Re-runs the deterministic evaluator on the received project (client findings are never trusted),
 * asks the provider for structured observations, and gates them. Unknown categories map to 'other' rather than being
 * dropped, because a mis-labeled real concern is worth more than a clean list; the mapping is recorded in dropReasons.
 * Provider transport errors propagate; malformed model output does not.
 */
export async function reviewProject(project: Project, registry: Registry, provider: Provider): Promise<ReviewResult> {
  const { user } = buildReviewInput(project, registry);
  const schema = z.toJSONSchema(AIReviewOutput) as Record<string, unknown>;
  const t0 = Date.now();
  const raw = await provider.complete({ system: REVIEW_SYSTEM_PROMPT, user, schema, maxTokens: 2000 });
  const base: ReviewResult = { observations: [], dropped: 0, dropReasons: [], provider: provider.name, model: provider.model, latencyMs: raw.latencyMs || Date.now() - t0, usage: raw.usage };

  const parsed = AIReviewOutput.safeParse(raw.json);
  if (!parsed.success) {
    base.dropped = 1;
    base.dropReasons.push(`parse: output did not match schema (${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ' ' + i.message).join('; ')})`);
    return base;
  }
  const instanceIds = new Set(project.instances.map((i) => i.id));
  const netIds = new Set(project.nets.map((n) => n.id));
  let n = 0;
  for (const o of parsed.data.observations) {
    const badId = o.affected.find((a) => (a.instanceId && !instanceIds.has(a.instanceId)) || (a.netId && !netIds.has(a.netId)));
    if (badId) { base.dropped++; base.dropReasons.push(`unknown id: ${badId.instanceId ?? badId.netId} in "${o.title}"`); continue; }
    if (o.contradicts_rule !== undefined && o.contradicts_rule !== '') {
      if (!o.rationale.trim()) { base.dropped++; base.dropReasons.push(`contradiction without rationale: "${o.title}"`); continue; }
      if (!RULE_IDS.has(o.contradicts_rule)) { base.dropped++; base.dropReasons.push(`contradiction names unknown rule ${o.contradicts_rule}: "${o.title}"`); continue; }
    }
    let category = o.category;
    if (!CATEGORIES.has(category)) { base.dropReasons.push(`category ${category} mapped to other: "${o.title}"`); category = 'other'; }
    base.observations.push({
      id: `ai-${++n}`, ruleId: o.contradicts_rule || 'ai_review', origin: 'ai_review', basis: 'ai_inference', fixes: [],
      severity: o.severity, category, title: o.title,
      affected: o.affected.map((a) => ({ instanceId: a.instanceId, netId: a.netId })),
      evidence: [{ label: 'model rationale', value: o.rationale, provenance: 'ai' }, ...(o.contradicts_rule ? [{ label: 'contradicts rule', value: o.contradicts_rule, provenance: 'ai' as const }] : [])],
      consequence: o.consequence, remediation: o.remediation, confidence: o.confidence,
    });
  }
  return base;
}
