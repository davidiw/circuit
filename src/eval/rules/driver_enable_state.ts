import { finding, freeGpio, type Rule } from '../context';

export const driver_enable_state: Rule = {
  id: 'driver_enable_state', origin: 'deterministic', dimensions: ['driver_control_state'],
  analyze(ctx) {
    const findings = [] as ReturnType<typeof finding>[];
    const notes: string[] = [];
    for (const inst of ctx.project.instances) {
      const comp = ctx.comp(inst.id); if (!comp) continue;
      for (const pin of comp.pins) {
        if (pin.role !== 'enable_in') continue;
        const net = ctx.netOf(inst.id, pin.name);
        const pullup = ctx.fact(inst.id, 'stby_pullup_kohm');
        if (!net) {
          if (ctx.features(inst.id).includes('stby_10k_pullup')) { notes.push(`${inst.label} ${pin.name} unconnected; enabled by this board's ${pullup?.value ?? 10} kOhm pull-up`); continue; }
          findings.push(finding({
            ruleId: 'driver_enable_state', basis: 'component_spec', severity: 'unknown', category: 'control_state',
            title: `${inst.label} ${pin.name} is unconnected and this part's default state is unknown`, affected: [{ instanceId: inst.id, pin: pin.name }],
            evidence: [{ label: 'board features', value: comp.board_features.join(', ') || 'none', provenance: comp.verification_status.startsWith('vetted') ? 'vetted_source' : 'fixture_assumption' }],
            consequence: 'A floating enable may leave the driver disabled or flickering.', remediation: ['Drive the enable pin from a GPIO or tie it to the logic rail'], missing: ['default enable state for this part'],
          }));
          continue;
        }
        const pins = ctx.netPins(net);
        if (pins.some((p) => p.def.role === 'ground')) {
          findings.push(finding({
            ruleId: 'driver_enable_state', basis: 'component_spec', severity: 'violation', category: 'control_state',
            title: `${inst.label} is held in standby`, affected: [{ instanceId: inst.id, pin: pin.name, netId: net.id }],
            evidence: [
              { label: `${inst.id}.${pin.name} net`, value: net.name, provenance: 'user' },
              { label: `${pin.name} role`, value: 'enable input, active high', provenance: 'vetted_source' },
              ...(pullup ? [{ label: 'stby_pullup_kohm', value: String(pullup.value), provenance: pullup.provenance }] : []),
            ],
            consequence: 'Both H-bridges are disabled. The board receives commands and PWM but neither motor turns. Drive is unavailable.',
            remediation: ['Move the pin to a GPIO and drive it high in firmware', 'Tie it to the logic rail', ...(comp.board_features.includes('stby_10k_pullup') ? ['Leave it unconnected: this breakout\'s pull-up enables the driver by default'] : [])],
            fixes: (() => {
              const board = ctx.instancesOfKind('dev_board')[0]; const gpio = board && freeGpio(ctx, board.id);
              const logic = ctx.project.nets.find((n) => n.kind === 'power' && ctx.netVoltages.get(n.id)?.nominal === 3.3);
              return [
                ...(board && gpio ? [{ label: `Move ${pin.name} to ${board.label} ${gpio}`, ops: [{ op: 'move_pin' as const, instance: inst.id, pin: pin.name, net: `${inst.id}_${pin.name}_${gpio}`, name: pin.name, kind: 'signal' as const }, { op: 'move_pin' as const, instance: board.id, pin: gpio, net: `${inst.id}_${pin.name}_${gpio}` }], kind: 'edit' as const }] : []),
                ...(logic ? [{ label: `Tie ${pin.name} to ${logic.name}`, ops: [{ op: 'move_pin' as const, instance: inst.id, pin: pin.name, net: logic.id }], kind: 'edit' as const }] : []),
                ...(comp.board_features.includes('stby_10k_pullup') ? [{ label: `Leave ${pin.name} unconnected`, ops: [{ op: 'move_pin' as const, instance: inst.id, pin: pin.name, net: null }], kind: 'edit' as const }] : []),
              ];
            })(),
          }));
        } else if (!pins.some((p) => p.def.role === 'gpio' || p.def.role === 'supply_out' || p.def.role === 'logic_out')) {
          findings.push(finding({
            ruleId: 'driver_enable_state', basis: 'component_spec', severity: 'unknown', category: 'control_state',
            title: `${inst.label} ${pin.name} is on ${net.name} with no driver`, affected: [{ instanceId: inst.id, pin: pin.name, netId: net.id }],
            evidence: [{ label: 'net members', value: pins.map((p) => `${p.instance}.${p.pin}`).join(', '), provenance: 'user' }],
            consequence: 'Enable state is undefined.', remediation: ['Drive the enable pin from a GPIO or the logic rail'],
          }));
        } else notes.push(`${inst.label} ${pin.name} driven from ${pins.filter((p) => p.instance !== inst.id).map((p) => `${p.instance}.${p.pin}`).join(', ')}`);
      }
    }
    const any = ctx.project.instances.some((i) => ctx.comp(i.id)?.pins.some((p) => p.role === 'enable_in'));
    return { findings, coverage: any ? [{ dimension: 'driver_control_state', group: 'electrical', status: 'checked', note: notes.join('; ') || 'enable pins checked' }] : [] };
  },
};
