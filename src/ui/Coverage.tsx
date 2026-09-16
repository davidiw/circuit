import { useEffect } from 'react';
import type { Session } from '../model/workflow';
import type { CoverageEntry } from '../model/schema';
import type { Action } from './store';

const CLASS: Record<string, string> = { checked: 'ok', partial: 'part', estimated: 'est', heuristic: 'heur', not_evaluated: 'no', unsupported: 'no' };
const OUT: Record<string, string> = { violation: 'bad', warning: 'warn', unknown: 'unk' };

function Row({ c }: { c: CoverageEntry }) {
  const failed = c.outcome && c.outcome !== 'pass';
  return (
    <li title={c.note} className={failed ? 'failed' : ''}>
      <span>{c.dimension.replace(/_/g, ' ')}</span>
      <span className="sts">
        <span className={`st ${CLASS[c.status]}`}>{c.status.replace('_', ' ')}</span>
        {failed && <span className={`st ${OUT[c.outcome!]}`}>{c.findingCount} {c.outcome}{(c.findingCount ?? 0) > 1 ? 's' : ''}</span>}
        {c.outcome === 'pass' && <span className="st ok">pass</span>}
      </span>
    </li>
  );
}

export function Coverage({ session, dispatch }: { session: Session; dispatch: React.Dispatch<Action> }) {
  const ev = session.project.lastEvaluation;
  useEffect(() => { if (ev) { const el = document.getElementById('panel-coverage'); const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { dispatch({ type: 'VIEW_COVERAGE' }); io.disconnect(); } }); if (el) io.observe(el); return () => io.disconnect(); } }, [ev, dispatch]);
  const evaluated = (ev?.coverage ?? []).filter((c) => c.status !== 'not_evaluated' && c.status !== 'unsupported');
  const notEval = (ev?.coverage ?? []).filter((c) => c.status === 'not_evaluated' || c.status === 'unsupported');
  return (
    <section className="panel" id="panel-coverage"><h4>Coverage {ev && <span>{ev.status}</span>}</h4>
      {!ev && <div className="muted small">Nothing evaluated yet. Each dimension that applies to this design will read checked, partial, estimated, or heuristic, with its outcome. There is no overall score.</div>}
      {ev && (['electrical', 'product'] as const).map((g) => (
        <ul className="cov" key={g}><li className="grp">{g}</li>
          {evaluated.filter((c) => c.group === g).map((c) => <Row key={c.dimension} c={c} />)}
        </ul>
      ))}
      {ev && notEval.length > 0 && <div className="muted small top"><b>Not evaluated:</b> {notEval.map((c) => c.dimension.replace(/_/g, ' ')).join(', ')}. Nothing here has been checked; a clean findings list says nothing about these.</div>}
    </section>
  );
}
