import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { registry, templates } from '../../data';
import { applyOps, connectPins, disconnectPin } from '../mutations';
import { evaluate } from '../evaluate';
import { pinRefs } from '../sweep';
import { Project, type MutationOp } from '../../model/schema';
import { assertEvaluationContract, assertProjectInvariants } from './contract';

/** Random edit sequences from the real op vocabulary. Every step must leave a valid, evaluable, renderable-contract project. fast-check shrinks failures to a minimal sequence. */
type Step = { kind: 'connect'; a: number; b: number } | { kind: 'disconnect'; a: number } | { kind: 'remove'; i: number } | { kind: 'mutation'; m: number } | { kind: 'fix'; f: number; x: number } | { kind: 'optimize'; o: number } | { kind: 'undo' };
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('connect' as const), a: fc.nat(200), b: fc.nat(200) }),
  fc.record({ kind: fc.constant('disconnect' as const), a: fc.nat(200) }),
  fc.record({ kind: fc.constant('remove' as const), i: fc.nat(20) }),
  fc.record({ kind: fc.constant('mutation' as const), m: fc.nat(20) }),
  fc.record({ kind: fc.constant('fix' as const), f: fc.nat(10), x: fc.nat(3) }),
  fc.record({ kind: fc.constant('optimize' as const), o: fc.nat(3) }),
  fc.constant({ kind: 'undo' as const }),
);

describe('edit sequences (property)', () => {
  for (const t of templates) {
    it(`${t.id}: any sequence of up to 8 edits keeps the project valid, evaluable, and contract-clean`, () => {
      fc.assert(fc.property(fc.array(stepArb, { minLength: 1, maxLength: 8 }), (steps) => {
        const stack: MutationOp[][] = [];
        const current = () => applyOps(t, stack.flat());
        for (const s of steps) {
          const p = current(); const pins = pinRefs(p, registry);
          let ops: MutationOp[] = [];
          if (s.kind === 'connect' && pins.length) ops = connectPins(p, registry, pins[s.a % pins.length].ref, pins[s.b % pins.length].ref);
          else if (s.kind === 'disconnect' && pins.length) ops = disconnectPin(pins[s.a % pins.length].ref);
          else if (s.kind === 'remove' && p.instances.length) { const inst = p.instances[s.i % p.instances.length]; ops = [...(p.power.sourceInstance === inst.id ? [{ op: 'clear_power_source' as const }] : []), { op: 'remove_instance', instance: inst.id }]; }
          else if (s.kind === 'mutation' && t.mutations.length) ops = t.mutations[s.m % t.mutations.length].ops;
          else if (s.kind === 'fix') { const fx = evaluate(p, registry).findings.flatMap((f) => f.fixes.filter((x) => x.kind === 'edit')); if (fx.length) ops = fx[s.f % fx.length].ops; }
          else if (s.kind === 'optimize' && t.optimizations.length) ops = t.optimizations[s.o % t.optimizations.length].ops;
          else if (s.kind === 'undo') { stack.pop(); continue; }
          if (ops.length) stack.push(ops);
          const next = current();
          expect(Project.safeParse(next).success).toBe(true);
          assertProjectInvariants(next, JSON.stringify(s));
          assertEvaluationContract(evaluate(next, registry), next, JSON.stringify(s));
        }
      }), { numRuns: 40, seed: 20260916 });
    });
  }
});
