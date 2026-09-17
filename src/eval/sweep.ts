import type { Project, Registry, PinRef, PinRole, Finding } from '../model/schema';
import { applyOps, connectPins, disconnectPin } from './mutations';
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
const EXTENSION_FINDINGS = new Set(['ground+source', 'ground+out', 'ground+motor_out', 'ground+speaker_out', 'ground+supply_in', 'gpio+ground', 'gpio+motor_in']);
export const KNOWN_GAPS: Record<string, string> = {
  'gpio+motor_out': 'an H-bridge output into a GPIO: pin types are compatible but the motor-rail voltage exceeds the GPIO rating; voltage on driven nets is not modeled',
  'logic_in+motor_out': 'an H-bridge output into a logic input: pin types are compatible but the motor-rail voltage exceeds logic levels; voltage on driven nets is not modeled',
  'analog_in+source': 'a supply straight into an ADC input: over-voltage on analog inputs is not modeled',
  'gpio+supply_in': 'a GPIO powering a module supply input: pin types are compatible but a GPIO cannot source module current; not modeled',
  'motor_out+supply_in': 'an H-bridge output feeding a supply input: switching supply, not modeled',
  'logic_in+supply_in': 'a logic input tied to a supply input with no source: covered only when a source joins the net',
  'ground+motor_in': 'one motor terminal grounded: the missing driver is already reported; the grounding itself is not modeled',
  'motor_in+motor_in': 'two windings tied without a driver: reported only as undriven, not as a short between motors',
  'motor_in+source': 'a motor winding straight on a supply: the motor runs uncontrolled at supply voltage; not modeled',
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
  return { expectation: 'allowed', kicad, why: 'KiCad OK; domain rules may still fire on voltage, enable state, or an undriven net' };
}

export type SweepCase = { a: PinRef; b: PinRef; key: string; expectation: Expectation; findings: Finding[]; fired: boolean; relevant: boolean; error?: string };
export type SweepSummary = { key: string; expectation: Expectation; kicad: 'OK' | 'WAR' | 'ERR'; why: string; tested: number; fired: number; relevant: number; verdict: 'covered' | 'allowed' | 'gap' | 'MISSED' | 'NOISY' };
export type SweepMode = 'fresh' | 'merge';

export function pinRefs(project: Project, registry: Registry): { ref: PinRef; role: PinRole }[] {
  const out: { ref: PinRef; role: PinRole }[] = [];
  for (const inst of project.instances) { const c = registry.components.find((x) => x.id === inst.registryId); if (!c) continue; for (const p of c.pins) out.push({ ref: { instance: inst.id, pin: p.name }, role: p.role }); }
  return out;
}

/**
 * mode 'fresh': both pins are first taken off their nets, then joined on a new two-pin net, so the result answers "what does this pair alone reveal".
 * mode 'merge': the pins are joined as the UI does it (their existing nets merge), which is what a user actually experiences.
 * A finding counts as relevant when it names one of the two pins; only relevant findings earn a 'covered' verdict.
 */
export function runPinSweep(project: Project, registry: Registry, mode: SweepMode = 'fresh'): { cases: SweepCase[]; summary: SweepSummary[] } {
  const pins = pinRefs(project, registry);
  const templateBaseline = new Set(evaluate(project, registry).findings.map((f) => `${f.ruleId}|${f.title}`));
  const cases: SweepCase[] = [];
  const touches = (f: Finding, a: PinRef, b: PinRef) => f.affected.some((x) => (x.instanceId === a.instance && (!x.pin || x.pin === a.pin)) || (x.instanceId === b.instance && (!x.pin || x.pin === b.pin)));
  for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
    const A = pins[i], B = pins[j];
    const key = pairKey(ROLE_CLASS[A.role], ROLE_CLASS[B.role]);
    const { expectation } = expectationFor(ROLE_CLASS[A.role], ROLE_CLASS[B.role]);
    try {
      let p1 = project; let baseline = templateBaseline;
      // Fresh mode: the baseline is the disconnected state, so findings caused by lifting the pins (a lost ground reference) are not credited to the join.
      if (mode === 'fresh') { p1 = applyOps(project, [...disconnectPin(A.ref), ...disconnectPin(B.ref)]); baseline = new Set(evaluate(p1, registry).findings.map((f) => `${f.ruleId}|${f.title}`)); }
      const ops = connectPins(p1, registry, A.ref, B.ref); if (!ops.length) continue;      // already on one net (merge mode only)
      const p2 = applyOps(p1, ops); const r = evaluate(p2, registry);
      const fresh = r.findings.filter((f) => (f.severity === 'violation' || f.severity === 'warning') && !baseline.has(`${f.ruleId}|${f.title}`));
      const relevant = fresh.filter((f) => touches(f, A.ref, B.ref));
      cases.push({ a: A.ref, b: B.ref, key, expectation, findings: fresh, fired: fresh.length > 0, relevant: relevant.length > 0 });
    } catch (e) { cases.push({ a: A.ref, b: B.ref, key, expectation, findings: [], fired: false, relevant: false, error: (e as Error).message }); }
  }
  const byKey = new Map<string, SweepCase[]>();
  for (const c of cases) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  const summary: SweepSummary[] = [...byKey.entries()].map(([key, cs]) => {
    const fired = cs.filter((c) => c.fired).length; const relevant = cs.filter((c) => c.relevant).length; const [a, b] = key.split('+') as RoleClass[]; const e = expectationFor(a, b);
    // 'allowed' means KiCad calls the pairing OK; a domain rule (voltage range, enable state, undriven net) may still fire, and every such firing must name one of the two pins. A firing that names neither is noise.
    const verdict: SweepSummary['verdict'] = e.expectation === 'finding' ? (relevant === cs.length ? 'covered' : 'MISSED') : e.expectation === 'allowed' ? (mode === 'fresh' && fired > relevant ? 'NOISY' : 'allowed') : 'gap';
    return { key, expectation: e.expectation, kicad: e.kicad, why: e.why, tested: cs.length, fired, relevant, verdict };
  }).sort((x, y) => x.key.localeCompare(y.key));
  return { cases, summary };
}

export const ROLE_CLASSES: RoleClass[] = ['source', 'ground', 'supply_in', 'logic_in', 'gpio', 'out', 'motor_out', 'motor_in', 'analog_in', 'cap', 'diode', 'bus', 'speaker_out', 'speaker_in', 'switch'];
export function allPairKinds(): string[] { const out: string[] = []; for (let i = 0; i < ROLE_CLASSES.length; i++) for (let j = i; j < ROLE_CLASSES.length; j++) out.push(pairKey(ROLE_CLASSES[i], ROLE_CLASSES[j])); return out; }
