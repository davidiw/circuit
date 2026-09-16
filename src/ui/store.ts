import { useEffect, useReducer } from 'react';
import type { Project, EvaluationResult, Finding } from '../model/schema';
import type { HistoryEvent, EventKind } from '../model/history';
import type { Session } from '../model/workflow';
import { registry, freshProject } from '../data';
import { evaluate } from '../eval/evaluate';
import { applyMutation } from '../eval/mutations';
import { stateHash } from '../eval/hash';

export type AIStatus = { configured: boolean; provider?: string; model?: string };
export type AppState = { view: 'gate' | 'library' | 'project'; sessions: Record<string, Session>; activeId?: string; aiStatus?: AIStatus; aiBusy: boolean };

export type Action =
  | { type: 'AUTHED' } | { type: 'OPEN_TEMPLATE'; id: string } | { type: 'BACK' }
  | { type: 'EVALUATE' } | { type: 'APPLY_MUTATION'; id: string } | { type: 'RESET' }
  | { type: 'VIEW_FINDING'; id: string } | { type: 'VIEW_COVERAGE' } | { type: 'SELECT_INSTANCE'; id?: string } | { type: 'DISMISS_TIP'; id: string }
  | { type: 'AI_START' } | { type: 'AI_RESULT'; result: { observations: Finding[]; model: string; provider: string; latencyMs: number; dropped: number } } | { type: 'AI_ERROR'; error: string }
  | { type: 'SET_AI_STATUS'; status: AIStatus };

const STORAGE_KEY = 'circuit-factory.sessions.v1';
const isDev = import.meta.env.DEV;

function load(): Pick<AppState, 'sessions' | 'activeId'> {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch { /* storage unavailable */ }
  return { sessions: {} };
}
function save(s: AppState) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions: s.sessions, activeId: s.activeId })); } catch { /* ignore */ } }

const ev = (kind: EventKind, hash: string, ref?: string): HistoryEvent => ({ kind, at: new Date().toISOString(), stateHash: hash, ref });

function newSession(project: Project): Session {
  const h = stateHash(project);
  return { project, history: [ev('open_template', h)], currentHash: h, dismissedTips: [], appliedMutations: [] };
}

function withSession(state: AppState, f: (s: Session) => Session): AppState {
  const id = state.activeId; if (!id) return state;
  const s = state.sessions[id]; if (!s) return state;
  return { ...state, sessions: { ...state.sessions, [id]: f(s) } };
}

export function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case 'AUTHED': return { ...state, view: 'library' };
    case 'OPEN_TEMPLATE': {
      const existing = state.sessions[a.id];
      const session = existing ? { ...existing, history: [...existing.history, ev('open_template', existing.currentHash)] } : newSession(freshProject(a.id));
      return { ...state, view: 'project', activeId: a.id, sessions: { ...state.sessions, [a.id]: session } };
    }
    case 'BACK': return { ...state, view: 'library' };
    case 'EVALUATE': return withSession(state, (s) => {
      const result: EvaluationResult = evaluate(s.project, registry);
      return { ...s, previousEvaluation: s.project.lastEvaluation ?? s.previousEvaluation, project: { ...s.project, lastEvaluation: result }, history: [...s.history, ev('evaluate', result.stateHash)], openFinding: undefined };
    });
    case 'APPLY_MUTATION': return withSession(state, (s) => {
      const project = applyMutation(s.project, a.id); const h = stateHash(project);
      return { ...s, project, currentHash: h, appliedMutations: [...s.appliedMutations, a.id], history: [...s.history, ev('apply_mutation', h, a.id)] };
    });
    case 'RESET': return withSession(state, (s) => {
      const project = freshProject(s.project.id); const h = stateHash(project);
      return { ...s, project, currentHash: h, appliedMutations: [], previousEvaluation: s.project.lastEvaluation ?? s.previousEvaluation, aiReview: undefined, openFinding: undefined, history: [...s.history, ev('reset', h)] };
    });
    case 'VIEW_FINDING': return withSession(state, (s) => ({ ...s, openFinding: s.openFinding === a.id ? undefined : a.id, history: s.openFinding === a.id ? s.history : [...s.history, ev('view_finding', s.currentHash, a.id)] }));
    case 'VIEW_COVERAGE': return withSession(state, (s) => s.history.some((e) => e.kind === 'view_coverage') ? s : ({ ...s, history: [...s.history, ev('view_coverage', s.currentHash)] }));
    case 'SELECT_INSTANCE': return withSession(state, (s) => ({ ...s, selectedInstance: s.selectedInstance === a.id ? undefined : a.id, history: a.id ? [...s.history, ev('select_instance', s.currentHash, a.id)] : s.history }));
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
