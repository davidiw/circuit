import type { Project } from '../model/schema';

/** Stable hash over the design-bearing parts of a project. Viewing, evaluating, and history never change it. */
export function stateHash(p: Project): string {
  const canon = canonical({ requirements: p.requirements, power: p.power, instances: p.instances, nets: p.nets, assumptions: p.assumptions, overrides: p.overrides });
  return fnv1a(JSON.stringify(canon));
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = canonical(o[k]); return acc; }, {});
  }
  return v;
}

// 64-bit FNV-1a split in two 32-bit halves; portable, no crypto dependency, adequate for change detection.
function fnv1a(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c; h2 = Math.imul(h2, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
