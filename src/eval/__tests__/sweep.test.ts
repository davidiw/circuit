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
  it('race car: every pair the role table says must fire does fire; gaps are known, not silent', async () => {
    const { summary } = runPinSweep(templates[0], registry);
    const missed = summary.filter((s) => s.verdict === 'MISSED');
    expect(missed.map((s) => `${s.key}: ${s.fired}/${s.tested}`)).toEqual([]);
    // Every silent pair kind must be a documented gap with a reason; a new rule that covers one must remove it from KNOWN_GAPS.
    const { KNOWN_GAPS } = await import('../sweep');
    const gaps = summary.filter((s) => s.verdict === 'gap');
    for (const g of gaps) expect(KNOWN_GAPS[g.key], `gap ${g.key} needs a documented reason`).toBeTruthy();
    // A gap kind may still fire incidentally when the merged net contains other pins (a GPIO joining the battery rail); that is coverage by neighbors, not by design, so it stays a gap.
  });
});
