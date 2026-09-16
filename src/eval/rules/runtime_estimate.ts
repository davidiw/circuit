import { finding, type Rule } from '../context';

export const runtime_estimate: Rule = {
  id: 'runtime_estimate', origin: 'deterministic', dimensions: ['runtime'],
  analyze(ctx) {
    const req = ctx.project.requirements.find((r) => r.kind === 'runtime_minutes' && r.evaluable);
    if (!req) return { findings: [], coverage: [] };
    const cov = (status: 'estimated' | 'partial' | 'not_evaluated', note: string) => [{ dimension: 'runtime', group: 'product' as const, status, note }];
    if (!ctx.hasPower || ctx.project.power.mode !== 'battery') return { findings: [], coverage: cov('not_evaluated', 'No battery source') };
    const src = ctx.project.power.sourceInstance!;
    const cap = ctx.fact(src, 'capacity_mah_min'); const vnom = ctx.fact(src, 'nominal_v');
    if (!cap || !vnom) return { findings: [finding({ ruleId: 'runtime_estimate', basis: 'assumption', severity: 'unknown', category: 'runtime', title: 'Battery capacity unknown; runtime cannot be estimated', affected: [{ instanceId: src }], evidence: [{ label: 'capacity_mah_min', value: String(ctx.comp(src)!.facts['capacity_mah_min']?.value ?? 'absent'), provenance: 'unknown' }], consequence: 'The runtime requirement stays unverified.', remediation: ['Choose an exact pack or set an assumed capacity'], missing: ['battery capacity'] })], coverage: cov('partial', 'Capacity unknown') };
    const motors = ctx.instancesOfKind('dc_gearmotor').length;
    const iMotor = ctx.assumptionNum('avg_motor_current_a') ?? 0; const vMotor = ctx.assumptionNum('motor_rail_v') ?? vnom.value;
    const iMcu = ctx.assumptionNum('mcu_avg_current_a') ?? 0; const eff = ctx.assumptionNum('buck_efficiency') ?? 1;
    const pLoad = motors * iMotor * vMotor + iMcu * 5.0;
    const wh = (cap.value / 1000) * vnom.value * eff;
    const hours = pLoad > 0 ? wh / pLoad : Infinity;
    const minutes = Math.round(hours * 60);
    const need = (req.value as { min: number }).min;
    const mass = ctx.fact(src, 'mass_g_approx');
    const metrics = [
      { key: 'battery_capacity_mah', label: 'Battery capacity (min of class)', value: cap.value, unit: 'mAh', provenance: cap.provenance, group: 'power' as const },
      { key: 'runtime_min', label: 'Estimated runtime', value: minutes, unit: 'min', provenance: 'fixture_assumption' as const, group: 'power' as const, note: `from ${cap.value} mAh at ${pLoad.toFixed(2)} W average load` },
      { key: 'avg_load_w', label: 'Average load', value: Math.round(pLoad * 100) / 100, unit: 'W', provenance: 'fixture_assumption' as const, group: 'power' as const },
      ...(mass ? [{ key: 'battery_mass_g', label: 'Battery mass (approx.)', value: mass.value, unit: 'g', provenance: mass.provenance, group: 'physical' as const }] : []),
    ];
    const ev = [
      { label: 'capacity_mah_min', value: `${cap.value} mAh`, provenance: cap.provenance },
      { label: 'nominal_v', value: `${vnom.value} V`, provenance: vnom.provenance },
      { label: 'avg_motor_current_a x motors', value: `${iMotor} A x ${motors} at ${vMotor} V`, provenance: 'fixture_assumption' as const },
      { label: 'mcu_avg_current_a', value: `${iMcu} A at 5 V`, provenance: 'fixture_assumption' as const },
      { label: 'buck_efficiency', value: String(eff), provenance: 'fixture_assumption' as const },
      { label: 'estimated runtime', value: `${minutes} min`, provenance: 'fixture_assumption' as const },
    ];
    const max = (req.value as { max?: number }).max;
    const findings = [] as ReturnType<typeof finding>[];
    if (minutes < need) findings.push(finding({ ruleId: 'runtime_estimate', basis: 'assumption', severity: 'violation', category: 'runtime', title: `Estimated runtime ${minutes} min is below the ${need} min target`, affected: [{ instanceId: src, requirementId: req.id }], evidence: ev, consequence: 'The runtime target is not met under the stated assumptions.', remediation: ['Increase capacity', 'Reduce average motor current', 'Revisit the duty assumption'] }));
    else if (max && minutes > max * 1.5) findings.push(finding({ ruleId: 'runtime_estimate', basis: 'assumption', severity: 'optimization', category: 'runtime', title: `Estimated runtime ${minutes} min is ${(minutes / max).toFixed(1)}x the ${max} min target: the battery may be larger, heavier, and costlier than the goal needs`, affected: [{ instanceId: src, requirementId: req.id }], evidence: ev, consequence: 'Electrically valid, but the pack is sized well beyond the stated runtime target. Excess capacity costs mass, volume, and money in a small car.', remediation: ['Right-size the battery toward the target with the Optimize step', 'Or raise the runtime target if longer sessions are the real goal'], fixes: ctx.project.optimizations.filter((o) => o.id === 'right_size_battery').map((o) => ({ label: o.title, ops: o.ops, kind: 'optimize' as const, optimizationId: o.id })) }));
    const status = minutes < need ? 'below target' : max && minutes > max * 1.5 ? `${(minutes / max).toFixed(1)}x above the ${max} min target` : max && minutes > max ? 'slightly above target' : 'within target';
    return { findings, metrics, coverage: cov('estimated', `about ${minutes} min from assumptions; target ${need} to ${max ?? need} min; ${status}`) };
  },
};
