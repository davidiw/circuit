import type { Session } from '../model/workflow';
import type { CoverageEntry } from '../model/schema';
import type { Action } from './store';

const CLASS: Record<string, string> = { checked: 'ok', partial: 'part', estimated: 'est', heuristic: 'heur', not_evaluated: 'no', unsupported: 'no' };
const OUT: Record<string, string> = { violation: 'bad', warning: 'warn', unknown: 'unk', optimization: 'opt' };
const OUTWORD: Record<string, string> = { violation: 'violation', warning: 'warning', unknown: 'unknown', optimization: 'opportunity' };

function Row({ c }: { c: CoverageEntry }) {
  const flagged = c.outcome && c.outcome !== 'pass';
  return (
    <li title={c.note} className={c.outcome === 'violation' || c.outcome === 'warning' ? 'failed' : ''}>
      <span>{c.dimension.replace(/_/g, ' ')}</span>
      <span className="sts"><span className={`st ${CLASS[c.status]}`}>{c.status.replace('_', ' ')}</span>{flagged ? <span className={`st ${OUT[c.outcome!]}`}>{c.findingCount} {OUTWORD[c.outcome!]}{(c.findingCount ?? 0) > 1 ? 's' : ''}</span> : c.outcome === 'pass' ? <span className="st ok">pass</span> : null}</span>
    </li>
  );
}

export function Coverage({ session, embedded }: { session: Session; dispatch: React.Dispatch<Action>; embedded?: boolean }) {
  const ev = session.project.lastEvaluation;
  const evaluated = (ev?.coverage ?? []).filter((c) => c.status !== 'not_evaluated' && c.status !== 'unsupported');
  const notEval = (ev?.coverage ?? []).filter((c) => c.status === 'not_evaluated' || c.status === 'unsupported');
  const body = <>
    {(['electrical', 'product'] as const).map((g) => (
      <ul className="cov" key={g}><li className="grp">{g}</li>{evaluated.filter((c) => c.group === g).map((c) => <Row key={c.dimension} c={c} />)}</ul>
    ))}
    {notEval.length > 0 && <div className="muted small top"><b>Not evaluated:</b> {notEval.map((c) => c.dimension.replace(/_/g, ' ')).join(', ')}. Nothing here has been checked; a clean findings list says nothing about these.</div>}
    <div className="muted small top">Statuses say how a dimension was evaluated (checked against published limits, estimated from assumptions, heuristic, or partial where data is unknown). There is no overall score on purpose.</div>
  </>;
  if (embedded) return <div className="covbody" id="panel-coverage">{body}</div>;
  return <section className="panel" id="panel-coverage"><h4>Coverage {ev && <span>{ev.status}</span>}</h4>{ev ? body : <div className="muted small">Nothing evaluated yet.</div>}</section>;
}
