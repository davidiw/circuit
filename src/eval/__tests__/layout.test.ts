import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { layout } from '../layout';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layout (elk)', () => {
  for (const t of templates) it(`${t.id}: every instance placed, no node overlap, every non-rail net routed, wires clear of boxes`, async () => {
    const l = await layout(t, registry);
    expect(l.nodes.map((n) => n.id).sort()).toEqual(t.instances.map((i) => i.id).sort());
    for (const a of l.nodes) for (const b of l.nodes) if (a !== b) expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
    const rail = new Set(l.rails.map((r) => r.netId));
    const routed = new Set(l.edges.map((e) => e.netId));
    for (const n of t.nets) if (n.pins.length >= 2 && !rail.has(n.id)) expect(routed.has(n.id), `${n.id} routed`).toBe(true);
    // Every interior wire point lies outside every node box (endpoints touch their own node).
    for (const e of l.edges) for (const p of e.points.slice(1, -1)) for (const n of l.nodes) {
      const inside = p.x > n.x + 1 && p.x < n.x + n.w - 1 && p.y > n.y + 1 && p.y < n.y + n.h - 1;
      expect(inside, `${e.netId} bend inside ${n.id}`).toBe(false);
    }
    expect(l.width).toBeGreaterThan(0); expect(l.height).toBeGreaterThan(0);
  });
});
