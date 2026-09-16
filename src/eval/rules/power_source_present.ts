import { finding, type Rule } from '../context';

export const power_source_present: Rule = {
  id: 'power_source_present', origin: 'deterministic', dimensions: ['power_source'],
  analyze(ctx) {
    const cov = (status: 'checked', note: string) => [{ dimension: 'power_source', group: 'electrical' as const, status, note }];
    const id = ctx.project.power.sourceInstance;
    if (!id || !ctx.inst(id)) {
      return { coverage: cov('checked', 'No power source instance'), findings: [finding({
        ruleId: 'power_source_present', basis: 'component_spec', severity: 'violation', category: 'power',
        title: 'No explicit power source', affected: [],
        evidence: [{ label: 'power.sourceInstance', value: String(id), provenance: 'user' }],
        consequence: 'The design is incomplete. Every voltage-dependent rule is skipped and reports not evaluated rather than passing.',
        remediation: ['Add a battery, regulated supply, or USB source instance and set it as the power source'],
        missing: ['power source'],
      })] };
    }
    const comp = ctx.comp(id)!;
    const srcPin = comp.pins.find((p) => p.role === 'battery_pos' || p.role === 'supply_out');
    if (!srcPin || !ctx.netOf(id, srcPin.name)) {
      return { coverage: cov('checked', 'Source present but unwired'), findings: [finding({
        ruleId: 'power_source_present', basis: 'component_spec', severity: 'violation', category: 'power',
        title: 'Power source is not wired to any net', affected: [{ instanceId: id, pin: srcPin?.name }],
        evidence: [{ label: 'source pin', value: srcPin?.name ?? 'none', provenance: 'vetted_source' }],
        consequence: 'Nothing downstream receives power.', remediation: ['Connect the source positive pin to the input of the first stage'],
      })] };
    }
    return { coverage: cov('checked', `${comp.label} on ${ctx.netOf(id, srcPin.name)!.name}`), findings: [] };
  },
};
