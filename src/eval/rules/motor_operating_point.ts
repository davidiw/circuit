import { finding, fmtV, type Rule } from '../context';

/** Motors versus their rated voltage: a performance note, not a fault. No-load speed is estimated as proportional to voltage. */
export const motor_operating_point: Rule = {
  id: 'motor_operating_point', origin: 'deterministic', dimensions: ['motor_operating_point'],
  analyze(ctx) {
    const motors = ctx.instancesOfKind('dc_gearmotor');
    if (!motors.length || !ctx.hasPower) return { findings: [], coverage: [] };
    const findings = [] as ReturnType<typeof finding>[];
    const metrics = [] as { key: string; label: string; value: number; unit: string; provenance: 'vetted_source' | 'fixture_assumption'; group: 'performance'; note?: string }[];
    const seen = new Set<string>();
    for (const m of motors) {
      const pin = ctx.comp(m.id)!.pins[0]; const net = ctx.netOf(m.id, pin.name); if (!net) continue;
      const drvPin = ctx.netPins(net).find((p) => p.def.role === 'motor_out'); if (!drvPin) continue;
      const drv = ctx.comp(drvPin.instance)!;
      const vmot = drv.pins.filter((p) => p.role === 'supply_in').sort((a, b) => (b.supply_range?.max ?? 0) - (a.supply_range?.max ?? 0))[0];
      const railNet = vmot && ctx.netOf(drvPin.instance, vmot.name); const rail = railNet && ctx.voltage(railNet.id);
      const nominal = ctx.fact(m.id, 'nominal_v'); const rpm = ctx.fact(m.id, 'no_load_rpm');
      if (!rail || !nominal) continue;
      const ratio = rail.nominal / nominal.value;
      if (!seen.has(railNet!.id)) {
        seen.add(railNet!.id);
        metrics.push({ key: 'motor_rail_v', label: 'Motor rail', value: rail.nominal, unit: 'V', provenance: rail.provenance as 'fixture_assumption', group: 'performance' }, { key: 'motor_rated_v', label: 'Motor rated voltage', value: nominal.value, unit: 'V', provenance: nominal.provenance as 'vetted_source', group: 'performance' });
        if (rpm) metrics.push({ key: 'motor_no_load_rpm_est', label: 'Estimated no-load speed', value: Math.round(rpm.value * ratio), unit: 'rpm', provenance: rail.provenance as 'fixture_assumption', group: 'performance', note: `${rpm.value} rpm rated at ${nominal.value} V, scaled linearly with rail voltage` });
      }
      if (ratio < 0.95 && !findings.length) findings.push(finding({
        ruleId: 'motor_operating_point', basis: 'assumption', severity: 'optimization', category: 'performance',
        title: `Motors run at ${fmtV(rail.nominal)}, below their ${fmtV(nominal.value)} rating: about ${Math.round((1 - ratio) * 100)} percent lower no-load speed (estimated)`,
        affected: [...motors.map((x) => ({ instanceId: x.id })), { instanceId: drvPin.instance, pin: vmot!.name, netId: railNet!.id }],
        evidence: [{ label: `${railNet!.name} voltage`, value: fmtV(rail.nominal), provenance: rail.provenance }, { label: `${m.id} nominal_v`, value: fmtV(nominal.value), provenance: nominal.provenance }, ...(rpm ? [{ label: 'no_load_rpm at rated voltage', value: String(rpm.value), provenance: rpm.provenance }] : [])],
        consequence: 'Top speed and torque are below what the motors can deliver. Brushed DC no-load speed scales roughly with voltage; torque and current scale with it too, so a higher rail also raises stall current and runtime cost.',
        remediation: ['Raise the motor rail toward the rating with the Optimize step, keeping the logic supply within its own range', 'Or accept the lower speed for the runtime and simplicity it buys'],
        fixes: ctx.project.optimizations.filter((o) => o.id === 'motors_at_rated_voltage').map((o) => ({ label: o.title, ops: o.ops, kind: 'optimize' as const, optimizationId: o.id })),
      }));
    }
    return { findings, metrics, coverage: [{ dimension: 'motor_operating_point', group: 'product', status: 'estimated', note: 'Rail versus rating; no-load speed scaled linearly, torque and acceleration not modeled' }] };
  },
};
