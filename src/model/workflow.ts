import type { Project, EvaluationResult, Finding, PinRef, MutationOp } from './schema';
import type { HistoryEvent } from './history';
import { RULES_VERSION } from '../eval/evaluate';

export type ProjectState = 'intent' | 'requirements' | 'parts_unresolved' | 'design_incomplete' | 'unevaluated' | 'evaluated_current' | 'evaluated_stale' | 'reviewed';
export type Edit = { label: string; ops: MutationOp[]; mutationId?: string; optimizationId?: string };
export type EvalSummary = { at: string; added: number; resolved: number; persisting: number };

export type Session = {
  base: Project;                 // template snapshot or imported project; edits replay on top of it
  edits: Edit[];
  project: Project;
  history: HistoryEvent[];
  lastSummary?: EvalSummary;
  currentHash: string;
  aiReview?: { stateHash: string; observations: Finding[]; model: string; latencyMs: number; dropped: number; error?: string };
  dismissedTips: string[];
  appliedMutations: string[];
  previousEvaluation?: EvaluationResult;
  selectedInstance?: string;
  selectedNet?: string;
  selectedPin?: PinRef;
  connectFrom?: PinRef;          // connect mode is armed from this pin
  compareId?: string;            // optimization being previewed
  openFinding?: string;
  introDismissed?: boolean;
  learn?: { focus?: string };   // the Learn sheet is open; focus is `flow:<id>` | `part:<instance>` | `decision:<id>` and only drives highlighting
};

/** Derived, never stored. */
export function projectState(s: Session): ProjectState {
  const p = s.project;
  if (p.source === 'generated' && p.requirements.length === 0) return 'intent';
  if (p.unresolved.some((u) => u.startsWith('question:'))) return 'requirements';
  if (p.unresolved.length > 0) return 'parts_unresolved';
  const powerOk = !!p.power.sourceInstance && p.instances.some((i) => i.id === p.power.sourceInstance);
  if (!powerOk) return 'design_incomplete';
  if (!p.lastEvaluation) return 'unevaluated';
  if (p.lastEvaluation.stateHash !== s.currentHash || p.lastEvaluation.rulesVersion !== RULES_VERSION) return 'evaluated_stale';
  if (s.aiReview && s.aiReview.stateHash === s.currentHash) return 'reviewed';
  return 'evaluated_current';
}

export type FindingLifecycle = 'new' | 'persisting' | 'resolved' | 'acknowledged' | 'overridden';
export type LifecycleFinding = Finding & { lifecycle: FindingLifecycle };

export const findingKey = (f: Finding) => `${f.ruleId}|${f.category}|${f.affected.map((a) => a.instanceId ?? a.netId ?? a.requirementId ?? '').sort().join(',')}`;

/** Diff the current evaluation against the previous one. Resolved findings are returned once, from the previous result. */
export function findingLifecycles(current: EvaluationResult | undefined, previous: EvaluationResult | undefined, history: HistoryEvent[], overrides: Project['overrides']): LifecycleFinding[] {
  if (!current) return [];
  const prevKeys = new Set((previous?.findings ?? []).map(findingKey));
  const viewed = new Set(history.filter((e) => e.kind === 'view_finding').map((e) => e.ref));
  const out: LifecycleFinding[] = current.findings.map((f) => ({
    ...f,
    lifecycle: overrides.some((o) => o.ruleId === f.ruleId && (!o.instanceId || f.affected.some((a) => a.instanceId === o.instanceId))) ? 'overridden'
      : viewed.has(f.id) ? 'acknowledged' : prevKeys.has(findingKey(f)) ? 'persisting' : 'new',
  }));
  const curKeys = new Set(current.findings.map(findingKey));
  for (const f of previous?.findings ?? []) if (!curKeys.has(findingKey(f)) && (f.severity === 'violation' || f.severity === 'warning')) out.push({ ...f, id: `resolved-${f.id}`, lifecycle: 'resolved' });
  return out;
}

export type RequirementStatus = 'pass' | 'fail' | 'above_target' | 'not_evaluated' | 'unknown';
/** Per-requirement status from an evaluation: findings that name the requirement decide it; evaluable requirements without findings pass. */
export function requirementStatuses(project: Project, ev: EvaluationResult | undefined): Record<string, RequirementStatus> {
  const out: Record<string, RequirementStatus> = {};
  for (const r of project.requirements) {
    if (!r.evaluable) { out[r.id] = 'not_evaluated'; continue; }
    if (!ev) { out[r.id] = 'unknown'; continue; }
    const mine = ev.findings.filter((f) => f.affected.some((a) => a.requirementId === r.id));
    out[r.id] = mine.some((f) => f.severity === 'violation') ? 'fail' : mine.some((f) => f.severity === 'optimization') ? 'above_target' : mine.some((f) => f.severity === 'unknown') ? 'unknown' : 'pass';
  }
  return out;
}

export type Step = 'inspect' | 'evaluate' | 'change' | 'reevaluate' | 'optimize';
export type StepState = { current: Step; done: Step[]; hint: string; target?: { kind: 'finding' | 'mutation' | 'panel' | 'button' | 'optimization'; id: string } };

/** The loop, as a stepper: which step is current, which are done, and one hint. Pure. */
export function stepState(s: Session, lifecycles: LifecycleFinding[]): StepState {
  const state = projectState(s);
  const did = (k: HistoryEvent['kind']) => s.history.some((e) => e.kind === k);
  const changed = did('apply_mutation') || did('edit') || did('connect') || did('fix');
  const evaluatedAfterChange = changed && s.history.some((e, i) => e.kind === 'evaluate' && s.history.slice(0, i).some((x) => ['apply_mutation', 'edit', 'connect', 'fix'].includes(x.kind)));
  const done: Step[] = ['inspect'];
  if (did('evaluate')) done.push('evaluate');
  if (changed) done.push('change');
  if (evaluatedAfterChange) done.push('reevaluate');
  if (did('optimize')) done.push('optimize');
  if (state === 'design_incomplete') return { current: 'change', done, hint: 'This design has no power source. Undo, or connect a source.', target: { kind: 'panel', id: 'design' } };
  if (state === 'unevaluated') return { current: 'evaluate', done, hint: 'Run the deterministic rules on this design. Nothing leaves the browser.', target: { kind: 'button', id: 'evaluate' } };
  if (state === 'evaluated_stale') return { current: 'reevaluate', done, hint: `The circuit changed${s.edits.length ? ` (${s.edits[s.edits.length - 1].label})` : ''}. Re-evaluate to see the consequence.`, target: { kind: 'button', id: 'evaluate' } };
  // Any standing violation sends the loop back to Inspect, whether it is new or has persisted across evaluations, and before
  // any celebration of a resolved finding: the design is not sound until it clears.
  const violations = lifecycles.filter((f) => f.severity === 'violation' && f.lifecycle !== 'resolved');
  const firstViolation = violations.find((f) => f.lifecycle === 'new') ?? violations[0];
  if (firstViolation) return { current: 'inspect', done: done.filter((d) => d !== 'inspect'), hint: `${violations.length > 1 ? `${violations.length} violations` : 'A violation'}. Open it: the evidence names the pins, and the fix buttons change the circuit for you.`, target: { kind: 'finding', id: firstViolation.id } };
  const resolved = lifecycles.find((f) => f.lifecycle === 'resolved');
  if (resolved) return { current: evaluatedAfterChange ? 'optimize' : 'change', done, hint: `"${resolved.title}" cleared because the circuit changed. ${evaluatedAfterChange ? 'Now improve the design toward its goals: Optimize.' : ''}`.trim(), target: { kind: 'finding', id: resolved.id } };
  if (!changed) {
    const stby = s.project.mutations.find((m) => m.id === 'force_stby_low');
    return { current: 'change', done, hint: stby ? `Nothing wrong yet. Try "${stby.label}", or tap a pin to wire it somewhere else.` : 'Change the circuit: tap a pin to wire it, or try a change.', target: stby ? { kind: 'mutation', id: stby.id } : { kind: 'panel', id: 'changes' } };
  }
  const opp = lifecycles.find((f) => f.severity === 'optimization' && f.fixes.some((x) => x.kind === 'optimize'));
  if (s.project.optimizations.length && !did('optimize')) return { current: 'optimize', done, hint: opp ? `Electrically fine, but not tuned to the goal: ${opp.title.split(':')[0]}. Preview an optimization to compare tradeoffs.` : 'Preview an optimization to compare before and after.', target: { kind: 'panel', id: 'optimize' } };
  return { current: 'optimize', done, hint: 'Keep going: every change is undoable and re-evaluated by the same rules.', target: { kind: 'panel', id: 'changes' } };
}
