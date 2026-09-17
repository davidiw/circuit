import { finding, freeGpio, type Rule } from '../context';
import type { Finding } from '../../model/schema';

/**
 * A part's internals: an output pin only does its job when the pins it is made from are wired. The registry declares those
 * relationships per component (pin_dependencies): a motor driver's channel outputs need that channel's speed and direction
 * inputs and the supplies; a regulator's output needs its input; a diode, capacitor, motor, speaker, or switch with one end
 * open does nothing. A wired output whose required pins are unwired is a violation. A part with no wired pin at all is a
 * warning: it is in the design but connected to nothing. An unwired output needs nothing (an unused channel is fine).
 */
export const pin_dependencies: Rule = {
  id: 'pin_dependencies', origin: 'deterministic', dimensions: ['pin_dependencies'],
  analyze(ctx) {
    const findings: Finding[] = []; const notes: string[] = []; let parts = 0;
    const wired = (inst: string, pin: string) => { const n = ctx.netOf(inst, pin); return !!n && n.pins.length >= 2; };
    for (const inst of ctx.project.instances) {
      const comp = ctx.comp(inst.id); if (!comp) continue;
      const anyWired = comp.pins.some((p) => wired(inst.id, p.name));
      if (!anyWired && comp.pins.length > 0) {
        findings.push(finding({
          ruleId: 'pin_dependencies', basis: 'component_spec', severity: 'warning', category: 'load_path',
          title: `${inst.label} is not connected to anything`, affected: [{ instanceId: inst.id }],
          evidence: [{ label: 'wired pins', value: 'none', provenance: 'user' }, { label: 'pins on the part', value: comp.pins.map((p) => p.name).join(', '), provenance: comp.verification_status.startsWith('vetted') ? 'vetted_source' : 'fixture_assumption' }],
          consequence: 'The part is in the design but takes no part in the circuit. Nothing it provides reaches anything else.',
          remediation: ['Wire its pins, or remove the part if it is not needed'],
          fixes: [{ label: `Remove ${inst.label}`, ops: [...(ctx.project.power.sourceInstance === inst.id ? [{ op: 'clear_power_source' as const }] : []), { op: 'remove_instance' as const, instance: inst.id }], kind: 'edit' as const }],
        }));
        continue;
      }
      if (!comp.pin_dependencies.length) continue;
      parts++;
      // Group outputs that share a requirement list (a driver channel's two outputs) so they read as one finding. The title
      // names the outputs, which is stable while they stay wired; the missing pins go in evidence and the consequence, so
      // wiring one of several missing inputs updates the finding instead of replacing it.
      const groups = new Map<string, { outputs: string[]; missing: string[]; why: string }>();
      for (const d of comp.pin_dependencies) {
        if (!wired(inst.id, d.pin)) continue;
        const missing = d.requires.filter((r) => !wired(inst.id, r)); if (!missing.length) continue;
        const key = [...d.requires].sort().join('+'); const g = groups.get(key) ?? { outputs: [], missing: [], why: d.why };
        g.outputs.push(d.pin); for (const m of missing) if (!g.missing.includes(m)) g.missing.push(m); groups.set(key, g);
      }
      for (const g of groups.values()) {
        const outs = g.outputs.join(' and '); const miss = g.missing.join(' and ');
        const board = ctx.instancesOfKind('dev_board')[0];
        const logicInputs = g.missing.filter((m) => ['logic_in', 'enable_in'].includes(ctx.pinDef(inst.id, m)?.role ?? ''));
        const fixes: Finding['fixes'] = [{ label: `Leave ${outs} unconnected`, ops: g.outputs.map((o) => ({ op: 'move_pin' as const, instance: inst.id, pin: o, net: null })), kind: 'edit' as const }];
        if (board && board.id !== inst.id && logicInputs.length) {
          // Wire each missing logic input to its own free GPIO, one op pair per input, only if enough free pins exist.
          const used = new Set<string>(); const ops: Finding['fixes'][number]['ops'] = []; const names: string[] = [];
          for (const m of logicInputs) { const gpio = (ctx.comp(board.id)?.pins ?? []).find((p) => p.role === 'gpio' && !ctx.netOf(board.id, p.name) && !used.has(p.name))?.name ?? (used.size ? undefined : freeGpio(ctx, board.id)); if (!gpio) break; used.add(gpio); names.push(`${m} to ${gpio}`); const net = `${inst.id}_${m}_${gpio}`; ops.push({ op: 'move_pin', instance: inst.id, pin: m, net, name: m, kind: 'signal' }, { op: 'move_pin', instance: board.id, pin: gpio, net }); }
          if (names.length === logicInputs.length) fixes.unshift({ label: `Wire ${names.join(', ')} on ${board.label}`, ops, kind: 'edit' });
        }
        findings.push(finding({
          ruleId: 'pin_dependencies', basis: 'component_spec', severity: 'violation', category: 'load_path',
          title: `${inst.label}: ${outs} ${g.outputs.length > 1 ? 'are wired but not everything they depend on is' : 'is wired but not everything it depends on is'}`,
          // Identity is the wired outputs: which inputs are missing is evidence, so wiring one of several updates this finding instead of replacing it.
          affected: g.outputs.map((o) => ({ instanceId: inst.id, pin: o, netId: ctx.netOf(inst.id, o)?.id })),
          evidence: [
            { label: `${g.outputs.length > 1 ? 'outputs' : 'output'} wired`, value: g.outputs.map((o) => `${o} on ${ctx.netOf(inst.id, o)?.name}`).join(', '), provenance: 'user' },
            { label: 'unwired', value: miss, provenance: 'user' },
            { label: 'how this part works', value: g.why, provenance: comp.verification_status.startsWith('vetted') ? 'vetted_source' : 'fixture_assumption' },
          ],
          consequence: `${miss} ${g.missing.length > 1 ? 'are' : 'is'} not wired. Whatever is connected to ${outs} depends on ${g.missing.length > 1 ? 'them' : 'it'} inside this part, so ${outs} cannot do ${g.outputs.length > 1 ? 'their' : 'its'} job: ${g.why}.`,
          remediation: [`Wire ${miss}${logicInputs.length ? ' (logic inputs go to controller GPIOs)' : ''}`, `Or leave ${outs} unconnected if this part of the circuit is not used`],
          fixes,
        }));
      }
    }
    return { findings, coverage: parts ? [{ dimension: 'pin_dependencies', group: 'electrical', status: 'checked', note: notes.join('; ') || `internal input-to-output relationships checked on ${parts} part${parts > 1 ? 's' : ''}` }] : [] };
  },
};
