import { useMemo } from 'react';
import type { Session } from '../model/workflow';
import { findingKey, requirementStatuses } from '../model/workflow';
import { registry } from '../data';
import { evaluate } from '../eval/evaluate';
import { applyOps } from '../eval/mutations';
import type { Action } from './store';
import { Prov } from './Sheet';

const RS: Record<string, string> = { pass: 'met', fail: 'not met', above_target: 'above target', not_evaluated: 'not evaluated', unknown: 'unknown' };

export function Compare({ session, dispatch }: { session: Session; dispatch: React.Dispatch<Action> }) {
  const o = session.project.optimizations.find((x) => x.id === session.compareId);
  const p = session.project;
  const data = useMemo(() => {
    if (!o) return null;
    const before = p.lastEvaluation && p.lastEvaluation.stateHash === session.currentHash ? p.lastEvaluation : evaluate(p, registry);
    const candidate = applyOps(p, o.ops); const after = evaluate(candidate, registry);
    const bk = new Set(before.findings.map(findingKey)), ak = new Set(after.findings.map(findingKey));
    const added = after.findings.filter((f) => !bk.has(findingKey(f))); const resolved = before.findings.filter((f) => !ak.has(findingKey(f)));
    const mkeys = [...new Set([...before.metrics.map((m) => m.key), ...after.metrics.map((m) => m.key)])];
    const metrics = mkeys.map((k) => ({ key: k, b: before.metrics.find((m) => m.key === k), a: after.metrics.find((m) => m.key === k) })).filter((m) => (m.b?.value !== m.a?.value) || !m.b || !m.a);
    const assumptions = candidate.assumptions.filter((a) => { const b = p.assumptions.find((x) => x.key === a.key); return !b || String(b.value) !== String(a.value); }).map((a) => ({ key: a.key, before: p.assumptions.find((x) => x.key === a.key)?.value, after: a.value }));
    const reqB = requirementStatuses(p, before), reqA = requirementStatuses(candidate, after);
    const reqs = p.requirements.filter((r) => r.evaluable && reqB[r.id] !== reqA[r.id]);
    const partsB = p.instances.map((i) => i.label), partsA = candidate.instances.map((i) => i.label);
    const addedParts = candidate.instances.filter((i) => !p.instances.some((x) => x.id === i.id)).map((i) => i.label); const removedParts = p.instances.filter((i) => !candidate.instances.some((x) => x.id === i.id)).map((i) => i.label);
    const unknownsB = before.findings.filter((f) => f.severity === 'unknown').length, unknownsA = after.findings.filter((f) => f.severity === 'unknown').length;
    return { before, after, added, resolved, metrics, assumptions, reqs, reqA, reqB, partsB, partsA, addedParts, removedParts, unknownsB, unknownsA };
  }, [o, p, session.currentHash]);
  if (!o || !data) return null;
  const newViolations = data.added.filter((f) => f.severity === 'violation');
  const sev = (s: string) => (s === 'violation' ? 'bad' : s === 'warning' ? 'warn' : s === 'unknown' ? 'unk' : 'opt');
  const fmt = (v: number, unit: string) => `${Number.isInteger(v) ? v : v.toFixed(2)} ${unit}`;
  return (
    <div className="overlay" role="dialog" aria-label={`Compare: ${o.title}`} onClick={() => dispatch({ type: 'COMPARE' })}>
      <div className="compare" onClick={(e) => e.stopPropagation()}>
        <header><div><div className="num">Optimize · before / after</div><h3>{o.title}</h3><div className="muted">Goal: {o.goal}</div><div className="small top">{o.summary}</div></div><button className="btn ghost small" onClick={() => dispatch({ type: 'COMPARE' })} aria-label="Close">✕</button></header>
        {newViolations.length > 0 && <div className="bar bad"><b>This change introduces {newViolations.length} violation{newViolations.length > 1 ? 's' : ''}.</b> They are listed below and will not be hidden if you apply it.</div>}
        <div className="cmp-grid">
          <section><h5>Modeled quantities</h5>
            {data.metrics.length === 0 && <div className="muted small">No modeled quantity changes.</div>}
            <table className="cmp"><thead><tr><th></th><th>Before</th><th>After</th><th></th></tr></thead><tbody>
              {data.metrics.map((m) => { const b = m.b, a = m.a; const d = a && b ? a.value - b.value : undefined; return <tr key={m.key}><td>{(a ?? b)!.label} <Prov p={(a ?? b)!.provenance} /></td><td>{b ? fmt(b.value, b.unit) : '—'}</td><td><b>{a ? fmt(a.value, a.unit) : '—'}</b></td><td className={`delta ${d === undefined ? '' : d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>{d === undefined ? (a ? 'new' : 'gone') : d === 0 ? '' : `${d > 0 ? '+' : ''}${Number.isInteger(d) ? d : d.toFixed(2)}`}</td></tr>; })}
            </tbody></table>
            <div className="muted small">Values tagged "assumed" rest on stated assumptions; the estimate moves because the inputs moved, not because anything was measured.</div>
          </section>
          <section><h5>Requirements</h5>
            {data.reqs.length === 0 ? <div className="muted small">No requirement changes status.</div> : <table className="cmp"><tbody>{data.reqs.map((r) => <tr key={r.id}><td>{r.label}</td><td>{RS[data.reqB[r.id]]}</td><td><b>{RS[data.reqA[r.id]]}</b></td></tr>)}</tbody></table>}
            <h5>Assumptions changed</h5>
            {data.assumptions.length === 0 ? <div className="muted small">None.</div> : <table className="cmp"><tbody>{data.assumptions.map((a) => <tr key={a.key}><td>{a.key.replace(/_/g, ' ')}</td><td>{String(a.before ?? '—')}</td><td><b>{String(a.after)}</b></td></tr>)}</tbody></table>}
            <h5>Parts and cost</h5>
            <div className="small">{data.partsB.length} → <b>{data.partsA.length}</b> parts{data.addedParts.length ? ` · added ${data.addedParts.join(', ')}` : ''}{data.removedParts.length ? ` · removed ${data.removedParts.join(', ')}` : ''} · cost direction <b>{o.costDirection}</b> (direction only; no prices are modeled)</div>
          </section>
          <section className="span2"><h5>Findings</h5>
            {data.added.length === 0 && data.resolved.length === 0 && <div className="muted small">No finding appears or clears. {data.after.findings.length} persist.</div>}
            {data.added.map((f) => <div key={`a-${f.id}`} className={`finding ${sev(f.severity)}`}><div className="stripe" /><div className="body"><div className="t"><span className={`sev ${sev(f.severity)}`}>new {f.severity === 'optimization' ? 'opportunity' : f.severity}</span><span className="title">{f.title}</span></div><div className="sub">{f.consequence}</div></div></div>)}
            {data.resolved.map((f) => <div key={`r-${f.id}`} className="finding res"><div className="stripe" /><div className="body"><div className="t"><span className="sev ok">resolves</span><span className="title">{f.title}</span></div></div></div>)}
            <div className="small top">Unknowns: {data.unknownsB} → <b>{data.unknownsA}</b> · {data.after.findings.length - data.added.length} findings persist unchanged</div>
          </section>
          {o.acceptsRisks.length > 0 && <section className="span2"><h5>Risks you accept by applying this</h5><ul className="small">{o.acceptsRisks.map((r) => <li key={r}>{r}</li>)}</ul></section>}
        </div>
        <footer>
          <span className="muted small">No score, no ranking: this is the engineering tradeoff, and the evaluator ran on the real candidate state.</span>
          <div className="row"><button className="btn" onClick={() => dispatch({ type: 'COMPARE' })}>Keep current design</button><button className="btn primary" onClick={() => dispatch({ type: 'APPLY_OPTIMIZATION', id: o.id, evaluation: data.after })}>Apply this change</button></div>
        </footer>
      </div>
    </div>
  );
}
