import { describe, it, expect } from 'vitest';
import { reducer, type AppState, type Action } from '../store';
import { projectState, stepState, findingLifecycles } from '../../model/workflow';
import { templates, registry } from '../../data';
import { stateHash } from '../../eval/hash';
import { applyOps } from '../../eval/mutations';
import { evaluate, RULES_VERSION } from '../../eval/evaluate';

const base = (): AppState => ({ view: 'library', sessions: {}, aiBusy: false });
const run = (actions: Action[], from: AppState = base()) => actions.reduce(reducer, from);
const T = templates[0];
const sess = (s: AppState) => s.sessions[s.activeId!];
const opened = () => run([{ type: 'AUTHED' }, { type: 'OPEN_TEMPLATE', id: T.id }]);
const evaluated = () => run([{ type: 'EVALUATE' }], opened());

describe('freshness state machine', () => {
  it('Evaluate records the result for the current state hash and rules version, and the state reads current', () => {
    const s = sess(evaluated());
    expect(s.project.lastEvaluation?.stateHash).toBe(s.currentHash);
    expect(s.project.lastEvaluation?.rulesVersion).toBe(RULES_VERSION);
    expect(projectState(s)).toBe('evaluated_current');
    expect(projectState(sess(opened()))).toBe('unevaluated');
  });
  it('every semantic edit makes the evaluation stale: guided change, assumption-only edit, connect, undo, reset', () => {
    const st = evaluated(); const p = sess(st).project;
    const stale = (a: Action[]) => projectState(sess(run(a, st)));
    expect(stale([{ type: 'APPLY_MUTATION', id: 'force_stby_low' }])).toBe('evaluated_stale');
    expect(stale([{ type: 'EDIT', label: 'assumption only', ops: [{ op: 'set_assumption', key: 'avg_motor_current_a', value: 0.5 }] }])).toBe('evaluated_stale');
    expect(stale([{ type: 'SELECT_PIN', pin: { instance: 'mcu', pin: 'D7' } }, { type: 'ARM_CONNECT', pin: { instance: 'mcu', pin: 'D7' } }, { type: 'CONNECT_TO', pin: { instance: 'mcu', pin: 'D8' } }])).toBe('evaluated_stale');
    const changed = run([{ type: 'APPLY_MUTATION', id: 'force_stby_low' }, { type: 'EVALUATE' }], st);
    expect(projectState(sess(changed))).toBe('evaluated_current');
    expect(stale.call(null, [])).toBe('evaluated_current');
    expect(projectState(sess(run([{ type: 'UNDO' }], changed)))).toBe('evaluated_stale');
    expect(projectState(sess(run([{ type: 'RESET' }], changed)))).toBe('evaluated_stale');
    expect(p.id).toBe(T.id);
  });
  it('re-evaluation consumes the new state; undo and reset restore the template hash exactly', () => {
    const st = run([{ type: 'APPLY_MUTATION', id: 'force_stby_low' }, { type: 'EVALUATE' }], evaluated());
    const s = sess(st);
    expect(s.project.lastEvaluation?.stateHash).toBe(s.currentHash);
    expect(s.project.lastEvaluation?.findings.some((f) => f.ruleId === 'driver_enable_state' && f.severity === 'violation')).toBe(true);
    expect(sess(run([{ type: 'UNDO' }], st)).currentHash).toBe(stateHash(T));
    expect(sess(run([{ type: 'RESET' }], st)).currentHash).toBe(stateHash(T));
    expect(sess(run([{ type: 'RESET' }], st)).project.nets).toEqual(T.nets);
  });
  it('viewing, selecting, dismissing, comparing, and AI results never change the design or its hash', () => {
    const st = evaluated(); const before = sess(st);
    const ui: Action[] = [
      { type: 'SELECT_INSTANCE', id: 'driver' }, { type: 'SELECT_NET', id: 'STBY' }, { type: 'SELECT_PIN', pin: { instance: 'mcu', pin: 'D6' } }, { type: 'ARM_CONNECT', pin: { instance: 'mcu', pin: 'D6' } }, { type: 'ARM_CONNECT', pin: undefined },
      { type: 'VIEW_FINDING', id: before.project.lastEvaluation!.findings[0].id }, { type: 'VIEW_COVERAGE' }, { type: 'DISMISS_TIP', id: 'x' }, { type: 'COMPARE', id: 'right_size_battery' }, { type: 'COMPARE' }, { type: 'DESELECT' },
      { type: 'LEARN_OPEN' }, { type: 'LEARN_FOCUS', id: 'decision:separate_driver' }, { type: 'LEARN_FOCUS', id: 'part:driver' }, { type: 'LEARN_CLOSE' },
      { type: 'AI_RESULT', result: { observations: [], model: 'm', provider: 'fake', latencyMs: 1, dropped: 0 } },
    ];
    let cur = st;
    for (const a of ui) { cur = reducer(cur, a); const s = sess(cur); expect(s.currentHash, a.type).toBe(before.currentHash); expect(s.project.nets, a.type).toBe(before.project.nets); expect(s.project.instances, a.type).toBe(before.project.instances); expect(projectState(s), a.type).toMatch(/evaluated_current|reviewed/); }
  });
  it('stale findings are labeled as from the previous state, and resolution shows after re-evaluation', () => {
    const st = run([{ type: 'APPLY_MUTATION', id: 'force_stby_low' }, { type: 'EVALUATE' }, { type: 'UNDO' }], evaluated());
    const s = sess(st); expect(projectState(s)).toBe('evaluated_stale'); expect(stepState(s, []).current).toBe('reevaluate');
    const re = sess(run([{ type: 'EVALUATE' }], st));
    const lc = findingLifecycles(re.project.lastEvaluation, re.previousEvaluation, re.history, re.project.overrides);
    expect(lc.some((f) => f.lifecycle === 'resolved' && f.ruleId === 'driver_enable_state')).toBe(true);
    expect(re.project.lastEvaluation!.findings.some((f) => f.severity === 'violation')).toBe(false);
  });
});

describe('optimization apply path', () => {
  it('applies the real ops, stores an evaluation of the real candidate, and reads current; a forged evaluation is ignored', () => {
    const st = evaluated();
    const o = T.optimizations.find((x) => x.id === 'right_size_battery')!;
    const expected = applyOps(T, o.ops);
    const forged = { ...evaluate(T, registry), stateHash: stateHash(expected), findings: [] };
    const s = sess(run([{ type: 'APPLY_OPTIMIZATION', id: o.id, evaluation: forged }], st));
    expect(s.currentHash).toBe(stateHash(expected));
    expect(projectState(s)).toBe('evaluated_current');
    expect(s.project.instances.find((i) => i.id === 'battery')?.registryId).toBe('battery.3s_lipo_200_300mah_class');
    const real = evaluate(expected, registry);
    expect(s.project.lastEvaluation?.findings.map((f) => f.title)).toEqual(real.findings.map((f) => f.title));
    expect(s.project.lastEvaluation?.metrics.find((m) => m.key === 'runtime_min')?.value).toBe(37);
    expect(sess(run([{ type: 'UNDO' }], run([{ type: 'APPLY_OPTIMIZATION', id: o.id }], st))).currentHash).toBe(stateHash(T));
  });
  it('an evaluation from an older rule set is stale even when the design is unchanged', () => {
    const st = evaluated(); const s = sess(st);
    const old = { ...st, sessions: { ...st.sessions, [T.id]: { ...s, project: { ...s.project, lastEvaluation: { ...s.project.lastEvaluation!, rulesVersion: '2020-01-01.0' } } } } };
    expect(projectState(sess(old))).toBe('evaluated_stale');
  });
});

describe('import trust boundary', () => {
  it('an imported project with a forged clean evaluation is never presented as current', () => {
    const forged = { ...T, id: 'forged', lastEvaluation: { ...evaluate(T, registry), findings: [] } };
    const s = sess(run([{ type: 'AUTHED' }, { type: 'IMPORT', project: forged }]));
    expect(s.project.lastEvaluation).toBeUndefined(); expect(projectState(s)).toBe('unevaluated');
    const re = sess(run([{ type: 'AUTHED' }, { type: 'IMPORT', project: forged }, { type: 'EVALUATE' }]));
    expect(re.project.lastEvaluation!.findings.length).toBeGreaterThan(0);
  });
  it('AI results cannot touch the design and carry the ai_review origin', () => {
    const st = evaluated(); const before = sess(st);
    const s = sess(run([{ type: 'AI_RESULT', result: { observations: [{ ...before.project.lastEvaluation!.findings[0], id: 'ai-1', origin: 'ai_review', basis: 'ai_inference' }], model: 'm', provider: 'fake', latencyMs: 1, dropped: 0 } }], st));
    expect(s.project).toBe(before.project); expect(s.aiReview?.observations.every((o) => o.origin === 'ai_review')).toBe(true);
    expect(s.project.lastEvaluation).toBe(before.project.lastEvaluation);
  });
});

describe('stepper: a standing violation sends the loop back to Inspect', () => {
  const lc = (st: AppState) => { const s = sess(st); return findingLifecycles(s.project.lastEvaluation, s.previousEvaluation, s.history, s.project.overrides); };
  it('new violation, viewed violation, and a violation persisting across evaluations all read Inspect with the finding as target', () => {
    const v1 = run([{ type: 'APPLY_MUTATION', id: 'force_stby_low' }, { type: 'EVALUATE' }], evaluated());
    let st = stepState(sess(v1), lc(v1)); expect(st.current).toBe('inspect'); expect(st.done).not.toContain('inspect'); expect(st.target?.kind).toBe('finding');
    const id = st.target!.id; expect(sess(v1).project.lastEvaluation!.findings.find((f) => f.id === id)?.severity).toBe('violation');
    const viewed = run([{ type: 'VIEW_FINDING', id }], v1); expect(stepState(sess(viewed), lc(viewed)).current).toBe('inspect');
    // A harmless extra edit and another evaluation: the violation now persists rather than being new, and still holds the loop.
    const persisting = run([{ type: 'EDIT', label: 'assumption only', ops: [{ op: 'set_assumption', key: 'avg_motor_current_a', value: 0.3 }] }, { type: 'EVALUATE' }], viewed);
    expect(['acknowledged', 'persisting']).toContain(lc(persisting).find((f) => f.severity === 'violation')?.lifecycle);   // viewed earlier: not new any more
    st = stepState(sess(persisting), lc(persisting)); expect(st.current).toBe('inspect'); expect(st.hint).toMatch(/^A violation/);
  });
  it('a violation outranks a resolved finding; once every violation clears the loop moves on', () => {
    // Two violations: fix one, leave the other. The resolved one must not hide the standing one.
    const two = run([{ type: 'APPLY_MUTATION', id: 'force_stby_low' }, { type: 'APPLY_MUTATION', id: 'disconnect_channel_b_inputs' }, { type: 'EVALUATE' }], evaluated());
    expect(stepState(sess(two), lc(two)).hint).toMatch(/^2 violations/);
    const one = run([{ type: 'UNDO' }, { type: 'EVALUATE' }], two);   // channel B inputs back; STBY still grounded
    const l = lc(one); expect(l.some((f) => f.lifecycle === 'resolved')).toBe(true); expect(l.some((f) => f.severity === 'violation' && f.lifecycle !== 'resolved')).toBe(true);
    expect(stepState(sess(one), l).current).toBe('inspect');
    const clear = run([{ type: 'UNDO' }, { type: 'EVALUATE' }], one);
    const st = stepState(sess(clear), lc(clear)); expect(st.current).toBe('optimize'); expect(st.hint).toMatch(/cleared because the circuit changed/);
  });
});
