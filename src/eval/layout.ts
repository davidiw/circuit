import type { Project, Registry, PinRole } from '../model/schema';

/**
 * Pure geometry for the system diagram, computed by ELK's layered algorithm with orthogonal routing.
 * Pins sit on node sides by role; power and ground nets with three or more pins are drawn as flags, not wires;
 * crossings between unrelated wires get a hop marker on the horizontal wire. The renderer only draws what this returns.
 */
export type Side = 'north' | 'south' | 'west' | 'east';
export type LayoutPin = { name: string; role: PinRole; side: Side; x: number; y: number; netId?: string; flag?: string };
export type LayoutNode = { id: string; label: string; sub: string; kind: string; x: number; y: number; w: number; h: number; head: number; pins: LayoutPin[] };
export type LayoutEdge = { netId: string; name: string; kind: string; points: { x: number; y: number }[]; from: { nodeId: string; pin: string }; to: { nodeId: string; pin: string }; label?: { x: number; y: number } };
export type Hop = { x: number; y: number; netId: string };
export type Junction = { x: number; y: number; netId: string };
export type Layout = { width: number; height: number; nodes: LayoutNode[]; edges: LayoutEdge[]; hops: Hop[]; junctions: Junction[]; rails: { netId: string; name: string; kind: 'power' | 'ground' }[] };

const OUTPUT_ROLES: PinRole[] = ['supply_out', 'battery_pos', 'motor_out', 'gpio', 'cathode', 'analog_out', 'speaker_out', 'logic_out'];
const PIN_H = 13, HEAD_H = 30, CHAR_W = 6.2, PAD = 10, MIN_W = 120;

type ElkPort = { id: string; width: number; height: number; x?: number; y?: number; layoutOptions: Record<string, string> };
type ElkNode = { id: string; width: number; height: number; x?: number; y?: number; ports: ElkPort[]; layoutOptions: Record<string, string> };
type ElkEdge = { id: string; sources: string[]; targets: string[]; sections?: { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: { x: number; y: number }[] }[]; junctionPoints?: { x: number; y: number }[] };
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

function sideFor(role: PinRole): Side {
  if (role === 'supply_in') return 'north';
  if (role === 'ground') return 'south';
  return OUTPUT_ROLES.includes(role) ? 'east' : 'west';
}
const ELK_SIDE: Record<Side, string> = { north: 'NORTH', south: 'SOUTH', west: 'WEST', east: 'EAST' };

export async function layout(project: Project, registry: Registry, opts: { compact?: boolean } = {}): Promise<Layout> {
  const comp = (rid: string) => registry.components.find((c) => c.id === rid);
  const netOfPin = new Map<string, string>();
  for (const n of project.nets) for (const p of n.pins) netOfPin.set(`${p.instance}.${p.pin}`, n.id);
  const railNets = project.nets.filter((n) => (n.kind === 'power' || n.kind === 'ground') && n.pins.length >= 3);
  const railIds = new Set(railNets.map((n) => n.id));

  // Nodes and ports
  const nodes: LayoutNode[] = []; const elkNodes: ElkNode[] = [];
  for (const inst of project.instances) {
    const c = comp(inst.registryId); const kind = c?.kind ?? 'unknown';
    const used = (c?.pins ?? []).filter((p) => netOfPin.has(`${inst.id}.${p.name}`));
    const bySide: Record<Side, typeof used> = { north: [], south: [], west: [], east: [] };
    for (const p of used) {
      const onRail = railIds.has(netOfPin.get(`${inst.id}.${p.name}`)!);
      let side = sideFor(p.role);
      if (!onRail && side === 'north') side = 'west';   // a routed supply input arrives from the left like any input
      if (!onRail && side === 'south') side = 'west';   // a routed ground (rare) likewise
      bySide[side].push(p);
    }
    const sub = c?.label ?? inst.registryId;
    const w = Math.max(MIN_W, inst.label.length * CHAR_W + 2 * PAD, Math.min(sub.length, 28) * 5 + 2 * PAD, (bySide.north.length + 1) * 34, (bySide.south.length + 1) * 34,
      (Math.max(...bySide.west.map((p) => p.name.length), 0) + Math.max(...bySide.east.map((p) => p.name.length), 0)) * CHAR_W + 3 * PAD);
    const rows = Math.max(bySide.west.length, bySide.east.length);
    const head = HEAD_H + (bySide.north.length ? 12 : 0);
    const h = head + rows * PIN_H + (bySide.south.length ? 14 : 8);
    const node: LayoutNode = { id: inst.id, label: inst.label, sub, kind, x: 0, y: 0, w, h, pins: [], head };
    const ports: ElkPort[] = [];
    const pos = (side: Side, i: number, count: number) => side === 'west' ? { x: -2, y: head + i * PIN_H + 6 } : side === 'east' ? { x: w - 2, y: head + i * PIN_H + 6 }
      : side === 'north' ? { x: (w * (i + 1)) / (count + 1) - 2, y: -2 } : { x: (w * (i + 1)) / (count + 1) - 2, y: h - 2 };
    (['north', 'south', 'west', 'east'] as Side[]).forEach((side) => bySide[side].forEach((p, i) => {
      const netId = netOfPin.get(`${inst.id}.${p.name}`);
      const rail = netId && railIds.has(netId) ? project.nets.find((n) => n.id === netId)!.name : undefined;
      const at = pos(side, i, bySide[side].length);
      node.pins.push({ name: p.name, role: p.role, side, x: at.x + 2, y: at.y + 2, netId, flag: rail });
      ports.push({ id: `${inst.id}.${p.name}`, width: 4, height: 4, x: at.x, y: at.y, layoutOptions: { 'elk.port.side': ELK_SIDE[side] } });
    }));
    nodes.push(node);
    const lo: Record<string, string> = { 'elk.portConstraints': 'FIXED_POS' };
    if (inst.id === project.power.sourceInstance) lo['elk.layered.layering.layerConstraint'] = 'FIRST';
    elkNodes.push({ id: inst.id, width: w, height: h, ports, layoutOptions: lo });
  }

  // Edges: every non-rail net, from its driving pin to each other pin.
  const elkEdges: ElkEdge[] = []; const edgeMeta = new Map<string, { netId: string; from: { nodeId: string; pin: string }; to: { nodeId: string; pin: string } }>();
  for (const n of project.nets) {
    if (railIds.has(n.id)) continue;
    const pins = n.pins.filter((p) => nodes.some((x) => x.id === p.instance));
    if (pins.length < 2) continue;
    const role = (p: { instance: string; pin: string }) => comp(project.instances.find((i) => i.id === p.instance)!.registryId)?.pins.find((x) => x.name === p.pin)?.role;
    const src = pins.find((p) => OUTPUT_ROLES.includes(role(p) as PinRole)) ?? pins[0];
    pins.filter((p) => p !== src).forEach((p, i) => {
      const id = `${n.id}#${i}`;
      elkEdges.push({ id, sources: [`${src.instance}.${src.pin}`], targets: [`${p.instance}.${p.pin}`] });
      edgeMeta.set(id, { netId: n.id, from: { nodeId: src.instance, pin: src.pin }, to: { nodeId: p.instance, pin: p.pin } });
    });
  }

  // Invisible power-flow edges along each rail (source pin to every consumer) so layering follows the power path.
  const ghost = new Set<string>();
  for (const n of railNets) {
    const role = (p: { instance: string; pin: string }) => comp(project.instances.find((i) => i.id === p.instance)!.registryId)?.pins.find((x) => x.name === p.pin)?.role;
    const src = n.pins.find((p) => role(p) === 'supply_out' || role(p) === 'battery_pos');
    if (!src) continue;
    n.pins.filter((p) => p !== src && p.instance !== src.instance && role(p) !== 'ground').forEach((p, i) => {
      const id = `ghost:${n.id}#${i}`; ghost.add(id);
      elkEdges.push({ id, sources: [`${src.instance}.${src.pin}`], targets: [`${p.instance}.${p.pin}`] });
    });
  }
  const graph: ElkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': opts.compact ? '28' : '40', 'elk.layered.spacing.nodeNodeBetweenLayers': opts.compact ? '50' : '70',
      'elk.spacing.edgeNode': '18', 'elk.spacing.edgeEdge': '12', 'elk.layered.spacing.edgeEdgeBetweenLayers': '12', 'elk.layered.spacing.edgeNodeBetweenLayers': '18',
      'elk.layered.mergeEdges': 'true', 'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.padding': '[top=24,left=16,bottom=24,right=16]',
    },
    children: elkNodes, edges: elkEdges,
  };
  const elk = await getElk();
  const out = await elk.layout(graph);

  for (const en of out.children) {
    const node = nodes.find((n) => n.id === en.id)!; node.x = en.x ?? 0; node.y = en.y ?? 0;

  }
  const edges: LayoutEdge[] = []; const junctions: Junction[] = [];
  for (const ee of out.edges) {
    if (ghost.has(ee.id)) continue;
    const meta = edgeMeta.get(ee.id)!; const net = project.nets.find((n) => n.id === meta.netId)!;
    for (const s of ee.sections ?? []) {
      const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
      const first = points.length > 1 ? points[0] : s.startPoint; const second = points.length > 1 ? points[1] : s.endPoint;
      edges.push({ netId: net.id, name: net.name, kind: net.kind, points, from: meta.from, to: meta.to, label: { x: Math.min(first.x, second.x) + 6, y: first.y - 4 } });
    }
    for (const j of ee.junctionPoints ?? []) junctions.push({ x: j.x, y: j.y, netId: meta.netId });
  }
  // Hops: intersections between a horizontal segment of one net and a vertical segment of another.
  const hops: Hop[] = [];
  const segs = edges.flatMap((e) => e.points.slice(1).map((p, i) => ({ netId: e.netId, a: e.points[i], b: p })));
  for (const h of segs) {
    if (Math.abs(h.a.y - h.b.y) > 0.5) continue; // horizontal only
    const [x1, x2] = [Math.min(h.a.x, h.b.x), Math.max(h.a.x, h.b.x)];
    for (const v of segs) {
      if (v.netId === h.netId || Math.abs(v.a.x - v.b.x) > 0.5) continue;
      const [y1, y2] = [Math.min(v.a.y, v.b.y), Math.max(v.a.y, v.b.y)];
      if (v.a.x > x1 + 1 && v.a.x < x2 - 1 && h.a.y > y1 + 1 && h.a.y < y2 - 1) hops.push({ x: v.a.x, y: h.a.y, netId: h.netId });
    }
  }
  return { width: out.width ?? 0, height: out.height ?? 0, nodes, edges, hops, junctions, rails: railNets.map((n) => ({ netId: n.id, name: n.name, kind: n.kind as 'power' | 'ground' })) };
}
