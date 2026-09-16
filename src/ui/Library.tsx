import { templates, registry } from '../data';
import type { AppState, Action } from './store';

export function Library({ state, dispatch }: { state: AppState; dispatch: React.Dispatch<Action> }) {
  return (
    <div className="page">
      <header className="appbar"><div className="brand">Circuit Factory <span>· Library</span></div>
        <form method="post" action="/api/logout"><button className="btn ghost" type="submit">Sign out</button></form></header>
      <p className="lede">Start from a vetted template. Each one is a structured design with explicit power, assumptions, and parts, and loads without any AI. The Bluetooth Race Car is the golden path.</p>
      <div className="cards">
        {templates.map((t) => {
          const vetted = t.instances.filter((i) => registry.components.find((c) => c.id === i.registryId)?.verification_status.startsWith('vetted')).length;
          const s = state.sessions[t.id];
          return (
            <div className={`card ${t.status === 'golden_candidate' ? 'golden' : ''}`} key={t.id}>
              <h3>{t.title}</h3>
              <p>{t.goal}</p>
              <div className="tags">
                <span className={`tag ${t.status === 'golden_candidate' ? 'cls' : ''}`}>{t.status === 'golden_candidate' ? 'golden' : 'fixture'} · {t.mutations.length} mutations</span>
                <span className="tag vet">{vetted} vetted of {t.instances.length} parts</span>
                {s && <span className="tag asm">{s.project.lastEvaluation ? 'evaluated' : 'opened'}</span>}
              </div>
              <button className={`btn ${t.status === 'golden_candidate' ? 'primary' : ''}`} onClick={() => dispatch({ type: 'OPEN_TEMPLATE', id: t.id })}>{s ? 'Resume' : 'Open'}</button>
            </div>
          );
        })}
      </div>
      <div className="prompt-box"><div className="in muted">Describe a hobby electronics project…</div><span className="tag">prompt path: not in this build</span></div>
    </div>
  );
}
