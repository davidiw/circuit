import { useEffect, useState } from 'react';
import type { Project } from '../model/schema';
import { registry } from '../data';
import { layout, type Layout } from '../eval/layout';

type Highlight = { instances: Set<string>; nets: Set<string>; severity: string };

export function Diagram({ project, highlight, selected, selectedNet, compact, onSelect, onSelectNet }: {
  project: Project; highlight: Highlight; selected?: string; selectedNet?: string; compact: boolean; onSelect: (id: string) => void; onSelectNet: (id: string) => void;
}) {
  const [l, setL] = useState<Layout | null>(null);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let alive = true; setBusy(true);
    layout(project, registry, { compact: compact || project.instances.length < 5 }).then((res) => { if (alive) { setL(res); setBusy(false); } }).catch((e) => { console.error('layout failed', e); if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [project, compact]);
  const sevClass = highlight.severity === 'violation' ? 'bad' : highlight.severity === 'warning' ? 'warn' : 'ai';
  const netClass = (id?: string) => (id && highlight.nets.has(id) ? sevClass : id && selectedNet === id ? 'sel' : '');
  if (!l) return <div className="dia"><div className="muted small" style={{ padding: 20 }}>{busy ? 'Laying out…' : 'Layout unavailable'}</div></div>;
  const FLAG = 16;
  return (
    <div className={`dia ${busy ? 'busy' : ''}`}>
      <svg viewBox={`0 0 ${l.width} ${l.height}`} role="img" aria-label={`${project.title} system diagram`} style={{ minWidth: Math.min(l.width, 900) }}>
        {l.edges.map((e, i) => (
          <g key={`${e.netId}-${i}`} className={`edge ${e.kind} ${netClass(e.netId)}`} onClick={() => onSelectNet(e.netId)}>
            <polyline className="hit" points={e.points.map((p) => `${p.x},${p.y}`).join(' ')} />
            <polyline points={e.points.map((p) => `${p.x},${p.y}`).join(' ')} />
            {e.label && (e.kind === 'power' || e.kind === 'bus') && i === l.edges.findIndex((x) => x.netId === e.netId) && <text x={e.label.x} y={e.label.y} className="lab">{e.name}</text>}
          </g>
        ))}
        {l.hops.map((h, i) => <g key={`hop-${i}`} className={`hop ${netClass(h.netId)}`}><line x1={h.x - 6} y1={h.y} x2={h.x + 6} y2={h.y} className="mask" /><path d={`M ${h.x - 5},${h.y} A 5,5 0 0 1 ${h.x + 5},${h.y}`} /></g>)}
        {l.junctions.map((j, i) => <circle key={`j-${i}`} className={`junction ${netClass(j.netId)}`} cx={j.x} cy={j.y} r={3} />)}
        {l.nodes.map((n) => (
          <g key={n.id} className={`node ${highlight.instances.has(n.id) ? sevClass : ''} ${selected === n.id ? 'sel' : ''}`} onClick={() => onSelect(n.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(n.id)}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} />
            <text x={n.x + 8} y={n.y + n.head - 16} className="title">{n.label}</text>
            <text x={n.x + 8} y={n.y + n.head - 5} className="lab">{(() => { const max = Math.floor((n.w - 16) / 5.2); return n.sub.length > max ? n.sub.slice(0, Math.max(0, max - 1)) + '…' : n.sub; })()}</text>
            {n.pins.map((p) => {
              const x = n.x + p.x, y = n.y + p.y; const cls = `pin ${netClass(p.netId)}`;
              if (p.side === 'west' || p.side === 'east') return <g key={p.name} className={cls}><circle cx={x} cy={y} r={2.2} /><text x={x + (p.side === 'west' ? 6 : -6)} y={y + 3} textAnchor={p.side === 'west' ? 'start' : 'end'}>{p.name}</text></g>;
              const up = p.side === 'north'; const fy = up ? y - FLAG : y + FLAG;
              return (
                <g key={p.name} className={cls} onClick={(e) => { if (p.netId) { e.stopPropagation(); onSelectNet(p.netId); } }}>
                  <circle cx={x} cy={y} r={2.2} />
                  <text x={x} y={up ? y + 10 : y - 4} textAnchor="middle" className="pinlab">{p.name}</text>
                  {p.flag && <><line x1={x} y1={y} x2={x} y2={fy} className="flagline" />
                    {up ? <g><line x1={x - 7} y1={fy} x2={x + 7} y2={fy} className="flagline" /><text x={x} y={fy - 4} textAnchor="middle" className="flag">{p.flag}{p.source ? ' (source)' : ''}</text></g>
                      : <g className="gndsym"><line x1={x - 6} y1={fy} x2={x + 6} y2={fy} /><line x1={x - 4} y1={fy + 3} x2={x + 4} y2={fy + 3} /><line x1={x - 2} y1={fy + 6} x2={x + 2} y2={fy + 6} /><text x={x + 9} y={fy + 4} className="flag">{p.flag}</text></g>}</>}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      <div className="legend"><span><i className="pw"></i>power</span><span><i className="gnd"></i>ground</span><span><i className="sig"></i>signal</span><span><i className="mot"></i>motor</span><span>⌒ hop: wires cross, no connection</span><span>● junction</span><span className="muted">{l.rails.length ? `${l.rails.map((r) => r.name).join(', ')} drawn as symbols at each pin · ` : ''}tap a part or wire · Delete removes the selection</span></div>
    </div>
  );
}
