import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { layout } from '../layout';

describe('layout', () => {
  for (const t of templates) it(`${t.id} places every instance and routes every net`, () => {
    for (const cols of [6, 3] as const) {
      const l = layout(t, registry, { columns: cols });
      expect(l.nodes.map((n) => n.id).sort()).toEqual(t.instances.map((i) => i.id).sort());
      const routed = new Set([...l.buses.map((b) => b.netId), ...l.edges.map((e) => e.netId)]);
      for (const n of t.nets) if (n.pins.length >= 2) expect(routed.has(n.id), `${n.id} at ${cols} cols`).toBe(true);
      expect(l.width).toBeGreaterThan(0); expect(l.height).toBeGreaterThan(0);
    }
  });
});
