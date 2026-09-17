import type { PinRef, Project, Registry } from '../../model/schema';
import { applyOps, connectPins } from '../mutations';
import { pinRefs } from '../sweep';

/**
 * Merged-net topologies a user can reach through the normal connect flow that are electrically absurd and geometrically
 * awkward: rails swallowed by ground, sources shorted, motor outputs on supplies, everything on one net. Found by the
 * pin-pair sweep; kept by name so the compact-layout and React render corpora exercise the same states. Each entry is a
 * sequence of connects applied in order (merge mode, exactly as the UI does it).
 */
export type Topology = { template: string; label: string; pairs: [PinRef, PinRef][] };
const P = (s: string): PinRef => { const i = s.indexOf('.'); return { instance: s.slice(0, i), pin: s.slice(i + 1) }; };
const pair = (a: string, b: string): [PinRef, PinRef] => [P(a), P(b)];

export const ADVERSARIAL_TOPOLOGIES: Topology[] = [
  { template: 'race_car_bt_v1', label: 'ground swallows the 5 V rail (ten-pin ground, power flags vanish)', pairs: [pair('battery.-', 'buck.OUT+')] },
  { template: 'race_car_bt_v1', label: 'battery positive into ground', pairs: [pair('battery.+', 'mcu.GND')] },
  { template: 'race_car_bt_v1', label: 'motor output onto the 5 V rail', pairs: [pair('driver.MOTORA1', 'buck.OUT+')] },
  { template: 'race_car_bt_v1', label: 'buck input tied to buck output', pairs: [pair('buck.IN+', 'buck.OUT+')] },
  { template: 'race_car_bt_v1', label: 'two motor windings tied', pairs: [pair('motor_left.M+', 'motor_right.M-')] },
  { template: 'race_car_bt_v1', label: 'STBY into ground (the walkthrough edit)', pairs: [pair('mcu.D6', 'driver.GND')] },
  { template: 'race_car_bt_v1', label: 'every rail and ground on one net', pairs: [pair('battery.-', 'buck.OUT+'), pair('mcu.3V3', 'battery.-'), pair('battery.+', 'battery.-'), pair('buck.IN+', 'battery.-')] },
  { template: 'race_car_bt_v1', label: 'all control signals merged with a motor output', pairs: [pair('mcu.D0', 'mcu.D1'), pair('mcu.D2', 'mcu.D0'), pair('mcu.D3', 'mcu.D0'), pair('mcu.D4', 'mcu.D0'), pair('mcu.D5', 'mcu.D0'), pair('driver.MOTORB2', 'mcu.D0')] },
  { template: 'video_doorbell_v1', label: 'supply shorted to its own return', pairs: [pair('psu.+', 'psu.-')] },
  { template: 'video_doorbell_v1', label: 'camera bus onto the speaker', pairs: [pair('amp.SPK+', 'mcu.CSI')] },
  { template: 'video_doorbell_v1', label: 'button pulls the 5 V rail into ground', pairs: [pair('mcu.5V', 'button.2'), pair('amp.SPK-', 'button.2')] },
  { template: 'water_leak_detector_v1', label: 'battery shorted', pairs: [pair('battery.+', 'battery.-')] },
  { template: 'water_leak_detector_v1', label: 'sensor signal onto the 3.3 V rail, then everything to ground', pairs: [pair('sensor.SIG', 'mcu.3V3'), pair('battery.-', 'mcu.3V3'), pair('battery.+', 'battery.-')] },
];

export function applyTopology(base: Project, registry: Registry, t: Topology): Project {
  let p = base;
  for (const [a, b] of t.pairs) { const ops = connectPins(p, registry, a, b); if (!ops.length) throw new Error(`${t.label}: ${a.instance}.${a.pin} and ${b.instance}.${b.pin} are already joined`); p = applyOps(p, ops); }
  return p;
}

/** The single-connect merges that produce the largest nets, most nets merged first: a deterministic "ugliest" slice of the sweep. */
export function largestMerges(base: Project, registry: Registry, limit: number): { a: PinRef; b: PinRef; maxNet: number }[] {
  const pins = pinRefs(base, registry); const out: { a: PinRef; b: PinRef; maxNet: number; nets: number }[] = [];
  for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
    const ops = connectPins(base, registry, pins[i].ref, pins[j].ref); if (!ops.length) continue;
    const p2 = applyOps(base, ops); out.push({ a: pins[i].ref, b: pins[j].ref, maxNet: Math.max(...p2.nets.map((n) => n.pins.length)), nets: p2.nets.length });
  }
  return out.sort((x, y) => y.maxNet - x.maxNet || x.nets - y.nets).slice(0, limit);
}
