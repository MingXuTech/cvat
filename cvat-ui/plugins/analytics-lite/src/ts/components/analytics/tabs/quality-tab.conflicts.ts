import { ConflictAnnotationId } from './quality-tab.types';
import { getFrameIdFromAny, normalizeConflictAnnotationId } from './quality-tab.utils';

export type ConflictFrameRow = {
    frame: number;
    types: string[];
    severities: string[];
    count: number;
    errorCount: number;
    warningCount: number;
    annotationIds: ConflictAnnotationId[];
};

export const getConflictFrameRowsFromConflicts = (list: any[] | null): ConflictFrameRow[] => {
    if (!Array.isArray(list) || !list.length) return [];
    const byFrame = new Map<number, {
        frame: number;
        types: Set<string>;
        severities: Set<string>;
        count: number;
        errorCount: number;
        warningCount: number;
        annotationIds: ConflictAnnotationId[];
    }>();

    for (const c of list) {
        const frame = getFrameIdFromAny(c);
        if (frame === null) continue;
        const row = byFrame.get(frame) || {
            frame,
            types: new Set<string>(),
            severities: new Set<string>(),
            count: 0,
            errorCount: 0,
            warningCount: 0,
            annotationIds: [],
        };
        if (typeof c?.type === 'string' && c.type) row.types.add(c.type);
        if (typeof c?.severity === 'string' && c.severity) {
            row.severities.add(c.severity);
            if (c.severity === 'error') row.errorCount += 1;
            if (c.severity === 'warning') row.warningCount += 1;
        }
        const annotationsRaw = Array.isArray(c?.annotationConflicts) ?
            c.annotationConflicts :
            (Array.isArray(c?.annotation_ids) ? c.annotation_ids : []);
        if (Array.isArray(annotationsRaw)) {
            for (const ann of annotationsRaw) {
                const normalized = normalizeConflictAnnotationId(ann);
                if (normalized) row.annotationIds.push(normalized);
            }
        }
        row.count += 1;
        byFrame.set(frame, row);
    }

    const rows = Array.from(byFrame.values()).map((r) => ({
        frame: r.frame,
        count: r.count,
        errorCount: r.errorCount,
        warningCount: r.warningCount,
        types: Array.from(r.types).sort(),
        severities: Array.from(r.severities).sort(),
        annotationIds: r.annotationIds,
    }));
    rows.sort((a, b) => {
        const aErr = a.severities.includes('error') ? 1 : 0;
        const bErr = b.severities.includes('error') ? 1 : 0;
        if (aErr !== bErr) return bErr - aErr;
        return a.frame - b.frame;
    });
    return rows;
};
