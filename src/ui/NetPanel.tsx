import type { Session } from '../model/workflow';
import type { Ctx } from '../eval/context';
import type { Action } from './store';

export function NetPanel({ session, ctx, dispatch }: { session: Session; ctx: Ctx; dispatch: React.Dispatch<Action> }) {
  const net = session.selectedNet ? ctx.netById(session.selectedNet) : undefined;
  if (!net) return null;
  const v = ctx.netVoltages.get(net.id);
  return (
    <section className="panel" id="panel-net">
      <h4>Net {net.name} <span><button className="btn ghost small" onClick={() => dispatch({ type: 'SELECT_NET', id: net.id })}>close</button></span></h4>
      <div className="kv"><div>Kind</div><div className="v">{net.kind}</div>{v && <><div>Voltage</div><div className="v">{v.nominal.toFixed(2)} V ({v.min.toFixed(2)} – {v.max.toFixed(2)})</div></>}<div>Pins</div><div className="v">{net.pins.length}</div></div>
      <ul className="list top">
        {net.pins.map((p) => <li key={`${p.instance}.${p.pin}`}><span>{ctx.inst(p.instance)?.label ?? p.instance} · <code>{p.pin}</code> <span className="muted small">{ctx.pinDef(p.instance, p.pin)?.role.replace('_', ' ')}</span></span>
          <button className="btn small" onClick={() => dispatch({ type: 'EDIT', label: `Disconnect ${p.instance}.${p.pin} from ${net.name}`, ops: [{ op: 'move_pin', instance: p.instance, pin: p.pin, net: null }] })}>Disconnect</button></li>)}
      </ul>
      <div className="muted small top">Disconnecting a pin is a structured edit. Re-evaluate to see what it changes; Undo reverses it.</div>
    </section>
  );
}
