import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { evaluate } from '../evaluate';
import { applyOps, applyMutation, connectPins } from '../mutations';
import { EXPECTED_FACTS } from '../../model/vocab';
import { MutationOp, type Finding } from '../../model/schema';

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
    // Merging a signal net into ground keeps the ground net's identity regardless of which pin was picked first.
    const toGnd = applyOps(t, connectPins(t, registry, { instance: 'mcu', pin: 'D6' }, { instance: 'driver', pin: 'GND' }));
    expect(toGnd.nets.find((n) => n.id === 'GND')?.pins.some((p) => p.pin === 'STBY')).toBe(true); expect(toGnd.nets.find((n) => n.id === 'STBY')).toBeUndefined();
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

describe('coverage policy: checked means every input was a published fact or a user setting', () => {
  it('race car baseline rows land where the policy says', () => {
    const cov = Object.fromEntries(evaluate(templates[0], registry).coverage.map((c) => [c.dimension, c.status]));
    expect(cov.rail_voltages).toBe('partial'); expect(cov.reverse_polarity).toBe('partial'); expect(cov.regulator_current_thermal).toBe('partial'); expect(cov.decoupling).toBe('partial');
    expect(cov.driver_control_state).toBe('checked'); expect(cov.motor_wiring).toBe('checked'); expect(cov.pin_type_conflicts).toBe('checked'); expect(cov.signal_reference).toBe('checked');
    expect(cov.regulator_headroom).toBe('estimated'); expect(cov.bulk_capacitance).toBe('heuristic'); expect(cov.thermal).toBe('not_evaluated');
  });
  it('a rule that reads an assumed fact or a template assumption cannot report checked', async () => {
    const { Ctx } = await import('../context');
    const stub = { id: 'stub', origin: 'deterministic' as const, dimensions: ['stub'], analyze: (ctx: InstanceType<typeof Ctx>) => { ctx.fact('buck', 'dropout_v'); return { findings: [], coverage: [{ dimension: 'thermal', group: 'electrical' as const, status: 'checked' as const, note: 'read an assumption' }] }; } };
    expect(evaluate(templates[0], registry, [stub]).coverage[0].status).toBe('partial');
    const stub2 = { ...stub, analyze: (ctx: InstanceType<typeof Ctx>) => { ctx.assumptionNum('motor_rail_v'); return { findings: [], coverage: [{ dimension: 'thermal', group: 'electrical' as const, status: 'checked' as const, note: 'read a template assumption' }] }; } };
    expect(evaluate(templates[0], registry, [stub2]).coverage[0].status).toBe('partial');
    const stub3 = { ...stub, analyze: (ctx: InstanceType<typeof Ctx>) => { ctx.fact('driver', 'continuous_current_per_channel_a'); return { findings: [], coverage: [{ dimension: 'thermal', group: 'electrical' as const, status: 'checked' as const, note: 'read a vetted fact' }] }; } };
    expect(evaluate(templates[0], registry, [stub3]).coverage[0].status).toBe('checked');
  });
});

describe('numeric invariants (hand-derived, not recomputed from the code)', () => {
  // Runtime: 1000 mAh x 11.1 V x 0.85 = 9.435 Wh; load = 2 motors x 0.25 A x 5 V + 0.12 A x 5 V = 3.1 W; 9.435 / 3.1 = 3.04 h = 183 min. Right-sized: 200 mAh -> 1.887 Wh / 3.1 W = 0.609 h = 37 min.
  // Headroom: 3S cutoff 9.6 V - 0.45 V diode = 9.15 V input, minus 5.0 V output = 4.15 V. 2S: 6.4 - 0.45 - 5.0 = 0.95 V.
  const metric = (r: ReturnType<typeof evaluate>, key: string) => r.metrics.find((m) => m.key === key)?.value;
  it('runtime, load, and headroom match hand calculations', () => {
    const t = templates[0]; const r = evaluate(t, registry);
    expect(metric(r, 'runtime_min')).toBe(183); expect(metric(r, 'avg_load_w')).toBe(3.1); expect(metric(r, 'headroom_v:buck')).toBe(4.15);
    expect(metric(evaluate(applyOps(t, t.optimizations.find((o) => o.id === 'right_size_battery')!.ops), registry), 'runtime_min')).toBe(37);
    expect(metric(evaluate(applyOps(t, t.mutations.find((m) => m.id === 'swap_battery_2s')!.ops), registry), 'headroom_v:buck')).toBe(0.95);
  });
  it('supply-range boundaries come from the registry limits: 13.5 V passes the driver, 13.51 fails, 5.46 is the edge of the assumed XIAO limit, 4.5 passes', () => {
    const t = templates[0];
    const at = (v: number) => evaluate(applyOps(t, [{ op: 'set_prop', instance: 'buck', prop: 'outputV', value: v, provenance: 'user' }]), registry).findings.filter((f) => f.ruleId === 'supply_in_range');
    const driver = (fs: ReturnType<typeof at>) => fs.filter((f) => f.affected.some((a) => a.instanceId === 'driver' && a.pin === 'VMOT'));
    const mcu = (fs: ReturnType<typeof at>) => fs.filter((f) => f.affected.some((a) => a.instanceId === 'mcu'));
    expect(driver(at(13.5)).filter((f) => f.severity === 'violation')).toEqual([]);
    expect(driver(at(13.51)).map((f) => f.severity)).toEqual(['violation']);
    expect(mcu(at(5.46)).map((f) => f.severity)).toEqual(['warning']);
    expect(mcu(at(4.5)).filter((f) => f.severity === 'violation' || f.severity === 'warning')).toEqual([]);
    expect(mcu(at(4.49)).map((f) => f.severity)).toEqual(['violation']);
  });
});

describe('provenance follows the value', () => {
  it('a user-set rail makes rail-derived metrics and evidence read as user, and set_prop defaults to user', () => {
    const t = templates[0]; const o = t.optimizations.find((x) => x.id === 'motors_at_rated_voltage')!;
    const after = evaluate(applyOps(t, o.ops), registry);
    expect(after.metrics.find((m) => m.key === 'motor_rail_v')?.provenance).toBe('user');
    expect(after.metrics.find((m) => m.key === 'motor_rail_v')?.value).toBe(6);
    const p = applyOps(t, [MutationOp.parse({ op: 'set_prop', instance: 'buck', prop: 'outputV', value: 5.5 })]);
    expect(p.instances.find((i) => i.id === 'buck')?.props.outputV.provenance).toBe('user');
    // A template assumption stays an assumption after a swap that does not touch it.
    expect(evaluate(applyOps(t, t.mutations.find((m) => m.id === 'swap_battery_2s')!.ops), registry).metrics.find((m) => m.key === 'runtime_min')?.provenance).toBe('fixture_assumption');
  });
  it('unknown stays unknown: a non-numeric regulator setting yields unknown findings, never a pass', () => {
    const bad = applyOps(templates[0], [{ op: 'set_prop', instance: 'buck', prop: 'outputV', value: 'five', provenance: 'user' }]);
    const fs = evaluate(bad, registry).findings.filter((f) => f.ruleId === 'supply_in_range');
    expect(fs.length).toBeGreaterThan(0); expect(fs.every((f) => f.severity === 'unknown')).toBe(true);
  });
});

describe('connectPins survivors and disconnect precision', () => {
  const t = templates[0];
  const netOf = (p: typeof t, i: string, pin: string) => p.nets.find((n) => n.pins.some((x) => x.instance === i && x.pin === pin))?.id;
  it('ground beats power beats bus beats signal; equal rank keeps the larger net; ties keep the first pin\'s net', () => {
    expect(netOf(applyOps(t, connectPins(t, registry, { instance: 'mcu', pin: 'D6' }, { instance: 'driver', pin: 'GND' })), 'mcu', 'D6')).toBe('GND');          // signal into ground, regardless of pick order
    expect(netOf(applyOps(t, connectPins(t, registry, { instance: 'driver', pin: 'GND' }, { instance: 'mcu', pin: 'D6' })), 'mcu', 'D6')).toBe('GND');
    expect(netOf(applyOps(t, connectPins(t, registry, { instance: 'mcu', pin: 'D0' }, { instance: 'driver', pin: 'VMOT' })), 'mcu', 'D0')).toBe('RAIL_5V');    // signal into power keeps the power net
    expect(netOf(applyOps(t, connectPins(t, registry, { instance: 'buck', pin: 'OUT+' }, { instance: 'battery', pin: '-' })), 'buck', 'OUT+')).toBe('GND');     // power into ground keeps ground
    expect(netOf(applyOps(t, connectPins(t, registry, { instance: 'mcu', pin: 'D0' }, { instance: 'driver', pin: 'AIN1' })), 'driver', 'AIN1')).toBe('CTRL_PWMA'); // equal rank, equal size: the first pin's net
    const merged = applyOps(t, connectPins(t, registry, { instance: 'diode', pin: 'A' }, { instance: 'buck', pin: 'OUT+' }));     // BATT+ (2 pins) into 5V (4 pins): larger survives
    expect(netOf(merged, 'diode', 'A')).toBe('RAIL_5V');
  });
  it('self and same-net connections are no-ops; disconnect removes exactly one pin and empties nothing else', async () => {
    const { disconnectPin } = await import('../mutations');
    expect(connectPins(t, registry, { instance: 'mcu', pin: 'D0' }, { instance: 'mcu', pin: 'D0' })).toEqual([]);
    expect(connectPins(t, registry, { instance: 'driver', pin: 'GND' }, { instance: 'mcu', pin: 'GND' })).toEqual([]);
    const p = applyOps(t, disconnectPin({ instance: 'driver', pin: 'STBY' }));
    expect(netOf(p, 'driver', 'STBY')).toBeUndefined(); expect(p.nets.find((n) => n.id === 'STBY')?.pins).toEqual([{ instance: 'mcu', pin: 'D6' }]);
    expect(p.nets.length).toBe(t.nets.length); expect(p.nets.flatMap((n) => n.pins).length).toBe(t.nets.flatMap((n) => n.pins).length - 1);
  });
  it('a finding names the exact pins that were edited', () => {
    const p = applyMutation(t, 'connect_motor_to_mcu'); const f = evaluate(p, registry).findings.find((x) => x.ruleId === 'motor_load_path')!;
    // The motor pin and the GPIO pin it names must sit on the same net: a finding that points at the wrong pin fails here.
    const motorPin = f.affected.find((a) => a.instanceId === 'motor_left')!; const gpioPin = f.affected.find((a) => a.instanceId === 'mcu')!;
    expect(motorPin.pin).toMatch(/^M[+-]$/); expect(gpioPin.pin).toMatch(/^D[78]$/);
    const net = p.nets.find((n) => n.pins.some((x) => x.instance === 'motor_left' && x.pin === motorPin.pin))!;
    expect(net.pins).toContainEqual({ instance: 'mcu', pin: gpioPin.pin });
    const g = evaluate(applyMutation(t, 'force_stby_low'), registry).findings.find((x) => x.ruleId === 'driver_enable_state')!;
    expect(g.affected).toEqual([{ instanceId: 'driver', pin: 'STBY', netId: 'GND' }]);
  });
});
