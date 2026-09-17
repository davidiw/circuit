import { finding, fmtV, type Rule } from '../context';

export const regulator_headroom: Rule = {
  id: 'regulator_headroom', origin: 'deterministic', dimensions: ['regulator_headroom'],
  analyze(ctx) {
    const regs = ctx.project.instances.filter((i) => ctx.fact(i.id, 'dropout_v'));
    if (regs.length === 0) return { findings: [], coverage: [] };
    if (!ctx.hasPower) return { findings: [], coverage: [{ dimension: 'regulator_headroom', group: 'electrical', status: 'not_evaluated', note: 'No power source' }] };
    const findings = [] as ReturnType<typeof finding>[];
    const notes: string[] = []; const metrics = [] as { key: string; label: string; value: number; unit: string; provenance: 'fixture_assumption' | 'user' | 'vetted_source'; group: 'electrical' }[];
    for (const reg of regs) {
      const comp = ctx.comp(reg.id)!;
      const inPin = comp.pins.find((p) => p.role === 'supply_in'); const outPin = comp.pins.find((p) => p.role === 'supply_out');
      const inNet = inPin && ctx.netOf(reg.id, inPin.name); const outNet = outPin && ctx.netOf(reg.id, outPin.name);
      const vin = inNet && ctx.voltage(inNet.id); const vout = outNet && ctx.voltage(outNet.id);
      const dropout = ctx.fact(reg.id, 'dropout_v')!;
      if (!vin || !vout) {
        findings.push(finding({ ruleId: 'regulator_headroom', basis: 'assumption', severity: 'unknown', category: 'voltage', title: `${reg.label}: input or output voltage unknown`, affected: [{ instanceId: reg.id }],
          evidence: [{ label: 'input', value: vin ? fmtV(vin.min) : 'unknown', provenance: vin ? vin.provenance : 'unknown' }, { label: 'output', value: vout ? fmtV(vout.nominal) : 'unknown', provenance: vout ? vout.provenance : 'unknown' }],
          consequence: 'Headroom cannot be estimated.', remediation: [`Wire the regulator input to a source so ${inNet?.name ?? 'its input'} has a known voltage`], missing: ['regulator input voltage'] }));
        continue;
      }
      const margin = vin.min - vout.nominal;
      metrics.push({ key: `headroom_v:${reg.id}`, label: `${reg.label} headroom at battery cutoff`, value: Math.round(margin * 100) / 100, unit: 'V', provenance: vin.provenance === 'vetted_source' && vout.provenance === 'user' ? 'user' : 'fixture_assumption', group: 'electrical' });
      const ev = [
        { label: `${inNet!.name} minimum (via ${vin.via})`, value: fmtV(vin.min), provenance: vin.provenance },
        { label: `${outNet!.name} setting`, value: fmtV(vout.nominal), provenance: ctx.prop(reg.id, 'outputV')?.provenance ?? 'fixture_assumption' },
        { label: 'assumed dropout', value: fmtV(dropout.value), provenance: dropout.provenance },
        { label: 'margin at end of discharge', value: fmtV(margin), provenance: vin.provenance },
      ];
      if (margin < 0) {
        findings.push(finding({
          ruleId: 'regulator_headroom', basis: 'component_spec', severity: 'violation', category: 'voltage',
          title: `${reg.label} is set to ${fmtV(vout.nominal)} but its input is only ${fmtV(vin.min)} at the battery cutoff: a buck cannot step up`, affected: [{ instanceId: reg.id, netId: inNet!.id }], evidence: ev,
          consequence: `The output can never reach its setting; it follows the input minus the dropout, so everything on ${outNet!.name} runs below the voltage the design assumes.`,
          remediation: ['Lower the output setting below the input minimum', 'Use a battery with more cells', 'Use a boost or buck-boost regulator if a higher output is required'],
        }));
      } else if (margin < dropout.value) {
        findings.push(finding({
          ruleId: 'regulator_headroom', basis: 'assumption', severity: 'warning', category: 'voltage',
          title: `${reg.label} has ${fmtV(margin)} of headroom at end of discharge; needs about ${fmtV(dropout.value)}`, affected: [{ instanceId: reg.id, netId: inNet!.id }],
          evidence: ev,
          consequence: `Near the battery cutoff the regulator drops out and the ${outNet!.name} rail sags under motor load. Downstream logic can brown out and reset while the battery still shows charge.`,
          remediation: ['Use a battery with more cells or a higher cutoff', 'Remove series voltage drops before the regulator, for example with a P-channel MOSFET instead of a diode', 'Lower the output setting if every load allows it', 'Replace the class with an exact module whose measured dropout is lower'],
        }));
      } else notes.push(`${reg.label}: ${fmtV(margin)} margin vs ${fmtV(dropout.value)} assumed dropout`);
    }
    return { findings, metrics, coverage: [{ dimension: 'regulator_headroom', group: 'electrical', status: 'estimated', note: notes.join('; ') || 'From assumed dropout and battery cutoff' }] };
  },
};
