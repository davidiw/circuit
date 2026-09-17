import { finding, type Rule } from '../context';
import { ROLE_TO_KICAD } from '../erc';

/** A net whose pins are all inputs, power inputs, or passives has nothing driving it (KiCad ERC "undriven net"). Single-pin nets are reported the same way. */
export const undriven_net: Rule = {
  id: 'undriven_net', origin: 'deterministic', dimensions: ['undriven_nets'],
  analyze(ctx) {
    const findings = [] as ReturnType<typeof finding>[];
    if (!ctx.hasPower) return { findings, coverage: [{ dimension: 'undriven_nets', group: 'electrical', status: 'not_evaluated', note: 'No power source; every net is undriven until one is added' }] };
    for (const net of ctx.project.nets) {
      const pins = ctx.netPins(net);
      if (!pins.length || net.kind === 'ground') continue;                                   // a ground net is the reference, not a driven node
      // A pin drives a net if its type drives in ERC terms, or if the registry derives a voltage for it (a diode cathode fed from its anode).
      const drivers = pins.filter((p) => ['O', 'PwrO', 'Bi', 'OC', 'OE', '3S'].includes(ROLE_TO_KICAD[p.def.role]) || !!p.def.output);
      if (drivers.length) continue;
      const label = (p: { instance: string; pin: string }) => `${ctx.inst(p.instance)?.label ?? p.instance} ${p.pin}`;
      const passiveOnly = pins.every((p) => ROLE_TO_KICAD[p.def.role] === 'Pas');
      findings.push(finding({
        ruleId: 'undriven_net', basis: 'component_spec', severity: pins.length === 1 ? 'warning' : passiveOnly ? 'unknown' : 'warning', category: 'load_path',
        title: pins.length === 1 ? `${label(pins[0])} is the only pin on ${net.name}` : `Nothing drives ${net.name}: ${pins.map(label).join(', ')}`,
        affected: pins.map((p) => ({ instanceId: p.instance, pin: p.pin, netId: net.id })),
        evidence: [{ label: `pins on ${net.name}`, value: pins.map((p) => `${label(p)} (${p.def.role.replace('_', ' ')})`).join(', '), provenance: 'user' }],
        consequence: pins.length === 1 ? 'A wire to nowhere. The pin behaves as unconnected.' : passiveOnly ? 'Only passive terminals share this node; whether that is intended depends on the circuit, and no source or output sets its voltage.' : 'Inputs and supply pins on this node have no source or output setting their level; they float.',
        remediation: ['Connect a source, an output, or a GPIO to this net', 'Or disconnect the pins if the net is a leftover'],
      }));
    }
    return { findings, coverage: [{ dimension: 'undriven_nets', group: 'electrical', status: 'checked', note: 'every non-ground net has a driver' }] };
  },
};
