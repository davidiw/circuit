import { finding, fmtV, type Rule } from '../context';

export const supply_in_range: Rule = {
  id: 'supply_in_range', origin: 'deterministic', dimensions: ['rail_voltages'],
  analyze(ctx) {
    if (!ctx.hasPower) return { findings: [], coverage: [{ dimension: 'rail_voltages', group: 'electrical', status: 'not_evaluated', note: 'No power source' }] };
    const findings = [] as ReturnType<typeof finding>[];
    let checked = 0, unknown = 0; const unconnected: string[] = [];
    for (const inst of ctx.project.instances) {
      const comp = ctx.comp(inst.id); if (!comp) continue;
      for (const pin of comp.pins) {
        if (pin.role !== 'supply_in') continue;
        const net = ctx.netOf(inst.id, pin.name);
        if (!net) {
          unconnected.push(`${inst.label} ${pin.name}`);
          findings.push(finding({ ruleId: 'supply_in_range', basis: 'component_spec', severity: 'warning', category: 'voltage', title: `${inst.label} ${pin.name} is not connected to anything`, affected: [{ instanceId: inst.id, pin: pin.name }], evidence: [{ label: `${pin.name} role`, value: 'supply input', provenance: 'vetted_source' }], consequence: pin.note?.includes('Logic') ? 'The part has no logic supply and will not respond.' : 'The part is unpowered on this input; whatever it powers does nothing.', remediation: [`Wire ${pin.name} to a rail in its range${pin.supply_range ? ` (${pin.supply_range.min} to ${pin.supply_range.max} V)` : ''}`] }));
          continue;
        }
        const v = ctx.voltage(net.id); const range = ctx.supplyRange(inst.id, pin);
        const affected = [{ instanceId: inst.id, pin: pin.name, netId: net.id }];
        if (!range || !v) {
          unknown++;
          findings.push(finding({
            ruleId: 'supply_in_range', basis: 'component_spec', severity: 'unknown', category: 'voltage',
            title: `${inst.label} ${pin.name}: ${!v ? 'net voltage unknown' : 'no modeled input range'}`, affected,
            evidence: [{ label: 'net', value: net.name, provenance: 'user' }, { label: 'voltage', value: v ? fmtV(v.nominal) : 'unknown', provenance: v ? v.provenance : 'unknown' }],
            consequence: 'Compatibility cannot be confirmed.', remediation: [!v ? `Connect a source or a regulator output to ${net.name} so its voltage is known` : `We do not have a published input range for this pin yet; check the ${comp.manufacturer ?? 'maker'} documentation before powering it`],
            missing: [!v ? 'net voltage' : `${pin.name} supply range`],
          }));
          continue;
        }
        checked++;
        const r = range; const prov = pin.supply_range_provenance ?? 'unknown';
        const evidence = [
          { label: `${net.name} nominal / min / max`, value: `${fmtV(v.nominal)} / ${fmtV(v.min)} / ${fmtV(v.max)}`, provenance: v.provenance },
          { label: `${pin.name} allowed`, value: `${fmtV(r.min)} to ${fmtV(r.max)}`, provenance: prov },
        ];
        if (v.nominal < r.min || v.nominal > r.max || v.max > r.max) {
          const high = v.nominal > r.max || v.max > r.max;
          findings.push(finding({
            ruleId: 'supply_in_range', basis: prov === 'vetted_source' ? 'component_spec' : 'assumption', severity: 'violation', category: 'voltage',
            title: `${inst.label} ${pin.name} sees ${fmtV(high ? Math.max(v.nominal, v.max) : v.nominal)}, ${high ? 'above' : 'below'} its ${high ? fmtV(r.max) + ' maximum' : fmtV(r.min) + ' minimum'}`,
            affected, evidence,
            consequence: high ? 'Overvoltage on a supply input can destroy the part or its onboard regulator.' : 'The part will not operate or will operate erratically below its minimum supply.',
            remediation: [high ? 'Lower the rail or insert a regulator rated for this part' : 'Raise the rail or choose a part rated for this voltage'],
            fixes: (() => {
              const via = v.via.split('.'); const src = via[0]; const isProp = via[1] === 'outputV' && ctx.prop(src, 'outputV');
              if (!isProp) return [];
              const target = Math.min(Math.max(5.0, r.min), r.max);
              return [{ label: `Set ${ctx.inst(src)!.label} output to ${fmtV(target)}`, ops: [{ op: 'set_prop' as const, instance: src, prop: 'outputV', value: target, provenance: 'user' as const }], kind: 'edit' as const }];
            })(),
          }));
        } else if (prov !== 'vetted_source' && (v.max > r.max - 0.05 * (r.max - r.min) || v.nominal > r.max - 0.05 * (r.max - r.min))) {
          findings.push(finding({
            ruleId: 'supply_in_range', basis: 'assumption', severity: 'warning', category: 'voltage',
            title: `${inst.label} ${pin.name} at ${fmtV(v.max)} sits at the edge of an assumed ${fmtV(r.max)} limit`,
            affected, evidence,
            consequence: 'The input range for this pin is a fixture assumption, not a published limit. Operating at its edge is unverified.',
            remediation: ['Confirm the input tolerance from the manufacturer documentation', 'Or lower the rail to leave margin'],
          }));
        } else if (v.min < r.min) {
          findings.push(finding({
            ruleId: 'supply_in_range', basis: 'assumption', severity: 'warning', category: 'voltage',
            title: `${inst.label} ${pin.name} drops to ${fmtV(v.min)} at end of discharge, below ${fmtV(r.min)}`,
            affected, evidence,
            consequence: 'Works from a full battery but browns out before the battery is empty.',
            remediation: ['Raise the battery cutoff, add cells, or lower the rail requirement'],
          }));
        }
      }
    }
    return { findings, coverage: [{ dimension: 'rail_voltages', group: 'electrical', status: unknown ? 'partial' : 'checked', note: `${checked} supply inputs checked${unknown ? `, ${unknown} unknown` : ''}${unconnected.length ? `, unconnected: ${unconnected.join(', ')}` : ''}` }] };
  },
};
