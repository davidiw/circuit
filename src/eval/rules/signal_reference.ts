import { finding, type Rule } from '../context';
import type { Net } from '../../model/schema';

/** Every pair of instances that exchange a signal or share a supply must share a reference net. */
export const signal_reference: Rule = {
  id: 'signal_reference', origin: 'deterministic', dimensions: ['signal_reference'],
  analyze(ctx) {
    const refNets = new Map<string, Set<string>>(); // instance -> ids of nets carrying one of its ground pins
    for (const inst of ctx.project.instances) {
      const comp = ctx.comp(inst.id); if (!comp) continue;
      const set = new Set<string>();
      for (const pin of comp.pins) if (pin.role === 'ground') { const n = ctx.netOf(inst.id, pin.name); if (n) set.add(n.id); }
      refNets.set(inst.id, set);
    }
    const hasGroundPin = (id: string) => (ctx.comp(id)?.pins.some((p) => p.role === 'ground')) ?? false;
    const flagged = new Map<string, { net: Net; others: string[] }>();
    for (const net of ctx.project.nets) {
      if (net.kind === 'ground') continue;
      const members = [...new Set(net.pins.map((p) => p.instance))].filter(hasGroundPin);
      for (const a of members) for (const b of members) {
        if (a >= b) continue;
        const ra = refNets.get(a)!, rb = refNets.get(b)!;
        const shared = [...ra].some((n) => rb.has(n));
        if (shared) continue;
        // Blame the instance with the smaller reference set (the one split off); tie -> both.
        const victims = ra.size < rb.size ? [a] : rb.size < ra.size ? [b] : [a, b];
        for (const v of victims) { const other = v === a ? b : a; const cur = flagged.get(v); if (cur) cur.others.push(other); else flagged.set(v, { net, others: [other] }); }
      }
    }
    const findings = [...flagged.entries()].map(([id, { net, others }]) => finding({
      ruleId: 'signal_reference', basis: 'component_spec', severity: 'violation', category: 'reference',
      title: `${ctx.inst(id)!.label} shares no reference with ${others.map((o) => ctx.inst(o)!.label).join(', ')}`,
      affected: [{ instanceId: id, netId: net.id }, ...others.map((o) => ({ instanceId: o }))],
      evidence: [
        { label: `${id} ground nets`, value: [...refNets.get(id)!].join(', ') || 'none', provenance: 'user' },
        { label: 'shared net without common reference', value: net.name, provenance: 'user' },
      ],
      consequence: 'Signals and supplies between these parts have no defined return path. Logic levels are undefined and current returns through whatever path exists, if any.',
      remediation: ['Connect the ground pins of both parts to the same ground net'],
    }));
    return { findings, coverage: [{ dimension: 'signal_reference', group: 'electrical', status: 'checked', note: `${ctx.project.nets.filter((n) => n.kind !== 'ground').length} nets checked for a shared reference` }] };
  },
};
