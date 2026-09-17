import { describe, it, expect } from 'vitest';
import { loadSessions, saveSessions, STORAGE_KEY, LEGACY_KEY_V1, STORAGE_VERSION } from '../storage';
import { templates, registry } from '../../data';
import { evaluate } from '../../eval/evaluate';
import { applyOps } from '../../eval/mutations';
import { findingLifecycles } from '../../model/workflow';

class MemStorage { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

/** A payload as build b71e7f8 wrote it: unversioned key, no base/edits, findings without `fixes`. */
function v1Payload() {
  const t = templates[0]; const mutated = applyOps(t, t.mutations.find((m) => m.id === 'force_stby_low')!.ops);
  const strip = (r: ReturnType<typeof evaluate>) => { const c = JSON.parse(JSON.stringify(r)); for (const f of c.findings) delete f.fixes; delete c.metrics; return c; };
  return JSON.stringify({ sessions: { [t.id]: { project: { ...mutated, lastEvaluation: strip(evaluate(mutated, registry)) }, history: [], currentHash: 'x', dismissedTips: [], appliedMutations: ['force_stby_low'], previousEvaluation: strip(evaluate(t, registry)) } }, activeId: t.id });
}

describe('versioned storage', () => {
  it('upgrades a v1 payload: findings gain fixes, evaluations re-parse, the session survives and renders lifecycles', () => {
    const st = new MemStorage(); st.setItem(LEGACY_KEY_V1, v1Payload());
    const r = loadSessions(st);
    expect(r.notice).toBeUndefined();
    const s = r.sessions[templates[0].id]; expect(s).toBeTruthy();
    expect(s.appliedMutations).toEqual(['force_stby_low']); expect(s.edits.length).toBe(1);
    expect(s.previousEvaluation?.findings.every((f) => Array.isArray(f.fixes))).toBe(true);
    // The crash path: lifecycles built from the migrated previous evaluation.
    const lc = findingLifecycles(evaluate(s.project, registry), s.previousEvaluation, s.history, s.project.overrides);
    expect(lc.every((f) => Array.isArray(f.fixes))).toBe(true);
    expect(st.getItem(STORAGE_KEY)).toBeTruthy(); expect(st.getItem(LEGACY_KEY_V1)).toBeNull();
    expect(JSON.parse(st.getItem(STORAGE_KEY)!).version).toBe(STORAGE_VERSION);
  });
  it('drops unreadable data and says so; refuses data from a newer version; round-trips its own writes', () => {
    const st = new MemStorage(); st.setItem(STORAGE_KEY, '{not json');
    expect(loadSessions(st).notice).toMatch(/could not be read/);
    st.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION + 1, sessions: {} }));
    expect(loadSessions(st).notice).toMatch(/newer version/);
    st.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, sessions: { bogus: { project: { id: 'nope' } } } }));
    expect(loadSessions(st).notice).toMatch(/could not be kept/);
    const v1 = new MemStorage(); v1.setItem(LEGACY_KEY_V1, v1Payload()); const loaded = loadSessions(v1);
    const again = new MemStorage(); saveSessions(loaded.sessions, loaded.activeId, again);
    const re = loadSessions(again); expect(Object.keys(re.sessions)).toEqual(Object.keys(loaded.sessions)); expect(re.notice).toBeUndefined();
  });
});
