import { finding, type Rule } from '../context';

export const reverse_polarity_strategy: Rule = {
  id: 'reverse_polarity_strategy', origin: 'deterministic', dimensions: ['reverse_polarity'],
  analyze(ctx) {
    const cov = (status: 'checked' | 'not_evaluated', note: string) => [{ dimension: 'reverse_polarity', group: 'electrical' as const, status, note }];
    if (!ctx.hasPower) return { findings: [], coverage: cov('not_evaluated', 'No power source') };
    if (ctx.project.power.mode !== 'battery') return { findings: [], coverage: [] };
    const src = ctx.project.power.sourceInstance!;
    const comp = ctx.comp(src)!;
    const builtIn = ctx.factAny(src, 'built_in_reverse_protection');
    if (builtIn && builtIn.value === true) return { findings: [], coverage: cov('checked', `${comp.label} declares built-in or keyed protection (${builtIn.provenance})`) };
    const posPin = comp.pins.find((p) => p.role === 'battery_pos');
    const net = posPin ? ctx.netOf(src, posPin.name) : undefined;
    const protector = net ? ctx.netPins(net).find((p) => p.instance !== src && ctx.comp(p.instance)?.capabilities.includes('reverse_polarity_protection')) : undefined;
    if (protector && protector.def.role === 'cathode') {
      // Orientation: a series diode must face the load; its anode belongs on the battery side.
      return { coverage: cov('checked', `${ctx.inst(protector.instance)!.label} present but reversed`), findings: [finding({
        ruleId: 'reverse_polarity_strategy', basis: 'component_spec', severity: 'violation', category: 'protection',
        title: `${ctx.inst(protector.instance)!.label} is installed backwards: its cathode is on ${net!.name}`, affected: [{ instanceId: protector.instance, pin: protector.pin, netId: net!.id }],
        evidence: [{ label: 'pin on the battery net', value: `${protector.pin} (cathode)`, provenance: 'vetted_source' }, { label: 'expected', value: 'A (anode) toward the battery, K (cathode) toward the load', provenance: 'vetted_source' }],
        consequence: 'A reversed series diode blocks normal current: nothing downstream powers up. When the battery is reversed it conducts instead of protecting.',
        remediation: ['Turn the diode around: anode to the battery positive, cathode to the load'],
      })] };
    }
    if (protector) return { findings: [], coverage: cov('checked', `${ctx.inst(protector.instance)!.label} in series on ${net!.name}, anode toward the battery`) };
    if (ctx.overridden('reverse_polarity_strategy', src)) return { findings: [], coverage: cov('checked', 'No protection; risk accepted by override') };
    return { coverage: cov('checked', 'No strategy found'), findings: [finding({
      ruleId: 'reverse_polarity_strategy', basis: 'component_spec', severity: 'warning', category: 'protection',
      title: 'Battery design has no reverse-polarity strategy', affected: [{ instanceId: src, ...(net ? { netId: net.id } : {}) }],
      evidence: [
        { label: 'source', value: comp.label, provenance: comp.verification_status === 'constrained_component_class' ? 'fixture_assumption' : 'vetted_source' },
        { label: 'source declares built-in protection', value: String(builtIn?.value ?? 'not stated'), provenance: builtIn?.provenance ?? 'unknown' },
        { label: `parts on ${net?.name ?? 'battery net'}`, value: net ? ctx.netPins(net).map((p) => p.instance).filter((i) => i !== src).join(', ') || 'none' : 'unwired', provenance: 'user' },
      ],
      consequence: 'The circuit runs normally when connected correctly. One reversed connection during assembly or a battery swap puts full pack voltage backwards across the regulator and everything after it.',
      remediation: ['Add a series Schottky diode on the battery positive line', 'Use a keyed connector and record it as the accepted strategy', 'Choose a source or module with documented reverse protection'],
      fixes: (() => {
        if (!net) return [];
        const consumers = ctx.netPins(net).filter((p) => p.instance !== src && p.def.role === 'supply_in');
        if (!consumers.length) return [];
        let n = 1; while (ctx.project.instances.some((i) => i.id === `diode${n}`)) n++;
        const id = `diode${n}`; const prot = `${net.id}_PROT`;
        return [{ label: 'Add a 1N5822 Schottky in series', kind: 'edit' as const, ops: [
          { op: 'add_instance' as const, id, registryId: 'diode.onsemi_1n5822', label: 'Reverse-polarity Schottky' },
          { op: 'move_pin' as const, instance: id, pin: 'A', net: net.id },
          { op: 'move_pin' as const, instance: id, pin: 'K', net: prot, name: 'VIN', kind: 'power' as const },
          ...consumers.map((c) => ({ op: 'move_pin' as const, instance: c.instance, pin: c.pin, net: prot })),
        ] }];
      })(),
    })] };
  },
};
