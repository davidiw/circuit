import { finding, type Rule } from '../context';
import type { PinRole } from '../../model/schema';

const SOURCE: PinRole[] = ['supply_out', 'battery_pos'];
const DRIVEN_OUT: PinRole[] = ['logic_out', 'analog_out', 'cathode', 'speaker_out'];

/** Ground-side conflicts the KiCad matrix cannot express because a ground pin is a power input there: a supply or driven output shorted to ground, a supply input alone on ground, a GPIO tied to ground. Everything else is the pin_type_conflict rule. */
export const net_conflict: Rule = {
  id: 'net_conflict', origin: 'deterministic', dimensions: ['net_conflicts'],
  analyze(ctx) {
    const findings = [] as ReturnType<typeof finding>[];
    for (const net of ctx.project.nets) {
      const pins = ctx.netPins(net);
      const by = (roles: PinRole[]) => pins.filter((p) => roles.includes(p.def.role));
      const sources = by(SOURCE), grounds = by(['ground']), outs = by(DRIVEN_OUT), motorOuts = by(['motor_out']), gpios = by(['gpio']), supplyIns = by(['supply_in']);
      const driven = [...outs, ...motorOuts];
      const label = (p: { instance: string; pin: string }) => `${ctx.inst(p.instance)?.label ?? p.instance} ${p.pin}`;
      const affected = (xs: typeof pins) => xs.map((p) => ({ instanceId: p.instance, pin: p.pin, netId: net.id }));
      const evidence = [{ label: `pins on ${net.name}`, value: pins.map((p) => `${label(p)} (${p.def.role.replace('_', ' ')})`).join(', '), provenance: 'user' as const }];
      if ((sources.length || driven.length) && grounds.length) findings.push(finding({ ruleId: 'net_conflict', basis: 'component_spec', severity: 'violation', category: 'load_path', title: `${[...sources, ...driven].map(label).join(', ')} shorted to ground on ${net.name}`, affected: affected([...sources, ...driven, ...grounds]), evidence, consequence: 'A direct short. The source delivers its maximum current into the ground return until something opens: a fuse, a trace, or the part.', remediation: ['Disconnect the ground pin from this net', 'Route the source to a load input, not to a ground pin'] }));
      if (supplyIns.length && grounds.length && !sources.length) findings.push(finding({ ruleId: 'net_conflict', basis: 'component_spec', severity: 'violation', category: 'load_path', title: `${supplyIns.map(label).join(', ')} tied to ground on ${net.name}`, affected: affected([...supplyIns, ...grounds]), evidence, consequence: 'The supply input sits at 0 V: the part is unpowered, and if a source is later added to this net it is shorted.', remediation: ['Connect the supply input to a power rail instead'] }));
      if (gpios.length && grounds.length) findings.push(finding({ ruleId: 'net_conflict', basis: 'heuristic', severity: 'warning', category: 'load_path', title: `${gpios.map(label).join(', ')} tied directly to ground on ${net.name}`, affected: affected([...gpios, ...grounds]), evidence, consequence: 'A GPIO driven as an output against a rail is a short through the pin; as an input it reads a fixed level, which may be intended. The rules cannot tell which the firmware does.', remediation: ['Read a fixed level through a resistor or use a dedicated enable pin', 'If the pin is meant to control something, connect it to a logic input instead'] }));
    }
    return { findings, coverage: [{ dimension: 'net_conflicts', group: 'electrical', status: 'checked', note: `${ctx.project.nets.length} nets checked for shorts to ground and GPIO on ground` }] };
  },
};
