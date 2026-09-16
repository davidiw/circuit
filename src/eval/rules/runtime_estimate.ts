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
    const ev = [
      { label: 'capacity_mah_min', value: `${cap.value} mAh`, provenance: cap.provenance },
      { label: 'nominal_v', value: `${vnom.value} V`, provenance: vnom.provenance },
      { label: 'avg_motor_current_a x motors', value: `${iMotor} A x ${motors} at ${vMotor} V`, provenance: 'fixture_assumption' as const },
      { label: 'mcu_avg_current_a', value: `${iMcu} A at 5 V`, provenance: 'fixture_assumption' as const },
      { label: 'buck_efficiency', value: String(eff), provenance: 'fixture_assumption' as const },
      { label: 'estimated runtime', value: `${minutes} min`, provenance: 'fixture_assumption' as const },
    ];
    const findings = minutes < need ? [finding({ ruleId: 'runtime_estimate', basis: 'assumption', severity: 'violation', category: 'runtime', title: `Estimated runtime ${minutes} min is below the ${need} min requirement`, affected: [{ instanceId: src }], evidence: ev, consequence: 'The product goal is not met under the stated assumptions.', remediation: ['Increase capacity', 'Reduce average motor current', 'Revisit the duty assumption'] })] : [];
    return { findings, coverage: cov('estimated', `about ${minutes} min from assumptions; requirement ${need} min`) };
  },
};
