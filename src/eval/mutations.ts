import type { Project, MutationOp, Net } from '../model/schema';

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
      for (const n of p.nets) n.pins = n.pins.filter((pin) => !(pin.instance === op.instance && pin.pin === op.pin));
      p.nets = p.nets.filter((n) => n.pins.length > 0);
      if (op.net === null) return;
      let target: Net | undefined = p.nets.find((n) => n.id === op.net);
      if (!target) {
        target = { id: op.net, name: op.net, kind: 'signal', pins: [] };
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
