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
