import { useState } from 'react';
import type { Mutation, MutationOp } from '../model/schema';
import type { Session } from '../model/workflow';
import type { Action } from './store';

const groupOf = (ops: MutationOp[]) => ops.some((o) => o.op === 'swap_registry') ? 'Swap a part' : ops.some((o) => o.op === 'set_prop' || o.op === 'set_assumption') ? 'Change a setting' : ops.some((o) => o.op === 'remove_instance' || o.op === 'clear_power_source' || (o.op === 'move_pin' && o.net === null)) ? 'Break something' : 'Rewire';
const ORDER = ['Break something', 'Rewire', 'Change a setting', 'Swap a part'];

export function Changes({ session, dispatch, stepTarget }: { session: Session; dispatch: React.Dispatch<Action>; stepTarget?: string }) {
  const p = session.project;
  const [showAll, setShowAll] = useState(false);
  const groups = ORDER.map((g) => ({ g, items: p.mutations.filter((m) => groupOf(m.ops) === g) })).filter((x) => x.items.length);
  const lastEdit = session.edits[session.edits.length - 1];
  const visibleLimit = showAll ? Infinity : 6;
  let shown = 0;
  const Chip = ({ m }: { m: Mutation }) => {
    const applied = session.appliedMutations.includes(m.id); const isLast = lastEdit?.mutationId === m.id;
    return (
      <div className={`exp ${applied ? 'applied' : ''} ${stepTarget === m.id ? 'pulse' : ''}`}>
        <div className="exp-main"><button className="btn small" disabled={applied} onClick={() => dispatch({ type: 'APPLY_MUTATION', id: m.id })}>{m.label}</button>
          {applied && (isLast ? <button className="btn ghost small" onClick={() => dispatch({ type: 'UNDO' })}>applied · Undo</button> : <span className="muted small">applied</span>)}</div>
        <div className="muted small">{m.description}</div>
      </div>
    );
  };
  return (
    <section className="panel" id="panel-changes">
      <h4>Try a change <span>guided edits, same operations as manual editing</span></h4>
      {groups.map(({ g, items }) => {
        const take = items.filter(() => shown++ < visibleLimit); if (!take.length) return null;
        return <div key={g} className="exp-group"><div className="exp-h">{g}</div>{take.map((m) => <Chip key={m.id} m={m} />)}</div>;
      })}
      {p.mutations.length > 6 && <button className="btn ghost small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show ${p.mutations.length - 6} more`}</button>}
      {session.edits.length > 0 && <div className="row top"><button className="btn small" onClick={() => dispatch({ type: 'RESET' })}>Reset to {p.source === 'imported' ? 'imported design' : 'template'}</button><span className="muted small">{session.edits.length} change{session.edits.length > 1 ? 's' : ''} applied</span></div>}
    </section>
  );
}

export function Optimize({ session, dispatch, active }: { session: Session; dispatch: React.Dispatch<Action>; active: boolean }) {
  const p = session.project;
  if (!p.optimizations.length) return null;
  const applied = new Set(session.edits.map((e) => e.optimizationId).filter(Boolean));
  return (
    <section className={`panel optimize ${active ? 'pulse' : ''}`} id="panel-optimize">
      <h4>Optimize <span>curated changes toward the product goals; consequences come from the same rules</span></h4>
      {!p.lastEvaluation && <div className="muted small">Evaluate first so there is a before to compare against.</div>}
      {p.optimizations.map((o) => (
        <div key={o.id} className={`opt ${applied.has(o.id) ? 'applied' : ''}`}>
          <div className="opt-t"><b>{o.title}</b><span className={`tag ${o.costDirection === 'lower' ? 'vet' : o.costDirection === 'higher' ? 'asm' : ''}`}>cost {o.costDirection}</span></div>
          <div className="muted small">Goal: {o.goal}</div>
          <div className="small">{o.summary}</div>
          <div className="row top"><button className="btn small primary" disabled={!p.lastEvaluation || applied.has(o.id)} onClick={() => dispatch({ type: 'COMPARE', id: o.id })}>{applied.has(o.id) ? 'Applied' : 'Preview before / after'}</button></div>
        </div>
      ))}
    </section>
  );
}
