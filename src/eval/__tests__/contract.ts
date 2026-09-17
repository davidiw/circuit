import { expect } from 'vitest';
import type { Finding, Project, EvaluationResult } from '../../model/schema';
import { COVERAGE_DIMENSIONS } from '../../model/vocab';

const KNOWN_DIMS = new Set<string>([...COVERAGE_DIMENSIONS.electrical, ...COVERAGE_DIMENSIONS.product, 'motor_operating_point', 'runtime']);

/** What every finding owes the user: it names something real, shows evidence with provenance, says what happens, and says what to do (or admits it cannot). */
export function assertFindingContract(f: Finding, p: Project, where = '') {
  const ctx = `${where} ${f.ruleId}: "${f.title}"`;
  expect(f.title.trim().length, `${ctx} title`).toBeGreaterThan(8);
  expect(f.consequence.trim().length, `${ctx} consequence`).toBeGreaterThan(20);
  expect(f.remediation.length + (f.missing?.length ?? 0), `${ctx} remediation or missing`).toBeGreaterThan(0);
  expect(f.evidence.length, `${ctx} evidence`).toBeGreaterThan(0);
  for (const e of f.evidence) expect(e.provenance, `${ctx} evidence provenance`).toBeTruthy();
  // A violation must point at something, or say what is missing (the one project-level case: no power source).
  if (f.severity === 'violation' || f.severity === 'warning') expect(f.affected.length + (f.missing?.length ?? 0), `${ctx} affected or missing`).toBeGreaterThan(0);
  for (const a of f.affected) {
    if (a.instanceId) { const inst = p.instances.find((i) => i.id === a.instanceId); expect(inst, `${ctx} affected instance ${a.instanceId}`).toBeTruthy(); }
    if (a.netId) expect(p.nets.find((n) => n.id === a.netId), `${ctx} affected net ${a.netId}`).toBeTruthy();
    if (a.requirementId) expect(p.requirements.find((r) => r.id === a.requirementId), `${ctx} affected requirement`).toBeTruthy();
  }
  // Hobbyist-facing text: no internal vocabulary, no repeated names in a title, evidence that says something.
  const text = [f.title, f.consequence, ...f.remediation].join(' ');
  expect(text, `${ctx} leaks internal vocabulary`).not.toMatch(/\bregistry\b|\bfixture\b|\bunresolved\b|\bPwrO\b|\bPwrI\b|_[a-z]+_[a-z]+/);
  expect(f.title, `${ctx} repeats a name`).not.toMatch(/\b(.{4,}?), \1\b/);
  expect(f.evidence.every((e) => e.value === 'unknown'), `${ctx} evidence all unknown`).toBe(false);
  for (const fix of f.fixes) { expect(fix.label.length, `${ctx} fix label`).toBeGreaterThan(3); expect(fix.ops.length, `${ctx} fix ops`).toBeGreaterThan(0); }
}

export function assertEvaluationContract(r: EvaluationResult, p: Project, where = '') {
  for (const f of r.findings) assertFindingContract(f, p, where);
  for (const c of r.coverage) { expect(KNOWN_DIMS.has(c.dimension) || p.requirements.some((q) => q.kind === c.dimension), `${where} unknown coverage dimension ${c.dimension}`).toBe(true); expect(c.note.length, `${where} coverage note`).toBeGreaterThan(0); }
  expect(r.stateHash.length).toBe(16);
}

/** Structural invariants of a project after any edit. */
export function assertProjectInvariants(p: Project, where = '') {
  const seen = new Set<string>();
  for (const n of p.nets) {
    expect(n.pins.length, `${where} net ${n.id} empty`).toBeGreaterThan(0);
    for (const pin of n.pins) { const k = `${pin.instance}.${pin.pin}`; expect(seen.has(k), `${where} ${k} on two nets`).toBe(false); seen.add(k); expect(p.instances.some((i) => i.id === pin.instance), `${where} ${k} dangling`).toBe(true); }
  }
  if (p.power.sourceInstance) expect(p.instances.some((i) => i.id === p.power.sourceInstance), `${where} power source missing`).toBe(true);
}
