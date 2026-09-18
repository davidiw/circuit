// @vitest-environment jsdom
import './setup';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { templates, registry } from '../../data';
import { reducer, type AppState, type Action } from '../store';
import { ProjectView } from '../ProjectView';
import { projectState } from '../../model/workflow';
import { guideFocus, resolveToken, tokensIn } from '../Learn';

afterEach(cleanup);
const base = (): AppState => ({ view: 'library', sessions: {}, aiBusy: false });
const run = (actions: Action[], from: AppState = base()) => actions.reduce(reducer, from);
const open = (id: string) => run([{ type: 'OPEN_TEMPLATE', id }]);
const sess = (s: AppState) => s.sessions[s.activeId!];

async function renderState(state: AppState, label: string) {
  const errors: unknown[] = []; const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
  const dispatch = vi.fn();
  const out = render(<ProjectView session={sess(state)} state={state} dispatch={dispatch} />);
  await waitFor(() => expect(out.container.querySelector('.dia svg')).toBeTruthy(), { timeout: 4000 });
  spy.mockRestore(); expect(errors.map(String), label).toEqual([]);
  return { out, dispatch };
}

describe('design guide data: every reference resolves to a real artifact', () => {
  for (const t of templates) {
    it(`${t.id}: guide references, tokens, and registry guides resolve`, () => {
      const g = t.designGuide!; expect(g, `${t.id} has a designGuide`).toBeTruthy();
      const inst = new Set(t.instances.map((i) => i.id)), nets = new Set(t.nets.map((n) => n.id)), reqs = new Set(t.requirements.map((r) => r.id)), asms = new Set(t.assumptions.map((a) => a.key)), opts = new Set(t.optimizations.map((o) => o.id));
      const texts: string[] = [g.summary, g.paths.power, g.paths.control, g.paths.outcome];
      for (const s of g.flow) { texts.push(s.explanation); for (const x of s.relatedInstances) expect(inst.has(x), `flow ${s.id} instance ${x}`).toBe(true); for (const x of s.relatedNets) expect(nets.has(x), `flow ${s.id} net ${x}`).toBe(true); }
      for (const p of g.parts) { texts.push(p.why); expect(inst.has(p.instance), `part ${p.instance}`).toBe(true); }
      expect(new Set(g.parts.map((p) => p.instance)), `${t.id}: every part of the design is explained`).toEqual(inst);
      for (const d of g.decisions) {
        texts.push(d.explanation);
        for (const x of d.relatedInstances) expect(inst.has(x), `decision ${d.id} instance ${x}`).toBe(true);
        for (const x of d.relatedNets) expect(nets.has(x), `decision ${d.id} net ${x}`).toBe(true);
        if (d.relatedRequirement) expect(reqs.has(d.relatedRequirement), `decision ${d.id} requirement`).toBe(true);
        if (d.relatedAssumption) expect(asms.has(d.relatedAssumption), `decision ${d.id} assumption`).toBe(true);
        if (d.relatedOptimization) expect(opts.has(d.relatedOptimization), `decision ${d.id} optimization`).toBe(true);
      }
      expect(g.decisions.length).toBeGreaterThanOrEqual(3); expect(g.flow.length).toBeGreaterThanOrEqual(3);
      // Every {{token}} resolves to a fact or assumption with provenance, and none of it is jargon.
      for (const text of texts) {
        for (const tok of tokensIn(text)) expect(resolveToken(t, registry, tok.scope, tok.key), `${t.id} token {{${tok.scope}.${tok.key}}}`).toBeTruthy();
        expect(text, `${t.id} leaks internal vocabulary: ${text.slice(0, 60)}`).not.toMatch(/\bregistry\b|\bfixture\b|\bmutation\b|\bcanonical\b|_[a-z]+_[a-z]+\b(?![^{]*\}\})/);
      }
      // Every part in every template has reusable component guidance in the registry.
      for (const i of t.instances) { const c = registry.components.find((x) => x.id === i.registryId)!; expect(c.guide?.role && c.guide.summary.length > 20, `${i.registryId} registry guide`).toBeTruthy(); }
    });
  }
  it('every registry component carries a guide, and unresolvable tokens read as unknown', () => {
    for (const c of registry.components) expect(c.guide, c.id).toBeTruthy();
    expect(resolveToken(templates[0], registry, 'mcu', 'no_such_fact')).toBeUndefined();
    expect(resolveToken(templates[0], registry, 'nobody', 'x')).toBeUndefined();
    expect(resolveToken(templates[0], registry, 'buck', 'dropout_v')).toEqual({ value: '1.5', provenance: 'fixture_assumption' });
    expect(resolveToken(templates[0], registry, 'buck', 'outputV')?.value).toBe('5');   // instance prop wins over a registry fact
    expect(resolveToken(templates[0], registry, 'assumption', 'motor_rail_v')).toEqual({ value: '5', provenance: 'fixture_assumption' });
  });
  it('guideFocus maps focus ids to real artifacts and ignores unknown ones', () => {
    const t = templates[0];
    expect(guideFocus(t, 'part:driver')).toEqual({ instances: new Set(['driver']), nets: new Set(t.nets.filter((n) => n.pins.some((p) => p.instance === 'driver')).map((n) => n.id)) });
    const f = guideFocus(t, 'flow:regulation')!; expect([...f.instances]).toEqual(['buck', 'bulk_cap']); expect(f.nets.has('RAIL_5V')).toBe(true);
    expect(guideFocus(t, 'decision:battery_size')!.instances.has('battery')).toBe(true);
    for (const bad of ['part:nobody', 'flow:nope', 'decision:nope', 'junk', undefined]) expect(guideFocus(t, bad)).toBeUndefined();
  });
});

describe('Learn view is read-only with respect to engineering state', () => {
  it('opening, focusing, and closing never change the project, the hash, or the evaluation state', () => {
    for (const t of templates) {
      for (const start of [open(t.id), run([{ type: 'EVALUATE' }], open(t.id)), run([{ type: 'EVALUATE' }, { type: 'APPLY_MUTATION', id: t.mutations[0].id }], open(t.id))]) {
        const before = sess(start); const state0 = projectState(before);
        const ids = ['flow:' + t.designGuide!.flow[0].id, 'part:' + t.instances[0].id, 'decision:' + t.designGuide!.decisions[0].id, 'junk:none'];
        let st = run([{ type: 'LEARN_OPEN' }], start);
        expect(sess(st).learn).toEqual({ focus: `decision:${t.designGuide!.decisions[0].id}` });   // opens on the key decision so something is highlighted
        for (const id of ids) { st = run([{ type: 'LEARN_FOCUS', id }], st); expect(sess(st).learn?.focus).toBe(id); }
        st = run([{ type: 'LEARN_FOCUS', id: 'junk:none' }], st); expect(sess(st).learn?.focus).toBeUndefined();   // toggling off
        const during = sess(st);
        expect(during.project).toEqual(before.project); expect(during.currentHash).toBe(before.currentHash); expect(during.edits).toEqual(before.edits);
        expect(projectState(during)).toBe(state0); expect(during.project.lastEvaluation).toEqual(before.project.lastEvaluation);
        st = run([{ type: 'LEARN_CLOSE' }], st); expect(sess(st).learn).toBeUndefined();
        expect(sess(st).project).toEqual(before.project); expect(sess(st).currentHash).toBe(before.currentHash);
        // Selecting anything in the diagram replaces the guide, and the guide replaces any selection.
        expect(sess(run([{ type: 'LEARN_OPEN' }, { type: 'SELECT_INSTANCE', id: t.instances[0].id }], start)).learn).toBeUndefined();
        expect(sess(run([{ type: 'SELECT_INSTANCE', id: t.instances[0].id }, { type: 'LEARN_OPEN' }], start)).selectedInstance).toBeUndefined();
        expect(sess(run([{ type: 'LEARN_OPEN' }, { type: 'DESELECT' }], start)).learn).toBeUndefined();
      }
    }
  });
  it('focusing without the guide open is a no-op', () => {
    const st = open(templates[0].id); expect(sess(run([{ type: 'LEARN_FOCUS', id: 'part:mcu' }], st))).toEqual(sess(st));
  });
});

describe('Learn view renders and drives the diagram highlight', () => {
  for (const t of templates) {
    it(`${t.id}: card, sheet, sections, and phone layout render; steps, parts, and decisions highlight real artifacts`, async () => {
      const st = run([{ type: 'EVALUATE' }], open(t.id));
      const { out, dispatch } = await renderState(st, `${t.id} card`);
      expect(out.container.querySelector('#panel-learn-card')?.textContent).toContain(t.designGuide!.summary.slice(0, 40));
      fireEvent.click(out.container.querySelector('#btn-learn')!); expect(dispatch).toHaveBeenCalledWith({ type: 'LEARN_OPEN' }); cleanup();
      // Opening lands on the first decision, expanded and highlighted, so the diagram link is visible at once.
      const landed = run([{ type: 'LEARN_OPEN' }], st); const { out: ol } = await renderState(landed, `${t.id} landed`);
      expect(ol.container.querySelector('#panel-learn .decisions li.on .q')?.textContent).toBe(t.designGuide!.decisions[0].title);
      expect(ol.container.querySelectorAll('.node.focus').length).toBe(t.designGuide!.decisions[0].relatedInstances.length);
      expect(ol.container.querySelector('#btn-learn'), 'card button hidden while open').toBeNull(); cleanup();
      const opened = run([{ type: 'LEARN_OPEN' }, { type: 'LEARN_FOCUS', id: `decision:${t.designGuide!.decisions[0].id}` }], st);   // toggled off: nothing focused
      const { out: o2, dispatch: d2 } = await renderState(opened, `${t.id} learn open`);
      const sheet = o2.container.querySelector('#panel-learn')!; expect(sheet).toBeTruthy();
      expect(sheet.textContent).toMatch(/How the system works/); expect(sheet.textContent).toMatch(/What each part does/); expect(sheet.textContent).toMatch(/Why it is built this way/);
      expect(sheet.querySelectorAll('.chain button').length).toBe(t.designGuide!.flow.length);
      expect(sheet.querySelectorAll('.parts li').length).toBe(t.designGuide!.parts.length);
      expect(sheet.querySelectorAll('.decisions li').length).toBe(t.designGuide!.decisions.length);
      expect(sheet.textContent).not.toMatch(/\{\{/);   // every token rendered
      // Clicking a step, a part, and a decision dispatches a focus for that artifact.
      fireEvent.click(sheet.querySelectorAll('.chain button')[0]); expect(d2).toHaveBeenCalledWith({ type: 'LEARN_FOCUS', id: `flow:${t.designGuide!.flow[0].id}` });
      fireEvent.click(sheet.querySelector('.parts li .head')!); expect(d2).toHaveBeenCalledWith({ type: 'LEARN_FOCUS', id: `part:${t.designGuide!.parts[0].instance}` });
      fireEvent.click(sheet.querySelector('.decisions li .q')!); expect(d2).toHaveBeenCalledWith({ type: 'LEARN_FOCUS', id: `decision:${t.designGuide!.decisions[0].id}` });
      fireEvent.click(sheet.querySelector('[aria-label="Close"]')!); expect(d2).toHaveBeenCalledWith({ type: 'LEARN_CLOSE' }); cleanup();
      // With a step focused, exactly its related parts carry the focus class in the diagram, and the explanation shows with provenance tags for tokens.
      const step = t.designGuide!.flow.find((s) => s.relatedInstances.length > 0)!;
      const focused = run([{ type: 'LEARN_FOCUS', id: `flow:${step.id}` }], opened);
      const { out: o3 } = await renderState(focused, `${t.id} step focused`);
      expect([...o3.container.querySelectorAll('.node.focus')].map((n) => n.querySelector('.title')?.textContent).sort()).toEqual(step.relatedInstances.map((i) => t.instances.find((x) => x.id === i)!.label).sort());
      expect(o3.container.querySelector('#learn-step')?.textContent?.length).toBeGreaterThan(40);
      if (tokensIn(step.explanation).length) expect(o3.container.querySelectorAll('#learn-step .tag.prov').length).toBe(tokensIn(step.explanation).length);
      cleanup();
      // A focused part offers a way into the real part sheet.
      const partFocused = run([{ type: 'LEARN_FOCUS', id: `part:${t.instances[0].id}` }], opened);
      const { out: o4, dispatch: d4 } = await renderState(partFocused, `${t.id} part focused`);
      expect(o4.container.querySelectorAll('.node.focus').length).toBe(1);
      fireEvent.click([...o4.container.querySelectorAll('#panel-learn .btn')].find((b) => /Open part details/.test(b.textContent ?? ''))!);
      expect(d4).toHaveBeenCalledWith({ type: 'SELECT_INSTANCE', id: t.instances[0].id }); cleanup();
      // A decision with an optimization offers its preview through the normal compare path.
      const withOpt = t.designGuide!.decisions.find((d) => d.relatedOptimization);
      if (withOpt) {
        const { out: o5, dispatch: d5 } = await renderState(run([{ type: 'LEARN_FOCUS', id: `decision:${withOpt.id}` }], opened), `${t.id} decision`);
        fireEvent.click([...o5.container.querySelectorAll('#panel-learn .btn')].find((b) => /^Preview:/.test(b.textContent ?? ''))!);
        expect(d5).toHaveBeenCalledWith({ type: 'COMPARE', id: withOpt.relatedOptimization }); cleanup();
      }
      // Phone: the compact line is present, the sheet renders as the bottom sheet, and nothing errors.
      (globalThis as unknown as { __narrow: boolean }).__narrow = true;
      try {
        const { out: p1 } = await renderState(st, `${t.id} phone line`); expect(p1.container.querySelector('#btn-learn-m')).toBeTruthy(); cleanup();
        const { out: p2 } = await renderState(focused, `${t.id} phone learn`); expect(p2.container.querySelector('.sheet-host #panel-learn')).toBeTruthy(); expect(p2.container.querySelector('#btn-learn-m')).toBeNull();
      } finally { (globalThis as unknown as { __narrow: boolean }).__narrow = false; }
    });
  }
  it('stale evaluation stays stale while browsing the guide, and current stays current', async () => {
    const t = templates[0];
    const stale = run([{ type: 'EVALUATE' }, { type: 'APPLY_MUTATION', id: 'force_stby_low' }, { type: 'LEARN_OPEN' }, { type: 'LEARN_FOCUS', id: 'decision:separate_driver' }], open(t.id));
    const { out } = await renderState(stale, 'stale with guide'); expect(out.container.querySelector('.chip.stale')).toBeTruthy(); expect(out.container.querySelector('#panel-learn')).toBeTruthy(); cleanup();
    const cur = run([{ type: 'EVALUATE' }, { type: 'LEARN_OPEN' }, { type: 'LEARN_FOCUS', id: 'part:driver' }], open(t.id));
    const { out: o2 } = await renderState(cur, 'current with guide'); expect(o2.container.querySelector('.chip.cur')).toBeTruthy();
  });
});
