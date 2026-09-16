import { finding, type Rule } from '../context';

export const reverse_polarity_strategy: Rule = {
  id: 'reverse_polarity_strategy', origin: 'deterministic', dimensions: ['reverse_polarity'],
  analyze(ctx) {
    const cov = (status: 'checked' | 'not_evaluated', note: string) => [{ dimension: 'reverse_polarity', group: 'electrical' as const, status, note }];
    if (!ctx.hasPower) return { findings: [], coverage: cov('not_evaluated', 'No power source') };
    if (ctx.project.power.mode !== 'battery') return { findings: [], coverage: cov('checked', 'Continuous source; user-reversible polarity not applicable') };
    const src = ctx.project.power.sourceInstance!;
    const comp = ctx.comp(src)!;
    const builtIn = comp.facts['built_in_reverse_protection'];
    if (builtIn && builtIn.value === true) return { findings: [], coverage: cov('checked', `${comp.label} declares built-in or keyed protection (${builtIn.provenance})`) };
    const posPin = comp.pins.find((p) => p.role === 'battery_pos');
    const net = posPin ? ctx.netOf(src, posPin.name) : undefined;
    const protector = net ? ctx.netPins(net).find((p) => p.instance !== src && ctx.comp(p.instance)?.capabilities.includes('reverse_polarity_protection')) : undefined;
    if (protector) return { findings: [], coverage: cov('checked', `${ctx.inst(protector.instance)!.label} in series on ${net!.name}`) };
    if (ctx.overridden('reverse_polarity_strategy', src)) return { findings: [], coverage: cov('checked', 'No protection; risk accepted by override') };
    return { coverage: cov('checked', 'No strategy found'), findings: [finding({
      ruleId: 'reverse_polarity_strategy', basis: 'component_spec', severity: 'warning', category: 'protection',
      title: 'Battery design has no reverse-polarity strategy', affected: [{ instanceId: src, ...(net ? { netId: net.id } : {}) }],
      evidence: [
        { label: 'source', value: comp.label, provenance: comp.verification_status === 'constrained_component_class' ? 'fixture_assumption' : 'vetted_source' },
        { label: 'built_in_reverse_protection', value: String(builtIn?.value ?? 'unknown'), provenance: builtIn?.provenance ?? 'unknown' },
        { label: `parts on ${net?.name ?? 'battery net'}`, value: net ? ctx.netPins(net).map((p) => p.instance).filter((i) => i !== src).join(', ') || 'none' : 'unwired', provenance: 'user' },
      ],
      consequence: 'The circuit runs normally when connected correctly. One reversed connection during assembly or a battery swap puts full pack voltage backwards across the regulator and everything after it.',
      remediation: ['Add a series Schottky diode on the battery positive line', 'Use a keyed connector and record it as the accepted strategy', 'Choose a source or module with documented reverse protection'],
    })] };
  },
};
