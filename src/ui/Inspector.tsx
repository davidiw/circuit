import type { Session } from '../model/workflow';
import type { Ctx } from '../eval/context';

export function Inspector({ session, ctx, onClose }: { session: Session; ctx: Ctx; onClose: () => void }) {
  const id = session.selectedInstance!; const inst = ctx.inst(id); const c = inst && ctx.comp(id);
  if (!inst || !c) return null;
  const fact = (v: unknown) => Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v);
  return (
    <section className="panel inspector" id="panel-inspector">
      <h4>{inst.label} <span><button className="btn ghost small" onClick={onClose}>close</button></span></h4>
      <div className="kv">
        <div>Registry</div><div className="v">{c.id}</div>
        <div>Part</div><div className="v">{c.manufacturer ? `${c.manufacturer} ${c.mpn}` : 'class, no exact part'}</div>
        <div>Status</div><div className="v"><span className={`tag ${c.verification_status.startsWith('vetted') ? 'vet' : c.verification_status === 'constrained_component_class' ? 'cls' : 'unk'}`}>{c.verification_status.replace(/_/g, ' ')}</span></div>
        {c.prototype_interface && <><div>Interface</div><div className="v">{c.prototype_interface.type.replace(/_/g, ' ')}{c.prototype_interface.requires_light_soldering ? ', light soldering' : ''}</div></>}
        {c.board_features.length > 0 && <><div>Board features</div><div className="v">{c.board_features.join(', ')}</div></>}
        {c.capabilities.length > 0 && <><div>Capabilities</div><div className="v">{c.capabilities.join(', ')}</div></>}
      </div>
      <h5>Facts</h5>
      <table className="facts"><tbody>
        {Object.entries(inst.props).map(([k, f]) => <tr key={`p-${k}`}><td>{k} <span className="muted">(instance)</span></td><td>{fact(f.value)}</td><td><span className={`tag prov ${f.provenance}`}>{f.provenance.replace('_', ' ')}</span></td><td className="muted small">{f.note}</td></tr>)}
        {Object.entries(c.facts).map(([k, f]) => <tr key={k}><td>{k}</td><td>{fact(f.value)}</td><td><span className={`tag prov ${f.provenance}`}>{f.provenance.replace('_', ' ')}</span></td><td className="muted small">{f.note}{f.source && <> <a href={f.source} target="_blank" rel="noreferrer">source</a></>}</td></tr>)}
      </tbody></table>
      <h5>Pins</h5>
      <table className="facts"><tbody>{c.pins.map((p) => { const n = ctx.netOf(id, p.name); const v = n && ctx.netVoltages.get(n.id); return <tr key={p.name}><td>{p.name}</td><td>{p.role.replace('_', ' ')}{p.pwm ? ', pwm' : ''}</td><td>{n ? n.name : <span className="muted">unconnected</span>}{v ? ` · ${v.nominal.toFixed(2)} V` : ''}</td><td className="muted small">{p.supply_range ? `${p.supply_range.min}–${p.supply_range.max} V ` : ''}{p.supply_range && <span className={`tag prov ${p.supply_range_provenance ?? 'unknown'}`}>{(p.supply_range_provenance ?? 'unknown').replace('_', ' ')}</span>}{p.note ? ` ${p.note}` : ''}</td></tr>; })}</tbody></table>
      {c.sources.length > 0 && <div className="muted small top">Sources: {c.sources.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer">{new URL(s).hostname}</a>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])}</div>}
      {c.notes && <div className="muted small top">{c.notes}</div>}
    </section>
  );
}
