import type { Project, Registry, PinRole, RegistryComponent } from '../model/schema';

/**
 * Pure geometry for the system diagram, computed by ELK's layered algorithm with orthogonal routing.
 * Conventions: a part's geometry (box size, which pins sit on which side, and where) is a pure function of the
 * component (`partGeometry`), never of the wiring, so editing nets never moves or hides a pin: inputs sit on the
 * west edge, outputs and a controller board's GPIO and buses on the east edge, ground on the south edge, and every
 * registry pin is always drawn, unconnected ones muted. Ground nets with three or more pins are drawn as ground
 * symbols at each pin (never routed); power rails are routed as wires with junction dots unless they have more than
 * six pins, then they become flags; crossings between unrelated wires get a hop marker on the horizontal wire.
 * The renderer only draws what this returns.
 */
export type Side = 'north' | 'south' | 'west' | 'east';
export type LayoutPin = { name: string; role: PinRole; side: Side; x: number; y: number; netId?: string; wired: boolean; flag?: string; flagKind?: 'power' | 'ground'; source?: boolean };
export type PartGeometry = { w: number; h: number; head: number; margin: { top: number; bottom: number }; pins: { name: string; role: PinRole; side: Side; x: number; y: number }[] };
export type LayoutNode = { id: string; label: string; sub: string; kind: string; x: number; y: number; w: number; h: number; head: number; margin: { top: number; bottom: number }; pins: LayoutPin[] };
export type LayoutEdge = { netId: string; name: string; kind: string; points: { x: number; y: number }[]; from: { nodeId: string; pin: string }; to: { nodeId: string; pin: string }; label?: { x: number; y: number } };
export type Hop = { x: number; y: number; netId: string };
export type Junction = { x: number; y: number; netId: string };
export type Layout = { width: number; height: number; nodes: LayoutNode[]; edges: LayoutEdge[]; hops: Hop[]; junctions: Junction[]; rails: { netId: string; name: string; kind: 'power' | 'ground' }[] };

const OUTPUT_ROLES: PinRole[] = ['supply_out', 'battery_pos', 'motor_out', 'gpio', 'cathode', 'analog_out', 'speaker_out', 'logic_out'];
const PIN_H = 13, HEAD_H = 30, CHAR_W = 6.2, PAD = 10, MIN_W = 120, FLAG_MARGIN = 26, MAX_ROUTED_POWER_PINS = 6;
const EAST_ROLES: PinRole[] = ['supply_out', 'battery_pos', 'motor_out', 'logic_out', 'analog_out', 'speaker_out', 'cathode'];
const BOARD_EAST_ROLES: PinRole[] = ['gpio', 'csi', 'i2s'];

/** Which edge a pin sits on, from its role and the kind of part it is on. Never from the nets. */
export function pinSide(role: PinRole, kind: string): Side {
  if (role === 'ground') return 'south';
  if (EAST_ROLES.includes(role)) return 'east';
  if (BOARD_EAST_ROLES.includes(role) && kind === 'dev_board') return 'east';
  return 'west';
}

/**
 * The box and pin positions for one part: a pure function of the component and its label. Every registry pin is placed,
 * in registry order within its side, so wiring edits can neither move nor hide a pin. An unknown component is an empty box.
 */
export function partGeometry(c: RegistryComponent | undefined, label: string, registryId: string): PartGeometry {
  const kind = c?.kind ?? 'unknown'; const sub = c?.label ?? registryId;
  const bySide: Record<Side, { name: string; role: PinRole }[]> = { north: [], south: [], west: [], east: [] };
  for (const p of c?.pins ?? []) bySide[pinSide(p.role, kind)].push({ name: p.name, role: p.role });
  const w = Math.max(MIN_W, label.length * CHAR_W + 2 * PAD, Math.min(sub.length, 28) * 5 + 2 * PAD, (bySide.south.length + 1) * 34,
    (Math.max(...bySide.west.map((p) => p.name.length), 0) + Math.max(...bySide.east.map((p) => p.name.length), 0)) * CHAR_W + 3 * PAD);
  const rows = Math.max(bySide.west.length, bySide.east.length);
  const head = HEAD_H;
  const h = head + rows * PIN_H + (bySide.south.length ? 14 : 8);
  const margin = { top: 0, bottom: bySide.south.length ? FLAG_MARGIN : 0 };
  const pos = (side: Side, i: number, count: number) => side === 'west' ? { x: 0, y: head + i * PIN_H + 8 } : side === 'east' ? { x: w, y: head + i * PIN_H + 8 } : { x: (w * (i + 1)) / (count + 1), y: side === 'north' ? 0 : h };
  const pins: PartGeometry['pins'] = [];
  (['west', 'east', 'south', 'north'] as Side[]).forEach((side) => bySide[side].forEach((p, i) => { const at = pos(side, i, bySide[side].length); pins.push({ name: p.name, role: p.role, side, x: at.x, y: at.y }); }));
  return { w, h, head, margin, pins };
}

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
  const knownPin = (p: { instance: string; pin: string }) => { const i = instById.get(p.instance); return !!i && !!comp(i.registryId)?.pins.some((x) => x.name === p.pin); };
  for (const n of project.nets) for (const p of n.pins) if (knownPin(p)) netOfPin.set(`${p.instance}.${p.pin}`, n.id);
  // Nets as the layout sees them: only pins that exist on their component (an unknown part or pin never reaches ELK).
  project = { ...project, nets: project.nets.map((n) => ({ ...n, pins: n.pins.filter(knownPin) })).filter((n) => n.pins.length > 0) };

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
  // Nodes and ports: geometry from the component alone; net membership only decorates the pins (net, flag, wired, source).
  const nodes: LayoutNode[] = []; const elkNodes: ElkNode[] = [];
  const netById = new Map(project.nets.map((n) => [n.id, n]));
  for (const inst of project.instances) {
    const c = comp(inst.registryId); const kind = c?.kind ?? 'unknown';
    const g = partGeometry(c, inst.label, inst.registryId);
    const node: LayoutNode = { id: inst.id, label: inst.label, sub: c?.label ?? inst.registryId, kind, x: 0, y: 0, w: g.w, h: g.h, head: g.head, margin: g.margin, pins: [] };
    const ports: ElkPort[] = [];
    for (const p of g.pins) {
      const key = `${inst.id}.${p.name}`; const netId = netOfPin.get(key); const net = netId ? netById.get(netId) : undefined;
      const flagged = !!netId && flagIds.has(netId);
      node.pins.push({ ...p, netId, wired: !!net && net.pins.length >= 2, flag: flagged ? net!.name : undefined, flagKind: flagged ? (net!.kind === 'ground' ? 'ground' : 'power') : undefined, source: (!!netId && sourceOf.get(netId) === key) || OUTPUT_ROLES.includes(p.role) });
      ports.push({ id: key, width: 4, height: 4, x: p.x - 2, y: p.y - 2 + g.margin.top, layoutOptions: { 'elk.port.side': ELK_SIDE[p.side] } });
    }
    nodes.push(node);
    const lo: Record<string, string> = { 'elk.portConstraints': 'FIXED_POS' };
    if (inst.id === project.power.sourceInstance) lo['elk.layered.layering.layerConstraint'] = 'FIRST';
    elkNodes.push({ id: inst.id, width: g.w, height: g.h + g.margin.top + g.margin.bottom, ports, layoutOptions: lo });
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
