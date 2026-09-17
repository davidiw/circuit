import type { Project, Registry } from './schema';

/** Referential integrity beyond the schema: every id points at something real. Run at every boundary where a project enters state (import, storage, server). */
export function integrityProblems(p: Project, registry: Registry): string[] {
  const out: string[] = [];
  const comps = new Map(registry.components.map((c) => [c.id, c]));
  const inst = new Map(p.instances.map((i) => [i.id, i]));
  const seenInst = new Set<string>();
  for (const i of p.instances) {
    if (seenInst.has(i.id)) out.push(`duplicate instance id ${i.id}`); seenInst.add(i.id);
    if (!comps.has(i.registryId)) out.push(`instance ${i.id} references unknown registry part ${i.registryId}`);
  }
  const seenPin = new Set<string>(); const seenNet = new Set<string>();
  for (const n of p.nets) {
    if (seenNet.has(n.id)) out.push(`duplicate net id ${n.id}`); seenNet.add(n.id);
    if (!n.pins.length) out.push(`net ${n.id} has no pins`);
    for (const pin of n.pins) {
      const key = `${pin.instance}.${pin.pin}`;
      if (seenPin.has(key)) out.push(`${key} is on more than one net`); seenPin.add(key);
      const i = inst.get(pin.instance); if (!i) { out.push(`net ${n.id} references missing instance ${pin.instance}`); continue; }
      const c = comps.get(i.registryId); if (c && !c.pins.some((x) => x.name === pin.pin)) out.push(`${key} is not a pin of ${c.id}`);
    }
  }
  if (p.power.sourceInstance && !inst.has(p.power.sourceInstance)) out.push(`power source ${p.power.sourceInstance} is not an instance`);
  return out;
}
