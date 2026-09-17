import { describe, it, expect } from 'vitest';
import { registry, templates } from '../../data';
import { pinRefs } from '../sweep';
import { applyOps, connectPins, disconnectPin } from '../mutations';
import { evaluate } from '../evaluate';
import { layout } from '../layout';
import { assertProjectInvariants } from './contract';
import { assertLayoutInvariants } from './layout-contract';
import { ADVERSARIAL_TOPOLOGIES, applyTopology, largestMerges } from './adversarial';

/**
 * The arbitrary-connect path all the way to geometry. The pin-pair sweep proves connectPins -> applyOps -> evaluate; this
 * proves connectPins -> applyOps -> layout for every pair the UI can produce (merge mode, the nets the pins already sit on
 * join). The invariant is not attractive routing: a structurally valid edit may produce an ugly diagram, but never a crash,
 * a NaN, or a node or pin that does not exist.
 */
describe('pin-pair sweep through layout', () => {
  for (const t of templates) {
    it(`${t.id}: every merge-mode pin pair lays out with finite geometry over real parts and pins`, async () => {
      const pins = pinRefs(t, registry);
      let tested = 0; const failures: string[] = [];
      for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i].ref, b = pins[j].ref; const where = `${t.id} ${a.instance}.${a.pin}+${b.instance}.${b.pin}`;
        try {
          const ops = connectPins(t, registry, a, b); if (!ops.length) continue;
          const p2 = applyOps(t, ops); assertProjectInvariants(p2, where);
          evaluate(p2, registry);
          const l = await layout(p2, registry); assertLayoutInvariants(l, p2, registry, where);
          tested++;
        } catch (e) { failures.push(`${where}: ${(e as Error).message.split('\n')[0]}`); }
      }
      expect(failures).toEqual([]);
      expect(tested).toBeGreaterThan(t.id === 'water_leak_detector_v1' ? 30 : 200);
    }, 120_000);
  }
});

describe('disconnect sweep: a pin taken off its net neither moves nor disappears', () => {
  for (const t of templates) {
    it(`${t.id}: every single disconnect keeps every part's pins where the template drew them, and the freed pin stays drawn`, async () => {
      const ref = await layout(t, registry);
      const shape = (l: Awaited<ReturnType<typeof layout>>) => Object.fromEntries(l.nodes.map((n) => [n.id, { w: n.w, h: n.h, pins: n.pins.map((q) => `${q.name}@${q.side}:${q.x},${q.y}`) }]));
      const refShape = shape(ref);
      for (const { ref: pin } of pinRefs(t, registry)) {
        const ops = disconnectPin(pin); const p2 = applyOps(t, ops); const where = `${t.id} disconnect ${pin.instance}.${pin.pin}`;
        assertProjectInvariants(p2, where); evaluate(p2, registry);
        for (const compact of [false, true]) {
          const l = await layout(p2, registry, { compact }); assertLayoutInvariants(l, p2, registry, `${where} compact=${compact}`);
          expect(shape(l), `${where} compact=${compact}: part geometry unchanged by the edit`).toEqual(refShape);
          const q = l.nodes.find((n) => n.id === pin.instance)!.pins.find((x) => x.name === pin.pin)!;
          expect(q.wired, `${where}: freed pin reads unwired`).toBe(false);
        }
      }
    }, 60_000);
  }
});

describe('adversarial merged topologies through regular and compact layout', () => {
  for (const t of templates) {
    it(`${t.id}: named topologies and the largest single merges lay out in both modes`, async () => {
      const named = ADVERSARIAL_TOPOLOGIES.filter((x) => x.template === t.id).map((x) => ({ label: x.label, project: applyTopology(t, registry, x) }));
      const largest = largestMerges(t, registry, 24).map((m) => ({ label: `largest merge ${m.a.instance}.${m.a.pin}+${m.b.instance}.${m.b.pin}`, project: applyOps(t, connectPins(t, registry, m.a, m.b)) }));
      expect(named.length).toBeGreaterThan(0);
      for (const { label, project } of [...named, ...largest]) {
        assertProjectInvariants(project, label);
        evaluate(project, registry);
        for (const compact of [false, true]) { const l = await layout(project, registry, { compact }); assertLayoutInvariants(l, project, registry, `${t.id} ${label} compact=${compact}`); }
      }
    }, 60_000);
  }
  it('a topology with a removed part and a merge still lays out (the layout ignores pins of parts that are gone)', async () => {
    const t = templates[0];
    const p1 = applyOps(t, [{ op: 'remove_instance', instance: 'buck' }]);
    const p2 = applyOps(p1, connectPins(p1, registry, { instance: 'battery', pin: '-' }, { instance: 'mcu', pin: '5V' }));
    assertProjectInvariants(p2, 'removed buck');
    for (const compact of [false, true]) assertLayoutInvariants(await layout(p2, registry, { compact }), p2, registry, `removed buck compact=${compact}`);
  });
});
