import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { applyOps, disconnectPin } from '../mutations';
import { evaluate } from '../evaluate';
import { assertEvaluationContract } from './contract';

/**
 * Adversarial pass on a part's internals. For every part in every template and every declared output-to-input relationship:
 * taking a required pin off its net while the output stays wired must produce a pin_dependencies violation naming that part
 * and both pins; taking the output off instead must produce none for it (an unused output needs nothing). Disconnecting every
 * pin of a part must warn that it is connected to nothing. Registry discipline: every output-role pin of a multi-pin part has a
 * declared dependency, and every declared pin exists.
 */
const OUTPUT_ROLES = new Set(['supply_out', 'battery_pos', 'motor_out', 'speaker_out', 'analog_out', 'logic_out', 'cathode']);
const wired = (p: ReturnType<typeof applyOps>, inst: string, pin: string) => p.nets.some((n) => n.pins.length >= 2 && n.pins.some((x) => x.instance === inst && x.pin === pin));

describe('registry pin dependencies', () => {
  it('every declared pin exists, and every output-role pin of a multi-pin part declares what it depends on', () => {
    for (const c of registry.components) {
      const names = new Set(c.pins.map((p) => p.name));
      for (const d of c.pin_dependencies) { expect(names.has(d.pin), `${c.id} ${d.pin}`).toBe(true); for (const r of d.requires) { expect(names.has(r), `${c.id} ${d.pin} requires ${r}`).toBe(true); expect(r, `${c.id} ${d.pin} requires itself`).not.toBe(d.pin); } expect(d.why.length).toBeGreaterThan(20); }
      if (c.pins.length < 2) continue;
      for (const p of c.pins) if (OUTPUT_ROLES.has(p.role) && p.role !== 'logic_out') expect(c.pin_dependencies.some((d) => d.pin === p.name), `${c.id}: output ${p.name} (${p.role}) has no declared dependencies`).toBe(true);
    }
  });
});

describe('pin dependencies: every required pin, every part, every template', () => {
  for (const t of templates) {
    it(`${t.id}: a wired output with an unwired required pin is a violation; an unwired output needs nothing; an unwired part warns`, () => {
      const baseline = evaluate(t, registry);
      expect(baseline.findings.filter((f) => f.ruleId === 'pin_dependencies'), `${t.id} baseline is clean`).toEqual([]);
      let checked = 0;
      for (const inst of t.instances) {
        const c = registry.components.find((x) => x.id === inst.registryId)!;
        for (const d of c.pin_dependencies) {
          if (!wired(t, inst.id, d.pin)) continue;
          for (const r of d.requires) {
            if (!wired(t, inst.id, r)) continue;
            const p2 = applyOps(t, disconnectPin({ instance: inst.id, pin: r })); const res = evaluate(p2, registry); assertEvaluationContract(res, p2, `${inst.id}.${r} off`);
            const hits = res.findings.filter((f) => f.ruleId === 'pin_dependencies' && f.severity === 'violation' && f.affected.some((a) => a.instanceId === inst.id && a.pin === d.pin) && f.affected.some((a) => a.instanceId === inst.id && a.pin === r));
            expect(hits.length, `${t.id}: ${inst.id}.${d.pin} wired, ${r} off -> one finding naming both (got ${res.findings.filter((f) => f.ruleId === 'pin_dependencies').map((f) => f.title).join(' | ') || 'none'})`).toBe(1);
            expect(hits[0].fixes.length, `${inst.id}.${d.pin}/${r}: a structured fix is offered`).toBeGreaterThan(0);
            // Every offered fix clears this finding (a shared supply pin may still leave the other channel's finding standing).
            for (const fx of hits[0].fixes) { const p3 = applyOps(p2, fx.ops); expect(evaluate(p3, registry).findings.some((f) => f.ruleId === 'pin_dependencies' && f.title === hits[0].title), `${inst.id}: fix "${fx.label}" clears "${hits[0].title}"`).toBe(false); }
            checked++;
          }
          // The output itself off: no dependency violation for this part (other rules may speak; that is theirs).
          const off = evaluate(applyOps(t, disconnectPin({ instance: inst.id, pin: d.pin })), registry);
          // (an output appears in a finding as a wired output with its net; it may still appear as a missing pin of another output, e.g. the other end of a diode)
          expect(off.findings.filter((f) => f.ruleId === 'pin_dependencies' && f.severity === 'violation' && f.affected.some((a) => a.instanceId === inst.id && a.pin === d.pin && a.netId)), `${inst.id}.${d.pin} off needs nothing`).toEqual([]);
        }
        // Every pin off: the part is flagged as connected to nothing, once, with a remove fix that clears it.
        if (c.pins.length) {
          const ops = c.pins.map((p) => disconnectPin({ instance: inst.id, pin: p.name })).flat(); const p4 = applyOps(t, ops); const res = evaluate(p4, registry);
          const orphan = res.findings.filter((f) => f.ruleId === 'pin_dependencies' && f.severity === 'warning' && f.affected.some((a) => a.instanceId === inst.id));
          expect(orphan.length, `${t.id}: ${inst.id} unwired warns once`).toBe(1);
          expect(evaluate(applyOps(p4, orphan[0].fixes[0].ops), registry).findings.some((f) => f.ruleId === 'pin_dependencies' && f.affected.some((a) => a.instanceId === inst.id)), `${inst.id} remove fix clears`).toBe(false);
        }
      }
      expect(checked, `${t.id} exercised dependencies`).toBeGreaterThan(t.id === 'water_leak_detector_v1' ? 1 : 5);
    });
  }
  it('the user-reported case: BIN1 and BIN2 off with MOTORB1 and MOTORB2 wired is one finding naming the channel, and a GPIO fix exists', () => {
    const t = templates[0];
    const p2 = applyOps(t, [...disconnectPin({ instance: 'driver', pin: 'BIN1' }), ...disconnectPin({ instance: 'driver', pin: 'BIN2' })]);
    const hits = evaluate(p2, registry).findings.filter((f) => f.ruleId === 'pin_dependencies');
    expect(hits.length).toBe(1);
    expect(hits[0].title).toBe('TB6612 motor driver: MOTORB1 and MOTORB2 are wired but not everything they depend on is');
    expect(hits[0].consequence).toMatch(/^BIN1 and BIN2 are not wired\./);
    expect(hits[0].fixes.map((f) => f.label)).toEqual(['Wire BIN1 to D7, BIN2 to D8 on XIAO ESP32-S3', 'Leave MOTORB1 and MOTORB2 unconnected']);
    for (const fx of hits[0].fixes) expect(evaluate(applyOps(p2, fx.ops), registry).findings.filter((f) => f.ruleId === 'pin_dependencies' && f.severity === 'violation')).toEqual([]);
    // Leaving the outputs unconnected strands the right motor, which the same rule then reports as connected to nothing.
    expect(evaluate(applyOps(p2, hits[0].fixes[1].ops), registry).findings.some((f) => f.ruleId === 'pin_dependencies' && f.severity === 'warning' && f.affected.some((a) => a.instanceId === 'motor_right'))).toBe(true);
    // Wiring one of the two inputs updates the same finding rather than replacing it: the title is stable, the consequence shrinks.
    const partial = evaluate(applyOps(p2, [{ op: 'move_pin', instance: 'driver', pin: 'BIN1', net: 'x', name: 'x', kind: 'signal' }, { op: 'move_pin', instance: 'mcu', pin: 'D7', net: 'x' }]), registry).findings.filter((f) => f.ruleId === 'pin_dependencies');
    expect(partial.map((f) => f.title)).toEqual([hits[0].title]); expect(partial[0].consequence).toMatch(/^BIN2 is not wired\./);
  });
});
