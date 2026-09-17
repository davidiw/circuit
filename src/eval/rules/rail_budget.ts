import { finding, fmtA, type Rule } from '../context';

/** Worst-case draw on a regulator versus its continuous capability. Coverage is partial whenever the limit is an assumption. */
export const rail_budget: Rule = {
  id: 'rail_budget', origin: 'deterministic', dimensions: ['regulator_current_thermal'],
  analyze(ctx) {
    const regs = ctx.project.instances.filter((i) => ctx.comp(i.id)?.kind !== 'battery_class' && (ctx.fact(i.id, 'continuous_output_a') || ctx.fact(i.id, 'continuous_current_a')));
    if (!regs.length) return { findings: [], coverage: [] };
    if (!ctx.hasPower) return { findings: [], coverage: [{ dimension: 'regulator_current_thermal', group: 'electrical', status: 'not_evaluated', note: 'No power source' }] };
    const findings = [] as ReturnType<typeof finding>[];
    const metrics = [] as { key: string; label: string; value: number; unit: string; provenance: 'vetted_source' | 'fixture_assumption' | 'user' | 'ai' | 'unknown'; group: 'electrical' }[];
    const cov = [] as { dimension: string; group: 'electrical'; status: 'checked' | 'partial'; note: string }[];
    for (const reg of regs) {
      const limit = ctx.fact(reg.id, 'continuous_output_a') ?? ctx.fact(reg.id, 'continuous_current_a')!;
      // Loads on this regulator's own output rail: parts whose supply input sits on it, plus the motors of any driver whose motor supply sits on it.
      const outPin = ctx.comp(reg.id)!.pins.find((p) => p.role === 'supply_out'); const outNet = outPin && ctx.netOf(reg.id, outPin.name);
      const onRail = (id: string) => !!outNet && ctx.comp(id)!.pins.some((p) => p.role === 'supply_in' && ctx.netOf(id, p.name)?.id === outNet.id);
      const parts: { label: string; value: number; provenance: string }[] = [];
      for (const d of ctx.instancesOfKind('motor_driver')) { if (!onRail(d.id)) continue; for (const m of ctx.instancesOfKind('dc_gearmotor')) { const pin = ctx.comp(m.id)!.pins[0]; const net = ctx.netOf(m.id, pin.name); if (!net || !ctx.netPins(net).some((q) => q.instance === d.id)) continue; const s = ctx.fact(m.id, 'stall_current_a'); if (s) parts.push({ label: `${m.id} stall`, value: s.value, provenance: s.provenance }); } }
      for (const b of ctx.instancesOfKind('dev_board')) { if (!onRail(b.id)) continue; const p = ctx.fact(b.id, 'peak_current_a'); if (p) parts.push({ label: `${b.id} peak`, value: p.value, provenance: p.provenance }); }
      for (const a of ctx.instancesOfKind('audio_amp_breakout')) { if (!onRail(a.id)) continue; const w = ctx.fact(a.id, 'output_power_w'); if (w) parts.push({ label: `${a.id} at 5 V`, value: w.value / 5, provenance: w.provenance }); }
      const total = parts.reduce((s, p) => s + p.value, 0);
      const thermalUnknown = ctx.comp(reg.id)!.facts['thermal_performance']?.provenance === 'unknown';
      const ev = [...parts.map((p) => ({ label: p.label, value: fmtA(p.value), provenance: p.provenance as never })), { label: `${reg.id} continuous limit`, value: fmtA(limit.value), provenance: limit.provenance }];
      if (total > limit.value) findings.push(finding({ ruleId: 'rail_budget', basis: limit.provenance === 'vetted_source' ? 'component_spec' : 'assumption', severity: 'warning', category: 'budget', title: `Worst-case draw ${fmtA(total)} exceeds ${reg.label} limit ${fmtA(limit.value)}`, affected: [{ instanceId: reg.id }], evidence: ev, consequence: 'Simultaneous stall plus radio peak overloads the regulator; expect voltage sag, thermal shutdown, or resets.', remediation: ['Choose a regulator with more continuous capability', 'Separate motor and logic rails'] }));
      metrics.push({ key: `worst_case_draw_a:${reg.id}`, label: `Worst-case draw on ${reg.label}`, value: Math.round(total * 100) / 100, unit: 'A', provenance: 'fixture_assumption', group: 'electrical' }, { key: `rail_limit_a:${reg.id}`, label: `${reg.label} continuous limit`, value: limit.value, unit: 'A', provenance: limit.provenance, group: 'electrical' });
      cov.push({ dimension: 'regulator_current_thermal', group: 'electrical', status: limit.provenance === 'vetted_source' && !thermalUnknown ? 'checked' : 'partial', note: `${fmtA(total)} worst case of ${fmtA(limit.value)} ${limit.provenance === 'vetted_source' ? 'rated' : 'assumed'}${thermalUnknown ? '; thermal behavior of this class unknown' : ''}` });
    }
    return { findings, coverage: cov, metrics };
  },
};
