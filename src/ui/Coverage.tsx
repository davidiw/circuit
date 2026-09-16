import { useEffect } from 'react';
import type { Session } from '../model/workflow';
import type { Action } from './store';

const CLASS: Record<string, string> = { checked: 'ok', partial: 'part', estimated: 'est', heuristic: 'heur', not_evaluated: 'no', unsupported: 'no' };

export function Coverage({ session, dispatch }: { session: Session; dispatch: React.Dispatch<Action> }) {
  const ev = session.project.lastEvaluation;
  useEffect(() => { if (ev) { const el = document.getElementById('panel-coverage'); const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { dispatch({ type: 'VIEW_COVERAGE' }); io.disconnect(); } }); if (el) io.observe(el); return () => io.disconnect(); } }, [ev, dispatch]);
  return (
    <section className="panel" id="panel-coverage"><h4>Coverage {ev && <span>{ev.status}</span>}</h4>
      {!ev && <div className="muted small">Nothing evaluated yet. This panel lists each dimension as checked, partial, estimated, heuristic, or not evaluated. There is no overall score.</div>}
      {ev && (['electrical', 'product'] as const).map((g) => (
        <ul className="cov" key={g}><li className="grp">{g}</li>
          {ev.coverage.filter((c) => c.group === g).map((c) => <li key={c.dimension} title={c.note}><span>{c.dimension.replace(/_/g, ' ')}</span><span className={`st ${CLASS[c.status]}`}>{c.status.replace('_', ' ')}</span></li>)}
        </ul>
      ))}
    </section>
  );
}
