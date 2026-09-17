import type { Project, Registry, PinRef, PinRole, Finding } from '../model/schema';
import { applyOps, connectPins } from './mutations';
import { evaluate } from './evaluate';
import { kicadVerdict, type KicadType } from './erc';

/**
 * Pin-pair sweep: connect every ordered pair of pins in a design, evaluate, and classify by pin-role pair.
 * This is how we know which wrong connections the rules reveal, which are allowed on purpose, and which are silent gaps.
 * It tests our handling of every assignment, not the layout library. The docs/pin-sweep.md report is generated from it.
 */
export type RoleClass = 'source' | 'ground' | 'supply_in' | 'logic_in' | 'gpio' | 'out' | 'motor_out' | 'motor_in' | 'analog_in' | 'cap' | 'diode' | 'bus' | 'speaker_out' | 'speaker_in' | 'switch';
export const ROLE_CLASS: Record<PinRole, RoleClass> = {
  supply_out: 'source', battery_pos: 'source', ground: 'ground', supply_in: 'supply_in', logic_in: 'logic_in', enable_in: 'logic_in', gpio: 'gpio',
  logic_out: 'out', analog_out: 'out', cathode: 'diode', motor_out: 'motor_out', motor_in: 'motor_in', analog_in: 'analog_in', cap_pos: 'cap', anode: 'diode',
  csi: 'bus', i2s: 'bus', speaker_out: 'speaker_out', speaker_in: 'speaker_in', switch: 'switch',
};
export type Expectation = 'finding' | 'allowed' | 'gap';
export const pairKey = (a: RoleClass, b: RoleClass) => [a, b].sort().join('+');

/**
 * What connecting two pins of these classes should produce. The base verdict is KiCad's default ERC pin-type matrix (src/eval/erc.ts);
 * domain extensions cover what the matrix cannot express (ground is a power input there; motors need a driver). 'gap' names the pairs
 * KiCad calls OK but a domain expert would still question; they are silent today and documented as best effort.
 */
const CLASS_TO_KICAD: Record<RoleClass, KicadType> = { source: 'PwrO', ground: 'PwrI', supply_in: 'PwrI', logic_in: 'I', gpio: 'Bi', out: 'O', motor_out: 'O', motor_in: 'Pas', analog_in: 'I', cap: 'Pas', diode: 'Pas', bus: 'Bi', speaker_out: 'O', speaker_in: 'Pas', switch: 'Pas' };
const EXTENSION_FINDINGS = new Set(['ground+source', 'ground+out', 'ground+motor_out', 'ground+speaker_out', 'ground+supply_in', 'gpio+ground', 'gpio+motor_in', 'motor_in+motor_in', 'motor_in+source', 'ground+motor_in']);
export const KNOWN_GAPS: Record<string, string> = {
  'logic_in+motor_out': 'an H-bridge output into a logic input: pin types are compatible but the motor-rail voltage exceeds logic levels; voltage on driven nets is not modeled',
  'analog_in+source': 'a supply straight into an ADC input: over-voltage on analog inputs is not modeled',
  'gpio+supply_in': 'a GPIO powering a module supply input: pin types are compatible but a GPIO cannot source module current; not modeled',
  'motor_out+supply_in': 'an H-bridge output feeding a supply input: switching supply, not modeled',
  'logic_in+supply_in': 'a logic input tied to a supply input with no source: covered only when a source joins the net',
  'motor_in+supply_in': 'a motor winding on a supply input: the motor would be driven by whatever supplies that pin; not modeled',
  'motor_in+out': 'a motor winding driven by a logic or analog output: output current limits are not modeled',
  'diode+motor_in': 'diode into a motor winding: flyback topology, not modeled', 'diode+motor_out': 'diode across a bridge output: not modeled', 'diode+out': 'diode on a logic output: not modeled', 'diode+gpio': 'diode on a GPIO: not modeled', 'diode+logic_in': 'diode into a logic input: not modeled', 'cap+diode': 'diode into a capacitor: not modeled', 'diode+diode': 'diode terminals tied: not modeled', 'diode+source': 'diode terminal on a supply: direction not modeled', 'diode+supply_in': 'diode feeding a supply input: forward drop is modeled only along the fixture path',
  'cap+gpio': 'capacitor on a GPIO: not modeled', 'cap+logic_in': 'capacitor on a logic input: not modeled', 'cap+motor_in': 'capacitor across a motor: not modeled', 'cap+motor_out': 'capacitor on a bridge output: not modeled', 'cap+out': 'capacitor on an output: not modeled',
  'analog_in+diode': 'not modeled', 'analog_in+cap': 'not modeled', 'analog_in+ground': 'ADC input grounded: reads zero; intent unknown', 'analog_in+logic_in': 'not modeled', 'analog_in+motor_in': 'not modeled', 'analog_in+motor_out': 'motor voltage into an ADC input: not modeled', 'analog_in+supply_in': 'not modeled',
};
export function expectationFor(a: RoleClass, b: RoleClass): { expectation: Expectation; kicad: 'OK' | 'WAR' | 'ERR'; why: string } {
  const key = pairKey(a, b); const kicad = kicadVerdict(CLASS_TO_KICAD[a], CLASS_TO_KICAD[b]);
  if (kicad !== 'OK') return { expectation: 'finding', kicad, why: `KiCad ERC ${kicad === 'ERR' ? 'error' : 'warning'}` };
  if (EXTENSION_FINDINGS.has(key)) return { expectation: 'finding', kicad, why: 'domain rule (ground short, motor drive)' };
  if (KNOWN_GAPS[key]) return { expectation: 'gap', kicad, why: KNOWN_GAPS[key] };
  return { expectation: 'allowed', kicad, why: 'KiCad OK; legitimate wiring' };
}

export type SweepCase = { a: PinRef; b: PinRef; key: string; expectation: Expectation; findings: Finding[]; fired: boolean; error?: string };
export type SweepSummary = { key: string; expectation: Expectation; kicad: 'OK' | 'WAR' | 'ERR'; why: string; tested: number; fired: number; verdict: 'covered' | 'allowed' | 'gap' | 'MISSED' };

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
    const { expectation } = expectationFor(ROLE_CLASS[A.role], ROLE_CLASS[B.role]);
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
    const fired = cs.filter((c) => c.fired).length; const [a, b] = key.split('+') as RoleClass[]; const e = expectationFor(a, b);
    const verdict: SweepSummary['verdict'] = e.expectation === 'finding' ? (fired === cs.length ? 'covered' : 'MISSED') : e.expectation === 'allowed' ? 'allowed' : 'gap';
    return { key, expectation: e.expectation, kicad: e.kicad, why: e.why, tested: cs.length, fired, verdict };
  }).sort((x, y) => x.key.localeCompare(y.key));
  return { cases, summary };
}
