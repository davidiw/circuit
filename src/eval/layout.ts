import type { Project, Registry, PinRole } from '../model/schema';

/**
 * Pure geometry for the system diagram, computed by ELK's layered algorithm with orthogonal routing.
 * Conventions: wires leave a part on the right and enter on the left, so pin sides follow wire direction;
 * ground nets with three or more pins are drawn as ground symbols at each pin (never routed); power rails are
 * routed as wires with junction dots unless they have more than six pins, then they become flags; crossings
 * between unrelated wires get a hop marker on the horizontal wire. The renderer only draws what this returns.
 */
export type Side = 'north' | 'south' | 'west' | 'east';
export type LayoutPin = { name: string; role: PinRole; side: Side; x: number; y: number; netId?: string; flag?: string; flagKind?: 'power' | 'ground'; source?: boolean };
export type LayoutNode = { id: string; label: string; sub: string; kind: string; x: number; y: number; w: number; h: number; head: number; margin: { top: number; bottom: number }; pins: LayoutPin[] };
export type LayoutEdge = { netId: string; name: string; kind: string; points: { x: number; y: number }[]; from: { nodeId: string; pin: string }; to: { nodeId: string; pin: string }; label?: { x: number; y: number } };
export type Hop = { x: number; y: number; netId: string };
export type Junction = { x: number; y: number; netId: string };
export type Layout = { width: number; height: number; nodes: LayoutNode[]; edges: LayoutEdge[]; hops: Hop[]; junctions: Junction[]; rails: { netId: string; name: string; kind: 'power' | 'ground' }[] };

const OUTPUT_ROLES: PinRole[] = ['supply_out', 'battery_pos', 'motor_out', 'gpio', 'cathode', 'analog_out', 'speaker_out', 'logic_out'];
const PIN_H = 13, HEAD_H = 30, CHAR_W = 6.2, PAD = 10, MIN_W = 120, FLAG_MARGIN = 26, MAX_ROUTED_POWER_PINS = 6;

type ElkPort = { id: string; width: number; height: number; x?: number; y?: number; layoutOptions: Record<string, string> };
type ElkNode = { id: string; width: number; height: number; x?: number; y?: number; ports: ElkPort[]; layoutOptions: Record<string, string> };
type ElkEdge = { id: string; sources: string[]; targets: string[]; layoutOptions?: Record<string, string>; sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[]; junctionPoints?: { x: number; y: number }[] };
type ElkGraph = { id: string; layoutOptions: Record<string, string>; children: ElkNode[]; edges: ElkEdge[]; width?: number; height?: number };
export type ElkLike = { layout(graph: ElkGraph): Promise<ElkGraph> };

let elkInstance: ElkLike | undefined;
async function getElk(): Promise<ElkLike> {
  if (!elkInstance) {
    const mod = await import('elkjs/lib/elk.bundled.js');
    const ELK = (mod as unknown as { default?: new () => ElkLike }).default ?? (mod as unknown as new () => ElkLike);
    elkInstance = new ELK();
  }
  return elkInstance;
}
const ELK_SIDE: Record<Side, string> = { north: 'NORTH', south: 'SOUTH', west: 'WEST', east: 'EAST' };

export async function layout(project: Project, registry: Registry, opts: { compact?: boolean } = {}): Promise<Layout> {
  const comp = (rid: string) => registry.components.find((c) => c.id === rid);
  const instById = new Map(project.instances.map((i) => [i.id, i]));
  const roleOf = (p: { instance: string; pin: string }): PinRole | undefined => { const i = instById.get(p.instance); return i ? comp(i.registryId)?.pins.find((x) => x.name === p.pin)?.role : undefined; };
  const kindOf = (id: string) => { const i = instById.get(id); return i ? comp(i.registryId)?.kind : undefined; };
  const netOfPin = new Map<string, string>();
  for (const n of project.nets) for (const p of n.pins) netOfPin.set(`${p.instance}.${p.pin}`, n.id);

  // Which nets are flags (ground with 3+ pins, or power with more than MAX_ROUTED_POWER_PINS) versus routed wires.
  const flagNets = project.nets.filter((n) => (n.kind === 'ground' && n.pins.length >= 3) || (n.kind === 'power' && n.pins.length > MAX_ROUTED_POWER_PINS));
  const flagIds = new Set(flagNets.map((n) => n.id));

  // Source pin of every routed net: an output-role pin, else a pin on a controller board, else the first pin.
  const sourceOf = new Map<string, string>();
  for (const n of project.nets) {
    if (flagIds.has(n.id)) continue;
    const pins = n.pins.filter((p) => instById.has(p.instance));
    const src = pins.find((p) => OUTPUT_ROLES.includes(roleOf(p) as PinRole)) ?? pins.find((p) => kindOf(p.instance) === 'dev_board') ?? pins[0];
    if (src) sourceOf.set(n.id, `${src.instance}.${src.pin}`);
  }
  const sideOfPin = (instId: string, pinName: string, role: PinRole): Side => {
    const key = `${instId}.${pinName}`; const netId = netOfPin.get(key)!;
    if (flagIds.has(netId)) return project.nets.find((n) => n.id === netId)!.kind === 'ground' ? 'south' : 'north';
    return sourceOf.get(netId) === key ? 'east' : 'west';
  };

  // Nodes and ports
  const nodes: LayoutNode[] = []; const elkNodes: ElkNode[] = [];
  for (const inst of project.instances) {
    const c = comp(inst.registryId); const kind = c?.kind ?? 'unknown';
    const used = (c?.pins ?? []).filter((p) => netOfPin.has(`${inst.id}.${p.name}`));
    const bySide: Record<Side, typeof used> = { north: [], south: [], west: [], east: [] };
    for (const p of used) bySide[sideOfPin(inst.id, p.name, p.role)].push(p);
    const sub = c?.label ?? inst.registryId;
    const w = Math.max(MIN_W, inst.label.length * CHAR_W + 2 * PAD, Math.min(sub.length, 28) * 5 + 2 * PAD, (bySide.north.length + 1) * 34, (bySide.south.length + 1) * 34,
      (Math.max(...bySide.west.map((p) => p.name.length), 0) + Math.max(...bySide.east.map((p) => p.name.length), 0)) * CHAR_W + 3 * PAD);
    const rows = Math.max(bySide.west.length, bySide.east.length);
    const head = HEAD_H + (bySide.north.length ? 12 : 0);
    const h = head + rows * PIN_H + (bySide.south.length ? 14 : 8);
    const margin = { top: bySide.north.length ? FLAG_MARGIN : 0, bottom: bySide.south.length ? FLAG_MARGIN : 0 };
    const node: LayoutNode = { id: inst.id, label: inst.label, sub, kind, x: 0, y: 0, w, h, head, margin, pins: [] };
    const ports: ElkPort[] = [];
    const pos = (side: Side, i: number, count: number) => side === 'west' ? { x: -2, y: head + i * PIN_H + 6 } : side === 'east' ? { x: w - 2, y: head + i * PIN_H + 6 }
      : side === 'north' ? { x: (w * (i + 1)) / (count + 1) - 2, y: -2 } : { x: (w * (i + 1)) / (count + 1) - 2, y: h - 2 };
    (['north', 'south', 'west', 'east'] as Side[]).forEach((side) => bySide[side].forEach((p, i) => {
      const key = `${inst.id}.${p.name}`; const netId = netOfPin.get(key)!; const net = project.nets.find((n) => n.id === netId)!;
      const at = pos(side, i, bySide[side].length);
      node.pins.push({ name: p.name, role: p.role, side, x: at.x + 2, y: at.y + 2, netId, flag: flagIds.has(netId) ? net.name : undefined, flagKind: flagIds.has(netId) ? (net.kind === 'ground' ? 'ground' : 'power') : undefined, source: sourceOf.get(netId) === key || OUTPUT_ROLES.includes(p.role) });
      ports.push({ id: key, width: 4, height: 4, x: at.x, y: at.y + margin.top, layoutOptions: { 'elk.port.side': ELK_SIDE[side] } });
    }));
    nodes.push(node);
    const lo: Record<string, string> = { 'elk.portConstraints': 'FIXED_POS' };
    if (inst.id === project.power.sourceInstance) lo['elk.layered.layering.layerConstraint'] = 'FIRST';
    elkNodes.push({ id: inst.id, width: w, height: h + margin.top + margin.bottom, ports, layoutOptions: lo });
  }

  // Edges: every routed net from its source pin to each other pin. Power edges get priority so cycle breaking reverses signals, not supplies.
  const elkEdges: ElkEdge[] = []; const edgeMeta = new Map<string, { netId: string; from: { nodeId: string; pin: string }; to: { nodeId: string; pin: string } }>();
  for (const n of project.nets) {
    if (flagIds.has(n.id)) continue;
    const srcKey = sourceOf.get(n.id); if (!srcKey) continue;
    const [si, sp] = srcKey.split('.');
    n.pins.filter((p) => `${p.instance}.${p.pin}` !== srcKey && instById.has(p.instance)).forEach((p, i) => {
      const id = `${n.id}#${i}`;
      elkEdges.push({ id, sources: [srcKey], targets: [`${p.instance}.${p.pin}`], layoutOptions: n.kind === 'power' ? { 'elk.layered.priority.direction': '10' } : {} });
      edgeMeta.set(id, { netId: n.id, from: { nodeId: si, pin: sp }, to: { nodeId: p.instance, pin: p.pin } });
    });
  }
  // Invisible power-flow edges along flag power rails so layering still follows the power path.
  const ghost = new Set<string>();
  for (const n of flagNets.filter((x) => x.kind === 'power')) {
    const src = n.pins.find((p) => roleOf(p) === 'supply_out' || roleOf(p) === 'battery_pos'); if (!src) continue;
    n.pins.filter((p) => p !== src && p.instance !== src.instance).forEach((p, i) => { const id = `ghost:${n.id}#${i}`; ghost.add(id); elkEdges.push({ id, sources: [`${src.instance}.${src.pin}`], targets: [`${p.instance}.${p.pin}`] }); });
  }

  const graph: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': opts.compact ? '28' : '40', 'elk.layered.spacing.nodeNodeBetweenLayers': opts.compact ? '50' : '70',
      'elk.spacing.edgeNode': '18', 'elk.spacing.edgeEdge': '12', 'elk.layered.spacing.edgeEdgeBetweenLayers': '12', 'elk.layered.spacing.edgeNodeBetweenLayers': '18',
      'elk.layered.mergeEdges': 'true', 'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.cycleBreaking.strategy': 'GREEDY', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.padding': '[top=24,left=16,bottom=24,right=16]',
    },
    children: elkNodes, edges: elkEdges,
  };
  const elk = await getElk();
  const out = await elk.layout(graph);

  for (const en of out.children) { const node = nodes.find((n) => n.id === en.id)!; node.x = en.x ?? 0; node.y = (en.y ?? 0) + node.margin.top; }
  const edges: LayoutEdge[] = []; const junctions: Junction[] = [];
  for (const ee of out.edges) {
    if (ghost.has(ee.id)) continue;
    const meta = edgeMeta.get(ee.id)!; const net = project.nets.find((n) => n.id === meta.netId)!;
    for (const s of ee.sections ?? []) {
      const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      const a = points[0], b = points[1] ?? points[0];
      edges.push({ netId: net.id, name: net.name, kind: net.kind, points, from: meta.from, to: meta.to, label: { x: Math.min(a.x, b.x) + 6, y: a.y - 4 } });
    }
    for (const j of ee.junctionPoints ?? []) junctions.push({ x: j.x, y: j.y, netId: meta.netId });
  }
  const hops: Hop[] = [];
  const segs = edges.flatMap((e) => e.points.slice(1).map((p, i) => ({ netId: e.netId, a: e.points[i], b: p })));
  for (const h of segs) {
    if (Math.abs(h.a.y - h.b.y) > 0.5) continue;
    const [x1, x2] = [Math.min(h.a.x, h.b.x), Math.max(h.a.x, h.b.x)];
    for (const v of segs) {
      if (v.netId === h.netId || Math.abs(v.a.x - v.b.x) > 0.5) continue;
      const [y1, y2] = [Math.min(v.a.y, v.b.y), Math.max(v.a.y, v.b.y)];
      if (v.a.x > x1 + 1 && v.a.x < x2 - 1 && h.a.y > y1 + 1 && h.a.y < y2 - 1) hops.push({ x: v.a.x, y: h.a.y, netId: h.netId });
    }
  }
  return { width: out.width ?? 0, height: out.height ?? 0, nodes, edges, hops, junctions, rails: flagNets.map((n) => ({ netId: n.id, name: n.name, kind: n.kind as 'power' | 'ground' })) };
}
