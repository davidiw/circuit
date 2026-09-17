import { Project, EvaluationResult, Finding, MutationOp } from '../model/schema';
import { HistoryEvent } from '../model/history';
import { integrityProblems } from '../model/integrity';
import { registry } from '../data';
import { z } from 'zod';
import type { Session } from '../model/workflow';
import { getTemplate } from '../data';
import { applyOps } from '../eval/mutations';
import { stateHash } from '../eval/hash';

/**
 * Versioned browser persistence. Bump STORAGE_VERSION whenever the saved shape changes and add a migration step below.
 * A step that cannot carry data forward drops it and says so: the user is told that saved work from an earlier version was not kept.
 * Classification for the changelog: v1 -> v2 is upgradeable (older findings gain empty fix lists; older evaluations are re-parsed).
 */
export const STORAGE_KEY = 'circuit-factory.sessions';
export const LEGACY_KEY_V1 = 'circuit-factory.sessions.v1';
export const STORAGE_VERSION = 2;

export type Persisted = { version: number; sessions: Record<string, Session>; activeId?: string };
export type LoadResult = { sessions: Record<string, Session>; activeId?: string; notice?: string };

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;
/** Each entry migrates from its key version to the next. */
const MIGRATIONS: Record<number, Migration> = {
  1: (d) => ({ ...d, version: 2 }), // shape is the same; the per-session re-parse below adds default fields
};

function parseEvaluation(v: unknown): EvaluationResult | undefined {
  if (!v) return undefined;
  const r = EvaluationResult.safeParse(v); return r.success ? r.data : undefined;
}

/** Re-validate a session through the schemas; returns undefined if it cannot be trusted. */
function reviveSession(id: string, raw: Record<string, unknown>): Session | undefined {
  const projectRaw = raw.project as Record<string, unknown> | undefined;
  const template = getTemplate((projectRaw?.id as string) ?? id);
  let base: Project;
  if (template) base = structuredClone(template);                       // template sessions rebase on the current template
  else { const b = Project.safeParse(raw.base ?? projectRaw); if (!b.success) return undefined; base = b.data; }
  // v1 sessions stored applied mutation ids instead of an edit list; rebuild the edits from the template's mutations.
  const EditSchema = z.object({ label: z.string(), ops: z.array(MutationOp), mutationId: z.string().optional(), optimizationId: z.string().optional() });
  const editsParsed = Array.isArray(raw.edits) ? z.array(EditSchema).safeParse(raw.edits) : undefined;
  if (editsParsed && !editsParsed.success) return undefined;
  const editsRaw: Session['edits'] = editsParsed ? editsParsed.data
    : (Array.isArray(raw.appliedMutations) ? (raw.appliedMutations as string[]).map((m) => ({ label: template?.mutations.find((x) => x.id === m)?.label ?? m, ops: template?.mutations.find((x) => x.id === m)?.ops ?? [], mutationId: m })) : []);
  let project: Project;
  try { project = applyOps(structuredClone(base), editsRaw.flatMap((e) => e.ops ?? [])); } catch { return undefined; }
  if (!Project.safeParse(project).success || integrityProblems(project, registry).length) return undefined;
  const history = Array.isArray(raw.history) ? z.array(HistoryEvent).safeParse(raw.history) : undefined;
  const prev = parseEvaluation(raw.previousEvaluation);
  project.lastEvaluation = undefined;   // every revived session re-evaluates against the current rules; a stored result is never presented as current
  const ai = raw.aiReview as Session['aiReview'] | undefined;
  const aiObs = ai?.observations ? ai.observations.map((o) => Finding.safeParse(o)).filter((r) => r.success).map((r) => (r as { data: Finding }).data) : [];
  return {
    base, edits: editsRaw, project, currentHash: stateHash(project),
    history: history?.success ? history.data : [],
    lastSummary: raw.lastSummary as Session['lastSummary'], previousEvaluation: prev,
    aiReview: ai ? { ...ai, observations: aiObs } : undefined,
    dismissedTips: Array.isArray(raw.dismissedTips) ? raw.dismissedTips as string[] : [],
    appliedMutations: editsRaw.filter((e) => e.mutationId).map((e) => e.mutationId!),
    introDismissed: !!raw.introDismissed,
  };
}

export function loadSessions(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage): LoadResult {
  let raw: string | null = null; let legacy = false;
  try { raw = storage.getItem(STORAGE_KEY); if (!raw) { raw = storage.getItem(LEGACY_KEY_V1); legacy = !!raw; } } catch { return { sessions: {} }; }
  if (!raw) return { sessions: {} };
  let data: Record<string, unknown>;
  try { data = JSON.parse(raw); } catch { return { sessions: {}, notice: 'Saved work could not be read and was not kept.' }; }
  let version = typeof data.version === 'number' ? data.version : 1;
  if (version > STORAGE_VERSION) return { sessions: {}, notice: `Saved work came from a newer version of this app (v${version}) and was not loaded.` };
  while (version < STORAGE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { sessions: {}, notice: `Saved work from an earlier version (v${version}) could not be upgraded and was not kept.` };
    data = step(data); version++;
  }
  const sessions: Record<string, Session> = {}; const dropped: string[] = [];
  for (const [id, s] of Object.entries((data.sessions as Record<string, Record<string, unknown>>) ?? {})) {
    const revived = reviveSession(id, s);
    if (revived) sessions[id] = revived; else dropped.push(id);
  }
  const activeId = typeof data.activeId === 'string' && sessions[data.activeId] ? data.activeId : undefined;
  try { if (legacy) { storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, sessions, activeId })); storage.removeItem(LEGACY_KEY_V1); } } catch { /* ignore */ }
  return { sessions, activeId, notice: dropped.length ? `Saved work for ${dropped.join(', ')} came from an earlier version and could not be kept.` : undefined };
}

export function saveSessions(sessions: Record<string, Session>, activeId: string | undefined, storage: Pick<Storage, 'setItem'> = localStorage) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, sessions, activeId } satisfies Persisted)); } catch { /* ignore */ }
}
