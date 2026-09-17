import { finding, fmtA, type Rule } from '../context';

export const driver_load_current: Rule = {
  id: 'driver_load_current', origin: 'deterministic', dimensions: ['driver_motor_current'],
  analyze(ctx) {
    const motors = ctx.instancesOfKind('dc_gearmotor');
    const findings = [] as ReturnType<typeof finding>[];
    let checked = 0; const notes: string[] = [];
    for (const m of motors) {
      const pin = ctx.comp(m.id)!.pins[0]; const net = ctx.netOf(m.id, pin.name); if (!net) continue;
      const drvPin = ctx.netPins(net).find((p) => p.def.role === 'motor_out'); if (!drvPin) continue;
      const stall = ctx.fact(m.id, 'stall_current_a'); const limit = ctx.fact(drvPin.instance, 'continuous_current_per_channel_a');
      if (!stall || !limit) { findings.push(finding({ ruleId: 'driver_load_current', basis: 'component_spec', severity: 'unknown', category: 'current', title: `${m.label}: ${!stall ? 'stall current' : 'driver channel limit'} unknown`, affected: [{ instanceId: m.id }], evidence: [{ label: !stall ? 'motor stall current' : 'driver continuous current', value: 'not published for this part', provenance: 'unknown' }], consequence: 'We cannot tell whether the driver can carry this motor at stall.', remediation: ['Check the motor and driver documentation for stall current and per-channel rating before building'], missing: [!stall ? 'motor stall current' : 'driver channel current rating'] })); continue; }
      checked++;
      const ev = [{ label: `${m.id} stall_current_a (at motor nominal)`, value: fmtA(stall.value), provenance: stall.provenance }, { label: `${drvPin.instance} continuous_current_per_channel_a`, value: fmtA(limit.value), provenance: limit.provenance }];
      if (stall.value > limit.value) findings.push(finding({ ruleId: 'driver_load_current', basis: 'component_spec', severity: 'violation', category: 'current', title: `${m.label} stall ${fmtA(stall.value)} exceeds driver channel limit ${fmtA(limit.value)}`, affected: [{ instanceId: m.id }, { instanceId: drvPin.instance, pin: drvPin.pin }], evidence: ev, consequence: 'A stalled or hard-starting motor overloads the H-bridge; the driver shuts down thermally or is damaged.', remediation: ['Choose a driver with a higher per-channel continuous rating', 'Choose a motor with lower stall current'] }));
      else if (stall.value > 0.8 * limit.value) findings.push(finding({ ruleId: 'driver_load_current', basis: 'component_spec', severity: 'warning', category: 'current', title: `${m.label} stall ${fmtA(stall.value)} is within 20 percent of the driver limit`, affected: [{ instanceId: m.id }], evidence: ev, consequence: 'Little margin for stall events.', remediation: ['Consider a driver with more headroom'] }));
      else notes.push(`${m.label} ${fmtA(stall.value)} of ${fmtA(limit.value)}`);
    }
    return { findings, coverage: motors.length ? [{ dimension: 'driver_motor_current', group: 'electrical', status: checked ? 'checked' : 'partial', note: notes.join('; ') || 'No motor/driver pairs resolved' }] : [] };
  },
};
