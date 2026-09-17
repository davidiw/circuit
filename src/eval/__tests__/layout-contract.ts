import { expect } from 'vitest';
import type { Project, Registry } from '../../model/schema';
import type { Layout } from '../layout';

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/**
 * What any layout owes the renderer, for any structurally valid project: every number finite, every node an instance that
 * exists, every edge endpoint a real pin on a real part that sits on the edge's net, and a positive canvas when there is
 * anything to draw. Ugly routing is allowed; a NaN, a missing node, or a dangling pin is not.
 */
export function assertLayoutInvariants(l: Layout, p: Project, registry: Registry, where = '') {
  const ctx = (s: string) => `${where} ${s}`.trim();
  const instIds = new Set(p.instances.map((i) => i.id));
  const pinExists = (inst: string, pin: string) => { const i = p.instances.find((x) => x.id === inst); const c = i && registry.components.find((x) => x.id === i.registryId); return !!c && c.pins.some((x) => x.name === pin); };
  const onNet = (netId: string, inst: string, pin: string) => p.nets.some((n) => n.id === netId && n.pins.some((x) => x.instance === inst && x.pin === pin));

  expect(new Set(l.nodes.map((n) => n.id)), ctx('layout nodes are exactly the instances')).toEqual(instIds);
  if (p.instances.length > 0) { expect(finite(l.width) && l.width > 0, ctx(`width ${l.width}`)).toBe(true); expect(finite(l.height) && l.height > 0, ctx(`height ${l.height}`)).toBe(true); }
  else { expect(finite(l.width) && finite(l.height), ctx('empty canvas dimensions finite')).toBe(true); }
  for (const n of l.nodes) {
    for (const [k, v] of [['x', n.x], ['y', n.y], ['w', n.w], ['h', n.h], ['head', n.head], ['margin.top', n.margin.top], ['margin.bottom', n.margin.bottom]] as const) expect(finite(v), ctx(`${n.id}.${k} = ${v}`)).toBe(true);
    expect(n.w > 0 && n.h > 0, ctx(`${n.id} has positive size`)).toBe(true);
    const seen = new Set<string>();
    for (const q of n.pins) {
      expect(finite(q.x) && finite(q.y), ctx(`${n.id}.${q.name} position`)).toBe(true);
      expect(pinExists(n.id, q.name), ctx(`${n.id}.${q.name} exists on the part`)).toBe(true);
      expect(seen.has(q.name), ctx(`${n.id}.${q.name} drawn twice`)).toBe(false); seen.add(q.name);
      if (q.netId) expect(onNet(q.netId, n.id, q.name), ctx(`${n.id}.${q.name} sits on ${q.netId}`)).toBe(true);
    }
  }
  const netIds = new Set(p.nets.map((n) => n.id));
  for (const e of l.edges) {
    expect(netIds.has(e.netId), ctx(`edge net ${e.netId} exists`)).toBe(true);
    expect(e.points.length, ctx(`edge ${e.netId} has at least two points`)).toBeGreaterThanOrEqual(2);
    for (const pt of e.points) expect(finite(pt.x) && finite(pt.y), ctx(`edge ${e.netId} point ${JSON.stringify(pt)}`)).toBe(true);
    if (e.label) expect(finite(e.label.x) && finite(e.label.y), ctx(`edge ${e.netId} label`)).toBe(true);
    for (const end of [e.from, e.to]) {
      expect(instIds.has(end.nodeId), ctx(`edge ${e.netId} endpoint ${end.nodeId} is an instance`)).toBe(true);
      expect(pinExists(end.nodeId, end.pin), ctx(`edge ${e.netId} endpoint ${end.nodeId}.${end.pin} is a real pin`)).toBe(true);
      expect(onNet(e.netId, end.nodeId, end.pin), ctx(`edge ${e.netId} endpoint ${end.nodeId}.${end.pin} is on that net`)).toBe(true);
    }
  }
  for (const h of l.hops) { expect(finite(h.x) && finite(h.y), ctx('hop position')).toBe(true); expect(netIds.has(h.netId), ctx(`hop net ${h.netId}`)).toBe(true); }
  for (const j of l.junctions) { expect(finite(j.x) && finite(j.y), ctx('junction position')).toBe(true); expect(netIds.has(j.netId), ctx(`junction net ${j.netId}`)).toBe(true); }
  for (const r of l.rails) expect(netIds.has(r.netId), ctx(`rail net ${r.netId}`)).toBe(true);
  // Every pin the layout places belongs to a net the project has (an unconnected pin is never drawn).
  for (const n of l.nodes) for (const q of n.pins) expect(q.netId && netIds.has(q.netId), ctx(`${n.id}.${q.name} placed without a net`)).toBeTruthy();
}
