import type { Project, Registry, PinRef, PinRole, Finding } from '../model/schema';
import { applyOps, connectPins } from './mutations';
import { evaluate } from './evaluate';

/**
 * Pin-pair sweep: connect every ordered pair of pins in a design, evaluate, and classify by pin-role pair.
 * This is how we know which wrong connections the rules reveal, which are allowed on purpose, and which are silent gaps.
 * It tests our handling of every assignment, not the layout library. The docs/pin-sweep.md report is generated from it.
 */
export type RoleClass = 'source' | 'ground' | 'supply_in' | 'logic_in' | 'gpio' | 'out' | 'motor_out' | 'motor_in' | 'analog_in' | 'cap' | 'anode' | 'bus' | 'speaker_out' | 'speaker_in' | 'switch';
export const ROLE_CLASS: Record<PinRole, RoleClass> = {
  supply_out: 'source', battery_pos: 'source', ground: 'ground', supply_in: 'supply_in', logic_in: 'logic_in', enable_in: 'logic_in', gpio: 'gpio',
  logic_out: 'out', analog_out: 'out', cathode: 'out', motor_out: 'motor_out', motor_in: 'motor_in', analog_in: 'analog_in', cap_pos: 'cap', anode: 'anode',
  csi: 'bus', i2s: 'bus', speaker_out: 'speaker_out', speaker_in: 'speaker_in', switch: 'switch',
};
export type Expectation = 'finding' | 'allowed' | 'gap';
export const pairKey = (a: RoleClass, b: RoleClass) => [a, b].sort().join('+');

/** What connecting two pins of these classes should produce. 'finding': a rule must fire. 'allowed': legitimate wiring, silence is correct. 'gap': silent today; documented as best effort. */
export const EXPECT: Record<string, Expectation> = {
  'source+source': 'finding', 'ground+source': 'finding', 'ground+out': 'finding', 'ground+motor_out': 'finding', 'out+out': 'finding', 'motor_out+motor_out': 'finding',
  'out+source': 'finding', 'motor_out+source': 'finding', 'gpio+source': 'finding', 'gpio+ground': 'finding', 'ground+supply_in': 'finding',
  'gpio+motor_in': 'finding', 'gpio+motor_out': 'finding', 'gpio+out': 'finding', 'motor_out+out': 'finding', 'motor_in+motor_in': 'finding', 'motor_in+source': 'finding', 'ground+motor_in': 'finding',
  'ground+speaker_out': 'finding', 'source+speaker_out': 'finding', 'out+speaker_out': 'finding', 'motor_out+speaker_out': 'finding',
  'source+supply_in': 'allowed', 'motor_in+motor_out': 'allowed', 'gpio+logic_in': 'allowed', 'logic_in+source': 'allowed', 'ground+logic_in': 'allowed',
  'cap+source': 'allowed', 'cap+ground': 'allowed', 'cap+supply_in': 'allowed', 'anode+source': 'allowed', 'anode+ground': 'allowed', 'anode+supply_in': 'allowed',
  'bus+bus': 'allowed', 'analog_in+out': 'allowed', 'speaker_in+speaker_out': 'allowed', 'switch+switch': 'allowed', 'gpio+switch': 'allowed', 'ground+switch': 'allowed',
  'supply_in+supply_in': 'allowed', 'logic_in+logic_in': 'allowed', 'gpio+gpio': 'allowed', 'out+supply_in': 'allowed', 'logic_in+out': 'allowed',
};

export type SweepCase = { a: PinRef; b: PinRef; key: string; expectation: Expectation; findings: Finding[]; fired: boolean; error?: string };
export type SweepSummary = { key: string; expectation: Expectation; tested: number; fired: number; verdict: 'covered' | 'allowed' | 'gap' | 'MISSED' };

export function pinRefs(project: Project, registry: Registry): { ref: PinRef; role: PinRole }[] {
  const out: { ref: PinRef; role: PinRole }[] = [];
  for (const inst of project.instances) { const c = registry.components.find((x) => x.id === inst.registryId); if (!c) continue; for (const p of c.pins) out.push({ ref: { instance: inst.id, pin: p.name }, role: p.role }); }
  return out;
}

export function runPinSweep(project: Project, registry: Registry): { cases: SweepCase[]; summary: SweepSummary[] } {
  const pins = pinRefs(project, registry);
  const baseline = new Set(evaluate(project, registry).findings.map((f) => `${f.ruleId}|${f.title}`));
  const cases: SweepCase[] = [];
  for (const A of pins) for (const B of pins) {
    if (A.ref.instance === B.ref.instance) continue;                       // same part: not the question
    if (A.ref.instance > B.ref.instance || (A.ref.instance === B.ref.instance && A.ref.pin >= B.ref.pin)) continue; // unordered pairs
    const key = pairKey(ROLE_CLASS[A.role], ROLE_CLASS[B.role]);
    const expectation = EXPECT[key] ?? 'gap';
    try {
      const ops = connectPins(project, registry, A.ref, B.ref); if (!ops.length) continue;      // already on one net
      const p2 = applyOps(project, ops); const r = evaluate(p2, registry);
      const fresh = r.findings.filter((f) => (f.severity === 'violation' || f.severity === 'warning') && !baseline.has(`${f.ruleId}|${f.title}`));
      cases.push({ a: A.ref, b: B.ref, key, expectation, findings: fresh, fired: fresh.length > 0 });
    } catch (e) { cases.push({ a: A.ref, b: B.ref, key, expectation, findings: [], fired: false, error: (e as Error).message }); }
  }
  const byKey = new Map<string, SweepCase[]>();
  for (const c of cases) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  const summary: SweepSummary[] = [...byKey.entries()].map(([key, cs]) => {
    const fired = cs.filter((c) => c.fired).length; const exp = cs[0].expectation;
    const verdict: SweepSummary['verdict'] = exp === 'finding' ? (fired === cs.length ? 'covered' : 'MISSED') : exp === 'allowed' ? 'allowed' : 'gap';
    return { key, expectation: exp, tested: cs.length, fired, verdict };
  }).sort((x, y) => x.key.localeCompare(y.key));
  return { cases, summary };
}
