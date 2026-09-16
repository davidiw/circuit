import { useEffect, useMemo, useState } from 'react';
import type { Session } from '../model/workflow';
import { projectState, findingLifecycles, nextSteps } from '../model/workflow';
import { registry } from '../data';
import { Ctx } from '../eval/context';
import type { AppState, Action } from './store';
import { Diagram } from './Diagram';
import { Findings, AIPanel } from './Findings';
import { Coverage } from './Coverage';
import { Inspector } from './Inspector';

export function ProjectView({ session, state, dispatch }: { session: Session; state: AppState; dispatch: React.Dispatch<Action> }) {
  const p = session.project;
  const st = projectState(session);
  const lifecycles = useMemo(() => findingLifecycles(p.lastEvaluation, session.previousEvaluation, session.history, p.overrides), [p.lastEvaluation, session.previousEvaluation, session.history, p.overrides]);
  const tips = nextSteps(session, lifecycles);
  const ctx = useMemo(() => new Ctx(p, registry), [p]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => { const m = window.matchMedia('(max-width: 640px)'); const h = () => setNarrow(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);

  const open = lifecycles.find((f) => f.id === session.openFinding) ?? session.aiReview?.observations.find((f) => f.id === session.openFinding);
  const highlight = useMemo(() => {
    const src = open ? [open] : lifecycles.filter((f) => f.severity === 'violation' && f.lifecycle !== 'resolved');
    return { instances: new Set(src.flatMap((f) => f.affected.map((a) => a.instanceId).filter(Boolean) as string[])), nets: new Set(src.flatMap((f) => f.affected.map((a) => a.netId).filter(Boolean) as string[])), severity: open?.severity ?? 'violation' };
  }, [open, lifecycles]);

  const chip = st === 'evaluated_current' || st === 'reviewed' ? <span className="chip cur">evaluated · current</span> : st === 'evaluated_stale' ? <span className="chip stale">stale</span> : st === 'design_incomplete' ? <span className="chip bad">incomplete</span> : <span className="chip unev">not evaluated</span>;
  const src = p.power.sourceInstance ? ctx.inst(p.power.sourceInstance) : undefined;
  const srcComp = src ? ctx.comp(src.id) : undefined;
  const srcPin = srcComp?.pins.find((x) => x.role === 'battery_pos' || x.role === 'supply_out');
  const srcNet = src && srcPin ? ctx.netOf(src.id, srcPin.name) : undefined;
  const srcV = srcNet ? ctx.netVoltages.get(srcNet.id) : undefined;

  const runAI = async () => {
    dispatch({ type: 'AI_START' });
    try {
      const r = await fetch('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...p, lastEvaluation: undefined, mutations: [] }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `AI review failed (${r.status})`);
      dispatch({ type: 'AI_RESULT', result: body });
    } catch (e) { dispatch({ type: 'AI_ERROR', error: (e as Error).message }); }
  };

  return (
    <div className="page project">
      <header className="appbar">
        <div className="brand"><button className="btn ghost back" onClick={() => dispatch({ type: 'BACK' })} aria-label="Back to library">‹</button>{p.title} <span>· {p.source} · {p.status.replace('_', ' ')}</span></div>
        {chip}
      </header>
      {st === 'evaluated_stale' && <div className="bar stale">The design changed since the last evaluation. Re-evaluate to see what moved.<button className="btn small" onClick={() => dispatch({ type: 'EVALUATE' })}>Re-evaluate</button></div>}
      {tips.map((t) => <div className="bar tip" key={t.id}><b>Next</b><span>{t.text}</span><button className="x" onClick={() => dispatch({ type: 'DISMISS_TIP', id: t.id })} aria-label="Dismiss tip">dismiss</button></div>)}
      <Diagram project={p} highlight={highlight} selected={session.selectedInstance} columns={narrow ? 3 : 6} onSelect={(id) => dispatch({ type: 'SELECT_INSTANCE', id })} />
      <div className="cols">
        <aside className="col-left">
          <section className="panel" id="panel-requirements"><h4>Requirements <span>{p.requirements.length}</span></h4>
            <ul className="list">{p.requirements.map((r) => <li key={r.id}><span>{r.label}</span><span className={`tag ${r.evaluable ? 'cls' : ''}`}>{r.evaluable ? 'evaluable' : 'not evaluated'}</span></li>)}</ul></section>
          <section className="panel" id="panel-power"><h4>Power</h4>
            {src ? <div className="kv"><div>Source</div><div className="v">{src.label}</div><div>Mode</div><div className="v">{p.power.mode}</div>{srcV && <><div>Nominal</div><div className="v">{srcV.nominal.toFixed(1)} V</div><div>Range</div><div className="v">{srcV.min.toFixed(1)} – {srcV.max.toFixed(1)} V</div></>}</div>
              : <div className="error">No power source. This design is incomplete.</div>}</section>
          <section className="panel" id="panel-assumptions"><h4>Assumptions <span>{p.assumptions.length}</span></h4>
            <ul className="list assumptions">{p.assumptions.map((a) => <li key={a.key} title={a.reason}><span><b>{a.key.replace(/_/g, ' ')}</b> {String(a.value)}<div className="muted small">{a.reason}</div></span><span className="tag asm">{a.source}</span></li>)}</ul></section>
          <section className="panel" id="panel-parts"><h4>Parts <span>{p.instances.length}</span></h4>
            <ul className="list">{p.instances.map((i) => { const c = ctx.comp(i.id); const vs = c?.verification_status ?? 'unknown'; return <li key={i.id} className={`clickable ${session.selectedInstance === i.id ? 'sel' : ''}`} onClick={() => dispatch({ type: 'SELECT_INSTANCE', id: i.id })}><span>{i.label}<div className="muted small">{c?.label}</div></span><span className={`tag ${vs.startsWith('vetted') ? 'vet' : vs === 'constrained_component_class' ? 'cls' : 'unk'}`}>{vs.startsWith('vetted') ? 'vetted' : vs === 'constrained_component_class' ? 'class' : vs}</span></li>; })}</ul></section>
          {p.unresolved.length > 0 && <section className="panel"><h4>Unresolved</h4><ul className="list">{p.unresolved.map((u) => <li key={u}>{u}</li>)}</ul></section>}
        </aside>
        <main className="col-center">
          {session.selectedInstance && <Inspector session={session} ctx={ctx} onClose={() => dispatch({ type: 'SELECT_INSTANCE', id: session.selectedInstance })} />}
          <Findings session={session} lifecycles={lifecycles} dispatch={dispatch} />
          <AIPanel session={session} state={state} busy={state.aiBusy} onRun={runAI} dispatch={dispatch} />
        </main>
        <aside className="col-right">
          <section className="panel">
            <button className="btn primary wide" id="btn-evaluate" onClick={() => dispatch({ type: 'EVALUATE' })}>{p.lastEvaluation ? 'Re-evaluate' : 'Evaluate'}</button>
            <div className="muted small top">Runs {12} deterministic rules on the canonical state, in the browser.</div>
          </section>
          <section className="panel"><h4>Try a change</h4>
            <div className="mut">{p.mutations.map((m) => <button key={m.id} className={`btn small ${session.appliedMutations.includes(m.id) ? 'on' : ''}`} title={m.description} disabled={session.appliedMutations.includes(m.id)} onClick={() => dispatch({ type: 'APPLY_MUTATION', id: m.id })}>{m.label}{session.appliedMutations.includes(m.id) ? ' ✓' : ''}</button>)}</div>
            {session.appliedMutations.length > 0 && <button className="btn small top" onClick={() => dispatch({ type: 'RESET' })}>Reset to template</button>}
          </section>
          <Coverage session={session} dispatch={dispatch} />
        </aside>
      </div>
    </div>
  );
}
