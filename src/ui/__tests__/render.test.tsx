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
import { ADVERSARIAL_TOPOLOGIES } from '../../eval/__tests__/adversarial';

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
  // Wait for the layout to settle (a drawn diagram or the explicit fallback), so layout-time errors are caught by the spy too.
  await waitFor(() => expect(out.container.querySelector('.dia svg') || /Layout unavailable/.test(out.container.querySelector('.dia')?.textContent ?? '')).toBeTruthy(), { timeout: 4000 });
  spy.mockRestore();
  expect(errors.map(String), label).toEqual([]);
  return out;
}

/** Every attribute on every SVG element is a real number or text: no NaN, Infinity, or undefined ever reaches the DOM. */
function assertSvgGeometry(container: HTMLElement, label: string) {
  const svgs = container.querySelectorAll('svg'); expect(svgs.length, `${label} has a diagram`).toBeGreaterThan(0);
  const bad: string[] = [];
  for (const svg of svgs) {
    const vb = svg.getAttribute('viewBox') ?? ''; const dims = vb.split(/\s+/).map(Number);
    if (dims.length !== 4 || dims.some((d) => !Number.isFinite(d)) || dims[2] <= 0 || dims[3] <= 0) bad.push(`viewBox "${vb}"`);
    for (const el of svg.querySelectorAll('*')) for (const a of el.attributes) if (/NaN|Infinity|undefined|null/.test(a.value)) bad.push(`<${el.tagName} ${a.name}="${a.value}">`);
  }
  expect(bad, `${label} invalid SVG geometry`).toEqual([]);
}
/** The page is not a white screen: the app bar, the diagram, and the findings panel are all mounted. */
function assertPageMounted(container: HTMLElement, label: string) {
  for (const sel of ['.appbar', '.dia svg', '#panel-findings, .tabs']) expect(container.querySelector(sel), `${label} missing ${sel}`).toBeTruthy();
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
      // A change without re-evaluation: the findings header says the result is from the previous state and every fix button is disabled.
      const keepsPower = t.mutations.find((m) => !m.ops.some((o) => o.op === 'clear_power_source'));
      if (keepsPower) {
        const staleState = run([{ type: 'APPLY_MUTATION', id: keepsPower.id }], st);
        const sout = await renderState(staleState, `${t.id} stale`);
        expect(sout.container.querySelector('#panel-findings h4')?.textContent).toMatch(/from the previous state/);
        expect([...sout.container.querySelectorAll('.chip')].map((c) => c.className + ':' + c.textContent).join(' | '), `${t.id} stale chip`).toMatch(/chip stale/); cleanup();
      }
      for (const m of t.mutations) {
        const s2 = run([{ type: 'APPLY_MUTATION', id: m.id }, { type: 'EVALUATE' }], st);
        const out = await renderState(s2, `${t.id} ${m.id}`);
        for (const e of m.expected) if (e.severity === 'violation' || e.severity === 'warning') expect(out.container.querySelectorAll(`.finding.${e.severity === 'violation' ? 'bad' : 'warn'}`).length, `${m.id} shows its ${e.severity}`).toBeGreaterThan(0);
        const firstFinding = out.container.querySelector('.finding .t');
        if (firstFinding) { const s3 = run([{ type: 'VIEW_FINDING', id: s2.sessions[t.id].project.lastEvaluation!.findings[0]?.id ?? '' }], s2); cleanup(); await renderState(s3, `${t.id} ${m.id} open finding`); }
        cleanup();
        const s4 = run([{ type: 'UNDO' }, { type: 'EVALUATE' }], s2); const rout = await renderState(s4, `${t.id} ${m.id} resolved`);
        if (m.expected.some((e) => e.severity === 'violation' || e.severity === 'warning')) { expect(rout.container.querySelector('.finding.res'), `${m.id} shows a resolved row`).toBeTruthy(); expect(rout.container.querySelector('.finding.bad:not(.res)'), `${m.id} no violation after undo`).toBeNull(); }
        cleanup();
      }
    });
    it(`${t.id}: selection sheets and compare overlay`, async () => {
      const st = run([{ type: 'EVALUATE' }], open(t.id)); const p = st.sessions[t.id].project;
      await renderState(run([{ type: 'SELECT_INSTANCE', id: p.instances[0].id }], st), `${t.id} instance sheet`); cleanup();
      await renderState(run([{ type: 'SELECT_NET', id: p.nets[0].id }], st), `${t.id} net sheet`); cleanup();
      const pin = p.nets[0].pins[0]; await renderState(run([{ type: 'SELECT_PIN', pin }, { type: 'ARM_CONNECT', pin }], st), `${t.id} connect mode`); cleanup();
      for (const o of t.optimizations) {
        const cout = await renderState(run([{ type: 'COMPARE', id: o.id }], st), `${t.id} compare ${o.id}`);
        const after = evaluate(applyOps(p, o.ops), registry); const before = evaluate(p, registry);
        // Compare rows are derived: every metric whose value changed appears with both numbers.
        for (const m of after.metrics) { const b = before.metrics.find((x) => x.key === m.key); if (b && b.value !== m.value) { const text = cout.container.querySelector('.compare')?.textContent ?? ''; expect(text, `${o.id} shows ${m.label}`).toContain(m.label); expect(text).toContain(String(Number.isInteger(m.value) ? m.value : m.value.toFixed(2))); } }
        cleanup();
        const aout = await renderState(run([{ type: 'APPLY_OPTIMIZATION', id: o.id }], st), `${t.id} applied ${o.id}`);
        expect(aout.container.querySelector('.chip.cur'), `${o.id} applied reads current`).toBeTruthy(); cleanup();
      }
    });
  }
  for (const topo of ADVERSARIAL_TOPOLOGIES) {
    it(`adversarial topology renders: ${topo.template} · ${topo.label}`, async () => {
      // Reached exactly as a user reaches it: select a pin, arm connect, pick the target; each merge goes through the reducer.
      let st = run([{ type: 'EVALUATE' }], open(topo.template));
      for (const [a, b] of topo.pairs) st = run([{ type: 'SELECT_PIN', pin: a }, { type: 'ARM_CONNECT', pin: a }, { type: 'CONNECT_TO', pin: b }], st);
      expect(st.sessions[topo.template].edits.length, `${topo.label} every connect became an edit`).toBe(topo.pairs.length);
      const stale = await renderState(st, `${topo.label} stale`); assertPageMounted(stale.container, topo.label); assertSvgGeometry(stale.container, `${topo.label} stale`);
      expect(stale.container.querySelector('.chip.stale'), `${topo.label} reads stale after the edit`).toBeTruthy(); cleanup();
      const st2 = run([{ type: 'EVALUATE' }], st);
      const out = await renderState(st2, `${topo.label} evaluated`); assertPageMounted(out.container, topo.label); assertSvgGeometry(out.container, `${topo.label} evaluated`);
      expect(out.container.querySelector('.chip.cur'), `${topo.label} reads current after re-evaluation`).toBeTruthy();
      // The last connected pin stays selected, so its sheet is open on top of the ugly diagram.
      expect(out.container.querySelector('.sheet'), `${topo.label} pin sheet open`).toBeTruthy(); cleanup();
      const firstId = st2.sessions[topo.template].project.lastEvaluation!.findings[0]?.id;
      if (firstId) { const fo = await renderState(run([{ type: 'VIEW_FINDING', id: firstId }], st2), `${topo.label} finding open`); assertSvgGeometry(fo.container, `${topo.label} finding open`); cleanup(); }
      (globalThis as unknown as { __narrow: boolean }).__narrow = true;
      try { const ph = await renderState(st2, `${topo.label} phone`); assertPageMounted(ph.container, `${topo.label} phone`); assertSvgGeometry(ph.container, `${topo.label} phone`); }
      finally { (globalThis as unknown as { __narrow: boolean }).__narrow = false; }
    });
  }
  it('AI review surface: absent when the server reports no provider, present with Run when configured', async () => {
    const st = run([{ type: 'EVALUATE' }], open(templates[0].id));
    for (const aiStatus of [undefined, { configured: false }]) {
      const out = await renderState({ ...st, aiStatus }, `ai ${JSON.stringify(aiStatus)}`);
      expect(out.container.querySelector('.ai-line, #btn-ai'), 'no AI panel or button when unconfigured').toBeNull();
      expect(out.container.textContent, 'no wording that implies a missing provider').not.toMatch(/not configured|AI review/i); cleanup();
    }
    const out = await renderState({ ...st, aiStatus: { configured: true, provider: 'anthropic', model: 'claude-sonnet-5' } }, 'ai configured');
    const btn = out.container.querySelector<HTMLButtonElement>('#btn-ai'); expect(btn, 'Run button when configured').toBeTruthy(); expect(btn!.disabled).toBe(false);
    expect(out.container.querySelector('.ai-line')?.textContent).toContain('claude-sonnet-5'); cleanup();
    // Unevaluated design: the button exists but waits for an evaluation.
    const un = await renderState({ ...open(templates[0].id), aiStatus: { configured: true } }, 'ai configured unevaluated');
    expect(un.container.querySelector<HTMLButtonElement>('#btn-ai')!.disabled).toBe(true);
  });
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
