import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '../model/workflow';
import { projectState, findingLifecycles, nextSteps } from '../model/workflow';
import { Project as ProjectSchema } from '../model/schema';
import { registry } from '../data';
import { Ctx } from '../eval/context';
import { RULES } from '../eval/evaluate';
import type { AppState, Action } from './store';
import { Diagram } from './Diagram';
import { Findings, AIPanel } from './Findings';
import { Coverage } from './Coverage';
import { Inspector } from './Inspector';
import { NetPanel } from './NetPanel';

export function ProjectView({ session, state, dispatch }: { session: Session; state: AppState; dispatch: React.Dispatch<Action> }) {
  const p = session.project;
  const st = projectState(session);
  const lifecycles = useMemo(() => findingLifecycles(p.lastEvaluation, session.previousEvaluation, session.history, p.overrides), [p.lastEvaluation, session.previousEvaluation, session.history, p.overrides]);
  const tips = nextSteps(session, lifecycles);
  const ctx = useMemo(() => new Ctx(p, registry), [p]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => { const m = window.matchMedia('(max-width: 640px)'); const h = () => setNarrow(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);

  // Evaluate feel: a short working state, then a toast summarizing what moved.
  const [evaluating, setEvaluating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastSummaryAt = useRef<string | undefined>(session.lastSummary?.at);
  useEffect(() => {
    const s = session.lastSummary; if (!s || s.at === lastSummaryAt.current) return; lastSummaryAt.current = s.at;
    const parts = [`${s.added} new`, `${s.resolved} resolved`, `${s.persisting} persisting`];
    setToast(`Evaluated · ${parts.join(' · ')}`);
    window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, [session.lastSummary]);
  // Delete or Backspace removes the selected part or disconnects the selected net, unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (session.selectedInstance) { const inst = p.instances.find((i) => i.id === session.selectedInstance); if (!inst) return; e.preventDefault();
        dispatch({ type: 'EDIT', label: `Remove ${inst.label}`, ops: [...(p.power.sourceInstance === inst.id ? [{ op: 'clear_power_source' as const }] : []), { op: 'remove_instance' as const, instance: inst.id }] }); }
      else if (session.selectedNet) { const net = p.nets.find((n) => n.id === session.selectedNet); if (!net) return; e.preventDefault();
        dispatch({ type: 'EDIT', label: `Disconnect net ${net.name}`, ops: net.pins.map((pin) => ({ op: 'move_pin' as const, instance: pin.instance, pin: pin.pin, net: null })) }); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [session.selectedInstance, session.selectedNet, p, dispatch]);
  const runEvaluate = () => { if (evaluating) return; setEvaluating(true); window.setTimeout(() => { dispatch({ type: 'EVALUATE' }); setEvaluating(false); }, 350); };

  const open = lifecycles.find((f) => f.id === session.openFinding) ?? session.aiReview?.observations.find((f) => f.id === session.openFinding);
  const highlight = useMemo(() => {
    const src = open ? [open] : lifecycles.filter((f) => f.severity === 'violation' && f.lifecycle !== 'resolved');
    return { instances: new Set(src.flatMap((f) => f.affected.map((a) => a.instanceId).filter(Boolean) as string[])), nets: new Set(src.flatMap((f) => f.affected.map((a) => a.netId).filter(Boolean) as string[])), severity: open?.severity ?? 'violation' };
  }, [open, lifecycles]);

  const current = st === 'evaluated_current' || st === 'reviewed';
  const chip = current ? <span className="chip cur">evaluated · current</span> : st === 'evaluated_stale' ? <span className="chip stale">stale</span> : st === 'design_incomplete' ? <span className="chip bad">incomplete</span> : <span className="chip unev">not evaluated</span>;
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
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${p.id}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try { const parsed = ProjectSchema.parse(JSON.parse(await file.text())); dispatch({ type: 'IMPORT', project: parsed }); }
    catch (e) { setToast(`Import failed: ${(e as Error).message.slice(0, 120)}`); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 5000); }
  };

  const evalLabel = evaluating ? 'Evaluating…' : !p.lastEvaluation ? 'Evaluate' : current ? 'Up to date' : 'Re-evaluate';
  const evalButton = (id: string) => <button className={`btn ${current && !evaluating ? '' : 'primary'} wide ${evaluating ? 'working' : ''}`} id={id} onClick={runEvaluate} disabled={evaluating} aria-live="polite">{evalLabel}</button>;

  return (
    <div className={`page project ${narrow ? 'has-evalbar' : ''}`}>
      <header className="appbar">
        <div className="brand"><button className="btn ghost back" onClick={() => dispatch({ type: 'BACK' })} aria-label="Back to library">‹</button>{p.title} <span>· {p.source} · {p.status.replace('_', ' ')}</span></div>
        <div className="row">
          <button className="btn small" onClick={() => dispatch({ type: 'UNDO' })} disabled={!session.edits.length} title={session.edits.length ? `Undo: ${session.edits[session.edits.length - 1].label}` : 'Nothing to undo'}>Undo{session.edits.length ? ` (${session.edits.length})` : ''}</button>
          <button className="btn small" onClick={exportJson}>Export</button>
          <label className="btn small" htmlFor="import-file">Import<input id="import-file" type="file" accept="application/json,.json" hidden onChange={(e) => importJson(e.target.files?.[0])} /></label>
          {chip}
        </div>
      </header>
      {st === 'evaluated_stale' && <div className="bar stale">The design changed since the last evaluation{session.edits.length ? ` (${session.edits[session.edits.length - 1].label})` : ''}. Re-evaluate to see what moved.<button className="btn small" onClick={runEvaluate}>Re-evaluate</button></div>}
      {tips.map((t) => <div className="bar tip" key={t.id}><b>Next</b><span>{t.text}</span><button className="x" onClick={() => dispatch({ type: 'DISMISS_TIP', id: t.id })} aria-label="Dismiss tip">dismiss</button></div>)}
      <Diagram project={p} highlight={highlight} selected={session.selectedInstance} selectedNet={session.selectedNet} compact={narrow} onSelect={(id) => dispatch({ type: 'SELECT_INSTANCE', id })} onSelectNet={(id) => dispatch({ type: 'SELECT_NET', id })} />
      <div className="cols">
        <aside className="col-left">
          <section className="panel" id="panel-requirements"><h4>Requirements <span>{p.requirements.length}</span></h4>
            <ul className="list">{p.requirements.map((r) => <li key={r.id}><span>{r.label}</span><span className={`tag ${r.evaluable ? 'cls' : ''}`}>{r.evaluable ? 'evaluable' : 'informational'}</span></li>)}</ul></section>
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
          {session.selectedInstance && <Inspector session={session} ctx={ctx} dispatch={dispatch} onClose={() => dispatch({ type: 'SELECT_INSTANCE', id: session.selectedInstance })} />}
          {session.selectedNet && <NetPanel session={session} ctx={ctx} dispatch={dispatch} />}
          <div key={session.lastSummary?.at ?? 'none'} className="flash-on-mount"><Findings session={session} lifecycles={lifecycles} dispatch={dispatch} /></div>
          <AIPanel session={session} state={state} busy={state.aiBusy} onRun={runAI} dispatch={dispatch} />
        </main>
        <aside className="col-right">
          {!narrow && <section className="panel">{evalButton('btn-evaluate')}<div className="muted small top">Runs {RULES.length} deterministic rules on the canonical state, in the browser.</div></section>}
          <section className="panel"><h4>Try a change</h4>
            <div className="mut">{p.mutations.map((m) => <button key={m.id} className={`btn small ${session.appliedMutations.includes(m.id) ? 'on' : ''}`} title={m.description} disabled={session.appliedMutations.includes(m.id)} onClick={() => dispatch({ type: 'APPLY_MUTATION', id: m.id })}>{m.label}{session.appliedMutations.includes(m.id) ? ' ✓' : ''}</button>)}</div>
            <div className="muted small top">Or tap a part or wire in the diagram to remove or disconnect it.</div>
            {session.edits.length > 0 && <button className="btn small top" onClick={() => dispatch({ type: 'RESET' })}>Reset to {p.source === 'imported' ? 'imported design' : 'template'}</button>}
          </section>
          <Coverage session={session} dispatch={dispatch} />
        </aside>
      </div>
      {narrow && <div className="evalbar">{evalButton('btn-evaluate')}</div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
