import { useMemo } from 'react';
import type { Project } from '../model/schema';
import { registry } from '../data';
import { layout } from '../eval/layout';

type Highlight = { instances: Set<string>; nets: Set<string>; severity: string };

export function Diagram({ project, highlight, selected, columns, onSelect }: { project: Project; highlight: Highlight; selected?: string; columns: 6 | 3; onSelect: (id: string) => void }) {
  const l = useMemo(() => layout(project, registry, { columns }), [project, columns]);
  const sevClass = highlight.severity === 'violation' ? 'bad' : highlight.severity === 'warning' ? 'warn' : 'ai';
  const netClass = (id: string) => (highlight.nets.has(id) ? sevClass : '');
  return (
    <div className="dia">
      <svg viewBox={`0 0 ${l.width} ${l.height}`} role="img" aria-label={`${project.title} system diagram`} style={{ minWidth: columns === 6 ? 900 : 480 }}>
        {l.buses.map((b) => (
          <g key={b.netId} className={`bus ${b.kind} ${netClass(b.netId)}`}>
            <line x1={b.x1} y1={b.y} x2={b.x2} y2={b.y} />
            <text x={b.x1 + 2} y={b.y - 3} className="lab">{b.name}</text>
            {b.taps.map((t) => <polyline key={`${t.nodeId}.${t.pin}`} points={`${t.x},${t.y} ${t.x + (t.x < l.width / 2 && false ? -8 : 8)},${t.y} ${t.x + 8},${b.y}`} />)}
          </g>
        ))}
        {l.edges.map((e, i) => (
          <g key={`${e.netId}-${i}`} className={`edge ${e.kind} ${netClass(e.netId)}`}>
            <polyline points={e.points.map((p) => `${p.x},${p.y}`).join(' ')} />
            <text x={e.points[2].x + 3} y={Math.min(e.points[2].y, e.points[3].y) - 3} className="lab">{e.name}</text>
          </g>
        ))}
        {l.nodes.map((n) => (
          <g key={n.id} className={`node ${highlight.instances.has(n.id) ? sevClass : ''} ${selected === n.id ? 'sel' : ''}`} onClick={() => onSelect(n.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect(n.id)}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={4} />
            <text x={n.x + 8} y={n.y + 14} className="title">{n.label}</text>
            <text x={n.x + 8} y={n.y + 25} className="lab">{n.sub.length > 26 ? n.sub.slice(0, 25) + '…' : n.sub}</text>
            {n.pins.map((p) => (
              <g key={p.name} className={`pin ${p.netId && highlight.nets.has(p.netId) ? sevClass : ''}`}>
                <circle cx={n.x + p.x} cy={n.y + p.y} r={2.2} />
                <text x={n.x + p.x + (p.side === 'left' ? 6 : -6)} y={n.y + p.y + 3} textAnchor={p.side === 'left' ? 'start' : 'end'}>{p.name}</text>
              </g>
            ))}
          </g>
        ))}
      </svg>
      <div className="legend"><span><i className="pw"></i>power rail</span><span><i className="gnd"></i>ground</span><span><i className="sig"></i>signal</span><span><i className="mot"></i>motor</span><span className="muted">tap a part for facts and provenance</span></div>
    </div>
  );
}
