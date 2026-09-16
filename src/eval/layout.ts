import type { Project, Registry, PinRole } from '../model/schema';

/** Pure geometry for the system diagram. The renderer only draws what this returns. */
export type LayoutPin = { name: string; role: PinRole; side: 'left' | 'right'; x: number; y: number; netId?: string };
export type LayoutNode = { id: string; label: string; sub: string; kind: string; x: number; y: number; w: number; h: number; pins: LayoutPin[] };
export type LayoutBus = { netId: string; name: string; kind: 'power' | 'ground'; y: number; x1: number; x2: number; taps: { x: number; y: number; nodeId: string; pin: string }[] };
export type LayoutEdge = { netId: string; name: string; kind: string; points: { x: number; y: number }[]; from: { nodeId: string; pin: string }; to: { nodeId: string; pin: string } };
export type Layout = { width: number; height: number; nodes: LayoutNode[]; buses: LayoutBus[]; edges: LayoutEdge[] };

const COLUMN_OF_KIND: Record<string, number> = {
  battery_class: 0, dc_supply_class: 0,
  schottky_diode: 1,
  buck_module_class: 2, capacitor_class: 2,
  dev_board: 3,
  motor_driver: 4, audio_amp_breakout: 4,
  dc_gearmotor: 5, speaker_class: 5, camera_module: 5, water_sensor_module: 5, switch_class: 5,
};
const RIGHT_ROLES: PinRole[] = ['supply_out', 'battery_pos', 'motor_out', 'gpio', 'cathode', 'analog_out', 'speaker_out', 'cap_pos', 'csi', 'i2s', 'logic_out'];
const NODE_W = 150, PIN_H = 13, HEAD_H = 30, COL_GAP = 60, ROW_GAP = 28, MARGIN = 16;

export function layout(project: Project, registry: Registry, opts: { columns?: 6 | 3 } = {}): Layout {
  const cols = opts.columns ?? 6;
  const comp = (rid: string) => registry.components.find((c) => c.id === rid);
  const netOfPin = new Map<string, string>();
  for (const n of project.nets) for (const p of n.pins) netOfPin.set(`${p.instance}.${p.pin}`, n.id);

  // Buses: power/ground nets with 3+ pins. Power buses at top, ground at bottom.
  const busNets = project.nets.filter((n) => (n.kind === 'power' || n.kind === 'ground') && n.pins.length >= 3);
  const topBuses = busNets.filter((n) => n.kind === 'power');
  const bottomBuses = busNets.filter((n) => n.kind === 'ground');
  const busIds = new Set(busNets.map((n) => n.id));
  const topH = MARGIN + topBuses.length * 16;

  // Nodes
  const byCol = new Map<number, LayoutNode[]>();
  const nodes: LayoutNode[] = [];
  for (const inst of project.instances) {
    const c = comp(inst.registryId);
    const kind = c?.kind ?? 'unknown';
    let col = COLUMN_OF_KIND[kind] ?? 5;
    if (cols === 3) col = Math.floor(col / 2);
    const usedPins = (c?.pins ?? []).filter((p) => netOfPin.has(`${inst.id}.${p.name}`));
    const left = usedPins.filter((p) => !RIGHT_ROLES.includes(p.role) || (p.role === 'gpio' && col === 5));
    const right = usedPins.filter((p) => !left.includes(p));
    const rows = Math.max(left.length, right.length, 1);
    const node: LayoutNode = { id: inst.id, label: inst.label, sub: c?.label ?? inst.registryId, kind, x: 0, y: 0, w: NODE_W, h: HEAD_H + rows * PIN_H + 6, pins: [] };
    left.forEach((p, i) => node.pins.push({ name: p.name, role: p.role, side: 'left', x: 0, y: HEAD_H + i * PIN_H + 8, netId: netOfPin.get(`${inst.id}.${p.name}`) }));
    right.forEach((p, i) => node.pins.push({ name: p.name, role: p.role, side: 'right', x: NODE_W, y: HEAD_H + i * PIN_H + 8, netId: netOfPin.get(`${inst.id}.${p.name}`) }));
    nodes.push(node);
    byCol.set(col, [...(byCol.get(col) ?? []), node]);
  }
  let maxBottom = topH;
  for (const [col, list] of byCol) {
    let y = topH + 24;
    for (const n of list) { n.x = MARGIN + col * (NODE_W + COL_GAP); n.y = y; y += n.h + ROW_GAP; }
    maxBottom = Math.max(maxBottom, y - ROW_GAP);
  }
  const width = MARGIN * 2 + cols * NODE_W + (cols - 1) * COL_GAP;
  const height = maxBottom + 24 + bottomBuses.length * 16 + MARGIN;

  // Absolute pin coordinates
  const pinAt = (nodeId: string, pin: string) => { const n = nodes.find((x) => x.id === nodeId)!; const p = n.pins.find((x) => x.name === pin)!; return { x: n.x + p.x, y: n.y + p.y, side: p.side }; };

  const buses: LayoutBus[] = [];
  topBuses.forEach((n, i) => buses.push({ netId: n.id, name: n.name, kind: 'power', y: MARGIN + i * 16, x1: MARGIN, x2: width - MARGIN, taps: n.pins.map((p) => ({ ...pinAt(p.instance, p.pin), nodeId: p.instance, pin: p.pin })) }));
  bottomBuses.forEach((n, i) => buses.push({ netId: n.id, name: n.name, kind: 'ground', y: maxBottom + 24 + i * 16, x1: MARGIN, x2: width - MARGIN, taps: n.pins.map((p) => ({ ...pinAt(p.instance, p.pin), nodeId: p.instance, pin: p.pin })) }));

  // Point-to-point edges for every other net: chain pins in order, orthogonal routes.
  const edges: LayoutEdge[] = [];
  for (const n of project.nets) {
    if (busIds.has(n.id)) continue;
    const ps = n.pins.filter((p) => nodes.some((x) => x.id === p.instance));
    for (let i = 0; i + 1 < ps.length; i++) {
      const a = pinAt(ps[i].instance, ps[i].pin), b = pinAt(ps[i + 1].instance, ps[i + 1].pin);
      const [from, to] = a.x <= b.x ? [ps[i], ps[i + 1]] : [ps[i + 1], ps[i]];
      const A = a.x <= b.x ? a : b, B = a.x <= b.x ? b : a;
      const ax = A.x + (A.side === 'right' ? 10 : -10), bx = B.x + (B.side === 'left' ? -10 : 10);
      const midX = Math.round((ax + bx) / 2);
      edges.push({ netId: n.id, name: n.name, kind: n.kind, from: { nodeId: from.instance, pin: from.pin }, to: { nodeId: to.instance, pin: to.pin },
        points: [{ x: A.x, y: A.y }, { x: ax, y: A.y }, { x: midX, y: A.y }, { x: midX, y: B.y }, { x: bx, y: B.y }, { x: B.x, y: B.y }] });
    }
  }
  return { width, height, nodes, buses, edges };
}
