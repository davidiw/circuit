import { useState } from 'react';
import { templates, registry } from '../data';
import type { AppState, Action } from './store';

export function Library({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<Action> }) {
  const [confirmNew, setConfirmNew] = useState<string | undefined>();
  const [confirmClear, setConfirmClear] = useState(false);
  const saved = Object.values(state.sessions); const edits = saved.reduce((n, s) => n + s.edits.length, 0);
  return (
    <div className="page">
      <header className="appbar"><div className="brand">Circuit Factory <span>· Library</span></div>
        {saved.length > 0 && (confirmClear
          ? <div className="row wrap"><span className="small">Discard {saved.length} saved session{saved.length > 1 ? 's' : ''}{edits ? ` and ${edits} change${edits > 1 ? 's' : ''}` : ''} from this browser?</span><button className="btn small danger" id="btn-clear-yes" onClick={() => { setConfirmClear(false); dispatch({ type: 'CLEAR_ALL' }); }}>Clear saved work</button><button className="btn ghost small" onClick={() => setConfirmClear(false)}>Keep</button></div>
          : <button className="btn ghost" id="btn-clear" onClick={() => setConfirmClear(true)}>Clear saved work</button>)}</header>
      {state.notice && <div className="bar stale">{state.notice}<button className="x" onClick={() => dispatch({ type: 'DISMISS_NOTICE' })}>dismiss</button></div>}
      <p className="lede"><b>An engineering design as explicit state.</b> Every template below is parts, pins, nets, a power source, requirements, and assumptions with provenance. Open one, run the deterministic rules, change the circuit, and see what the rules say about the change. The Bluetooth Race Car is the fully worked example.</p>
      <div className="cards">
        {templates.map((t) => {
          const exact = t.instances.filter((i) => registry.components.find((c) => c.id === i.registryId)?.verification_status.startsWith('vetted')).length;
          const s = state.sessions[t.id];
          return (
            <div className={`card ${t.status === 'golden_candidate' ? 'golden' : ''}`} key={t.id}>
              <h3>{t.title}</h3>
              <p>{t.goal}</p>
              <div className="tags">
                <span className={`tag ${t.status === 'golden_candidate' ? 'cls' : ''}`}>{t.status === 'golden_candidate' ? 'Vetted template · full walkthrough' : 'Template'}</span>
                <span className="tag vet">{exact} exact part{exact === 1 ? '' : 's'} · {t.instances.length - exact} component class{t.instances.length - exact === 1 ? '' : 'es'}</span>
                <span className="tag">{t.mutations.length} guided change{t.mutations.length === 1 ? '' : 's'}{t.optimizations.length ? ` · ${t.optimizations.length} optimizations` : ''}</span>
                {s && <span className="tag asm">{s.edits.length ? `${s.edits.length} edits in progress` : s.project.lastEvaluation ? 'evaluated' : 'opened'}</span>}
              </div>
              {!s ? <button className={`btn ${t.status === 'golden_candidate' ? 'primary' : ''}`} onClick={() => dispatch({ type: 'OPEN_TEMPLATE', id: t.id })}>Open</button>
                : confirmNew === t.id ? <div className="row wrap"><span className="small">Discard {s.edits.length ? `${s.edits.length} change${s.edits.length > 1 ? 's' : ''} and ` : ''}the saved session?</span><button className="btn small danger" onClick={() => { setConfirmNew(undefined); dispatch({ type: 'NEW_SESSION', id: t.id }); }}>Start fresh</button><button className="btn ghost small" onClick={() => setConfirmNew(undefined)}>Keep</button></div>
                : <div className="row"><button className={`btn ${t.status === 'golden_candidate' ? 'primary' : ''}`} onClick={() => dispatch({ type: 'OPEN_TEMPLATE', id: t.id })}>Resume</button><button className="btn" onClick={() => setConfirmNew(t.id)}>Start fresh</button></div>}
            </div>
          );
        })}
      </div>
      <div className="prompt-box"><div className="in muted">Describe a hobby electronics project…</div><span className="tag">free-text intent: not in this build</span></div>
    </div>
  );
}
