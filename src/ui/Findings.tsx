import type { Finding } from '../model/schema';
import type { Session, LifecycleFinding } from '../model/workflow';
import type { AppState, Action } from './store';

const sevClass = (s: Finding['severity']) => (s === 'violation' ? 'bad' : s === 'warning' ? 'warn' : s === 'unknown' ? 'unk' : 'opt');

function Detail({ f }: { f: Finding }) {
  return (
    <div className="detail">
      <div><h5>What triggered it</h5>Rule <code>{f.ruleId}</code> · basis {f.basis.replace('_', ' ')}{f.confidence !== undefined && <> · confidence {f.confidence}</>}<div className="muted small">{f.affected.map((a) => [a.instanceId, a.pin, a.netId].filter(Boolean).join('.')).join(', ')}</div></div>
      <div><h5>Evidence</h5><div className="ev">{f.evidence.map((e, i) => <div key={i}>{e.label} = <b>{e.value}</b> <span className={`tag prov ${e.provenance}`}>{e.provenance.replace('_', ' ')}</span></div>)}{f.missing?.length ? <div className="muted">missing: {f.missing.join(', ')}</div> : null}</div></div>
      <div><h5>Consequence</h5>{f.consequence}</div>
      <div><h5>Remediation</h5><ul>{f.remediation.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
    </div>
  );
}

export function Findings({ session, lifecycles, dispatch }: { session: Session; lifecycles: LifecycleFinding[]; dispatch: React.Dispatch<Action> }) {
  const ev = session.project.lastEvaluation;
  const counts = { violation: 0, warning: 0, unknown: 0 } as Record<string, number>;
  for (const f of lifecycles) if (f.lifecycle !== 'resolved') counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return (
    <section className="panel findings" id="panel-findings">
      <h4>Deterministic findings {ev && <span>{counts.violation} violations · {counts.warning} warnings · {counts.unknown ?? 0} unknown{session.project.lastEvaluation?.stateHash !== session.currentHash ? ' · from previous state' : ''}</span>}</h4>
      {!ev && <div className="muted">Not evaluated yet. Findings point at instances, pins, and nets in the canonical state; none are generated prose.</div>}
      {ev && lifecycles.length === 0 && <div className="muted">Every rule that ran passed on this state. Coverage lists what did not run.</div>}
      {lifecycles.map((f) => (
        <div key={f.id} className={`finding ${sevClass(f.severity)} ${f.lifecycle === 'resolved' ? 'res' : ''} ${session.openFinding === f.id ? 'open' : ''}`}>
          <div className="stripe" />
          <div className="body">
            <button className="t" onClick={() => dispatch({ type: 'VIEW_FINDING', id: f.id })} aria-expanded={session.openFinding === f.id}>
              <span className={`sev ${f.lifecycle === 'resolved' ? 'ok' : sevClass(f.severity)}`}>{f.lifecycle === 'resolved' ? 'resolved' : f.severity}</span>
              <span className="sev det">deterministic</span>
              <span className="title">{f.title}</span>
              <span className="tag">{f.category}</span>
              {f.lifecycle === 'new' && <span className="tag new">new</span>}
            </button>
            <div className="sub">{f.affected.map((a) => [a.instanceId, a.pin, a.netId].filter(Boolean).join(' · ')).join(' ; ')}{f.lifecycle === 'resolved' && ' · cleared on this evaluation'}</div>
            {session.openFinding === f.id && <Detail f={f} />}
          </div>
        </div>
      ))}
    </section>
  );
}

export function AIPanel({ session, state, busy, onRun, dispatch }: { session: Session; state: AppState; busy: boolean; onRun: () => void; dispatch: React.Dispatch<Action> }) {
  const r = session.aiReview; const stale = r && r.stateHash !== session.currentHash;
  const configured = state.aiStatus?.configured;
  return (
    <section className="panel ai" id="panel-ai">
      <div className="ai-head">AI review<span className="muted small">separate from deterministic findings; nothing here changes the design</span>
        <span className="m">{configured ? `${state.aiStatus?.provider} · ${state.aiStatus?.model}` : 'not configured on this server'}</span></div>
      <div className="row">
        <button className="btn" id="btn-ai" disabled={!configured || busy || !session.project.lastEvaluation} onClick={onRun}>{busy ? 'Reviewing…' : 'Run AI review'}</button>
        {!session.project.lastEvaluation && <span className="muted small">Evaluate first; the reviewer receives the deterministic findings.</span>}
        {configured === false && <span className="muted small">Set AI_PROVIDER and a key on the server to enable.</span>}
      </div>
      {r?.error && <div className="error top">{r.error}</div>}
      {r && !r.error && <div className="muted small top">{r.observations.length} observations · {r.dropped} dropped by the output gate · {r.model} · {(r.latencyMs / 1000).toFixed(1)} s{stale ? ' · for a previous state' : ''}</div>}
      {r?.observations.map((f) => (
        <div key={f.id} className={`finding ai ${session.openFinding === f.id ? 'open' : ''}`}><div className="stripe" /><div className="body">
          <button className="t" onClick={() => dispatch({ type: 'VIEW_FINDING', id: f.id })}><span className="sev ai">ai · {f.severity}</span><span className="title">{f.title}</span><span className="tag">{f.category}</span></button>
          <div className="sub">{f.affected.map((a) => [a.instanceId, a.netId].filter(Boolean).join(' · ')).join(' ; ')}{f.confidence !== undefined ? ` · confidence ${f.confidence}` : ''}</div>
          {session.openFinding === f.id && <Detail f={f} />}
        </div></div>
      ))}
    </section>
  );
}
