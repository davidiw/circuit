import { finding, type Rule } from '../context';
import { ROLE_TO_KICAD, KICAD_TYPE_NAME, kicadVerdict } from '../erc';

/** Electrical rules check on every net: the KiCad default pin-type matrix. Errors are violations, warnings are warnings. One finding per net, listing the offending pairs. */
export const pin_type_conflict: Rule = {
  id: 'pin_type_conflict', origin: 'deterministic', dimensions: ['pin_type_conflicts'],
  analyze(ctx) {
    const findings = [] as ReturnType<typeof finding>[];
    for (const net of ctx.project.nets) {
      const pins = ctx.netPins(net);
      const label = (p: { instance: string; pin: string }) => `${ctx.inst(p.instance)?.label ?? p.instance} ${p.pin}`;
      const errs: string[] = []; const wars: string[] = []; const involved = new Set<string>();
      for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i], b = pins[j];
        const ta = ROLE_TO_KICAD[a.def.role], tb = ROLE_TO_KICAD[b.def.role]; const v = kicadVerdict(ta, tb);
        if (v === 'OK') continue;
        (v === 'ERR' ? errs : wars).push(`${label(a)} (${KICAD_TYPE_NAME[ta]}) with ${label(b)} (${KICAD_TYPE_NAME[tb]})`);
        involved.add(`${a.instance}.${a.pin}`); involved.add(`${b.instance}.${b.pin}`);
      }
      if (!errs.length && !wars.length) continue;
      const affected = pins.filter((p) => involved.has(`${p.instance}.${p.pin}`)).map((p) => ({ instanceId: p.instance, pin: p.pin, netId: net.id }));
      findings.push(finding({
        ruleId: 'pin_type_conflict', basis: 'component_spec', severity: errs.length ? 'violation' : 'warning', category: 'load_path',
        title: errs.length ? `Pin types conflict on ${net.name}: ${errs[0]}${errs.length > 1 ? ` and ${errs.length - 1} more` : ''}` : `Questionable pin pairing on ${net.name}: ${wars[0]}${wars.length > 1 ? ` and ${wars.length - 1} more` : ''}`,
        affected,
        evidence: [...errs.map((e) => ({ label: 'error pair', value: e, provenance: 'vetted_source' as const })), ...wars.map((w) => ({ label: 'warning pair', value: w, provenance: 'vetted_source' as const })), { label: 'basis', value: 'KiCad default ERC pin-type matrix', provenance: 'vetted_source' as const }],
        consequence: errs.length ? 'Two pins on this net both try to set its voltage. Whichever is stronger wins and the other carries the difference as a short: heat, a blown output stage, or a regulator in current limit.' : 'The pins on this net can work together only in a narrow case, usually a bidirectional pin used purely as an input. If either pin drives, they fight.',
        remediation: [`Separate ${errs.length ? errs[0].split(' with ')[0] : wars[0].split(' with ')[0]} onto its own net`, 'Wire outputs to inputs, and supplies to supply inputs; never output to output or output to supply'],
      }));
    }
    return { findings, coverage: [{ dimension: 'pin_type_conflicts', group: 'electrical', status: 'checked', note: `${ctx.project.nets.length} nets checked against the KiCad pin-type matrix` }] };
  },
};
