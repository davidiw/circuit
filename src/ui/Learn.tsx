import type { ReactNode } from 'react';
import type { Project, Provenance, Registry, DesignGuide } from '../model/schema';
import type { Session } from '../model/workflow';
import { registry } from '../data';
import type { Ctx } from '../eval/context';
import type { Action } from './store';
import { Prov } from './Sheet';

/**
 * Learn / How this design works. Read-only explanatory content from the project's designGuide and each part's registry
 * guide. It never touches design state: clicking a step, part, or decision only changes which artifacts the diagram
 * highlights (session.learn.focus), and every number in the prose is a live registry fact or project assumption rendered
 * with its provenance tag, so an assumed value never reads as a verified one.
 */
export type Focus = { instances: Set<string>; nets: Set<string> };
const TOKEN = /\{\{([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\}\}/g;

/** Resolve one `{{instance.fact}}` or `{{assumption.key}}` token against the project and registry. */
export function resolveToken(project: Project, reg: Registry, scope: string, key: string): { value: string; provenance: Provenance } | undefined {
  if (scope === 'assumption') { const a = project.assumptions.find((x) => x.key === key); return a ? { value: fmt(a.value), provenance: a.source === 'user' ? 'user' : 'fixture_assumption' } : undefined; }
  const inst = project.instances.find((i) => i.id === scope); if (!inst) return undefined;
  const prop = inst.props[key]; if (prop) return { value: fmt(prop.value), provenance: prop.provenance };
  const c = reg.components.find((x) => x.id === inst.registryId); const f = c?.facts[key];
  return f ? { value: fmt(f.value), provenance: f.provenance } : undefined;
}
const fmt = (v: unknown) => Array.isArray(v) ? v.join(', ') : typeof v === 'number' ? String(v) : String(v);
export const tokensIn = (text: string) => [...text.matchAll(TOKEN)].map((m) => ({ scope: m[1], key: m[2] }));

/** Prose with each token rendered as its value plus provenance tag. Unresolvable tokens render as "unknown" with the unknown tag. */
export function Explain({ text, project }: { text: string; project: Project }) {
  const out: ReactNode[] = []; let last = 0; let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    out.push(text.slice(last, m.index)); const r = resolveToken(project, registry, m[1], m[2]);
    out.push(<span key={i++} className="tok"><b>{r ? r.value : 'unknown'}</b> <Prov p={r ? r.provenance : 'unknown'} /></span>);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/** What the diagram should highlight for a focus id, or undefined for none. Pure. */
export function guideFocus(project: Project, focus: string | undefined): Focus | undefined {
  const g = project.designGuide; if (!g || !focus) return undefined;
  const i = focus.indexOf(':'); const kind = focus.slice(0, i), id = focus.slice(i + 1);
  const netsOf = (inst: string) => project.nets.filter((n) => n.pins.some((p) => p.instance === inst)).map((n) => n.id);
  if (kind === 'part') return project.instances.some((x) => x.id === id) ? { instances: new Set([id]), nets: new Set(netsOf(id)) } : undefined;
  const item = kind === 'flow' ? g.flow.find((x) => x.id === id) : kind === 'decision' ? g.decisions.find((x) => x.id === id) : undefined;
  if (!item) return undefined;
  const instances = item.relatedInstances.filter((x) => project.instances.some((y) => y.id === x));
  const nets = item.relatedNets.filter((x) => project.nets.some((y) => y.id === x));
  return { instances: new Set(instances), nets: new Set(nets) };
}

export function LearnCard({ session, dispatch }: { session: Session; dispatch: React.Dispatch<Action> }) {
  const g = session.project.designGuide; if (!g) return null;
  return (
    <section className="panel learn-card" id="panel-learn-card">
      <h4>How this design works</h4>
      <p>{g.summary}</p>
      {session.learn ? <span className="muted small">Open beside the diagram.</span> : <button className="btn small primary" id="btn-learn" onClick={() => dispatch({ type: 'LEARN_OPEN' })}>How this design works →</button>}
    </section>
  );
}

export function LearnLine({ session, dispatch }: { session: Session; dispatch: React.Dispatch<Action> }) {
  if (!session.project.designGuide || session.learn) return null;
  return <div className="learn-line"><button className="btn small" id="btn-learn-m" onClick={() => dispatch({ type: 'LEARN_OPEN' })}>How this design works →</button></div>;
}

const RS: Record<string, string> = { pass: 'met', fail: 'not met', above_target: 'above target', not_evaluated: 'informational', unknown: 'not evaluated yet' };

export function LearnSheet({ session, ctx, dispatch, reqStatus }: { session: Session; ctx: Ctx; dispatch: React.Dispatch<Action>; reqStatus: Record<string, string> }) {
  const p = session.project; const g: DesignGuide | undefined = p.designGuide; const focus = session.learn?.focus;
  if (!g) return null;
  const set = (id: string) => dispatch({ type: 'LEARN_FOCUS', id });
  const on = (id: string) => focus === id;
  const step = g.flow.find((s) => on(`flow:${s.id}`));
  return (
    <section className="sheet learn" id="panel-learn" aria-label="How this design works">
      <header><div><b>How this design works</b><div className="muted small">{p.title}</div></div><button className="btn ghost small" onClick={() => dispatch({ type: 'LEARN_CLOSE' })} aria-label="Close">✕</button></header>
      <p className="explain">{g.summary}</p>

      <h5>How the system works</h5>
      <ol className="chain" aria-label="System flow">{g.flow.map((s) => <li key={s.id}><button className={on(`flow:${s.id}`) ? 'on' : ''} aria-pressed={on(`flow:${s.id}`)} onClick={() => set(`flow:${s.id}`)}>{s.label}</button></li>)}</ol>
      {step ? <div className="explain" id="learn-step"><Explain text={step.explanation} project={p} /></div> : <div className="muted small">Tap a step to see what happens there; the diagram highlights the parts and wires involved.</div>}
      <div className="paths">
        <div><b>Power:</b> <Explain text={g.paths.power} project={p} /></div>
        <div><b>Control:</b> <Explain text={g.paths.control} project={p} /></div>
        <div><b>Result:</b> <Explain text={g.paths.outcome} project={p} /></div>
      </div>

      <h5>Why it is built this way</h5>
      <ul className="decisions">
        {g.decisions.map((d) => {
          const id = `decision:${d.id}`; const req = d.relatedRequirement ? p.requirements.find((r) => r.id === d.relatedRequirement) : undefined;
          const asm = d.relatedAssumption ? p.assumptions.find((a) => a.key === d.relatedAssumption) : undefined;
          const opt = d.relatedOptimization ? p.optimizations.find((o) => o.id === d.relatedOptimization) : undefined;
          return (
            <li key={d.id} className={on(id) ? 'on' : ''}>
              <button className="q" aria-expanded={on(id)} onClick={() => set(id)}>{d.title}</button>
              {on(id) && <>
                <div className="explain"><Explain text={d.explanation} project={p} /></div>
                <div className="related">
                  {req && <span className="tag">requirement · {req.label}{reqStatus[req.id] ? ` · ${RS[reqStatus[req.id]] ?? reqStatus[req.id]}` : ''}</span>}
                  {asm && <span className="tag asm">{asm.key.replace(/_/g, ' ')} · {String(asm.value)} · {asm.source === 'user' ? 'you' : 'assumed'}</span>}
                  {d.relatedInstances.length > 0 && <span className="muted small">highlighted: {d.relatedInstances.map((x) => ctx.inst(x)?.label ?? x).join(', ')}</span>}
                  {opt && <button className="btn small primary" onClick={() => dispatch({ type: 'COMPARE', id: opt.id })}>Preview: {opt.title}</button>}
                </div>
              </>}
            </li>
          );
        })}
      </ul>
      <h5>What each part does</h5>
      <ul className="list parts">
        {g.parts.map((part) => {
          const inst = ctx.inst(part.instance); const c = inst && ctx.comp(part.instance); if (!inst || !c) return null;
          const id = `part:${part.instance}`;
          return (
            <li key={part.instance} className={on(id) ? 'on' : ''}>
              <div className="head" onClick={() => set(id)} role="button" aria-pressed={on(id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && set(id)}><b>{inst.label}</b><span className="role">{c.guide?.role ?? c.kind.replace(/_/g, ' ')}</span></div>
              {c.guide && <div className="does">{c.guide.summary}</div>}
              <div className="why"><Explain text={part.why} project={p} /></div>
              {on(id) && <div className="related"><button className="btn small" onClick={() => dispatch({ type: 'SELECT_INSTANCE', id: part.instance })}>Open part details</button><span className="muted small">facts, sources, and connections</span></div>}
            </li>
          );
        })}
      </ul>

      <div className="trust">Values tagged <span className="tag prov fixture_assumption">assumed</span> are stated assumptions, not measurements. This guide explains the design; it does not check it. The rules under Evaluate do that, and only for the hardware path: what the software does with the link and the signals is not evaluated.</div>
    </section>
  );
}
