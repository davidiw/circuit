import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { evaluate } from '../evaluate';
import { applyOps } from '../mutations';
import { integrityProblems } from '../../model/integrity';
import { layout } from '../layout';

describe('trust boundary: projects that reference unknown parts or pins', () => {
  const t = templates[0];
  const ghost = { ...t, instances: t.instances.map((i) => (i.id === 'battery' ? { ...i, registryId: 'battery.renamed_in_a_later_build' } : i)) };
  it('integrity names the problem', () => { expect(integrityProblems(ghost, registry)).toEqual(['instance battery references unknown registry part battery.renamed_in_a_later_build']); });
  it('evaluate does not crash; it returns one unsupported finding and runs no rules', () => {
    const r = evaluate(ghost, registry);
    expect(r.status).toBe('incomplete'); expect(r.findings.map((f) => f.severity)).toEqual(['unsupported']); expect(r.coverage).toEqual([]);
  });
  it('swapping a part for one with different pins (nets now name pins the part lacks) is caught before rules run, and layout still draws', async () => {
    const swapped = applyOps(t, [{ op: 'swap_registry', instance: 'driver', registryId: 'board.seeed_xiao_esp32s3' }]);
    expect(integrityProblems(swapped, registry).length).toBeGreaterThan(0);
    expect(evaluate(swapped, registry).findings[0].severity).toBe('unsupported');
    const l = await layout(swapped, registry); expect(l.nodes.length).toBe(swapped.instances.length);
  });
  it('a bad prop value cannot produce voltage findings that blame the net', () => {
    const bad = applyOps(t, [{ op: 'set_prop', instance: 'buck', prop: 'outputV', value: 'five', provenance: 'user' }]);
    const r = evaluate(bad, registry); const fs = r.findings.filter((x) => x.ruleId === 'supply_in_range');
    expect(fs.length).toBeGreaterThan(0); for (const f of fs) expect(f.severity).toBe('unknown');
  });
});

describe('layout over every corpus state', () => {
  for (const t of templates) it(`${t.id}: mutations and optimizations lay out without throwing`, async () => {
    for (const m of t.mutations) { const l = await layout(applyOps(t, m.ops), registry); expect(l.nodes.length).toBeGreaterThan(0); }
    for (const o of t.optimizations) { const l = await layout(applyOps(t, o.ops), registry); expect(l.nodes.length).toBeGreaterThan(0); }
  });
});
