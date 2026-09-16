import { templates } from '../src/data';
import { applyMutation } from '../src/eval/mutations';
import type { Project } from '../src/model/schema';

export type Expected = { ruleId: string; severity: string; category: string; affectedInstance?: string };
export type BenchCase = { id: string; template: string; mutation: string | null; project: Project; expected: Expected[] };

export const caseId = (template: string, mutation: string | null) => `${template}/${mutation ?? 'baseline'}`;

/** Frozen corpus: every template baseline plus every mutation, with the structured findings the fixtures expect. */
export const cases: BenchCase[] = templates.flatMap((t) => [
  { id: caseId(t.id, null), template: t.id, mutation: null, project: t, expected: t.expectedBaseline },
  ...t.mutations.map((m) => ({ id: caseId(t.id, m.id), template: t.id, mutation: m.id, project: applyMutation(t, m.id), expected: m.expected })),
]);
