import { useEffect, useReducer } from 'react';
import type { Project, EvaluationResult, Finding, MutationOp, PinRef } from '../model/schema';
import type { HistoryEvent, EventKind } from '../model/history';
import type { Session, Edit } from '../model/workflow';
import { findingKey } from '../model/workflow';
import { registry, freshProject, getTemplate } from '../data';
import { evaluate } from '../eval/evaluate';
import { applyOps, connectPins } from '../eval/mutations';
import { stateHash } from '../eval/hash';
import { loadSessions, saveSessions } from './storage';

export type AIStatus = { configured: boolean; provider?: string; model?: string };
export type AppState = { view: 'library' | 'project'; sessions: Record<string, Session>; activeId?: string; aiStatus?: AIStatus; aiBusy: boolean; notice?: string };

export type Action =
  | { type: 'OPEN_TEMPLATE'; id: string } | { type: 'NEW_SESSION'; id: string } | { type: 'BACK' } | { type: 'IMPORT'; project: Project } | { type: 'DISMISS_NOTICE' } | { type: 'CLEAR_ALL' }
  | { type: 'EVALUATE' } | { type: 'APPLY_MUTATION'; id: string } | { type: 'EDIT'; label: string; ops: MutationOp[]; kind?: EventKind } | { type: 'UNDO' } | { type: 'RESET' }
  | { type: 'CONNECT_TO'; pin: PinRef } | { type: 'ARM_CONNECT'; pin?: PinRef } | { type: 'APPLY_OPTIMIZATION'; id: string; evaluation?: EvaluationResult } | { type: 'COMPARE'; id?: string }
  | { type: 'LEARN_OPEN' } | { type: 'LEARN_CLOSE' } | { type: 'LEARN_FOCUS'; id?: string }
  | { type: 'VIEW_FINDING'; id: string } | { type: 'VIEW_COVERAGE' } | { type: 'SELECT_INSTANCE'; id?: string } | { type: 'SELECT_NET'; id?: string } | { type: 'SELECT_PIN'; pin?: PinRef } | { type: 'DESELECT' } | { type: 'DISMISS_TIP'; id: string } | { type: 'DISMISS_INTRO' }
  | { type: 'AI_START' } | { type: 'AI_RESULT'; result: { observations: Finding[]; model: string; provider: string; latencyMs: number; dropped: number } } | { type: 'AI_ERROR'; error: string }
  | { type: 'SET_AI_STATUS'; status: AIStatus };

const ev = (kind: EventKind, hash: string, ref?: string): HistoryEvent => ({ kind, at: new Date().toISOString(), stateHash: hash, ref });

function newSession(base: Project, kind: EventKind = 'open_template'): Session {
  const project = structuredClone(base); const h = stateHash(project);
  return { base, edits: [], project, history: [ev(kind, h)], currentHash: h, dismissedTips: [], appliedMutations: [] };
}

/** Recompute the project from base plus edits; keep the last evaluation so the stale/current distinction survives. */
function replay(s: Session, edits: Edit[], eventKind: EventKind, ref?: string, keepEvaluation: EvaluationResult | undefined = s.project.lastEvaluation): Session {
  const project = applyOps(structuredClone(s.base), edits.flatMap((e) => e.ops));
  project.lastEvaluation = keepEvaluation;
  const h = stateHash(project);
  const pinOk = (p?: PinRef) => !!p && project.instances.some((i) => i.id === p.instance);
  return { ...s, edits, project, currentHash: h, appliedMutations: edits.filter((e) => e.mutationId).map((e) => e.mutationId!), history: [...s.history, ev(eventKind, h, ref)],
    selectedInstance: project.instances.some((i) => i.id === s.selectedInstance) ? s.selectedInstance : undefined, selectedNet: project.nets.some((n) => n.id === s.selectedNet) ? s.selectedNet : undefined,
    selectedPin: pinOk(s.selectedPin) ? s.selectedPin : undefined, connectFrom: undefined, compareId: undefined };
}

function withSession(state: AppState, f: (s: Session) => Session): AppState {
  const id = state.activeId; if (!id) return state;
  const s = state.sessions[id]; if (!s) return state;
  return { ...state, sessions: { ...state.sessions, [id]: f(s) } };
}

function summarize(prev: EvaluationResult | undefined, result: EvaluationResult) {
  const prevKeys = new Set((prev?.findings ?? []).map(findingKey)); const curKeys = new Set(result.findings.map(findingKey));
  const added = result.findings.filter((f) => !prevKeys.has(findingKey(f))).length;
  const resolved = (prev?.findings ?? []).filter((f) => !curKeys.has(findingKey(f)) && (f.severity === 'violation' || f.severity === 'warning')).length;
  return { at: result.evaluatedAt, added, resolved, persisting: result.findings.length - added };
}

export function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case 'OPEN_TEMPLATE': {
      const existing = state.sessions[a.id];
      const session = existing ? { ...existing, history: [...existing.history, ev('open_template', existing.currentHash)] } : newSession(freshProject(a.id));
      return { ...state, view: 'project', activeId: a.id, sessions: { ...state.sessions, [a.id]: session } };
    }
    case 'IMPORT': {
      const id = state.sessions[a.project.id] || getTemplate(a.project.id) ? `${a.project.id}-import-${Date.now().toString(36)}` : a.project.id;
      // An imported file's own evaluation is never trusted: the reviewer re-evaluates with this build's rules.
      const base = { ...structuredClone(a.project), id, source: 'imported' as const, lastEvaluation: undefined };
      const session = newSession(base, 'open_template');
      return { ...state, view: 'project', activeId: id, sessions: { ...state.sessions, [id]: session } };
    }
    case 'NEW_SESSION': return { ...state, view: 'project', activeId: a.id, sessions: { ...state.sessions, [a.id]: newSession(freshProject(a.id)) } };
    case 'DISMISS_NOTICE': return { ...state, notice: undefined };
    // Clear saved work: every session in this browser is discarded and the library starts fresh. The AI status is server state and stays.
    case 'CLEAR_ALL': return { view: 'library', sessions: {}, activeId: undefined, notice: undefined, aiBusy: false, aiStatus: state.aiStatus };
    case 'BACK': return { ...state, view: 'library' };
    case 'EVALUATE': return withSession(state, (s) => {
      const result = evaluate(s.project, registry); const prev = s.project.lastEvaluation;
      return { ...s, previousEvaluation: prev ?? s.previousEvaluation, project: { ...s.project, lastEvaluation: result }, lastSummary: summarize(prev, result), history: [...s.history, ev('evaluate', result.stateHash)], openFinding: undefined };
    });
    case 'APPLY_MUTATION': return withSession(state, (s) => { const m = s.project.mutations.find((x) => x.id === a.id); return m ? replay(s, [...s.edits, { label: m.label, ops: m.ops, mutationId: m.id }], 'apply_mutation', m.id) : s; });
    case 'EDIT': return withSession(state, (s) => replay(s, [...s.edits, { label: a.label, ops: a.ops }], a.kind ?? 'edit', a.label));
    case 'ARM_CONNECT': return withSession(state, (s) => ({ ...s, connectFrom: a.pin, selectedPin: a.pin ?? s.selectedPin }));
    case 'CONNECT_TO': return withSession(state, (s) => {
      const from = s.connectFrom; if (!from) return s;
      const ops = connectPins(s.project, registry, from, a.pin); if (!ops.length) return { ...s, connectFrom: undefined };
      const name = (r: PinRef) => `${s.project.instances.find((i) => i.id === r.instance)?.label ?? r.instance} ${r.pin}`;
      const label = `Connect ${name(from)} to ${name(a.pin)}`;
      const next = replay(s, [...s.edits, { label, ops }], 'connect', label);
      return { ...next, selectedPin: a.pin, selectedNet: next.project.nets.find((n) => n.pins.some((p) => p.instance === a.pin.instance && p.pin === a.pin.pin))?.id };
    });
    case 'COMPARE': return withSession(state, (s) => ({ ...s, compareId: a.id }));
    case 'APPLY_OPTIMIZATION': return withSession(state, (s) => {
      const o = s.project.optimizations.find((x) => x.id === a.id); if (!o) return s;
      const prev = s.project.lastEvaluation;
      // The evaluation stored with the applied optimization is computed here from the real candidate; a caller-supplied result is only accepted when it is byte-for-byte that.
      const edits = [...s.edits, { label: o.title, ops: o.ops, optimizationId: o.id }];
      const candidate = applyOps(structuredClone(s.base), edits.flatMap((e) => e.ops));
      const fresh = evaluate(candidate, registry);
      const result = a.evaluation && a.evaluation.stateHash === fresh.stateHash && a.evaluation.rulesVersion === fresh.rulesVersion && JSON.stringify(a.evaluation.findings) === JSON.stringify(fresh.findings) ? a.evaluation : fresh;
      const next = replay(s, edits, 'optimize', o.id, result);
      return { ...next, previousEvaluation: prev ?? s.previousEvaluation, lastSummary: summarize(prev, result), compareId: undefined, openFinding: undefined };
    });
    case 'UNDO': return withSession(state, (s) => (s.edits.length ? replay(s, s.edits.slice(0, -1), 'edit', 'undo') : s));
    case 'RESET': return withSession(state, (s) => ({ ...replay(s, [], 'reset'), aiReview: undefined, openFinding: undefined }));
    case 'VIEW_FINDING': return withSession(state, (s) => ({ ...s, openFinding: s.openFinding === a.id ? undefined : a.id, history: s.openFinding === a.id ? s.history : [...s.history, ev('view_finding', s.currentHash, a.id)] }));
    case 'VIEW_COVERAGE': return withSession(state, (s) => s.history.some((e) => e.kind === 'view_coverage') ? s : ({ ...s, history: [...s.history, ev('view_coverage', s.currentHash)] }));
    case 'LEARN_OPEN': return withSession(state, (s) => ({ ...s, learn: s.learn ?? { focus: s.project.designGuide?.decisions[0] ? `decision:${s.project.designGuide.decisions[0].id}` : undefined }, selectedInstance: undefined, selectedNet: undefined, selectedPin: undefined, connectFrom: undefined, history: s.learn ? s.history : [...s.history, ev('view_guide', s.currentHash)] }));
    case 'LEARN_CLOSE': return withSession(state, (s) => ({ ...s, learn: undefined }));
    case 'LEARN_FOCUS': return withSession(state, (s) => (s.learn ? { ...s, learn: { focus: s.learn.focus === a.id ? undefined : a.id } } : s));
    case 'SELECT_INSTANCE': return withSession(state, (s) => ({ ...s, learn: undefined, selectedNet: undefined, selectedPin: undefined, connectFrom: undefined, selectedInstance: s.selectedInstance === a.id ? undefined : a.id, history: a.id ? [...s.history, ev('select_instance', s.currentHash, a.id)] : s.history }));
    case 'SELECT_NET': return withSession(state, (s) => ({ ...s, learn: undefined, selectedInstance: undefined, selectedPin: undefined, connectFrom: undefined, selectedNet: s.selectedNet === a.id ? undefined : a.id }));
    case 'SELECT_PIN': return withSession(state, (s) => ({ ...s, learn: undefined, selectedInstance: undefined, selectedNet: undefined, connectFrom: undefined, selectedPin: a.pin }));
    case 'DESELECT': return withSession(state, (s) => ({ ...s, learn: undefined, selectedInstance: undefined, selectedNet: undefined, selectedPin: undefined, connectFrom: undefined }));
    case 'DISMISS_TIP': return withSession(state, (s) => ({ ...s, dismissedTips: [...s.dismissedTips, a.id], history: [...s.history, ev('dismiss_tip', s.currentHash, a.id)] }));
    case 'DISMISS_INTRO': return withSession(state, (s) => ({ ...s, introDismissed: true }));
    case 'AI_START': return { ...state, aiBusy: true };
    case 'AI_RESULT': return withSession({ ...state, aiBusy: false }, (s) => ({ ...s, aiReview: { stateHash: s.currentHash, ...a.result }, history: [...s.history, ev('ai_review', s.currentHash)] }));
    case 'AI_ERROR': return withSession({ ...state, aiBusy: false }, (s) => ({ ...s, aiReview: { stateHash: s.currentHash, observations: [], model: '', latencyMs: 0, dropped: 0, error: a.error } }));
    case 'SET_AI_STATUS': return { ...state, aiStatus: a.status };
  }
}

export function useAppStore() {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const persisted = loadSessions();
    return { view: 'library', aiBusy: false, sessions: persisted.sessions, activeId: persisted.activeId, notice: persisted.notice } as AppState;
  });
  useEffect(() => { saveSessions(state.sessions, state.activeId); }, [state.sessions, state.activeId]);
  useEffect(() => {
    fetch('/api/ai/status', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { configured: false })).then((s) => dispatch({ type: 'SET_AI_STATUS', status: s })).catch(() => dispatch({ type: 'SET_AI_STATUS', status: { configured: false } }));
  }, []);
  return { state, dispatch };
}
