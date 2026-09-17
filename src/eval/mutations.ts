import type { Project, MutationOp, Net, Registry, PinRef, PinRole } from '../model/schema';

/** Apply structured ops to a project, returning a new project. Never mutates the input. */
export function applyOps(project: Project, ops: MutationOp[]): Project {
  const p: Project = structuredClone(project);
  for (const op of ops) applyOne(p, op);
  return p;
}

function applyOne(p: Project, op: MutationOp) {
  switch (op.op) {
    case 'remove_instance': {
      p.instances = p.instances.filter((i) => i.id !== op.instance);
      for (const n of p.nets) n.pins = n.pins.filter((pin) => pin.instance !== op.instance);
      p.nets = p.nets.filter((n) => n.pins.length > 0);
      if (p.power.sourceInstance === op.instance) p.power.sourceInstance = null;
      return;
    }
    case 'move_pin': {
      if (!p.instances.some((i) => i.id === op.instance)) return;   // the part is gone (removed earlier in the edit list): nothing to move
      for (const n of p.nets) n.pins = n.pins.filter((pin) => !(pin.instance === op.instance && pin.pin === op.pin));
      p.nets = p.nets.filter((n) => n.pins.length > 0);
      if (op.net === null) return;
      let target: Net | undefined = p.nets.find((n) => n.id === op.net);
      if (!target) {
        target = { id: op.net, name: op.name ?? op.net, kind: op.kind ?? 'signal', pins: [] };
        p.nets.push(target);
      }
      target.pins.push({ instance: op.instance, pin: op.pin });
      return;
    }
    case 'set_prop': {
      const inst = p.instances.find((i) => i.id === op.instance);
      if (inst) inst.props[op.prop] = { value: op.value, provenance: op.provenance ?? 'user' };
      return;
    }
    case 'swap_registry': {
      const inst = p.instances.find((i) => i.id === op.instance);
      if (inst) inst.registryId = op.registryId;
      return;
    }
    case 'set_assumption': {
      const a = p.assumptions.find((x) => x.key === op.key);
      if (a) { a.value = op.value; a.source = 'user'; }
      return;
    }
    case 'add_instance': {
      if (!p.instances.some((i) => i.id === op.id)) p.instances.push({ id: op.id, registryId: op.registryId, label: op.label, props: op.props ?? {} });
      return;
    }
    case 'clear_power_source': {
      p.power.sourceInstance = null;
      return;
    }
  }
}

export function applyMutation(project: Project, mutationId: string): Project {
  const m = project.mutations.find((x) => x.id === mutationId);
  if (!m) throw new Error(`unknown mutation ${mutationId}`);
  return applyOps(project, m.ops);
}

const KIND_FOR_ROLE: Partial<Record<PinRole, Net['kind']>> = { supply_out: 'power', supply_in: 'power', battery_pos: 'power', cap_pos: 'power', ground: 'ground', motor_out: 'motor', motor_in: 'motor', csi: 'bus' };

/**
 * Ops that connect two pins. Joins the second pin to the first pin's net, adopts the second's net, merges both nets, or creates a new one.
 * Structural rules only (same pin twice is a no-op); electrically poor choices are allowed so the evaluator can explain them.
 */
export function connectPins(project: Project, registry: Registry, a: PinRef, b: PinRef): MutationOp[] {
  if (a.instance === b.instance && a.pin === b.pin) return [];
  const netOf = (r: PinRef) => project.nets.find((n) => n.pins.some((x) => x.instance === r.instance && x.pin === r.pin));
  const na = netOf(a), nb = netOf(b);
  if (na && nb && na.id === nb.id) return [];
  if (na && nb) {
    // Merge into the net that should keep its identity: ground beats power beats the rest; then the larger net.
    const rank = (n: Net) => (n.kind === 'ground' ? 3 : n.kind === 'power' ? 2 : n.kind === 'bus' ? 1 : 0);
    const [keep, drop] = rank(na) > rank(nb) || (rank(na) === rank(nb) && na.pins.length >= nb.pins.length) ? [na, nb] : [nb, na];
    return drop.pins.map((x) => ({ op: 'move_pin' as const, instance: x.instance, pin: x.pin, net: keep.id }));
  }
  if (na) return [{ op: 'move_pin', instance: b.instance, pin: b.pin, net: na.id }];
  if (nb) return [{ op: 'move_pin', instance: a.instance, pin: a.pin, net: nb.id }];
  const role = (r: PinRef) => { const i = project.instances.find((x) => x.id === r.instance); return i ? registry.components.find((c) => c.id === i.registryId)?.pins.find((x) => x.name === r.pin)?.role : undefined; };
  const kind = KIND_FOR_ROLE[role(a) as PinRole] ?? KIND_FOR_ROLE[role(b) as PinRole] ?? 'signal';
  let n = 1; while (project.nets.some((x) => x.id === `W${n}`)) n++;
  const id = `W${n}`;
  return [{ op: 'move_pin', instance: a.instance, pin: a.pin, net: id, name: id, kind }, { op: 'move_pin', instance: b.instance, pin: b.pin, net: id, kind }];
}

/** Ops that take one pin off its net. */
export function disconnectPin(a: PinRef): MutationOp[] { return [{ op: 'move_pin', instance: a.instance, pin: a.pin, net: null }]; }
