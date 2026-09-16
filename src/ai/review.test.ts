import { describe, it, expect } from 'vitest';
import { registry, templates } from '../data';
import { applyMutation } from '../eval/mutations';
import { FakeProvider } from './fake';
import { reviewProject } from './review';

const car = templates[0];
const obs = (over: Partial<Record<string, unknown>> = {}) => ({
  title: 'Shared 5 V rail couples motor transients into the XIAO', severity: 'warning', category: 'transients',
  affected: [{ instanceId: 'mcu' }, { netId: 'RAIL_5V' }], rationale: 'One buck feeds both.', consequence: 'Resets under stall.',
  remediation: ['Separate rails'], confidence: 0.7, ...over,
});

describe('AI review gate', () => {
  it('malformed output yields no observations and a parse drop', async () => {
    const p = new FakeProvider(() => ({ nonsense: true }));
    const r = await reviewProject(car, registry, p);
    expect(r.observations).toEqual([]);
    expect(r.dropped).toBeGreaterThanOrEqual(1);
    expect(r.dropReasons[0]).toMatch(/parse/);
    expect(r.provider).toBe('fake');
  });

  it('keeps valid observations and drops ones naming unknown ids', async () => {
    const p = new FakeProvider(() => ({ observations: [obs(), obs({ title: 'ghost', affected: [{ instanceId: 'nope' }] }), obs({ title: 'bad net', affected: [{ netId: 'NOPE' }] })] }));
    const r = await reviewProject(car, registry, p);
    expect(r.observations).toHaveLength(1);
    expect(r.dropped).toBe(2);
    expect(r.observations.every((o) => o.origin === 'ai_review' && o.basis === 'ai_inference')).toBe(true);
    expect(r.observations[0].evidence[0]).toMatchObject({ label: 'model rationale', provenance: 'ai' });
    expect(r.observations[0].id).toBe('ai-1');
  });

  it('drops a contradiction without rationale, keeps one with rationale and a real rule id, drops one naming a fake rule', async () => {
    const p = new FakeProvider(() => ({ observations: [
      obs({ title: 'no reason', contradicts_rule: 'bulk_capacitance', rationale: '  ' }),
      obs({ title: 'with reason', contradicts_rule: 'bulk_capacitance', rationale: 'Motors are tiny; 470 uF is overkill.' }),
      obs({ title: 'fake rule', contradicts_rule: 'not_a_rule', rationale: 'because' }),
    ] }));
    const r = await reviewProject(car, registry, p);
    expect(r.observations.map((o) => o.title)).toEqual(['with reason']);
    expect(r.observations[0].ruleId).toBe('bulk_capacitance');
    expect(r.dropped).toBe(2);
  });

  it('maps an unknown category to other and records it', async () => {
    const p = new FakeProvider(() => ({ observations: [obs({ category: 'vibes' })] }));
    const r = await reviewProject(car, registry, p);
    expect(r.observations[0].category).toBe('other');
    expect(r.dropped).toBe(0);
    expect(r.dropReasons.some((d) => d.includes('mapped to other'))).toBe(true);
  });

  it('sends the deterministic finding for the force_stby_low mutation to the model', async () => {
    const p = new FakeProvider(() => ({ observations: [] }));
    const mutated = applyMutation(car, 'force_stby_low');
    await reviewProject(mutated, registry, p);
    expect(p.calls).toHaveLength(1);
    const { user, system } = p.calls[0];
    expect(user).toContain('## deterministic_findings');
    expect(user).toContain('driver_enable_state');
    expect(user).toContain('"severity":"violation"');
    expect(user).not.toContain('lastEvaluation');
    expect(user).not.toContain('"mutations"');
    expect(system).toContain('contradicts_rule');
    expect(p.calls[0].schema).toHaveProperty('properties');
  });
});
