import { finding, type Rule } from '../context';

export const motor_load_path: Rule = {
  id: 'motor_load_path', origin: 'deterministic', dimensions: ['motor_wiring'],
  analyze(ctx) {
    const motors = ctx.instancesOfKind('dc_gearmotor');
    const findings = [] as ReturnType<typeof finding>[];
    for (const m of motors) {
      const comp = ctx.comp(m.id)!;
      let gpioHit: { pin: string; net: string; other: string } | undefined; let missingDriver = false; let unconnected = false;
      const nets = comp.pins.map((pin) => ctx.netOf(m.id, pin.name)?.id).filter(Boolean);
      if (nets.length === 2 && nets[0] === nets[1]) {
        findings.push(finding({ ruleId: 'motor_load_path', basis: 'component_spec', severity: 'violation', category: 'load_path', title: `${m.label} has both terminals on the same net`, affected: [{ instanceId: m.id, netId: nets[0] }], evidence: [{ label: 'terminals', value: comp.pins.map((p) => `${p.name} on ${ctx.netOf(m.id, p.name)?.name}`).join(', '), provenance: 'user' }], consequence: 'The winding is shorted out: no voltage across it, no torque, and the driver output is shorted to itself.', remediation: ['Put each terminal on a different driver output of one channel'] }));
        continue;
      }
      for (const pin of comp.pins) {
        const net = ctx.netOf(m.id, pin.name);
        if (!net) { unconnected = true; continue; }
        const pins = ctx.netPins(net);
        const g = pins.find((p) => p.def.role === 'gpio');
        if (g) gpioHit = { pin: pin.name, net: net.name, other: `${g.instance}.${g.pin}` };
        if (!pins.some((p) => p.def.role === 'motor_out')) missingDriver = true;
      }
      if (gpioHit) {
        const gpioMax = ctx.fact(gpioHit.other.split('.')[0], 'gpio_max_source_current_a');
        findings.push(finding({
          ruleId: 'motor_load_path', basis: 'component_spec', severity: 'violation', category: 'load_path',
          title: `${m.label} is wired to a microcontroller GPIO`, affected: [{ instanceId: m.id, pin: gpioHit.pin }, { instanceId: gpioHit.other.split('.')[0], pin: gpioHit.other.split('.')[1] }],
          evidence: [
            { label: 'net', value: gpioHit.net, provenance: 'user' },
            { label: 'motor stall current', value: `${ctx.fact(m.id, 'stall_current_a')?.value ?? 'unknown'} A`, provenance: ctx.fact(m.id, 'stall_current_a')?.provenance ?? 'unknown' },
            { label: 'GPIO source limit', value: gpioMax ? `${gpioMax.value} A` : 'unknown', provenance: gpioMax?.provenance ?? 'unknown' },
          ],
          consequence: 'A GPIO cannot source motor current. The motor will not turn and the pin, possibly the whole board, can be damaged by the load and by inductive kickback.',
          remediation: ['Connect the motor to an H-bridge output and drive the bridge from the GPIO'],
        }));
      } else if (unconnected || missingDriver) {
        findings.push(finding({
          ruleId: 'motor_load_path', basis: 'component_spec', severity: 'violation', category: 'load_path',
          title: `${m.label} is not driven by a motor driver output`, affected: [{ instanceId: m.id }],
          evidence: [{ label: 'motor pins', value: comp.pins.map((p) => `${p.name}: ${ctx.netOf(m.id, p.name)?.name ?? 'unconnected'}`).join(', '), provenance: 'user' }],
          consequence: 'The motor has no drive path.', remediation: ['Wire both motor terminals to one H-bridge channel'],
        }));
      }
    }
    // Two motors sharing one driver output cannot be controlled independently.
    const byOut = new Map<string, string[]>();
    for (const m of motors) for (const pin of ctx.comp(m.id)!.pins) { const net = ctx.netOf(m.id, pin.name); if (!net) continue; for (const q of ctx.netPins(net)) if (q.def.role === 'motor_out') { const k = `${q.instance}.${q.pin}`; byOut.set(k, [...new Set([...(byOut.get(k) ?? []), m.id])]); } }
    for (const [out, ms] of byOut) if (ms.length > 1) findings.push(finding({ ruleId: 'motor_load_path', basis: 'component_spec', severity: 'warning', category: 'load_path', title: `${ms.map((id) => ctx.inst(id)!.label).join(' and ')} share driver output ${out.split('.')[1]}`, affected: [...ms.map((id) => ({ instanceId: id })), { instanceId: out.split('.')[0], pin: out.split('.')[1] }], evidence: [{ label: 'shared output', value: out, provenance: 'user' }], consequence: 'The two motors move together and split the channel current; independent left and right drive is lost.', remediation: ['Give each motor its own driver channel'] }));
    return { findings, coverage: motors.length ? [{ dimension: 'motor_wiring', group: 'electrical', status: 'checked', note: `${motors.length} motors checked: driven by a driver output, terminals on separate nets, one motor per output` }] : [] };
  },
};
