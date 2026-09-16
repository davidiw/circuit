import { useEffect, useReducer } from 'react';
import type { Project, EvaluationResult, Finding, MutationOp } from '../model/schema';
import type { HistoryEvent, EventKind } from '../model/history';
import type { Session, Edit } from '../model/workflow';
import { registry, freshProject, getTemplate } from '../data';
import { evaluate } from '../eval/evaluate';
import { applyOps } from '../eval/mutations';
import { stateHash } from '../eval/hash';

export type AIStatus = { configured: boolean; provider?: string; model?: string };
export type AppState = { view: 'gate' | 'library' | 'project'; sessions: Record<string, Session>; activeId?: string; aiStatus?: AIStatus; aiBusy: boolean };

export type Action =
  | { type: 'AUTHED' } | { type: 'OPEN_TEMPLATE'; id: string } | { type: 'BACK' } | { type: 'IMPORT'; project: Project }
  | { type: 'EVALUATE' } | { type: 'APPLY_MUTATION'; id: string } | { type: 'EDIT'; label: string; ops: MutationOp[] } | { type: 'UNDO' } | { type: 'RESET' }
  | { type: 'VIEW_FINDING'; id: string } | { type: 'VIEW_COVERAGE' } | { type: 'SELECT_INSTANCE'; id?: string } | { type: 'SELECT_NET'; id?: string } | { type: 'DISMISS_TIP'; id: string }
  | { type: 'AI_START' } | { type: 'AI_RESULT'; result: { observations: Finding[]; model: string; provider: string; latencyMs: number; dropped: number } } | { type: 'AI_ERROR'; error: string }
  | { type: 'SET_AI_STATUS'; status: AIStatus };

const STORAGE_KEY = 'circuit-factory.sessions.v1';
const isDev = import.meta.env.DEV;

function load(): Pick<AppState, 'sessions' | 'activeId'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Pick<AppState, 'sessions' | 'activeId'>;
      // Older sessions predate `base` and `edits`; rebuild them from their template.
      for (const [id, s] of Object.entries(parsed.sessions ?? {})) {
        if (!s.base) { const t = getTemplate(s.project.id); if (!t) { delete parsed.sessions[id]; continue; } s.base = structuredClone(t); s.edits = (s.appliedMutations ?? []).map((m) => ({ label: m, ops: t.mutations.find((x) => x.id === m)?.ops ?? [], mutationId: m })); }
        s.edits ??= []; s.appliedMutations ??= []; s.dismissedTips ??= [];
      }
      return parsed;
    }
  } catch { /* storage unavailable */ }
  return { sessions: {} };
}
function save(s: AppState) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: s.sessions, activeId: s.activeId })); } catch { /* ignore */ } }

const ev = (kind: EventKind, hash: string, ref?: string): HistoryEvent => ({ kind, at: new Date().toISOString(), stateHash: hash, ref });

function newSession(base: Project, kind: EventKind = 'open_template'): Session {
  const project = structuredClone(base); const h = stateHash(project);
  return { base, edits: [], project, history: [ev(kind, h)], currentHash: h, dismissedTips: [], appliedMutations: [] };
}

/** Recompute the project from base plus edits; keep the last evaluation so the stale/current distinction survives. */
function replay(s: Session, edits: Edit[], eventKind: EventKind, ref?: string): Session {
  const project = applyOps(structuredClone(s.base), edits.flatMap((e) => e.ops));
  project.lastEvaluation = s.project.lastEvaluation;
  const h = stateHash(project);
  return { ...s, edits, project, currentHash: h, appliedMutations: edits.filter((e) => e.mutationId).map((e) => e.mutationId!), history: [...s.history, ev(eventKind, h, ref)], selectedInstance: project.instances.some((i) => i.id === s.selectedInstance) ? s.selectedInstance : undefined, selectedNet: project.nets.some((n) => n.id === s.selectedNet) ? s.selectedNet : undefined };
}

function withSession(state: AppState, f: (s: Session) => Session): AppState {
  const id = state.activeId; if (!id) return state;
  const s = state.sessions[id]; if (!s) return state;
  return { ...state, sessions: { ...state.sessions, [id]: f(s) } };
}

const fkey = (f: Finding) => `${f.ruleId}|${f.category}|${f.affected.map((a) => a.instanceId ?? a.netId ?? '').sort().join(',')}`;

export function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case 'AUTHED': return { ...state, view: 'library' };
    case 'OPEN_TEMPLATE': {
      const existing = state.sessions[a.id];
      const session = existing ? { ...existing, history: [...existing.history, ev('open_template', existing.currentHash)] } : newSession(freshProject(a.id));
      return { ...state, view: 'project', activeId: a.id, sessions: { ...state.sessions, [a.id]: session } };
    }
    case 'IMPORT': {
      const id = state.sessions[a.project.id] || getTemplate(a.project.id) ? `${a.project.id}-import-${Date.now().toString(36)}` : a.project.id;
      const base = { ...structuredClone(a.project), id, source: 'imported' as const, lastEvaluation: undefined };
      const session = newSession(base, 'open_template'); session.project.lastEvaluation = a.project.lastEvaluation;
      return { ...state, view: 'project', activeId: id, sessions: { ...state.sessions, [id]: session } };
    }
    case 'BACK': return { ...state, view: 'library' };
    case 'EVALUATE': return withSession(state, (s) => {
      const result: EvaluationResult = evaluate(s.project, registry);
      const prev = s.project.lastEvaluation; const prevKeys = new Set((prev?.findings ?? []).map(fkey)); const curKeys = new Set(result.findings.map(fkey));
      const added = result.findings.filter((f) => !prevKeys.has(fkey(f))).length;
      const resolved = (prev?.findings ?? []).filter((f) => !curKeys.has(fkey(f)) && (f.severity === 'violation' || f.severity === 'warning')).length;
      return { ...s, previousEvaluation: prev ?? s.previousEvaluation, project: { ...s.project, lastEvaluation: result }, lastSummary: { at: result.evaluatedAt, added, resolved, persisting: result.findings.length - added }, history: [...s.history, ev('evaluate', result.stateHash)], openFinding: undefined };
    });
    case 'APPLY_MUTATION': return withSession(state, (s) => {
      const m = s.project.mutations.find((x) => x.id === a.id); if (!m) return s;
      return replay(s, [...s.edits, { label: m.label, ops: m.ops, mutationId: m.id }], 'apply_mutation', m.id);
    });
    case 'EDIT': return withSession(state, (s) => replay(s, [...s.edits, { label: a.label, ops: a.ops }], 'edit', a.label));
    case 'UNDO': return withSession(state, (s) => (s.edits.length ? replay(s, s.edits.slice(0, -1), 'edit', 'undo') : s));
    case 'RESET': return withSession(state, (s) => ({ ...replay(s, [], 'reset'), aiReview: undefined, openFinding: undefined }));
    case 'VIEW_FINDING': return withSession(state, (s) => ({ ...s, openFinding: s.openFinding === a.id ? undefined : a.id, history: s.openFinding === a.id ? s.history : [...s.history, ev('view_finding', s.currentHash, a.id)] }));
    case 'VIEW_COVERAGE': return withSession(state, (s) => s.history.some((e) => e.kind === 'view_coverage') ? s : ({ ...s, history: [...s.history, ev('view_coverage', s.currentHash)] }));
    case 'SELECT_INSTANCE': return withSession(state, (s) => ({ ...s, selectedNet: undefined, selectedInstance: s.selectedInstance === a.id ? undefined : a.id, history: a.id ? [...s.history, ev('select_instance', s.currentHash, a.id)] : s.history }));
    case 'SELECT_NET': return withSession(state, (s) => ({ ...s, selectedInstance: undefined, selectedNet: s.selectedNet === a.id ? undefined : a.id }));
    case 'DISMISS_TIP': return withSession(state, (s) => ({ ...s, dismissedTips: [...s.dismissedTips, a.id], history: [...s.history, ev('dismiss_tip', s.currentHash, a.id)] }));
    case 'AI_START': return { ...state, aiBusy: true };
    case 'AI_RESULT': return withSession({ ...state, aiBusy: false }, (s) => ({ ...s, aiReview: { stateHash: s.currentHash, ...a.result }, history: [...s.history, ev('ai_review', s.currentHash)] }));
    case 'AI_ERROR': return withSession({ ...state, aiBusy: false }, (s) => ({ ...s, aiReview: { stateHash: s.currentHash, observations: [], model: '', latencyMs: 0, dropped: 0, error: a.error } }));
    case 'SET_AI_STATUS': return { ...state, aiStatus: a.status };
  }
}

export function useAppStore() {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const persisted = load();
    let authed = !isDev; try { authed = authed || sessionStorage.getItem('cf.dev.authed') === '1'; } catch { /* ignore */ }
    return { view: authed ? 'library' : 'gate', aiBusy: false, ...persisted } as AppState;
  });
  useEffect(() => { save(state); }, [state.sessions, state.activeId]);
  useEffect(() => {
    fetch('/api/ai/status', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { configured: false })).then((s) => dispatch({ type: 'SET_AI_STATUS', status: s })).catch(() => dispatch({ type: 'SET_AI_STATUS', status: { configured: false } }));
  }, []);
  return { state, dispatch, isDev };
}
