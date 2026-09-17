import { useState } from 'react';
import type { Finding } from '../model/schema';
import type { Session, LifecycleFinding } from '../model/workflow';
import type { AppState, Action } from './store';
import { Coverage } from './Coverage';
import { Prov } from './Sheet';

const sevClass = (s: Finding['severity']) => (s === 'violation' ? 'bad' : s === 'warning' ? 'warn' : s === 'unknown' ? 'unk' : 'opt');
const sevWord = (s: Finding['severity']) => (s === 'optimization' ? 'opportunity' : s);

function Detail({ f, dispatch, applied }: { f: Finding; dispatch: React.Dispatch<Action>; applied: boolean }) {
  return (
    <div className="detail">
      <div><h5>What triggered it</h5>Rule <code>{f.ruleId}</code> · basis {f.basis.replace('_', ' ')}{f.confidence !== undefined && <> · confidence {f.confidence}</>}<div className="muted small">{f.affected.map((a) => [a.instanceId, a.pin, a.netId, a.requirementId && `requirement ${a.requirementId}`].filter(Boolean).join('.')).join(', ')}</div></div>
      <div><h5>Evidence</h5><div className="ev">{f.evidence.map((e, i) => <div key={i}>{e.label} = <b>{e.value}</b> <Prov p={e.provenance} /></div>)}{f.missing?.length ? <div className="muted">missing: {f.missing.join(', ')}</div> : null}</div></div>
      <div><h5>Consequence</h5>{f.consequence}</div>
      <div><h5>Fix it</h5>
        {f.fixes.length > 0 && <div className="row wrap fixes">{f.fixes.map((x, i) => x.kind === 'optimize'
          ? <button key={i} className="btn small" onClick={() => dispatch({ type: 'COMPARE', id: x.optimizationId })}>Preview: {x.label}</button>
          : <button key={i} className="btn small primary" disabled={applied} onClick={() => dispatch({ type: 'EDIT', label: x.label, ops: x.ops, kind: 'fix' })}>Apply: {x.label}</button>)}</div>}
        <ul>{f.remediation.map((r, i) => <li key={i}>{r}</li>)}</ul>
        {f.fixes.length > 0 && <div className="muted small">Apply changes the circuit with the same structured edit a manual change makes. Re-evaluate afterwards.</div>}
      </div>
    </div>
  );
}

export function Findings({ session, lifecycles, state, dispatch, busy, onRunAI }: { session: Session; lifecycles: LifecycleFinding[]; state: AppState; dispatch: React.Dispatch<Action>; busy: boolean; onRunAI: () => void }) {
  const ev = session.project.lastEvaluation;
  const stale = ev && ev.stateHash !== session.currentHash;
  const counts = { violation: 0, warning: 0, unknown: 0, optimization: 0 } as Record<string, number>;
  for (const f of lifecycles) if (f.lifecycle !== 'resolved') counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const [showCov, setShowCov] = useState(false);
  const notEval = (ev?.coverage ?? []).filter((c) => c.status === 'not_evaluated' || c.status === 'unsupported').length;
  const evaluated = (ev?.coverage ?? []).filter((c) => c.status !== 'not_evaluated' && c.status !== 'unsupported').length;
  const ai = session.aiReview; const configured = state.aiStatus?.configured;
  return (
    <section className="panel findings" id="panel-findings">
      <h4>Findings {ev && <span>{counts.violation} violations · {counts.warning} warnings · {counts.unknown} unknown · {counts.optimization} opportunities{stale ? ' · from the previous state' : ''}</span>}</h4>
      {!ev && <div className="muted">Not evaluated yet. Findings point at instances, pins, and nets in the design state; none are generated prose.</div>}
      {ev && lifecycles.length === 0 && <div className="muted">Every rule that ran passed on this state.</div>}
      {lifecycles.map((f) => (
        <div key={f.id} className={`finding ${sevClass(f.severity)} ${f.lifecycle === 'resolved' ? 'res' : ''} ${session.openFinding === f.id ? 'open' : ''}`}>
          <div className="stripe" />
          <div className="body">
            <button className="t" onClick={() => dispatch({ type: 'VIEW_FINDING', id: f.id })} aria-expanded={session.openFinding === f.id}>
              <span className={`sev ${f.lifecycle === 'resolved' ? 'ok' : sevClass(f.severity)}`}>{f.lifecycle === 'resolved' ? 'resolved' : sevWord(f.severity)}</span>
              <span className="title">{f.title}</span>
              {f.lifecycle === 'new' && <span className="tag new">new</span>}
              {f.fixes.length > 0 && f.lifecycle !== 'resolved' && <span className="tag cls">{f.fixes.some((x) => x.kind === 'optimize') ? 'optimize' : 'fix available'}</span>}
            </button>
            <div className="sub">{f.affected.map((a) => [a.instanceId, a.pin, a.netId].filter(Boolean).join(' · ')).filter(Boolean).join(' ; ')}{f.lifecycle === 'resolved' && ' · cleared on this evaluation'}</div>
            {session.openFinding === f.id && <Detail f={f} dispatch={dispatch} applied={!!stale} />}
          </div>
        </div>
      ))}
      {ev && (
        <div className="covdock">
          <button className="btn ghost small" onClick={() => { setShowCov(!showCov); dispatch({ type: 'VIEW_COVERAGE' }); }} aria-expanded={showCov}>{showCov ? '▾' : '▸'} {evaluated} dimensions evaluated · {notEval} not evaluated · deterministic, no score</button>
          {showCov && <Coverage session={session} dispatch={dispatch} embedded />}
        </div>
      )}
      {/* The AI review surface exists only when the server has a provider; the deterministic product is complete without it. */}
      {configured && (
        <div className="ai-line">
          <span className="sev ai">AI review</span>
          <button className="btn small" id="btn-ai" disabled={busy || !ev} onClick={onRunAI}>{busy ? 'Reviewing…' : 'Run'}</button><span className="muted small">separate from the rules above; nothing it says changes the design · {state.aiStatus?.provider} · {state.aiStatus?.model}</span>
        </div>
      )}
      {ai?.error && <div className="error">{ai.error}</div>}
      {ai && !ai.error && <div className="muted small">{ai.observations.length} observations · {ai.dropped} dropped by the output gate · {ai.model} · {(ai.latencyMs / 1000).toFixed(1)} s{ai.stateHash !== session.currentHash ? ' · for a previous state' : ''}</div>}
      {ai?.observations.map((f) => (
        <div key={f.id} className={`finding ai ${session.openFinding === f.id ? 'open' : ''}`}><div className="stripe" /><div className="body">
          <button className="t" onClick={() => dispatch({ type: 'VIEW_FINDING', id: f.id })}><span className="sev ai">ai · {f.severity}</span><span className="title">{f.title}</span></button>
          <div className="sub">{f.affected.map((a) => [a.instanceId, a.netId].filter(Boolean).join(' · ')).join(' ; ')}{f.confidence !== undefined ? ` · confidence ${f.confidence}` : ''}</div>
          {session.openFinding === f.id && <Detail f={f} dispatch={dispatch} applied={false} />}
        </div></div>
      ))}
    </section>
  );
}
