import React from 'react';

import { OverlayShape } from './quality-tab.types';

export function buildOverlayShapes(states: any[], annoIdSet?: Set<number> | null): OverlayShape[] {
    if (!Array.isArray(states)) return [];
    if (annoIdSet && !annoIdSet.size) return [];
    const shapes: OverlayShape[] = [];

    const safePoints = (pts: any): number[] => (
        Array.isArray(pts) ? pts.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : []
    );

    const hasFilter = !!annoIdSet;
    for (const s of states) {
        const sidRaw = s?.serverID ?? s?.serverId ?? s?.id ?? null;
        const sid = typeof sidRaw === 'number' ? sidRaw : Number(sidRaw);
        if (hasFilter) {
            if (!Number.isFinite(sid) || !annoIdSet?.has(sid)) continue;
        }
        if (s?.outside || s?.hidden) continue;

        const shapeType = String(s?.shapeType ?? '').toLowerCase();
        const pts = safePoints(s?.points);
        if (!pts.length) continue;

        if (shapeType === 'rectangle' && pts.length >= 4) {
            const [x1, y1, x2, y2] = pts;
            shapes.push({ kind: 'rect', points: [x1, y1, x2, y2] });
            continue;
        }

        if (shapeType === 'ellipse' && pts.length >= 4) {
            shapes.push({ kind: 'ellipse', points: pts.slice(0, 4) });
            continue;
        }

        if (shapeType === 'points') {
            shapes.push({ kind: 'point', points: pts });
            continue;
        }

        if (shapeType === 'polyline') {
            shapes.push({ kind: 'line', points: pts });
            continue;
        }

        if (shapeType === 'mask' && pts.length >= 4) {
            const [left, top, right, bottom] = pts.slice(-4);
            shapes.push({ kind: 'rect', points: [left, top, right, bottom] });
            continue;
        }

        // polygon/other fallback
        shapes.push({ kind: 'poly', points: pts });
    }

    return shapes;
}

export function renderOverlayShape(
    shape: OverlayShape,
    keyPrefix: string,
    stroke: string,
    fill: string,
    dash?: string,
    strokeWidth = 2,
): JSX.Element | JSX.Element[] {
    const strokeProps = {
        stroke,
        strokeWidth,
        strokeDasharray: dash,
    };

    if (shape.kind === 'rect') {
        const [x1, y1, x2, y2] = shape.points;
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        return (
            <rect
                key={`${keyPrefix}-rect`}
                x={x}
                y={y}
                width={w}
                height={h}
                fill={fill}
                {...strokeProps}
            />
        );
    }

    if (shape.kind === 'ellipse') {
        const [cx, cy, rx, ry] = shape.points;
        return (
            <ellipse
                key={`${keyPrefix}-ellipse`}
                cx={cx}
                cy={cy}
                rx={Math.abs(rx)}
                ry={Math.abs(ry)}
                fill={fill}
                {...strokeProps}
            />
        );
    }

    if (shape.kind === 'point') {
        const circles: JSX.Element[] = [];
        for (let i = 0; i < shape.points.length - 1; i += 2) {
            circles.push(
                <circle
                    key={`${keyPrefix}-point-${i}`}
                    cx={shape.points[i]}
                    cy={shape.points[i + 1]}
                    r={Math.max(2, strokeWidth * 0.85)}
                    fill={stroke}
                    stroke={stroke}
                    strokeWidth={strokeWidth * 0.4}
                />,
            );
        }
        return circles;
    }

    if (shape.kind === 'line') {
        const points = shape.points.join(' ');
        return (
            <polyline
                key={`${keyPrefix}-line`}
                points={points}
                fill='none'
                {...strokeProps}
            />
        );
    }

    const points = shape.points.join(' ');
    return (
        <polygon
            key={`${keyPrefix}-poly`}
            points={points}
            fill={fill}
            {...strokeProps}
        />
    );
}
