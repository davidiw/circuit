import { finding, type Rule } from '../context';

export const motor_load_path: Rule = {
  id: 'motor_load_path', origin: 'deterministic', dimensions: ['motor_wiring'],
  analyze(ctx) {
    const motors = ctx.instancesOfKind('dc_gearmotor');
    const findings = [] as ReturnType<typeof finding>[];
    for (const m of motors) {
      const comp = ctx.comp(m.id)!;
      let gpioHit: { pin: string; net: string; other: string } | undefined; let missingDriver = false; let unconnected = false;
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
    return { findings, coverage: motors.length ? [{ dimension: 'motor_wiring', group: 'electrical', status: 'checked', note: `${motors.length} motors checked` }] : [] };
  },
};
