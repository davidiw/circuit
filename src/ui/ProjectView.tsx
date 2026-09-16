import { useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '../model/workflow';
import { projectState, findingLifecycles, stepState, requirementStatuses, type Step } from '../model/workflow';
import { Project as ProjectSchema } from '../model/schema';
import { registry } from '../data';
import { Ctx } from '../eval/context';
import { RULES } from '../eval/evaluate';
import type { AppState, Action } from './store';
import { Diagram } from './Diagram';
import { Findings } from './Findings';
import { InstanceSheet, NetSheet, PinSheet, Prov } from './Sheet';
import { Changes, Optimize } from './Changes';
import { Compare } from './Compare';

const STEPS: { id: Step; label: string }[] = [{ id: 'inspect', label: 'Inspect' }, { id: 'evaluate', label: 'Evaluate' }, { id: 'change', label: 'Change' }, { id: 'reevaluate', label: 'Re-evaluate' }, { id: 'optimize', label: 'Optimize' }];
const RSTAT: Record<string, [string, string]> = { pass: ['met', 'ok'], fail: ['not met', 'bad'], above_target: ['above target', 'opt'], not_evaluated: ['informational', 'no'], unknown: ['unknown', 'unk'] };

export function ProjectView({ session, state, dispatch }: { session: Session; state: AppState; dispatch: React.Dispatch<Action> }) {
  const p = session.project;
  const st = projectState(session);
  const lifecycles = useMemo(() => findingLifecycles(p.lastEvaluation, session.previousEvaluation, session.history, p.overrides), [p.lastEvaluation, session.previousEvaluation, session.history, p.overrides]);
  const step = stepState(session, lifecycles);
  const ctx = useMemo(() => new Ctx(p, registry), [p]);
  const reqStatus = useMemo(() => requirementStatuses(p, p.lastEvaluation && p.lastEvaluation.stateHash === session.currentHash ? p.lastEvaluation : undefined), [p, session.currentHash]);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => { const m = window.matchMedia('(max-width: 640px)'); const h = () => setNarrow(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);
  const [tab, setTab] = useState<'findings' | 'changes' | 'design'>('findings');
  const [full, setFull] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState<{ req: boolean; asm: boolean; parts: boolean }>({ req: true, asm: false, parts: false });

  // Evaluate feel: a short working state, then the summary docks next to the state chip.
  const [evaluating, setEvaluating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);
  const lastAt = useRef<string | undefined>(session.lastSummary?.at);
  useEffect(() => {
    const s = session.lastSummary; if (!s || s.at === lastAt.current) return; lastAt.current = s.at;
    setNote(`${s.added} new · ${s.resolved} resolved · ${s.persisting} unchanged`);
    window.clearTimeout(noteTimer.current); noteTimer.current = window.setTimeout(() => setNote(null), 6000);
  }, [session.lastSummary]);
  const runEvaluate = () => { if (evaluating) return; setEvaluating(true); window.setTimeout(() => { dispatch({ type: 'EVALUATE' }); setEvaluating(false); if (narrow) setTab('findings'); }, 350); };

  // Keyboard: Esc cancels connect or clears selection; Delete removes the selected part, net, or pin connection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { if (session.compareId) dispatch({ type: 'COMPARE' }); else if (session.connectFrom) dispatch({ type: 'ARM_CONNECT', pin: undefined }); else if (full) setFull(false); else dispatch({ type: 'DESELECT' }); return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (session.selectedInstance) { const inst = p.instances.find((i) => i.id === session.selectedInstance); if (!inst) return; e.preventDefault(); dispatch({ type: 'EDIT', label: `Remove ${inst.label}`, ops: [...(p.power.sourceInstance === inst.id ? [{ op: 'clear_power_source' as const }] : []), { op: 'remove_instance' as const, instance: inst.id }] }); }
      else if (session.selectedNet) { const net = p.nets.find((n) => n.id === session.selectedNet); if (!net) return; e.preventDefault(); dispatch({ type: 'EDIT', label: `Disconnect net ${net.name}`, ops: net.pins.map((pin) => ({ op: 'move_pin' as const, instance: pin.instance, pin: pin.pin, net: null })) }); }
      else if (session.selectedPin) { const pin = session.selectedPin; const net = ctx.netOf(pin.instance, pin.pin); if (!net) return; e.preventDefault(); dispatch({ type: 'EDIT', label: `Disconnect ${pin.instance}.${pin.pin} from ${net.name}`, ops: [{ op: 'move_pin', instance: pin.instance, pin: pin.pin, net: null }] }); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [session.selectedInstance, session.selectedNet, session.selectedPin, session.connectFrom, session.compareId, full, p, ctx, dispatch]);

  const openF = lifecycles.find((f) => f.id === session.openFinding) ?? session.aiReview?.observations.find((f) => f.id === session.openFinding);
  const selectedNetFromPin = session.selectedPin ? ctx.netOf(session.selectedPin.instance, session.selectedPin.pin)?.id : undefined;
  const highlight = useMemo(() => {
    if (session.selectedInstance) { const nets = new Set<string>(); for (const n of p.nets) if (n.pins.some((x) => x.instance === session.selectedInstance)) nets.add(n.id); return { instances: new Set<string>(), nets, severity: 'selection' }; }
    const src = openF ? [openF] : lifecycles.filter((f) => f.severity === 'violation' && f.lifecycle !== 'resolved');
    return { instances: new Set(src.flatMap((f) => f.affected.map((a) => a.instanceId).filter(Boolean) as string[])), nets: new Set(src.flatMap((f) => f.affected.map((a) => a.netId).filter(Boolean) as string[])), severity: openF?.severity ?? 'violation' };
  }, [openF, lifecycles, session.selectedInstance, p.nets]);

  const current = st === 'evaluated_current' || st === 'reviewed';
  const actionable = st === 'unevaluated' || st === 'evaluated_stale' || st === 'design_incomplete';
  const chip = current ? <span className="chip cur">evaluated · current</span> : st === 'evaluated_stale' ? <span className="chip stale">changed since evaluation</span> : st === 'design_incomplete' ? <span className="chip bad">incomplete</span> : <span className="chip unev">not evaluated</span>;
  const src = p.power.sourceInstance ? ctx.inst(p.power.sourceInstance) : undefined;
  const srcComp = src ? ctx.comp(src.id) : undefined; const srcPin = srcComp?.pins.find((x) => x.role === 'battery_pos' || x.role === 'supply_out');
  const srcNet = src && srcPin ? ctx.netOf(src.id, srcPin.name) : undefined; const srcV = srcNet ? ctx.netVoltages.get(srcNet.id) : undefined;

  const runAI = async () => {
    dispatch({ type: 'AI_START' });
    try {
      const r = await fetch('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...p, lastEvaluation: undefined, mutations: [], optimizations: [] }) });
      const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error ?? `AI review failed (${r.status})`);
      dispatch({ type: 'AI_RESULT', result: body });
    } catch (e) { dispatch({ type: 'AI_ERROR', error: (e as Error).message }); }
  };
  const exportJson = () => { const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${p.id}.json`; a.click(); URL.revokeObjectURL(url); };
  const importJson = async (file: File | undefined) => { if (!file) return; try { dispatch({ type: 'IMPORT', project: ProjectSchema.parse(JSON.parse(await file.text())) }); } catch (e) { setNote(`Import failed: ${(e as Error).message.slice(0, 100)}`); } };

  const evalLabel = evaluating ? 'Evaluating…' : !p.lastEvaluation ? 'Evaluate' : current ? 'Up to date' : 'Re-evaluate';
  const evalButton = (id: string, wide = false) => <button className={`btn ${actionable || evaluating ? 'primary' : 'ghost'} ${wide ? 'wide' : ''} ${evaluating ? 'working' : ''}`} id={id} onClick={runEvaluate} disabled={evaluating} title={`${RULES.length} deterministic rules, in the browser`}>{evalLabel}</button>;

  const diagramProps = {
    project: p, highlight, selection: { instance: session.selectedInstance, net: session.selectedNet ?? selectedNetFromPin, pin: session.selectedPin }, connectFrom: session.connectFrom, compact: narrow, frozenKey: session.edits.length,
    onSelect: (id: string) => dispatch({ type: 'SELECT_INSTANCE', id }), onSelectNet: (id: string) => dispatch({ type: 'SELECT_NET', id }), onSelectPin: (pin: { instance: string; pin: string }) => dispatch({ type: 'SELECT_PIN', pin }),
    onConnectTo: (pin: { instance: string; pin: string }) => dispatch({ type: 'CONNECT_TO', pin }), onCancelConnect: () => dispatch({ type: 'ARM_CONNECT', pin: undefined }), onDeselect: () => dispatch({ type: 'DESELECT' }),
  };
  const sheet = session.selectedInstance ? <InstanceSheet session={session} ctx={ctx} lifecycles={lifecycles} dispatch={dispatch} /> : session.selectedNet ? <NetSheet session={session} ctx={ctx} lifecycles={lifecycles} dispatch={dispatch} /> : session.selectedPin ? <PinSheet session={session} ctx={ctx} dispatch={dispatch} /> : null;
  const design = (
    <div className="design" id="panel-design">
      <section className="panel"><h4 className="tog" onClick={() => setOpen({ ...open, req: !open.req })}>Requirements <span>{p.requirements.length} {open.req ? '▾' : '▸'}</span></h4>
        {open.req && <ul className="list tight">{p.requirements.map((r) => { const [w, c] = RSTAT[reqStatus[r.id]] ?? ['', '']; return <li key={r.id}><span>{r.label}</span><span className={`st ${c}`}>{w}</span></li>; })}</ul>}
        {open.req && <div className="muted small top">Met means the hardware capability and wiring path exist. Application behavior, firmware, and streaming performance are not evaluated.</div>}</section>
      <section className="panel"><h4 className="tog" onClick={() => setOpen({ ...open, asm: !open.asm })}>Assumptions <span>{p.assumptions.length} {open.asm ? '▾' : '▸'}</span></h4>
        <ul className="list tight">{p.assumptions.map((a) => <li key={a.key}><span><b>{a.key.replace(/_/g, ' ')}</b> {String(a.value)}{open.asm && <div className="muted small">{a.reason}</div>}</span><span className="tag asm">{a.source === 'template' ? 'assumed' : a.source}</span></li>)}</ul></section>
      <section className="panel"><h4 className="tog" onClick={() => setOpen({ ...open, parts: !open.parts })}>Parts <span>{p.instances.length} {open.parts ? '▾' : '▸'}</span></h4>
        {open.parts && <ul className="list tight">{p.instances.map((i) => { const c = ctx.comp(i.id); const vs = c?.verification_status ?? 'unknown'; return <li key={i.id} className={`clickable ${session.selectedInstance === i.id ? 'sel' : ''}`} onClick={() => dispatch({ type: 'SELECT_INSTANCE', id: i.id })}><span>{i.label}<div className="muted small">{c?.label}</div></span><span className={`tag ${vs.startsWith('vetted') ? 'vet' : vs === 'constrained_component_class' ? 'cls' : 'unk'}`}>{vs.startsWith('vetted') ? 'exact part' : vs === 'constrained_component_class' ? 'class' : vs.replace(/_/g, ' ')}</span></li>; })}</ul>}
        {!open.parts && <div className="muted small">{p.instances.filter((i) => ctx.comp(i.id)?.verification_status.startsWith('vetted')).length} exact parts · {p.instances.filter((i) => ctx.comp(i.id)?.verification_status === 'constrained_component_class').length} component classes. Tap a part in the diagram for facts and provenance.</div>}</section>
      {p.unresolved.length > 0 && <section className="panel"><h4>Unresolved</h4><ul className="list">{p.unresolved.map((u) => <li key={u}>{u}</li>)}</ul></section>}
    </div>
  );
  const findings = <Findings session={session} lifecycles={lifecycles} state={state} dispatch={dispatch} busy={state.aiBusy} onRunAI={runAI} />;
  const changes = <><Changes session={session} dispatch={dispatch} stepTarget={step.target?.kind === 'mutation' ? step.target.id : undefined} /><Optimize session={session} dispatch={dispatch} active={step.current === 'optimize' && step.target?.kind === 'panel' && step.target.id === 'optimize'} /></>;

  return (
    <div className={`page project ${narrow ? 'narrow' : ''} ${narrow && (actionable || session.edits.length) ? 'has-evalbar' : ''}`}>
      <header className="appbar">
        <div className="brand"><button className="btn ghost back" onClick={() => dispatch({ type: 'BACK' })} aria-label="Back to library">‹</button><div><div>{p.title}</div><div className="intent">{p.goal}</div></div></div>
        <div className="row">
          {note && <span className="note">{note}</span>}
          {chip}
          <button className="btn small" onClick={() => dispatch({ type: 'UNDO' })} disabled={!session.edits.length} title={session.edits.length ? `Undo: ${session.edits[session.edits.length - 1].label}` : 'Nothing to undo'}>Undo{session.edits.length ? ` (${session.edits.length})` : ''}</button>
          {!narrow && evalButton('btn-evaluate')}
          {!narrow && <><button className="btn ghost small" onClick={exportJson}>Export</button><label className="btn ghost small" htmlFor="import-file">Import<input id="import-file" type="file" accept="application/json,.json" hidden onChange={(e) => importJson(e.target.files?.[0])} /></label></>}
        </div>
      </header>
      <div className="strip">
        {src ? <span><b>Power</b> {src.label} · {p.power.mode}{srcV ? ` · ${srcV.nominal.toFixed(1)} V (${srcV.min.toFixed(1)}–${srcV.max.toFixed(1)})` : ''}</span> : <span className="error"><b>Power</b> none: this design is incomplete</span>}
        <span><b>{p.instances.length}</b> parts · <b>{p.nets.length}</b> nets · <b>{p.assumptions.length}</b> assumptions · <b>{RULES.length}</b> rules</span>
        {!session.introDismissed && !narrow && <span className="thesis">This design is explicit state: parts, pins, nets, assumptions with provenance. The rules check it; you change it; the rules check it again. <button className="x" onClick={() => dispatch({ type: 'DISMISS_INTRO' })}>got it</button></span>}
      </div>
      <ol className="stepper" aria-label="Loop">
        {STEPS.map((s) => <li key={s.id} className={`${step.current === s.id ? 'cur' : ''} ${step.done.includes(s.id) ? 'done' : ''}`}>{s.label}</li>)}
        <li className="hint"><span>{step.hint}</span></li>
      </ol>
      <div className={`dia-wrap ${sheet ? 'with-sheet' : ''}`}>
        <Diagram {...diagramProps} />
        {sheet && !full && <div className="sheet-host">{sheet}</div>}
      </div>
      {narrow && <button className="btn small fullbtn wide" onClick={() => setFull(true)}>Open the diagram full-screen to select pins and wire</button>}
      {full && <div className="overlay dia-full" onClick={() => setFull(false)}><div onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><b>{p.title}</b><div className="row"><button className="btn small" onClick={() => setZoom(Math.max(1, zoom / 1.5))} disabled={zoom <= 1} aria-label="Zoom out">−</button><span className="muted small">{Math.round(zoom * 100)}%</span><button className="btn small" onClick={() => setZoom(Math.min(6, zoom * 1.5))} aria-label="Zoom in">+</button><button className="btn small primary" onClick={() => setFull(false)}>Done</button></div></div>
        <Diagram {...diagramProps} big compact={false} zoom={zoom} />
        {sheet && <div className="sheet-host inline">{sheet}</div>}
        {!sheet && <div className="muted small top">Tap a pin to wire it, a wire to inspect its net, or a part for its facts. Zoom in for bigger targets.</div>}
      </div></div>}
      {narrow ? (
        <>
          <div className="tabs" role="tablist"><button role="tab" aria-selected={tab === 'findings'} className={tab === 'findings' ? 'on' : ''} onClick={() => setTab('findings')}>Findings{p.lastEvaluation ? ` (${lifecycles.filter((f) => f.lifecycle !== 'resolved' && (f.severity === 'violation' || f.severity === 'warning')).length})` : ''}</button><button role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'on' : ''} onClick={() => setTab('changes')}>Changes</button><button role="tab" aria-selected={tab === 'design'} className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>Design</button></div>
          {tab === 'findings' && findings}{tab === 'changes' && changes}{tab === 'design' && design}
        </>
      ) : (
        <div className="cols3"><aside className="col-design">{design}</aside><main className="col-findings">{findings}</main><aside className="col-changes">{changes}</aside></div>
      )}
      {narrow && (actionable || session.edits.length > 0) && <div className="evalbar">{chip}{session.edits.length > 0 && <button className="btn small" onClick={() => dispatch({ type: 'UNDO' })}>Undo</button>}{actionable && evalButton('btn-evaluate-m')}</div>}
      {session.compareId && <Compare session={session} dispatch={dispatch} />}
    </div>
  );
}
