import { useState } from 'react';
import type { Session, LifecycleFinding } from '../model/workflow';
import type { Ctx } from '../eval/context';
import type { PinRef, RegistryComponent, Provenance } from '../model/schema';
import type { Action } from './store';

export const PROV: Record<Provenance, string> = { vetted_source: 'verified', fixture_assumption: 'assumed', user: 'you', ai: 'AI', unknown: 'unknown' };
export const Prov = ({ p }: { p: Provenance }) => <span className={`tag prov ${p}`}>{PROV[p]}</span>;
const humanKind: Record<string, string> = { dev_board: 'Controller board', motor_driver: 'Motor driver', dc_gearmotor: 'DC gearmotor', buck_module_class: 'Buck regulator module', schottky_diode: 'Schottky diode', battery_class: 'Battery pack', capacitor_class: 'Capacitor', dc_supply_class: 'DC supply', camera_module: 'Camera module', audio_amp_breakout: 'Audio amplifier', speaker_class: 'Speaker', switch_class: 'Pushbutton', water_sensor_module: 'Water sensor' };
const KEY_FACTS: Record<string, [string, string][]> = {
  motor_driver: [['h_bridge_channels', 'H-bridge channels'], ['continuous_current_per_channel_a', 'Continuous per channel (A)'], ['peak_current_per_channel_a', 'Peak per channel (A)']],
  dc_gearmotor: [['nominal_v', 'Rated voltage (V)'], ['stall_current_a', 'Stall current (A)'], ['no_load_rpm', 'No-load speed (rpm)'], ['gear_ratio', 'Gear ratio']],
  buck_module_class: [['continuous_output_a', 'Continuous output (A)'], ['dropout_v', 'Dropout (V)'], ['ic_max_output_a', 'IC rating (A)']],
  battery_class: [['nominal_v', 'Nominal (V)'], ['min_usable_v', 'Cutoff (V)'], ['capacity_mah_min', 'Capacity, min (mAh)'], ['mass_g_approx', 'Mass, approx. (g)'], ['continuous_current_a', 'Continuous current (A)']],
  schottky_diode: [['forward_drop_v', 'Forward drop (V)'], ['forward_current_a', 'Forward current (A)']],
  capacitor_class: [['capacitance_uf', 'Capacitance (uF)'], ['voltage_rating_v', 'Rating (V)']],
  dc_supply_class: [['output_v', 'Output (V)'], ['continuous_current_a', 'Continuous current (A)']],
  dev_board: [['logic_v', 'Logic (V)'], ['peak_current_a', 'Peak current (A)'], ['deep_sleep_ua', 'Deep sleep (uA)']],
  camera_module: [['megapixels', 'Megapixels'], ['video_modes', 'Video modes']],
  audio_amp_breakout: [['output_power_w', 'Output power (W)']],
  speaker_class: [['impedance_ohm', 'Impedance (ohm)'], ['power_w', 'Power (W)']],
};
const fmt = (v: unknown) => Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : String(v);

function keyFacts(c: RegistryComponent) {
  const list = KEY_FACTS[c.kind] ?? Object.keys(c.facts).slice(0, 4).map((k) => [k, k.replace(/_/g, ' ')] as [string, string]);
  return list.filter(([k]) => c.facts[k]).map(([k, label]) => ({ label, fact: c.facts[k] }));
}

export function InstanceSheet({ session, ctx, lifecycles, dispatch }: { session: Session; ctx: Ctx; lifecycles: LifecycleFinding[]; dispatch: React.Dispatch<Action> }) {
  const id = session.selectedInstance!; const inst = ctx.inst(id); const c = inst && ctx.comp(id);
  if (!inst || !c) return null;
  const pins = c.pins.map((p) => ({ p, net: ctx.netOf(id, p.name), v: undefined as number | undefined })).map((x) => ({ ...x, v: x.net ? ctx.netVoltages.get(x.net.id)?.nominal : undefined }));
  const related = lifecycles.filter((f) => f.lifecycle !== 'resolved' && f.affected.some((a) => a.instanceId === id));
  const ranges = c.pins.filter((p) => p.supply_range).map((p) => `${p.name} ${p.supply_range!.min}–${p.supply_range!.max} V`);
  const remove = () => dispatch({ type: 'EDIT', label: `Remove ${inst.label}`, ops: [...(session.project.power.sourceInstance === id ? [{ op: 'clear_power_source' as const }] : []), { op: 'remove_instance' as const, instance: id }] });
  return (
    <section className="sheet" id="panel-inspector">
      <header><div><b>{inst.label}</b><div className="muted small">{c.label}</div></div><button className="btn ghost small" onClick={() => dispatch({ type: 'DESELECT' })} aria-label="Close">✕</button></header>
      <div className="row wrap"><span className="tag cls">{humanKind[c.kind] ?? c.kind}</span><span className={`tag ${c.verification_status.startsWith('vetted') ? 'vet' : c.verification_status === 'constrained_component_class' ? 'cls' : 'unk'}`}>{c.verification_status.startsWith('vetted') ? 'exact part, verified sources' : c.verification_status === 'constrained_component_class' ? 'component class, bounds assumed' : c.verification_status.replace(/_/g, ' ')}</span>{c.prototype_interface && <span className="tag">{c.prototype_interface.type.replace(/_/g, ' ')}</span>}</div>
      <h5>Key constraints</h5>
      <div className="kv">{keyFacts(c).map(({ label, fact }) => <div key={label} className="kvrow"><div>{label}</div><div className="v">{fmt(fact.value)} <Prov p={fact.provenance} /></div></div>)}{ranges.length > 0 && <div className="kvrow"><div>Supply inputs</div><div className="v">{ranges.join('; ')}</div></div>}{Object.entries(inst.props).map(([k, f]) => <div key={k} className="kvrow"><div>{k} (this instance)</div><div className="v">{fmt(f.value)} <Prov p={f.provenance} /></div></div>)}</div>
      {related.length > 0 && <><h5>Findings here</h5><ul className="list">{related.map((f) => <li key={f.id} className="clickable" onClick={() => dispatch({ type: 'VIEW_FINDING', id: f.id })}><span className={`sev ${f.severity === 'violation' ? 'bad' : f.severity === 'warning' ? 'warn' : 'opt'}`}>{f.severity}</span><span>{f.title}</span></li>)}</ul></>}
      <h5>Connections</h5>
      <ul className="list">{pins.map(({ p, net, v }) => <li key={p.name} className={net ? 'clickable' : ''} onClick={() => net && dispatch({ type: 'SELECT_NET', id: net.id })}><span><code>{p.name}</code> <span className="muted small">{p.role.replace('_', ' ')}</span></span><span className="muted small">{net ? `${net.name}${v !== undefined ? ` · ${v.toFixed(2)} V` : ''}` : 'unconnected'}</span></li>)}</ul>
      <div className="row top"><button className="btn small danger" onClick={remove}>Remove part</button><span className="muted small">Or tap a pin in the diagram to wire it.</span></div>
      <details><summary>All facts and sources</summary>
        <table className="facts"><tbody>{Object.entries(c.facts).map(([k, f]) => <tr key={k}><td>{k}</td><td>{fmt(f.value)}</td><td><Prov p={f.provenance} /></td><td className="muted small">{f.note}{f.source && <> <a href={f.source} target="_blank" rel="noreferrer">source</a></>}</td></tr>)}</tbody></table>
        {c.board_features.length > 0 && <div className="muted small top">Board features: {c.board_features.join(', ')}</div>}
        {c.capabilities.length > 0 && <div className="muted small">Capabilities: {c.capabilities.join(', ')}</div>}
        {c.sources.length > 0 && <div className="muted small top">Sources: {c.sources.map((s, i) => <span key={s}>{i ? ', ' : ''}<a href={s} target="_blank" rel="noreferrer">{new URL(s).hostname}</a></span>)}</div>}
        {c.notes && <div className="muted small top">{c.notes}</div>}
      </details>
    </section>
  );
}

export function NetSheet({ session, ctx, lifecycles, dispatch }: { session: Session; ctx: Ctx; lifecycles: LifecycleFinding[]; dispatch: React.Dispatch<Action> }) {
  const [confirmAll, setConfirmAll] = useState(false);
  const net = session.selectedNet ? ctx.netById(session.selectedNet) : undefined;
  if (!net) return null;
  const v = ctx.netVoltages.get(net.id);
  const related = lifecycles.filter((f) => f.lifecycle !== 'resolved' && f.affected.some((a) => a.netId === net.id || (a.instanceId && a.pin && net.pins.some((p) => p.instance === a.instanceId && p.pin === a.pin))));
  const src = net.pins.find((p) => { const r = ctx.pinDef(p.instance, p.pin)?.role; return r === 'supply_out' || r === 'battery_pos' || r === 'motor_out' || r === 'gpio' || r === 'cathode' || r === 'analog_out'; });
  return (
    <section className="sheet" id="panel-net">
      <header><div><b>Net {net.name}</b><div className="muted small">{net.kind} · {net.pins.length} pins{src ? ` · driven by ${ctx.inst(src.instance)?.label} ${src.pin}` : ''}</div></div><button className="btn ghost small" onClick={() => dispatch({ type: 'DESELECT' })} aria-label="Close">✕</button></header>
      <div className="kv">{v ? <div className="kvrow"><div>Voltage</div><div className="v">{v.nominal.toFixed(2)} V ({v.min.toFixed(2)}–{v.max.toFixed(2)}) <span className="muted small">via {v.via}</span> <Prov p="fixture_assumption" /></div></div> : <div className="kvrow"><div>Voltage</div><div className="v">{net.kind === 'ground' ? 'reference (0 V)' : 'not derived'}</div></div>}</div>
      {related.length > 0 && <><h5>Findings on this net</h5><ul className="list">{related.map((f) => <li key={f.id} className="clickable" onClick={() => dispatch({ type: 'VIEW_FINDING', id: f.id })}><span className={`sev ${f.severity === 'violation' ? 'bad' : f.severity === 'warning' ? 'warn' : 'opt'}`}>{f.severity}</span><span>{f.title}</span></li>)}</ul></>}
      <h5>Pins on this net</h5>
      <ul className="list">{net.pins.map((p) => <li key={`${p.instance}.${p.pin}`}><span className="clickable" onClick={() => dispatch({ type: 'SELECT_INSTANCE', id: p.instance })}>{ctx.inst(p.instance)?.label ?? p.instance} · <code>{p.pin}</code> <span className="muted small">{ctx.pinDef(p.instance, p.pin)?.role.replace('_', ' ')}</span></span>
        <button className="btn small" onClick={() => dispatch({ type: 'EDIT', label: `Disconnect ${p.instance}.${p.pin} from ${net.name}`, ops: [{ op: 'move_pin', instance: p.instance, pin: p.pin, net: null }] })}>Disconnect</button></li>)}</ul>
      <div className="row top wrap">{confirmAll
        ? <><span className="small">Disconnect all {net.pins.length} pins from {net.name}?</span><button className="btn small danger" onClick={() => { setConfirmAll(false); dispatch({ type: 'EDIT', label: `Disconnect net ${net.name}`, ops: net.pins.map((pin) => ({ op: 'move_pin' as const, instance: pin.instance, pin: pin.pin, net: null })) }); }}>Yes, disconnect all</button><button className="btn ghost small" onClick={() => setConfirmAll(false)}>Keep</button></>
        : <><button className="btn ghost small" onClick={() => setConfirmAll(true)}>Disconnect all…</button><span className="muted small">Every change is undoable and re-evaluated by the same rules.</span></>}</div>
    </section>
  );
}

export function PinSheet({ session, ctx, dispatch }: { session: Session; ctx: Ctx; dispatch: React.Dispatch<Action> }) {
  const pin = session.selectedPin!; const inst = ctx.inst(pin.instance); const def = ctx.pinDef(pin.instance, pin.pin);
  if (!inst || !def) return null;
  const net = ctx.netOf(pin.instance, pin.pin); const v = net && ctx.netVoltages.get(net.id);
  return (
    <section className="sheet" id="panel-pin">
      <header><div><b>{inst.label} · {pin.pin}</b><div className="muted small">{def.role.replace('_', ' ')}{def.pwm ? ' · PWM capable' : ''}{def.supply_range ? ` · accepts ${def.supply_range.min}–${def.supply_range.max} V` : ''}</div></div><button className="btn ghost small" onClick={() => dispatch({ type: 'DESELECT' })} aria-label="Close">✕</button></header>
      <div className="kv"><div className="kvrow"><div>On net</div><div className="v">{net ? <span className="clickable" onClick={() => dispatch({ type: 'SELECT_NET', id: net.id })}>{net.name}</span> : 'unconnected'}{v ? ` · ${v.nominal.toFixed(2)} V` : ''}</div></div>{def.note && <div className="kvrow"><div>Note</div><div className="v">{def.note}</div></div>}</div>
      <div className="row top wrap">
        <button className="btn small primary" onClick={() => dispatch({ type: 'ARM_CONNECT', pin })}>Connect to another pin…</button>
        {net && <button className="btn small" onClick={() => dispatch({ type: 'EDIT', label: `Disconnect ${pin.instance}.${pin.pin} from ${net.name}`, ops: [{ op: 'move_pin', instance: pin.instance, pin: pin.pin, net: null }] })}>Disconnect</button>}
      </div>
      <div className="muted small top">Connect joins this pin to the other pin's net, or makes a new wire. Poor choices are allowed on purpose: Evaluate explains why they are poor.</div>
    </section>
  );
}
