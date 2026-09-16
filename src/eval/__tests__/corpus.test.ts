import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { evaluate } from '../evaluate';
import { applyOps } from '../mutations';
import { EXPECTED_FACTS } from '../../model/vocab';
import type { Finding } from '../../model/schema';

const sev = (f: Finding[]) => f.filter((x) => x.severity === 'violation' || x.severity === 'warning');
const matches = (f: Finding, e: { ruleId: string; severity: string; category: string; affectedInstance?: string }) =>
  f.ruleId === e.ruleId && f.severity === e.severity && f.category === e.category && (!e.affectedInstance || f.affected.some((a) => a.instanceId === e.affectedInstance));

describe('registry integrity', () => {
  for (const c of registry.components) {
    it(`${c.id} has sources for vetted facts and expected facts for its kind`, () => {
      for (const [k, f] of Object.entries(c.facts)) if (f.provenance === 'vetted_source') expect(f.source ?? c.sources[0], `${c.id}.${k} needs a source`).toBeTruthy();
      for (const k of EXPECTED_FACTS[c.kind] ?? []) expect(c.facts[k], `${c.id} missing fact ${k}`).toBeTruthy();
      for (const p of c.pins) if (p.role === 'supply_in') expect(p.supply_range, `${c.id}.${p.name} needs a supply_range`).toBeTruthy();
    });
  }
});

describe('template integrity', () => {
  for (const t of templates) {
    it(`${t.id} references resolve and a pin sits on one net`, () => {
      const seen = new Set<string>();
      for (const i of t.instances) expect(registry.components.find((c) => c.id === i.registryId), `${i.id} -> ${i.registryId}`).toBeTruthy();
      for (const n of t.nets) for (const p of n.pins) {
        const inst = t.instances.find((i) => i.id === p.instance); expect(inst, `${n.id} pin ${p.instance}`).toBeTruthy();
        const comp = registry.components.find((c) => c.id === inst!.registryId)!;
        expect(comp.pins.find((x) => x.name === p.pin), `${p.instance}.${p.pin} not a pin of ${comp.id}`).toBeTruthy();
        const key = `${p.instance}.${p.pin}`; expect(seen.has(key), `${key} on two nets`).toBe(false); seen.add(key);
      }
    });
    it(`${t.id} baseline evaluates to the expected findings`, () => {
      const r = evaluate(t, registry);
      expect(r.status).toBe('complete');
      const actual = sev(r.findings);
      for (const e of t.expectedBaseline) expect(actual.some((f) => matches(f, e)), `expected ${e.ruleId}`).toBe(true);
      const unexpected = actual.filter((f) => !t.expectedBaseline.some((e) => matches(f, e)));
      expect(unexpected.map((f) => `${f.ruleId}: ${f.title}`)).toEqual([]);
      expect(r.coverage.length).toBeGreaterThan(5);
    });
  }
});

describe('mutation corpus', () => {
  for (const t of templates) for (const m of t.mutations) {
    it(`${t.id} / ${m.id}`, () => {
      const mutated = applyOps(t, m.ops);
      expect(mutated).not.toBe(t);
      const before = evaluate(t, registry); const after = evaluate(mutated, registry);
      expect(after.stateHash).not.toBe(before.stateHash);
      for (const e of m.expected) expect(after.findings.some((f) => matches(f, e)), `expected ${JSON.stringify(e)} in ${after.findings.map((f) => `${f.ruleId}/${f.severity}/${f.category}/${f.affected.map((a) => a.instanceId).join('+')}`).join(' | ')}`).toBe(true);
      for (const ruleId of m.expectAbsent) expect(after.findings.some((f) => f.ruleId === ruleId), `${ruleId} should be absent`).toBe(false);
      if (m.expectStatus) expect(after.status).toBe(m.expectStatus);
      // Restoring the template clears the mutation's findings.
      const restored = evaluate(t, registry);
      for (const e of m.expected) if (!t.expectedBaseline.some((b) => b.ruleId === e.ruleId)) expect(restored.findings.some((f) => matches(f, e))).toBe(false);
    });
  }
});

describe('voltage propagation', () => {
  it('diode drop reaches the buck input and the buck prop reaches the 5 V rail', async () => {
    const { Ctx } = await import('../context');
    const ctx = new Ctx(templates[0], registry);
    expect(ctx.netVoltages.get('BATT_PLUS')?.nominal).toBeCloseTo(11.1);
    expect(ctx.netVoltages.get('VIN_PROT')?.nominal).toBeCloseTo(10.65);
    expect(ctx.netVoltages.get('VIN_PROT')?.min).toBeCloseTo(9.15);
    expect(ctx.netVoltages.get('RAIL_5V')?.nominal).toBe(5);
    expect(ctx.netVoltages.get('RAIL_3V3')?.nominal).toBe(3.3);
  });
});

describe('optimization corpus', () => {
  for (const t of templates) for (const o of t.optimizations) {
    it(`${t.id} / ${o.id}`, () => {
      const before = evaluate(t, registry); const candidate = applyOps(t, o.ops); const after = evaluate(candidate, registry);
      expect(after.status).toBe('complete');
      for (const e of o.expected) expect(after.findings.some((f) => matches(f, e)), `expected ${JSON.stringify(e)} in ${after.findings.map((f) => `${f.ruleId}/${f.severity}`).join(' | ')}`).toBe(true);
      for (const ruleId of o.expectAbsent) expect(after.findings.some((f) => f.ruleId === ruleId), `${ruleId} should be absent after ${o.id}`).toBe(false);
      if (o.expectNoNewViolations) {
        const beforeV = new Set(before.findings.filter((f) => f.severity === 'violation').map((f) => f.ruleId));
        expect(after.findings.filter((f) => f.severity === 'violation' && !beforeV.has(f.ruleId)).map((f) => f.title)).toEqual([]);
      }
      expect(after.metrics.length).toBeGreaterThan(0);
    });
  }
  it('race car baseline reports runtime above target and motors below rating as opportunities, not faults', () => {
    const r = evaluate(templates[0], registry);
    expect(r.findings.filter((f) => f.severity === 'optimization').map((f) => f.ruleId).sort()).toEqual(['motor_operating_point', 'runtime_estimate']);
    expect(r.findings.some((f) => f.severity === 'violation' || f.severity === 'warning')).toBe(false);
  });
});

describe('connectPins', () => {
  it('creates, joins, and merges nets structurally', async () => {
    const { connectPins } = await import('../mutations');
    const t = templates[0];
    const fresh = connectPins(t, registry, { instance: 'mcu', pin: 'D7' }, { instance: 'mcu', pin: 'D8' });
    expect(fresh.map((o) => o.op)).toEqual(['move_pin', 'move_pin']);
    const p1 = applyOps(t, fresh); expect(p1.nets.find((n) => n.id === 'W1')?.pins.length).toBe(2);
    const join = connectPins(t, registry, { instance: 'mcu', pin: 'D7' }, { instance: 'driver', pin: 'STBY' });
    expect(join).toEqual([{ op: 'move_pin', instance: 'mcu', pin: 'D7', net: 'STBY' }]);
    const merge = connectPins(t, registry, { instance: 'mcu', pin: 'D0' }, { instance: 'driver', pin: 'AIN1' });
    const p2 = applyOps(t, merge); expect(p2.nets.find((n) => n.id === 'CTRL_PWMA')?.pins.length).toBe(4); expect(p2.nets.find((n) => n.id === 'CTRL_AIN1')).toBeUndefined();
    expect(connectPins(t, registry, { instance: 'mcu', pin: 'D0' }, { instance: 'driver', pin: 'PWMA' })).toEqual([]);
    // Electrically poor but structurally fine: GPIO to motor terminal is allowed; the evaluator explains it.
    const bad = applyOps(t, connectPins(t, registry, { instance: 'mcu', pin: 'D9' }, { instance: 'motor_left', pin: 'M+' }));
    expect(evaluate(bad, registry).findings.some((f) => f.ruleId === 'motor_load_path')).toBe(true);
  });
});

describe('structured fixes', () => {
  it('every fix offered on a race car mutation resolves that finding when applied', () => {
    const t = templates[0];
    for (const m of t.mutations) {
      const mutated = applyOps(t, m.ops); const r = evaluate(mutated, registry);
      for (const f of r.findings) for (const fix of f.fixes.filter((x) => x.kind === 'edit')) {
        const fixed = evaluate(applyOps(mutated, fix.ops), registry);
        const still = fixed.findings.some((g) => g.ruleId === f.ruleId && g.severity === f.severity && g.affected.some((a) => f.affected.some((b) => b.instanceId && a.instanceId === b.instanceId && (a.pin ?? '') === (b.pin ?? ''))));
        expect(still, `${m.id}: fix "${fix.label}" did not clear ${f.ruleId} (${f.title})`).toBe(false);
      }
    }
  });
});
