// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { templates, registry } from '../../data';
import { reducer, type AppState, type Action } from '../store';
import { ProjectView } from '../ProjectView';
import { Library } from '../Library';
import { evaluate } from '../../eval/evaluate';
import { applyOps } from '../../eval/mutations';

afterEach(cleanup);
const base = (): AppState => ({ view: 'library', sessions: {}, aiBusy: false });
const run = (actions: Action[], from: AppState = base()) => actions.reduce(reducer, from);
const open = (id: string) => run([{ type: 'AUTHED' }, { type: 'OPEN_TEMPLATE', id }]);

/** Render the project view for a state and fail on any thrown render error or console.error. */
async function renderState(state: AppState, label: string) {
  const errors: unknown[] = []; const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
  const dispatch = vi.fn();
  const s = state.sessions[state.activeId!];
  const out = render(<ProjectView session={s} state={state} dispatch={dispatch} />);
  await waitFor(() => expect(out.container.querySelector('.dia svg, .dia .muted')).toBeTruthy(), { timeout: 4000 });
  spy.mockRestore();
  expect(errors.map(String), label).toEqual([]);
  return out;
}

describe('render every corpus state without errors', () => {
  it('library with and without sessions, with a storage notice', () => {
    const s0 = base(); render(<Library state={s0} dispatch={vi.fn()} />);
    const s1 = run([{ type: 'AUTHED' }, { type: 'OPEN_TEMPLATE', id: templates[0].id }, { type: 'EVALUATE' }, { type: 'BACK' }]);
    const out = render(<Library state={{ ...s1, notice: 'Saved work from an earlier version could not be kept.' }} dispatch={vi.fn()} />);
    expect(out.getAllByText(/Resume/).length).toBeGreaterThan(0); expect(out.getByText(/could not be kept/)).toBeTruthy();
  });
  for (const t of templates) {
    it(`${t.id}: fresh, evaluated, every mutation evaluated, resolved after undo`, async () => {
      let st = open(t.id); await renderState(st, `${t.id} fresh`); cleanup();
      st = run([{ type: 'EVALUATE' }], st); await renderState(st, `${t.id} evaluated`); cleanup();
      for (const m of t.mutations) {
        const s2 = run([{ type: 'APPLY_MUTATION', id: m.id }, { type: 'EVALUATE' }], st);
        const out = await renderState(s2, `${t.id} ${m.id}`);
        const firstFinding = out.container.querySelector('.finding .t');
        if (firstFinding) { const s3 = run([{ type: 'VIEW_FINDING', id: s2.sessions[t.id].project.lastEvaluation!.findings[0]?.id ?? '' }], s2); cleanup(); await renderState(s3, `${t.id} ${m.id} open finding`); }
        cleanup();
        const s4 = run([{ type: 'UNDO' }, { type: 'EVALUATE' }], s2); await renderState(s4, `${t.id} ${m.id} resolved`); cleanup();
      }
    });
    it(`${t.id}: selection sheets and compare overlay`, async () => {
      const st = run([{ type: 'EVALUATE' }], open(t.id)); const p = st.sessions[t.id].project;
      await renderState(run([{ type: 'SELECT_INSTANCE', id: p.instances[0].id }], st), `${t.id} instance sheet`); cleanup();
      await renderState(run([{ type: 'SELECT_NET', id: p.nets[0].id }], st), `${t.id} net sheet`); cleanup();
      const pin = p.nets[0].pins[0]; await renderState(run([{ type: 'SELECT_PIN', pin }, { type: 'ARM_CONNECT', pin }], st), `${t.id} connect mode`); cleanup();
      for (const o of t.optimizations) { await renderState(run([{ type: 'COMPARE', id: o.id }], st), `${t.id} compare ${o.id}`); cleanup(); const after = evaluate(applyOps(p, o.ops), registry); await renderState(run([{ type: 'APPLY_OPTIMIZATION', id: o.id, evaluation: after }], st), `${t.id} applied ${o.id}`); cleanup(); }
    });
  }
  it('phone layout: tabs, bottom bar, sheet, and full-screen render for evaluated and stale states', async () => {
    (globalThis as unknown as { __narrow: boolean }).__narrow = true;
    try {
      let st = run([{ type: 'EVALUATE' }], open(templates[0].id));
      const out = await renderState(st, 'phone evaluated'); expect(out.container.querySelector('.tabs')).toBeTruthy(); cleanup();
      st = run([{ type: 'APPLY_MUTATION', id: 'force_stby_low' }], st);
      const out2 = await renderState(st, 'phone stale'); expect(out2.container.querySelector('.evalbar')).toBeTruthy(); cleanup();
      const p = st.sessions[templates[0].id].project;
      await renderState(run([{ type: 'SELECT_PIN', pin: p.nets[0].pins[0] }], st), 'phone pin sheet'); cleanup();
    } finally { (globalThis as unknown as { __narrow: boolean }).__narrow = false; }
  });
  it('AI review states: observations, error, and an observation for a previous state', async () => {
    const st = run([{ type: 'EVALUATE' }], open(templates[0].id)); const p = st.sessions[templates[0].id].project;
    const obs = { id: 'ai-1', ruleId: 'ai_review', origin: 'ai_review' as const, basis: 'ai_inference' as const, severity: 'warning' as const, category: 'power_path', title: 'XIAO 5V pin can backfeed USB', affected: [{ instanceId: 'mcu' }], evidence: [{ label: 'model rationale', value: 'Seeed advises a diode', provenance: 'ai' as const }], consequence: 'USB and the buck fight.', remediation: ['Add a diode'], confidence: 0.7, fixes: [] };
    let s2 = run([{ type: 'AI_RESULT', result: { observations: [obs], model: 'm', provider: 'fake', latencyMs: 12, dropped: 1 } }], st);
    const out = await renderState(s2, 'ai observations'); expect(out.getByText(/backfeed/)).toBeTruthy(); cleanup();
    await renderState(run([{ type: 'VIEW_FINDING', id: 'ai-1' }], s2), 'ai observation open'); cleanup();
    await renderState(run([{ type: 'AI_ERROR', error: 'AI review limit reached' }], st), 'ai error'); cleanup();
    s2 = run([{ type: 'APPLY_MUTATION', id: 'force_stby_low' }], s2); await renderState(s2, 'ai observation for previous state'); cleanup();
    expect(p.id).toBe(templates[0].id);
  });
  it('an imported project and a session revived from storage render', async () => {
    const { loadSessions } = await import('../storage'); const { readFileSync } = await import('node:fs');
    const mem = new Map<string, string>(); const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
    storage.setItem('circuit-factory.sessions.v1', readFileSync('src/ui/__tests__/fixtures/storage-v1-b71e7f8.json', 'utf8'));
    const loaded = loadSessions(storage);
    const st: AppState = { view: 'project', sessions: loaded.sessions, activeId: loaded.activeId, aiBusy: false };
    await renderState(run([{ type: 'EVALUATE' }], st), 'revived v1 session'); cleanup();
    const imported = run([{ type: 'IMPORT', project: { ...templates[1], id: 'my-doorbell' } }]);
    await renderState(run([{ type: 'EVALUATE' }], imported), 'imported project');
  });
  it('findings from an older build without the fixes field render after migration', async () => {
    const st = run([{ type: 'EVALUATE' }, { type: 'APPLY_MUTATION', id: 'force_stby_low' }, { type: 'EVALUATE' }], open(templates[0].id));
    const s = st.sessions[templates[0].id];
    // Simulate a previous evaluation persisted before findings carried fixes, then re-parsed by the loader.
    const stale = JSON.parse(JSON.stringify(s.project.lastEvaluation)); for (const f of stale.findings) delete f.fixes;
    const { EvaluationResult } = await import('../../model/schema');
    const revived = EvaluationResult.parse(stale);
    const st2 = { ...st, sessions: { ...st.sessions, [templates[0].id]: { ...s, previousEvaluation: revived, project: { ...s.project, lastEvaluation: evaluate(applyOps(s.base, []), registry) } } } };
    await renderState(st2, 'migrated previous evaluation');
  });
});
