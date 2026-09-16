import type { Project, EvaluationResult, Finding } from './schema';
import type { HistoryEvent } from './history';

export type ProjectState = 'intent' | 'requirements' | 'parts_unresolved' | 'design_incomplete' | 'unevaluated' | 'evaluated_current' | 'evaluated_stale' | 'reviewed';

export type Session = {
  project: Project;
  history: HistoryEvent[];
  currentHash: string;
  aiReview?: { stateHash: string; observations: Finding[]; model: string; latencyMs: number; dropped: number; error?: string };
  dismissedTips: string[];
  appliedMutations: string[];
  previousEvaluation?: EvaluationResult;
  selectedInstance?: string;
  openFinding?: string;
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
  if (p.lastEvaluation.stateHash !== s.currentHash) return 'evaluated_stale';
  if (s.aiReview && s.aiReview.stateHash === s.currentHash) return 'reviewed';
  return 'evaluated_current';
}

export type FindingLifecycle = 'new' | 'persisting' | 'resolved' | 'acknowledged' | 'overridden';
export type LifecycleFinding = Finding & { lifecycle: FindingLifecycle };

const key = (f: Finding) => `${f.ruleId}|${f.category}|${f.affected.map((a) => a.instanceId ?? a.netId ?? '').sort().join(',')}`;

/** Diff the current evaluation against the previous one. Resolved findings are returned once, from the previous result. */
export function findingLifecycles(current: EvaluationResult | undefined, previous: EvaluationResult | undefined, history: HistoryEvent[], overrides: Project['overrides']): LifecycleFinding[] {
  if (!current) return [];
  const prevKeys = new Set((previous?.findings ?? []).map(key));
  const viewed = new Set(history.filter((e) => e.kind === 'view_finding').map((e) => e.ref));
  const out: LifecycleFinding[] = current.findings.map((f) => ({
    ...f,
    lifecycle: overrides.some((o) => o.ruleId === f.ruleId && (!o.instanceId || f.affected.some((a) => a.instanceId === o.instanceId))) ? 'overridden'
      : viewed.has(f.id) ? 'acknowledged' : prevKeys.has(key(f)) ? 'persisting' : 'new',
  }));
  const curKeys = new Set(current.findings.map(key));
  for (const f of previous?.findings ?? []) if (!curKeys.has(key(f)) && (f.severity === 'violation' || f.severity === 'warning')) out.push({ ...f, id: `resolved-${f.id}`, lifecycle: 'resolved' });
  return out;
}

export type Tip = { id: string; text: string; target?: { kind: 'finding' | 'mutation' | 'panel' | 'button'; id: string } };

/** At most two tips, from state plus history. Pure. */
export function nextSteps(s: Session, lifecycles: LifecycleFinding[]): Tip[] {
  const state = projectState(s);
  const tips: Tip[] = [];
  const did = (k: HistoryEvent['kind']) => s.history.some((e) => e.kind === k);
  const push = (t: Tip) => { if (!s.dismissedTips.includes(t.id) && tips.length < 2) tips.push(t); };
  const firstViolation = lifecycles.find((f) => f.severity === 'violation' && f.lifecycle === 'new');
  const resolved = lifecycles.filter((f) => f.lifecycle === 'resolved');
  switch (state) {
    case 'requirements': push({ id: 'answer', text: 'Open questions change the architecture. Answer them or accept the defaults.', target: { kind: 'panel', id: 'requirements' } }); break;
    case 'parts_unresolved': push({ id: 'resolve', text: 'A component need is not mapped to a registry part yet.', target: { kind: 'panel', id: 'parts' } }); break;
    case 'design_incomplete': push({ id: 'power', text: 'This design has no power source. Add one or it stays incomplete.', target: { kind: 'panel', id: 'power' } }); break;
    case 'unevaluated': push({ id: 'evaluate', text: 'Press Evaluate to run the deterministic rules on this design. No network needed.', target: { kind: 'button', id: 'evaluate' } }); break;
    case 'evaluated_stale': push({ id: 'reevaluate', text: 'The design changed since the last evaluation. Re-evaluate to see what moved.', target: { kind: 'button', id: 'evaluate' } }); break;
    case 'evaluated_current':
    case 'reviewed': {
      if (resolved.length) push({ id: `resolved-${resolved[0].ruleId}`, text: `"${resolved[0].title}" cleared because the rule condition changed. That is the loop.`, target: { kind: 'finding', id: resolved[0].id } });
      if (firstViolation) push({ id: `open-${firstViolation.id}`, text: 'A new violation appeared. Open it to see the trigger, evidence, and consequence.', target: { kind: 'finding', id: firstViolation.id } });
      else if (!did('apply_mutation') && s.project.mutations.length) push({ id: 'mutate', text: `No violations. Try "${s.project.mutations.find((m) => m.id === 'force_stby_low')?.label ?? s.project.mutations[0].label}", then re-evaluate to watch a rule fire.`, target: { kind: 'mutation', id: s.project.mutations.find((m) => m.id === 'force_stby_low')?.id ?? s.project.mutations[0].id } });
      if (!did('view_coverage')) push({ id: 'coverage', text: 'Coverage lists what was and was not evaluated. A clean findings list is only as good as that list.', target: { kind: 'panel', id: 'coverage' } });
      if (state === 'evaluated_current' && did('apply_mutation') && !did('ai_review')) push({ id: 'ai', text: 'AI review is a separate, labeled pass. Nothing it says changes the design.', target: { kind: 'button', id: 'ai_review' } });
      break;
    }
  }
  return tips;
}
