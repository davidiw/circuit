import type { Project, Registry, EvaluationResult, Finding, CoverageEntry, Metric } from '../model/schema';
import { UNIVERSAL_DIMENSIONS } from '../model/vocab';
import { integrityProblems } from '../model/integrity';
import { Ctx, resetIds, type Rule } from './context';
import { stateHash } from './hash';
import { power_source_present } from './rules/power_source_present';
import { signal_reference } from './rules/signal_reference';
import { supply_in_range } from './rules/supply_in_range';
import { motor_load_path } from './rules/motor_load_path';
import { driver_enable_state } from './rules/driver_enable_state';
import { reverse_polarity_strategy } from './rules/reverse_polarity_strategy';
import { regulator_headroom } from './rules/regulator_headroom';
import { bulk_capacitance } from './rules/bulk_capacitance';
import { requirement_capability } from './rules/requirement_capability';
import { driver_load_current } from './rules/driver_load_current';
import { rail_budget } from './rules/rail_budget';
import { runtime_estimate } from './rules/runtime_estimate';
import { decoupling } from './rules/decoupling';
import { motor_operating_point } from './rules/motor_operating_point';
import { net_conflict } from './rules/net_conflict';
import { pin_type_conflict } from './rules/pin_type_conflict';
import { undriven_net } from './rules/undriven_net';

export const RULES: Rule[] = [
  power_source_present, signal_reference, supply_in_range, motor_load_path, driver_enable_state,
  reverse_polarity_strategy, regulator_headroom, bulk_capacitance, requirement_capability,
  driver_load_current, rail_budget, runtime_estimate, decoupling, motor_operating_point, pin_type_conflict, net_conflict, undriven_net,
];

const SEVERITY_ORDER: Record<Finding['severity'], number> = { violation: 0, warning: 1, unknown: 2, optimization: 3, unsupported: 4 };

/** Deterministic evaluation of canonical state. Pure: same project and registry always give the same result. */
export function evaluate(project: Project, registry: Registry, rules: Rule[] = RULES): EvaluationResult {
  resetIds();
  const problems = integrityProblems(project, registry);
  if (problems.length) {
    return { status: 'incomplete', metrics: [], coverage: [], stateHash: stateHash(project), evaluatedAt: new Date().toISOString(), findings: [{
      id: 'integrity-1', ruleId: 'integrity', origin: 'deterministic', basis: 'component_spec', severity: 'unsupported', category: 'other', title: `This design references parts or pins the registry does not know (${problems.length} problem${problems.length > 1 ? 's' : ''}); the rules did not run`,
      affected: [], evidence: problems.slice(0, 8).map((x) => ({ label: 'problem', value: x, provenance: 'user' as const })), consequence: 'Nothing can be evaluated until every part and pin resolves to a registry entry.',
      remediation: ['Undo the last change, reset the template, or import a file saved by this version'], missing: problems, fixes: [],
    }] };
  }
  const ctx = new Ctx(project, registry);
  const findings: Finding[] = []; const coverage: CoverageEntry[] = []; const metrics: Metric[] = [];
  for (const rule of rules) {
    ctx.resetReads();
    const r = rule.analyze(ctx);
    findings.push(...r.findings); metrics.push(...(r.metrics ?? []));
    // Coverage policy: 'checked' only when every value the rule read is a published fact or a user setting; an assumption or unknown makes it 'partial' and says which.
    const assumed = [...new Map(ctx.reads.map((x) => [x.label, x])).values()];
    for (const c of r.coverage) if (c.status === 'checked' && assumed.length) { c.status = 'partial'; c.note = `${c.note}; relies on assumed or unknown values: ${assumed.slice(0, 4).map((x) => x.label).join(', ')}${assumed.length > 4 ? ` and ${assumed.length - 4} more` : ''}`; }
    // Outcome per dimension: the worst severity among the analyzer's findings, so a "checked" row can still read as failed.
    const rank: Record<string, number> = { violation: 0, warning: 1, unknown: 2, optimization: 3 };
    let worst: CoverageEntry['outcome'];
    for (const f of r.findings) { if (f.severity === 'unsupported') continue; if (!worst || rank[f.severity] < rank[worst]) worst = f.severity as CoverageEntry['outcome']; }
    for (const c of r.coverage) coverage.push({ ...c, outcome: c.status === 'not_evaluated' || c.status === 'unsupported' ? undefined : (worst ?? 'pass'), findingCount: r.findings.length });
  }
  // Dimensions that apply to every design but have no analyzer yet read not evaluated. Others appear only when relevant.
  const seen = new Set(coverage.map((c) => c.dimension));
  for (const d of UNIVERSAL_DIMENSIONS) if (!seen.has(d)) coverage.push({ dimension: d, group: 'electrical', status: 'not_evaluated', note: 'No analyzer covers this dimension yet' });
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { status: ctx.hasPower ? 'complete' : 'incomplete', findings, coverage, metrics, stateHash: stateHash(project), evaluatedAt: new Date().toISOString() };
}
