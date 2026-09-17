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
  it('race car: every pair the role table says must fire does fire; gaps are known, not silent', () => {
    const { summary } = runPinSweep(templates[0], registry);
    const missed = summary.filter((s) => s.verdict === 'MISSED');
    expect(missed.map((s) => `${s.key}: ${s.fired}/${s.tested}`)).toEqual([]);
    const gaps = summary.filter((s) => s.verdict === 'gap').map((s) => s.key);
    // Known best-effort gaps. Adding a rule that covers one must also move it out of this list (and into EXPECT), so the report stays honest.
    expect(gaps).toEqual(['anode+cap', 'anode+gpio', 'anode+logic_in', 'anode+motor_in', 'anode+motor_out', 'cap+gpio', 'cap+logic_in', 'cap+motor_in', 'cap+motor_out', 'cap+out', 'gpio+supply_in', 'logic_in+motor_in', 'logic_in+supply_in', 'motor_in+out', 'motor_in+supply_in', 'motor_out+supply_in']);
  });
});
