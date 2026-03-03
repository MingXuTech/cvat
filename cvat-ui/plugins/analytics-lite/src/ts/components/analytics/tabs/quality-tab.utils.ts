import { Job } from 'cvat-core-wrapper';

import { ConflictAnnotationId } from './quality-tab.types';

export function getJobId(r: any): number | null {
    return r?.jobID ?? r?.jobId ?? r?.job_id ?? r?.operation?.job_id ?? null;
}

export function getCreatedDateStr(r: any): string | null {
    return r?.createdDate ?? r?.created_date ?? null;
}

export function getCreatedMs(r: any): number {
    const s = getCreatedDateStr(r);
    if (!s) return 0;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? 0 : ms;
}

export function getTargetLastUpdatedStr(r: any): string | null {
    return r?.targetLastUpdated ?? r?.target_last_updated ?? null;
}

export function getTargetLastUpdatedMs(r: any): number {
    const s = getTargetLastUpdatedStr(r);
    if (!s) return 0;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? 0 : ms;
}

export function getJobUpdatedStr(job: any): string | null {
    return job?.updatedDate ?? job?.updated_date ?? null;
}

export function getJobUpdatedMs(job: any): number {
    const s = getJobUpdatedStr(job);
    if (!s) return 0;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? 0 : ms;
}

export function getLatestReportStamp(list: any[]): { createdMs: number; id: number } {
    if (!Array.isArray(list) || !list.length) {
        return { createdMs: 0, id: 0 };
    }
    return list.reduce((acc, r) => {
        const createdMs = getCreatedMs(r);
        const id = typeof r?.id === 'number' ? r.id : 0;
        if (createdMs > acc.createdMs) return { createdMs, id };
        if (createdMs === acc.createdMs && id > acc.id) return { createdMs, id };
        return acc;
    }, { createdMs: 0, id: 0 });
}

export function isNewerStamp(a: { createdMs: number; id: number }, b: { createdMs: number; id: number }): boolean {
    if (a.createdMs > b.createdMs) return true;
    if (a.createdMs < b.createdMs) return false;
    return a.id > b.id;
}

export function getErrorCount(s: any): number | null {
    return s?.errorCount ?? s?.error_count ?? null;
}

export function getTaskId(r: any): number | null {
    return r?.taskID ?? r?.taskId ?? r?.task_id ?? r?.operation?.task_id ?? null;
}

export function getFrameIdFromAny(r: any): number | null {
    const v = r?.frame_id ?? r?.frameId ?? r?.frame ?? null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return null;
}

export function uniqNums(xs: number[]): number[] {
    return Array.from(new Set(xs.filter((x) => typeof x === 'number' && Number.isFinite(x)))).sort((a, b) => a - b);
}

export function numOrZero(value: any): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function getDsCount(summary: any): number {
    return numOrZero(summary?.dsCount ?? summary?.ds_count);
}

export function getGtCount(summary: any): number {
    return numOrZero(summary?.gtCount ?? summary?.gt_count);
}

export function getValidCount(summary: any): number {
    return numOrZero(summary?.validCount ?? summary?.valid_count);
}

export function getTotalCount(summary: any): number {
    return numOrZero(summary?.totalCount ?? summary?.total_count);
}

export function toNumberArray(values: any): number[] {
    if (!Array.isArray(values)) return [];
    return values
        .map((v) => (typeof v === 'string' ? Number(v) : v))
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
}

export function filterFramesByRange(frames: number[], start: number, stop: number): number[] {
    if (!Number.isInteger(start) || !Number.isInteger(stop)) return [];
    return frames.filter((f) => f >= start && f <= stop);
}

export function rangeFrames(start: number, stop: number): number[] {
    if (!Number.isInteger(start) || !Number.isInteger(stop) || stop < start) return [];
    const count = stop - start + 1;
    const frames = new Array<number>(count);
    for (let i = 0; i < count; i++) {
        frames[i] = start + i;
    }
    return frames;
}

export async function listPositiveFramesForJob(job: Job, validationSet?: Set<number>): Promise<number[] | null> {
    try {
        const start = job.startFrame;
        const stop = job.stopFrame;
        if (!Number.isInteger(start) || !Number.isInteger(stop)) return [];
        if (validationSet && validationSet.size === 0) return [];

        await job.annotations.get(start, false, []);

        let frame = start;
        const frames: number[] = [];
        while (frame <= stop) {
            const found = await job.annotations.search(frame, stop, {
                allowDeletedFrames: false,
                generalFilters: { isEmptyFrame: false },
            });
            if (typeof found !== 'number') break;
            if (!validationSet || validationSet.has(found)) frames.push(found);
            frame = found + 1;
        }

        return frames;
    } catch {
        return null;
    }
}

export function countObjectsInStates(states: any[]): number {
    if (!Array.isArray(states)) return 0;
    let total = 0;
    for (const s of states) {
        if (s?.outside || s?.hidden) continue;
        total += 1;
    }
    return total;
}

export async function countObjectsForFrames(job: Job, frames: number[]): Promise<number | null> {
    try {
        let total = 0;
        for (const frame of frames) {
            const states = await job.annotations.get(frame, false, []);
            total += countObjectsInStates(states);
        }
        return total;
    } catch {
        return null;
    }
}

export function getCounts(summary: any): { tp: number; fp: number; fn: number; tn: number } {
    const tp = numOrZero(summary?.validCount ?? summary?.valid_count);
    const ds = getDsCount(summary);
    const gt = numOrZero(summary?.gtCount ?? summary?.gt_count);
    const total = numOrZero(summary?.totalCount ?? summary?.total_count);
    const fp = Math.max(0, ds - tp);
    const fn = Math.max(0, gt - tp);
    const tn = total ? Math.max(0, total - ds - gt + tp) : 0;
    return { tp, fp, fn, tn };
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

export function buildFrameImageUrl(jobId: number, frame: number, orgSlug?: string | null): string {
    const params = new URLSearchParams({
        type: 'frame',
        quality: 'compressed',
        number: String(frame),
    });
    if (orgSlug) params.set('org', orgSlug);
    return `/api/jobs/${jobId}/data?${params.toString()}`;
}

export function toFiniteNumber(value: any): number | null {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

export function normalizeConflictAnnotationId(raw: any): ConflictAnnotationId | null {
    const jobRaw = raw?.job_id ?? raw?.jobID ?? raw?.jobId;
    const objRaw = raw?.obj_id ?? raw?.objID ?? raw?.objId ?? raw?.serverID ?? raw?.serverId;
    const jobId = toFiniteNumber(jobRaw);
    const objId = toFiniteNumber(objRaw);
    if (jobId === null || objId === null) return null;
    return { jobId, objId };
}

export function parseDuplicateRequestMessage(message: string): {
    action: string;
    target: string;
    targetId: number;
    subresource?: string;
} | null {
    const match = message.match(/action=([^&]+)&target=([^&]+)&target_id=(\\d+)(?:&subresource=([^&]+))?/);
    if (!match) return null;
    const [, action, target, targetIdStr, subresource] = match;
    const targetId = Number(targetIdStr);
    if (!action || !target || !Number.isFinite(targetId)) return null;
    return {
        action,
        target,
        targetId,
        subresource: subresource || undefined,
    };
}
