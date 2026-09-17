import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project, PinRef } from '../model/schema';
import { registry } from '../data';
import { layout, type Layout } from '../eval/layout';

export type Highlight = { instances: Set<string>; nets: Set<string>; severity: string };
export type Selection = { instance?: string; net?: string; pin?: PinRef };
const samePin = (a?: PinRef, b?: PinRef) => !!a && !!b && a.instance === b.instance && a.pin === b.pin;

export function Diagram({ project, highlight, selection, connectFrom, compact, frozenKey, big, zoom, onSelect, onSelectNet, onSelectPin, onConnectTo, onCancelConnect, onDeselect }: {
  project: Project; highlight: Highlight; selection: Selection; connectFrom?: PinRef; compact: boolean; frozenKey: number; big?: boolean; zoom?: number;
  onSelect: (id: string) => void; onSelectNet: (id: string) => void; onSelectPin: (pin: PinRef) => void; onConnectTo: (pin: PinRef) => void; onCancelConnect: () => void; onDeselect: () => void;
}) {
  const [l, setL] = useState<Layout | null>(null);
  const [busy, setBusy] = useState(true);
  const [hoverNet, setHoverNet] = useState<string | undefined>();
  const [hoverPin, setHoverPin] = useState<PinRef | undefined>();
  const [pointer, setPointer] = useState<{ x: number; y: number } | undefined>();
  const [pendingMerge, setPendingMerge] = useState<PinRef | undefined>();
  const [baseW, setBaseW] = useState<{ w: number; key: string }>({ w: 0, key: '' });
  const [hostW, setHostW] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const key = `${project.id}|${compact}|${big ? 'big' : ''}`;
  // The drawing's scale is (container width / the project's first layout width): constant across edits, so a change never
  // rescales every part, but it follows the container, so opening a sheet or rotating a phone refits instead of clipping.
  useLayoutEffect(() => { if (l && (baseW.key !== key || frozenKey === 0) && baseW.w !== l.width) setBaseW({ w: l.width, key }); }, [l, key, frozenKey, baseW]);
  useLayoutEffect(() => {
    const el = hostRef.current; if (!el) return;
    const read = () => setHostW(el.clientWidth - 14);
    read(); const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect();
  }, [l]);
  useEffect(() => {
    let alive = true; setBusy(true);
    layout(project, registry, { compact: compact || project.instances.length < 5 }).then((res) => { if (alive) { setL(res); setBusy(false); } }).catch((e) => { console.error('layout failed', e); if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [project, compact]);
  useEffect(() => { if (!connectFrom) setPendingMerge(undefined); }, [connectFrom]);
  if (!l) return <div className="dia"><div className="muted small" style={{ padding: 20 }}>{busy ? 'Laying out…' : 'Layout unavailable'}</div></div>;

  const VW = l.width, VH = l.height;
  const pxPerUnit = baseW.key === key && baseW.w > 0 && hostW > 0 ? Math.max(hostW, 480) / baseW.w : 0;
  const pxW = pxPerUnit > 0 ? Math.round(l.width * pxPerUnit) : undefined;

  const sevClass = highlight.severity === 'violation' ? 'bad' : highlight.severity === 'warning' ? 'warn' : highlight.severity === 'optimization' ? 'opt' : highlight.severity === 'selection' ? 'focus' : 'ai';
  const netClass = (id?: string) => [id && highlight.nets.has(id) ? sevClass : '', id && selection.net === id ? 'sel' : '', id && hoverNet === id ? 'hover' : ''].join(' ');
  const netOfPin = (p: PinRef) => project.nets.find((n) => n.pins.some((x) => x.instance === p.instance && x.pin === p.pin));
  const fromNet = connectFrom && netOfPin(connectFrom);
  const isCandidate = (p: PinRef) => !!connectFrom && !samePin(p, connectFrom) && (!fromNet || !fromNet.pins.some((x) => x.instance === p.instance && x.pin === p.pin));
  const targetLabel = (p: PinRef) => { const tn = netOfPin(p); if (!fromNet && !tn) return 'new wire'; if (fromNet && tn) return `merge ${fromNet.name} and ${tn.name}`; return `join ${(fromNet ?? tn)!.name}`; };
  const pinAbs = (p: PinRef) => { const n = l.nodes.find((x) => x.id === p.instance); const q = n?.pins.find((x) => x.name === p.pin); return n && q ? { x: n.x + q.x, y: n.y + q.y } : undefined; };
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => { if (!connectFrom || !svgRef.current) return; const pt = svgRef.current.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = svgRef.current.getScreenCTM(); if (m) { const q = pt.matrixTransform(m.inverse()); setPointer({ x: q.x, y: q.y }); } };
  const clickPin = (p: PinRef) => {
    if (!connectFrom) { onSelectPin(p); return; }
    if (samePin(p, connectFrom)) { onCancelConnect(); return; }
    if (!isCandidate(p)) return;
    const tn = netOfPin(p);
    if (fromNet && tn) { setPendingMerge(p); return; }
    onConnectTo(p);
  };
  const from = connectFrom && pinAbs(connectFrom);
  const FLAG = 16;
  return (
    <div className={`dia ${busy ? 'busy' : ''} ${connectFrom ? 'connecting' : ''}`} ref={hostRef}>
      <svg ref={svgRef} viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label={`${project.title} system diagram`} style={big ? { width: `${Math.round((zoom ?? 1) * 100)}%`, minWidth: 0 } : compact ? { width: '100%', minWidth: 0 } : pxW ? { width: pxW, minWidth: 0 } : { minWidth: 0 }}
        onClick={() => (connectFrom ? onCancelConnect() : onDeselect())} onMouseMove={onMove} onMouseLeave={() => setPointer(undefined)}>
        {l.edges.map((e, i) => (
          <g key={`${e.netId}-${i}`} className={`edge ${e.kind} ${netClass(e.netId)}`} onClick={(ev) => { ev.stopPropagation(); if (!connectFrom) onSelectNet(e.netId); }} onMouseEnter={() => setHoverNet(e.netId)} onMouseLeave={() => setHoverNet(undefined)}>
            <polyline className="hit" points={e.points.map((p) => `${p.x},${p.y}`).join(' ')} />
            <polyline points={e.points.map((p) => `${p.x},${p.y}`).join(' ')} />
            {e.label && (e.kind === 'power' || e.kind === 'bus') && i === l.edges.findIndex((x) => x.netId === e.netId) && <text x={e.label.x} y={e.label.y} className="lab">{e.name}</text>}
          </g>
        ))}
        {l.hops.map((h, i) => <g key={`hop-${i}`} className={`hop ${netClass(h.netId)}`}><line x1={h.x - 6} y1={h.y} x2={h.x + 6} y2={h.y} className="mask" /><path d={`M ${h.x - 5},${h.y} A 5,5 0 0 1 ${h.x + 5},${h.y}`} /></g>)}
        {l.junctions.map((j, i) => <circle key={`j-${i}`} className={`junction ${netClass(j.netId)}`} cx={j.x} cy={j.y} r={3} />)}
        {l.nodes.map((n) => (
          <g key={n.id} className={`node ${highlight.instances.has(n.id) ? sevClass : ''} ${selection.instance === n.id ? 'sel' : ''}`} onClick={(ev) => { ev.stopPropagation(); if (!connectFrom) onSelect(n.id); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(n.id)}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} />
            <text x={n.x + 8} y={n.y + n.head - 16} className="title">{n.label}</text>
            <text x={n.x + 8} y={n.y + n.head - 5} className="lab">{(() => { const max = Math.floor((n.w - 16) / 5.2); return n.sub.length > max ? n.sub.slice(0, Math.max(0, max - 1)) + '…' : n.sub; })()}</text>
            {n.pins.map((p) => {
              const ref = { instance: n.id, pin: p.name }; const x = n.x + p.x, y = n.y + p.y;
              const cand = isCandidate(ref); const isFrom = samePin(ref, connectFrom); const isSel = samePin(ref, selection.pin); const isHover = samePin(ref, hoverPin);
              const cls = `pin ${netClass(p.netId)} ${p.wired ? '' : 'nc'} ${cand ? 'cand' : ''} ${isFrom ? 'from' : ''} ${isSel ? 'selpin' : ''} ${connectFrom && !cand && !isFrom ? 'dim' : ''}`;
              const handlers = { onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); clickPin(ref); }, onMouseEnter: () => { setHoverPin(ref); if (p.netId) setHoverNet(p.netId); }, onMouseLeave: () => { setHoverPin(undefined); setHoverNet(undefined); } };
              const tip = `${n.label} ${p.name} · ${p.role.replace('_', ' ')}${p.wired ? ` · ${project.nets.find((q) => q.id === p.netId)?.name}` : ' · unconnected'}`;
              if (p.side === 'west' || p.side === 'east') {
                const out = p.side === 'west' ? -1 : 1;   // direction away from the box
                return <g key={p.name} className={cls} {...handlers}><title>{tip}</title><circle className="hitpin" cx={x} cy={y} r={7} /><circle cx={x} cy={y} r={cand || isSel || isFrom ? 3.4 : 2.2} />{cand && <circle className="ring" cx={x} cy={y} r={6} />}<text x={x - out * 8} y={y + 3} textAnchor={p.side === 'west' ? 'start' : 'end'}>{p.name}</text>
                  {p.flag && <><line x1={x} y1={y} x2={x + out * 12} y2={y} className="flagline" /><text x={x + out * 14} y={y + 3} textAnchor={p.side === 'west' ? 'end' : 'start'} className="flag">{p.flag}</text></>}
                  {cand && isHover && <text x={x - out * 8} y={y - 8} textAnchor={p.side === 'west' ? 'start' : 'end'} className="cand-label">{targetLabel(ref)}</text>}</g>;
              }
              const up = p.side === 'north'; const fy = up ? y - FLAG : y + FLAG;
              return (
                <g key={p.name} className={cls} {...handlers}>
                  <title>{tip}</title><circle className="hitpin" cx={x} cy={y} r={7} /><circle cx={x} cy={y} r={cand || isSel || isFrom ? 3.4 : 2.2} />{cand && <circle className="ring" cx={x} cy={y} r={6} />}
                  <text x={x} y={up ? y + 10 : y - 4} textAnchor="middle" className="pinlab">{p.name}</text>
                  {p.flag && <><line x1={x} y1={y} x2={x} y2={fy} className="flagline" />
                    {up ? <g><line x1={x - 7} y1={fy} x2={x + 7} y2={fy} className="flagline" /><text x={x} y={fy - 4} textAnchor="middle" className="flag">{p.flag}</text></g>
                      : p.flagKind === 'ground' ? <g className="gndsym"><line x1={x - 6} y1={fy} x2={x + 6} y2={fy} /><line x1={x - 4} y1={fy + 3} x2={x + 4} y2={fy + 3} /><line x1={x - 2} y1={fy + 6} x2={x + 2} y2={fy + 6} /><text x={x + 9} y={fy + 4} className="flag">{p.flag}</text></g>
                      : <g><line x1={x - 7} y1={fy} x2={x + 7} y2={fy} className="flagline" /><text x={x} y={fy + 10} textAnchor="middle" className="flag">{p.flag}</text></g>}</>}
                  {cand && isHover && <text x={x} y={up ? y - 8 : y + 18} textAnchor="middle" className="cand-label">{targetLabel(ref)}</text>}
                </g>
              );
            })}
          </g>
        ))}
        {from && pointer && !pendingMerge && <line className="rubber" x1={from.x} y1={from.y} x2={pointer.x} y2={pointer.y} />}
      </svg>
      {connectFrom && (
        <div className="connectbar" role="status">
          {pendingMerge ? <>
            <span>Merge <b>{fromNet?.name}</b> with <b>{netOfPin(pendingMerge)?.name}</b>? Both nets become one.</span>
            <button className="btn small primary" onClick={() => { const p = pendingMerge; setPendingMerge(undefined); onConnectTo(p); }}>Merge</button>
            <button className="btn small" onClick={() => setPendingMerge(undefined)}>Pick another pin</button>
          </> : <>
            <span>Connecting <b>{project.instances.find((i) => i.id === connectFrom.instance)?.label} {connectFrom.pin}</b>{fromNet ? ` (on ${fromNet.name})` : ''}: tap a highlighted pin · Esc cancels</span>
            <button className="btn small" onClick={onCancelConnect}>Cancel</button>
          </>}
        </div>
      )}
      <div className="legend"><span><i className="pw"></i>power</span><span><i className="gnd"></i>ground</span><span><i className="sig"></i>signal</span><span><i className="mot"></i>motor</span><span>⌒ hop, no connection</span><span>○ unconnected pin</span><span>● junction</span>{l.rails.length > 0 && <span className="muted">{l.rails.map((r) => r.name).join(', ')} as symbols at each pin</span>}</div>
    </div>
  );
}
