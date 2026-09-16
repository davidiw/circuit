import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { layout, type LayoutNode } from '../layout';

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const withMargins = (n: LayoutNode): Box => ({ x: n.x, y: n.y - n.margin.top, w: n.w, h: n.h + n.margin.top + n.margin.bottom });
/** Approximate text boxes the renderer draws for a node: pin names, flags, title. */
function labelBoxes(n: LayoutNode): { id: string; box: Box }[] {
  const out: { id: string; box: Box }[] = [{ id: `${n.id}:title`, box: { x: n.x + 8, y: n.y + n.head - 26, w: n.label.length * 6.5, h: 12 } }];
  for (const p of n.pins) {
    const x = n.x + p.x, y = n.y + p.y, w = p.name.length * 5.4;
    if (p.side === 'west') out.push({ id: `${n.id}.${p.name}`, box: { x: x + 6, y: y - 4, w, h: 9 } });
    else if (p.side === 'east') out.push({ id: `${n.id}.${p.name}`, box: { x: x - 6 - w, y: y - 4, w, h: 9 } });
    else out.push({ id: `${n.id}.${p.name}`, box: { x: x - w / 2, y: p.side === 'north' ? y + 2 : y - 12, w, h: 9 } });
  }
  return out;
}

describe('layout (elk)', () => {
  for (const t of templates) it(`${t.id}: nodes apart, nets routed, wires clear of boxes and flags, labels apart`, async () => {
    const l = await layout(t, registry);
    expect(l.nodes.map((n) => n.id).sort()).toEqual(t.instances.map((i) => i.id).sort());
    for (const a of l.nodes) for (const b of l.nodes) if (a !== b) expect(overlaps(withMargins(a), withMargins(b)), `${a.id} overlaps ${b.id}`).toBe(false);
    const flags = new Set(l.rails.map((r) => r.netId)); const routed = new Set(l.edges.map((e) => e.netId));
    for (const n of t.nets) if (n.pins.length >= 2 && !flags.has(n.id)) expect(routed.has(n.id), `${n.id} routed`).toBe(true);
    // No wire segment passes through a node box or its flag margin, except the stub that touches its own endpoint pins.
    for (const e of l.edges) for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], b = e.points[i]; const seg: Box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
      for (const n of l.nodes) {
        if (n.id === e.from.nodeId || n.id === e.to.nodeId) { if (i === 1 || i === e.points.length - 1) continue; }
        const box = withMargins(n); const inner = { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 };
        expect(overlaps(seg, inner), `${e.netId} segment ${i} crosses ${n.id}`).toBe(false);
      }
    }
    // Text labels inside one node do not overlap each other.
    for (const n of l.nodes) { const boxes = labelBoxes(n); for (const a of boxes) for (const b of boxes) if (a.id < b.id) expect(overlaps(a.box, b.box), `${a.id} label overlaps ${b.id}`).toBe(false); }
    expect(l.width).toBeGreaterThan(0); expect(l.height).toBeGreaterThan(0);
  });
});
