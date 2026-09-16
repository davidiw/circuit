import type { Project, Registry, RegistryComponent, RegistryPin, Net, Instance, Provenance, Finding, CoverageEntry, Metric } from '../model/schema';

export type NetVoltage = { nominal: number; min: number; max: number; via: string };

/** Read-only view of canonical state plus derived net voltages. Rules only see this. */
export class Ctx {
  readonly netVoltages = new Map<string, NetVoltage>();
  private readonly compById = new Map<string, RegistryComponent>();
  private readonly instById = new Map<string, Instance>();
  private readonly pinNet = new Map<string, Net>();

  constructor(readonly project: Project, readonly registry: Registry) {
    for (const c of registry.components) this.compById.set(c.id, c);
    for (const i of project.instances) this.instById.set(i.id, i);
    for (const n of project.nets) for (const p of n.pins) this.pinNet.set(`${p.instance}.${p.pin}`, n);
    this.propagate();
  }

  get hasPower(): boolean {
    const id = this.project.power.sourceInstance;
    return !!id && this.instById.has(id);
  }

  inst(id: string) { return this.instById.get(id); }
  comp(instanceId: string) { const i = this.instById.get(instanceId); return i ? this.compById.get(i.registryId) : undefined; }
  pinDef(instanceId: string, pin: string): RegistryPin | undefined { return this.comp(instanceId)?.pins.find((p) => p.name === pin); }
  netOf(instanceId: string, pin: string): Net | undefined { return this.pinNet.get(`${instanceId}.${pin}`); }
  netById(id: string) { return this.project.nets.find((n) => n.id === id); }

  /** Numeric registry fact with provenance; undefined if absent or non-numeric. */
  fact(instanceId: string, key: string): { value: number; provenance: Provenance; note?: string } | undefined {
    const f = this.comp(instanceId)?.facts[key];
    if (!f || typeof f.value !== 'number') return undefined;
    return { value: f.value, provenance: f.provenance, note: f.note };
  }
  prop(instanceId: string, key: string): { value: number; provenance: Provenance } | undefined {
    const p = this.inst(instanceId)?.props[key];
    if (!p || typeof p.value !== 'number') return undefined;
    return { value: p.value, provenance: p.provenance };
  }
  assumption(key: string): unknown {
    return this.project.assumptions.find((a) => a.key === key && a.status === 'active')?.value;
  }
  assumptionNum(key: string): number | undefined {
    const v = this.assumption(key);
    return typeof v === 'number' ? v : undefined;
  }
  instancesOfKind(kind: string) { return this.project.instances.filter((i) => this.compById.get(i.registryId)?.kind === kind); }
  instancesWithCapability(cap: string) { return this.project.instances.filter((i) => this.compById.get(i.registryId)?.capabilities.includes(cap)); }
  /** Pins on a net enriched with their registry definitions. */
  netPins(net: Net) {
    return net.pins.map((p) => ({ ...p, def: this.pinDef(p.instance, p.pin) })).filter((p): p is typeof p & { def: RegistryPin } => !!p.def);
  }
  overridden(ruleId: string, instanceId?: string) {
    return this.project.overrides.some((o) => o.ruleId === ruleId && (!o.instanceId || o.instanceId === instanceId));
  }

  /** Propagate voltages from sources through supply_out pins until stable. */
  private propagate() {
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      for (const inst of this.project.instances) {
        const comp = this.compById.get(inst.registryId);
        if (!comp) continue;
        for (const pin of comp.pins) {
          if (!pin.output) continue;
          const net = this.netOf(inst.id, pin.name);
          if (!net || this.netVoltages.has(net.id)) continue;
          const v = this.pinVoltage(inst, pin);
          if (v) { this.netVoltages.set(net.id, v); changed = true; }
        }
      }
      if (!changed) break;
    }
  }

  private pinVoltage(inst: Instance, pin: RegistryPin): NetVoltage | undefined {
    const o = pin.output!;
    switch (o.kind) {
      case 'fixed': return { nominal: o.v, min: o.v, max: o.v, via: `${inst.id}.${pin.name}` };
      case 'prop': { const p = this.prop(inst.id, o.prop); return p ? { nominal: p.value, min: p.value, max: p.value, via: `${inst.id}.${o.prop}` } : undefined; }
      case 'fact': {
        const n = this.fact(inst.id, o.nominal); if (!n) return undefined;
        const mn = o.min ? this.fact(inst.id, o.min)?.value ?? n.value : n.value;
        const mx = o.max ? this.fact(inst.id, o.max)?.value ?? n.value : n.value;
        return { nominal: n.value, min: mn, max: mx, via: `${inst.id}.${pin.name}` };
      }
      case 'from_pin': {
        const src = this.netOf(inst.id, o.pin); if (!src) return undefined;
        const v = this.netVoltages.get(src.id); if (!v) return undefined;
        const drop = this.fact(inst.id, o.drop_fact)?.value ?? 0;
        return { nominal: v.nominal - drop, min: v.min - drop, max: v.max - drop, via: `${inst.id}.${pin.name}` };
      }
    }
  }
}

export type AnalyzerResult = { findings: Finding[]; coverage: CoverageEntry[]; metrics?: Metric[] };
/** A rule is the smallest analyzer. The AI reviewer and future simulation passes implement the same shape. */
export type Analyzer = {
  id: string;
  origin: 'deterministic' | 'ai_review' | 'simulation';
  dimensions: string[];
  analyze: (ctx: Ctx) => AnalyzerResult | Promise<AnalyzerResult>;
};
export type Rule = { id: string; origin: 'deterministic'; dimensions: string[]; analyze: (ctx: Ctx) => AnalyzerResult };

let seq = 0;
export function finding(f: Omit<Finding, 'id' | 'origin' | 'fixes'> & { fixes?: Finding['fixes'] }): Finding {
  return { id: `${f.ruleId}-${++seq}`, origin: 'deterministic', fixes: [], ...f };
}
/** First unused PWM-capable GPIO on a dev board, for fix suggestions. */
export function freeGpio(ctx: Ctx, boardId: string): string | undefined {
  const comp = ctx.comp(boardId); if (!comp) return undefined;
  return comp.pins.find((p) => p.role === 'gpio' && !ctx.netOf(boardId, p.name))?.name;
}
export function resetIds() { seq = 0; }
export const fmtV = (v: number) => `${v.toFixed(2)} V`;
export const fmtA = (a: number) => `${a.toFixed(2)} A`;
