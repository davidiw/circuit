import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { runPinSweep } from '../sweep';
import { applyOps, connectPins } from '../mutations';
import { evaluate } from '../evaluate';
import { Project } from '../../model/schema';
import { assertEvaluationContract, assertProjectInvariants } from './contract';

describe('pin-pair sweep: every pin connected to every other pin', () => {
  for (const t of templates) {
    it(`${t.id}: no connection crashes, every result is a valid project with contract-clean findings`, () => {
      const { cases } = runPinSweep(t, registry);
      expect(cases.length).toBeGreaterThan(10);
      const errors = cases.filter((c) => c.error);
      expect(errors.map((c) => `${c.a.instance}.${c.a.pin}+${c.b.instance}.${c.b.pin}: ${c.error}`)).toEqual([]);
      // Re-run a deterministic slice through the schema and contract (all pairs would be slow only because of Zod).
      for (const c of cases.filter((_, i) => i % 7 === 0)) {
        const p2 = applyOps(t, connectPins(t, registry, c.a, c.b));
        expect(Project.safeParse(p2).success, `${c.key}`).toBe(true);
        assertProjectInvariants(p2, c.key);
        assertEvaluationContract(evaluate(p2, registry), p2, c.key);
      }
    });
  }
  for (const t of templates) it(`${t.id}: fresh-pair sweep: every 'finding' kind fires on the touched pins, no 'allowed' kind fires, every silent kind has a documented reason`, async () => {
    const { KNOWN_GAPS } = await import('../sweep');
    const { summary } = runPinSweep(t, registry, 'fresh');
    expect(summary.filter((s) => s.verdict === 'MISSED').map((s) => `${s.key}: ${s.relevant}/${s.tested}`)).toEqual([]);
    expect(summary.filter((s) => s.verdict === 'NOISY').map((s) => `${s.key}: ${s.fired}/${s.tested}`)).toEqual([]);
    for (const g of summary.filter((s) => s.verdict === 'gap')) expect(KNOWN_GAPS[g.key], `gap ${g.key} needs a documented reason`).toBeTruthy();
    // Merge mode is what the user experiences; every 'finding' kind must fire there too, on the touched pins.
    const merge = runPinSweep(t, registry, 'merge');
    expect(merge.summary.filter((s) => s.verdict === 'MISSED').map((s) => `${s.key}: ${s.relevant}/${s.tested}`)).toEqual([]);
  });
  it('docs/pin-sweep.md matches the code (run npm run sweep after changing rules or the table)', async () => {
    const { renderReport } = await import('../../../bench/pin-sweep');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('docs/pin-sweep.md', 'utf8')).toBe(renderReport());
  });
});
