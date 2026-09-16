import { finding, type Rule } from '../context';

/** Heuristic: a motor driver's supply net should carry bulk capacitance near the assumed value. Not a component-spec invariant. */
export const bulk_capacitance: Rule = {
  id: 'bulk_capacitance', origin: 'deterministic', dimensions: ['bulk_capacitance'],
  analyze(ctx) {
    const drivers = ctx.instancesOfKind('motor_driver');
    if (drivers.length === 0) return { findings: [], coverage: [] };
    const target = ctx.assumptionNum('motor_bulk_cap_uf');
    const findings = [] as ReturnType<typeof finding>[];
    const notes: string[] = [];
    for (const d of drivers) {
      const comp = ctx.comp(d.id)!;
      const motorSupply = comp.pins.filter((p) => p.role === 'supply_in').sort((a, b) => (b.supply_range?.max ?? 0) - (a.supply_range?.max ?? 0))[0];
      const net = motorSupply && ctx.netOf(d.id, motorSupply.name);
      if (!net) continue;
      let total = 0; const caps: string[] = [];
      for (const p of ctx.netPins(net)) if (p.def.role === 'cap_pos') { const c = ctx.fact(p.instance, 'capacitance_uf'); if (c) { total += c.value; caps.push(`${p.instance} ${c.value} uF`); } }
      if (target !== undefined && total >= target) { notes.push(`${d.label} ${motorSupply.name}: ${total} uF on ${net.name} (heuristic target ${target} uF)`); continue; }
      if (target === undefined && total > 0) { notes.push(`${d.label}: ${total} uF present, no target assumption`); continue; }
      findings.push(finding({
        ruleId: 'bulk_capacitance', basis: 'heuristic', severity: 'warning', category: 'transients',
        title: `${d.label} motor rail has ${total ? `${total} uF` : 'no bulk capacitance'}; heuristic target is ${target ?? 'unset'} uF`, affected: [{ instanceId: d.id, pin: motorSupply.name, netId: net.id }],
        evidence: [
          { label: `capacitors on ${net.name}`, value: caps.join(', ') || 'none', provenance: 'user' },
          { label: 'motor_bulk_cap_uf assumption', value: String(target ?? 'unset'), provenance: 'fixture_assumption' },
        ],
        consequence: 'Motor start and stall transients pull the shared rail down. The logic board on the same rail may reset. This is a heuristic based on two small motors on a shared regulator, not a datasheet limit.',
        remediation: ['Add an electrolytic capacitor across the motor supply near the driver', 'Or separate the motor rail from the logic rail and accept this warning by override'],
      }));
    }
    return { findings, coverage: [{ dimension: 'bulk_capacitance', group: 'electrical', status: 'heuristic', note: notes.join('; ') || 'Heuristic check' }] };
  },
};
