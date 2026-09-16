import { finding, type Rule } from '../context';

/** Local decoupling on every supplied part: onboard on modules and breakouts (a board feature with provenance), else a small capacitor on the supply net. */
export const decoupling: Rule = {
  id: 'decoupling', origin: 'deterministic', dimensions: ['decoupling'],
  analyze(ctx) {
    const findings = [] as ReturnType<typeof finding>[];
    const notes: string[] = []; let checked = 0; let unknown = 0;
    for (const inst of ctx.project.instances) {
      const comp = ctx.comp(inst.id); if (!comp) continue;
      const supplyPins = comp.pins.filter((p) => p.role === 'supply_in' && ctx.netOf(inst.id, p.name));
      if (!supplyPins.length) continue;
      checked++;
      if (comp.board_features.includes('onboard_decoupling')) { notes.push(`${inst.label}: onboard`); continue; }
      for (const pin of supplyPins) {
        const net = ctx.netOf(inst.id, pin.name)!;
        const caps = ctx.netPins(net).filter((p) => p.def.role === 'cap_pos').map((p) => ({ id: p.instance, uf: ctx.fact(p.instance, 'capacitance_uf')?.value }));
        const local = caps.filter((c) => c.uf !== undefined && c.uf <= 10);
        if (local.length) { notes.push(`${inst.label} ${pin.name}: ${local.map((c) => `${c.id} ${c.uf} uF`).join(', ')}`); continue; }
        const req = comp.facts['requires_external_decoupling'];
        const known = req && req.value === true;
        if (!known) unknown++;
        findings.push(finding({
          ruleId: 'decoupling', basis: known ? 'component_spec' : 'heuristic', severity: known ? 'warning' : 'unknown', category: 'transients',
          title: known ? `${inst.label} ${pin.name} has no local decoupling capacitor` : `${inst.label} ${pin.name}: decoupling provision unknown`,
          affected: [{ instanceId: inst.id, pin: pin.name, netId: net.id }],
          evidence: [
            { label: 'board_features', value: comp.board_features.join(', ') || 'none', provenance: comp.verification_status.startsWith('vetted') ? 'vetted_source' : 'fixture_assumption' },
            { label: 'requires_external_decoupling', value: String(req?.value ?? 'not stated'), provenance: req?.provenance ?? 'unknown' },
            { label: `capacitors on ${net.name}`, value: caps.length ? caps.map((c) => `${c.id} ${c.uf ?? '?'} uF`).join(', ') : 'none', provenance: 'user' },
          ],
          consequence: known ? 'Supply transients at the part reach the die unfiltered; the datasheet application circuit assumes local capacitors. Expect resets or erratic switching under motor load.' : 'Whether this part needs an external capacitor is not recorded in the registry.',
          remediation: known ? ['Add a 0.1 uF ceramic across the supply pin and ground, as close to the part as possible', 'Or use a breakout that carries the decoupling on the board'] : ['Record the part\'s decoupling requirement in the registry with a source'],
          missing: known ? undefined : ['decoupling requirement'],
          fixes: (() => {
            if (!known) return [];
            const gnd = ctx.project.nets.filter((n) => n.kind === 'ground').sort((a, b) => b.pins.length - a.pins.length)[0]; if (!gnd) return [];
            let n = 1; while (ctx.project.instances.some((i) => i.id === `c_dec${n}`)) n++;
            const id = `c_dec${n}`;
            return [{ label: `Add a 0.1 uF ceramic at ${inst.label} ${pin.name}`, kind: 'edit' as const, ops: [{ op: 'add_instance' as const, id, registryId: 'cap.ceramic_100nf_class', label: `Decoupling for ${inst.label}` }, { op: 'move_pin' as const, instance: id, pin: '+', net: net.id }, { op: 'move_pin' as const, instance: id, pin: '-', net: gnd.id }] }];
          })(),
        }));
      }
    }
    return { findings, coverage: checked ? [{ dimension: 'decoupling', group: 'electrical', status: unknown ? 'partial' : 'checked', note: notes.join('; ') || 'supplied parts checked' }] : [] };
  },
};
