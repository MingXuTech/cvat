// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import notification from 'antd/lib/notification';
import { Request, getCore, Job, Task, JobType } from 'cvat-core-wrapper';

import { AnalyticsLiteProps, ResourceKind } from '../types';
import { fetchQualityReportData, isCvatError } from '../../../api';
import { asyncPool } from '../utils';
import { jsonStyle } from '../styles';
import TaskQualitySummary from 'components/analytics-report/task-quality-summary';

import { buildOverlayShapes } from './quality-tab.overlay';
import { ConflictAnnotationId, FrameGalleryState, GalleryItem, GalleryMode, JobRow, JobTotals, OverlayShape, TileOverlayState, TilePreview } from './quality-tab.types';
import {
    buildFrameImageUrl,
    countObjectsForFrames,
    filterFramesByRange,
    getCreatedDateStr,
    getCreatedMs,
    getDsCount,
    getGtCount,
    getJobId,
    getJobUpdatedMs,
    getLatestReportStamp,
    getTargetLastUpdatedMs,
    getTotalCount,
    getValidCount,
    isNewerStamp,
    listPositiveFramesForJob,
    numOrZero,
    parseDuplicateRequestMessage,
    rangeFrames,
    sleep,
    toNumberArray,
} from './quality-tab.utils';
import TaskSummaryExtra from './quality-tab.task-summary-extra';
import JobReportsCard from './quality-tab.job-reports-card';
import ConflictsCard from './quality-tab.conflicts-card';
import { FrameGalleryModal, FramePreviewModal } from './quality-tab.modals';
import { getConflictFrameRowsFromConflicts } from './quality-tab.conflicts';

export default function QualityTab(
    props: AnalyticsLiteProps & { kind: ResourceKind; debugEnabled: boolean },
): JSX.Element {
    const { resource, kind, debugEnabled } = props;
    const core = useMemo(() => getCore(), []);

    const [qualityLoading, setQualityLoading] = useState(false);
    const [qualityError, setQualityError] = useState<string | null>(null);
    const [qualityDebug, setQualityDebug] = useState<any | null>(null);
    const [creatingReport, setCreatingReport] = useState(false);
    const [createRqId, setCreateRqId] = useState<string | null>(null);
    const [createRqStatus, setCreateRqStatus] = useState<any | null>(null);
    const [reports, setReports] = useState<any[]>([]);
    const [expandedJobId, setExpandedJobId] = useState<number | null>(null);
    const [jobRoleFilter, setJobRoleFilter] = useState<'all' | 'parent' | 'consensus'>('all');
    const [conflictRoleFilter, setConflictRoleFilter] = useState<'all' | 'parent' | 'consensus'>('all');
    const [dsPositiveByJobId, setDsPositiveByJobId] = useState<Record<number, number | null>>({});
    const [gtPositiveByJobId, setGtPositiveByJobId] = useState<Record<number, number | null>>({});
    const [dsObjectCountByJobId, setDsObjectCountByJobId] = useState<Record<number, number | null>>({});
    const [gtObjectCountByJobId, setGtObjectCountByJobId] = useState<Record<number, number | null>>({});
    const [gtPositiveFramesByJobId, setGtPositiveFramesByJobId] = useState<Record<number, number[] | null>>({});
    const [dsPositiveLoading, setDsPositiveLoading] = useState(false);
    const [gtPositiveLoading, setGtPositiveLoading] = useState(false);
    const [gtJobs, setGtJobs] = useState<Job[]>([]);
    const [tilePreview, setTilePreview] = useState<TilePreview | null>(null);
    const [frameGallery, setFrameGallery] = useState<FrameGalleryState | null>(null);
    const [tileOverlay, setTileOverlay] = useState<TileOverlayState>({ loading: false, dsShapes: [], gtShapes: [], error: null });
    const [tileImageSize, setTileImageSize] = useState<{ w: number; h: number } | null>(null);
    // We don't show raw report data/conflicts blocks in UI anymore.
    // Conflicts are loaded lazily per job report for the "错误帧定位" table below.
    const [jobAssignees, setJobAssignees] = useState<Record<number, string | null>>({});

    // Validation layout + GT mapping caches (for DS frame -> GT frame jump)
    const [validationByJobLoading, setValidationByJobLoading] = useState<Record<number, boolean>>({});
    const [validationByJobError, setValidationByJobError] = useState<Record<number, string | null>>({});
    const [taskLayouts, setTaskLayouts] = useState<Record<number, any>>({});
    const [jobLayouts, setJobLayouts] = useState<Record<number, any>>({});
    const [gtJobByTask, setGtJobByTask] = useState<Record<number, number | null>>({});
    const [taskIdByJob, setTaskIdByJob] = useState<Record<number, number | null>>({});
    const [conflictsByReportId, setConflictsByReportId] = useState<Record<number, any[] | null>>({});
    const [conflictsLoadingByReportId, setConflictsLoadingByReportId] = useState<Record<number, boolean>>({});
    const [conflictsErrorByReportId, setConflictsErrorByReportId] = useState<Record<number, string | null>>({});

    const getJobHistoryForJobId = (jid: number): any[] => {
        if (!jid) return [];
        const jobReports = reports
            .filter((r: any) => r?.target === 'job' && getJobId(r) === jid)
            .slice()
            .sort((a: any, b: any) => {
                const diff = getCreatedMs(a) - getCreatedMs(b);
                if (diff) return diff;
                return (a.id || 0) - (b.id || 0);
            });

        return jobReports.map((r: any) => {
            const created = getCreatedDateStr(r);
            const label = (() => {
                if (!created) return `#${r?.id ?? '-'}`;
                try { return new Date(created).toLocaleString(); } catch { return created; }
            })();

            const s = r?.summary || {};
            return {
                reportId: r?.id,
                createdMs: getCreatedMs(r),
                label,
                accuracy: typeof s?.accuracy === 'number' ? s.accuracy : null,
                precision: typeof s?.precision === 'number' ? s.precision : null,
                recall: typeof s?.recall === 'number' ? s.recall : null,
                targetLastUpdatedMs: getTargetLastUpdatedMs(r),
            };
        });
    };


    const latestJobReportForCurrentJob = useMemo(() => {
        if (kind !== 'job') return null;
        const jid = resource?.id;
        const list = reports
            .filter((r: any) => r?.target === 'job' && getJobId(r) === jid)
            .slice()
            .sort((a: any, b: any) => {
                const diff = getCreatedMs(b) - getCreatedMs(a);
                if (diff) return diff;
                return (b.id || 0) - (a.id || 0);
            });
        return list[0] || null;
    }, [kind, reports, resource]);

    const displayedJobReports = useMemo(() => {
        const jobReports = reports.filter((r: any) => r?.target === 'job');
        if (!jobReports.length) return [];
        if (kind === 'job') {
            const current = jobReports
                .filter((r: any) => getJobId(r) === resource.id)
                .sort((a: any, b: any) => {
                    const diff = getCreatedMs(b) - getCreatedMs(a);
                    if (diff) return diff;
                    return (b.id || 0) - (a.id || 0);
                });
            return current.slice(0, 1);
        }
        const byJob = new Map<number, any>();
        for (const r of jobReports) {
            const jid = getJobId(r);
            if (typeof jid !== 'number') continue;
            const prev = byJob.get(jid);
            if (!prev) {
                byJob.set(jid, r);
                continue;
            }
            const diff = getCreatedMs(r) - getCreatedMs(prev);
            if (diff > 0) byJob.set(jid, r);
            else if (diff === 0 && (r.id || 0) > (prev.id || 0)) byJob.set(jid, r);
        }
        return Array.from(byJob.values()).sort((a: any, b: any) => {
            const diff = getCreatedMs(b) - getCreatedMs(a);
            if (diff) return diff;
            return (b.id || 0) - (a.id || 0);
        });
    }, [reports, kind, resource]);

    const jobRows = useMemo(() => {
        if (kind !== 'task') {
            return displayedJobReports.map((r: any) => {
                const jid = getJobId(r);
                const jobId = typeof jid === 'number' ? jid : r?.id ?? Math.random();
                return ({
                    key: `job-${jobId}`,
                    jobId,
                    parentJobId: null,
                    role: 'single',
                    depth: 0,
                    jobType: null,
                    job: null,
                    report: r,
                });
            }) as JobRow[];
        }

        const task = resource as Task;
        const jobs = task?.jobs || [];
        const reportByJobId = new Map<number, any>();
        displayedJobReports.forEach((r: any) => {
            const jid = getJobId(r);
            if (typeof jid === 'number') reportByJobId.set(jid, r);
        });

        const parents = jobs
            .filter((job) => job.type === JobType.ANNOTATION)
            .sort((a, b) => a.id - b.id);
        const childrenByParent = new Map<number, Job[]>();
        for (const job of jobs) {
            if (job.type === JobType.CONSENSUS_REPLICA && typeof job.parentJobId === 'number') {
                const list = childrenByParent.get(job.parentJobId) || [];
                list.push(job);
                childrenByParent.set(job.parentJobId, list);
            }
        }
        for (const list of childrenByParent.values()) {
            list.sort((a, b) => a.id - b.id);
        }

        const rows: JobRow[] = [];
        for (const parent of parents) {
            rows.push({
                key: `job-${parent.id}`,
                jobId: parent.id,
                parentJobId: null,
                role: parent.consensusReplicas > 0 ? 'parent' : 'single',
                depth: 0,
                jobType: parent.type,
                job: parent,
                report: reportByJobId.get(parent.id) || null,
            });
            const children = childrenByParent.get(parent.id) || [];
            for (const child of children) {
                rows.push({
                    key: `job-${child.id}`,
                    jobId: child.id,
                    parentJobId: parent.id,
                    role: 'consensus',
                    depth: 1,
                    jobType: child.type,
                    job: child,
                    report: reportByJobId.get(child.id) || null,
                });
            }
        }

        return rows;
    }, [displayedJobReports, kind, resource]);

    const gtJobsFromTask = useMemo(() => {
        if (kind !== 'task') return [];
        const task = resource as Task;
        const jobs = task?.jobs || [];
        return jobs.filter((job) => job.type === JobType.GROUND_TRUTH);
    }, [kind, resource]);

    const displayedOtherReports = useMemo(() => (
        reports
            .filter((r: any) => r?.target !== 'job')
            .sort((a: any, b: any) => {
                const diff = getCreatedMs(b) - getCreatedMs(a);
                if (diff) return diff;
                return (b.id || 0) - (a.id || 0);
            })
    ), [reports]);

    const latestTaskReport = useMemo(() => {
        const taskReports = reports.filter((r: any) => r?.target === 'task');
        if (!taskReports.length) return null;
        return taskReports.reduce((acc: any, r: any) => {
            const accMs = getCreatedMs(acc);
            const rMs = getCreatedMs(r);
            if (rMs > accMs) return r;
            if (rMs === accMs && (r.id || 0) > (acc.id || 0)) return r;
            return acc;
        }, taskReports[0]);
    }, [reports]);

    const parentJobSummary = useMemo(() => {
        if (kind !== 'task') return null;
        const rows = jobRows.filter((row) => row.role !== 'consensus' && row.report?.summary);
        if (!rows.length) return null;

        let valid = 0;
        let ds = 0;
        let gt = 0;
        let total = 0;
        for (const row of rows) {
            const summary = row.report?.summary;
            if (!summary) continue;
            valid += getValidCount(summary);
            ds += getDsCount(summary);
            gt += getGtCount(summary);
            total += getTotalCount(summary);
        }

        if (total <= 0 && (valid > 0 || ds > 0 || gt > 0)) {
            total = Math.max(0, ds + gt - valid);
        }

        const precision = ds ? (valid / ds) : 0;
        const recall = gt ? (valid / gt) : 0;
        const accuracy = total ? (valid / total) : 0;
        return {
            validCount: valid,
            dsCount: ds,
            gtCount: gt,
            totalCount: total,
            precision,
            recall,
            accuracy,
        };
    }, [kind, jobRows]);

    const [parentFrameCounts, setParentFrameCounts] = useState<{
        tp: number;
        fp: number;
        fn: number;
        tn: number;
    } | null>(null);
    const [parentFrameCountsLoading, setParentFrameCountsLoading] = useState(false);

    useEffect(() => {
        if (kind !== 'task') {
            setParentFrameCounts(null);
            setParentFrameCountsLoading(false);
            return;
        }

        const reportIds = jobRows
            .filter((row) => row.role !== 'consensus')
            .map((row) => row.report?.id)
            .filter((id) => typeof id === 'number' && Number.isFinite(id)) as number[];

        if (!reportIds.length) {
            setParentFrameCounts(null);
            setParentFrameCountsLoading(false);
            return;
        }

        let cancelled = false;
        const load = async (): Promise<void> => {
            setParentFrameCountsLoading(true);
            setParentFrameCounts(null);
            const org = core?.config?.organization?.organizationSlug;
            const frameMap = new Map<number, {
                valid: number;
                extra: number;
                missing: number;
                ds: number;
                gt: number;
            }>();

            for (const reportId of reportIds) {
                try {
                    const response = await core.server.request(`/api/quality/reports/${reportId}/data`, {
                        params: {
                            format: 'json',
                            ...(org ? { org } : {}),
                        },
                    });
                    let data = response?.data ?? response;
                    if (typeof data === 'string') data = JSON.parse(data);
                    const frameResults = data?.frame_results ?? data?.frameResults;
                    if (!frameResults || typeof frameResults !== 'object') continue;

                    for (const [frameKey, fr] of Object.entries(frameResults)) {
                        const frameId = Number(frameKey);
                        if (!Number.isFinite(frameId)) continue;
                        const ann: any = (fr as any)?.annotations ?? {};
                        const valid = numOrZero(ann.valid_count ?? ann.validCount);
                        const extra = numOrZero(ann.extra_count ?? ann.extraCount);
                        const missing = numOrZero(ann.missing_count ?? ann.missingCount);
                        const ds = numOrZero(ann.ds_count ?? ann.dsCount);
                        const gt = numOrZero(ann.gt_count ?? ann.gtCount);

                        const current = frameMap.get(frameId) || {
                            valid: 0,
                            extra: 0,
                            missing: 0,
                            ds: 0,
                            gt: 0,
                        };
                        current.valid += valid;
                        current.extra += extra;
                        current.missing += missing;
                        current.ds += ds;
                        current.gt += gt;
                        frameMap.set(frameId, current);
                    }
                } catch {
                    // ignore per-report failures
                }
            }

            if (cancelled) return;

            let tp = 0;
            let fp = 0;
            let fn = 0;
            let tn = 0;
            for (const fr of frameMap.values()) {
                if (fr.valid > 0) tp += 1;
                if (fr.extra > 0) fp += 1;
                if (fr.missing > 0) fn += 1;
                if (fr.ds === 0 && fr.gt === 0) tn += 1;
            }

            setParentFrameCounts({ tp, fp, fn, tn });
            setParentFrameCountsLoading(false);
        };

        load();
        return () => { cancelled = true; };
    }, [kind, jobRows, core]);

    const jobTotals = useMemo<JobTotals | null>(() => {
        if (kind !== 'task') return null;
        let dsObjectCount: number | null = 0;
        let gtObjectCount: number | null = 0;
        let dsObjectCountPending = 0;
        let dsObjectCountFailed = 0;
        let gtObjectCountPending = 0;
        let gtObjectCountFailed = 0;
        let missingReports = 0;
        let jobsCount = 0;
        let dsPositiveImages = 0;
        let dsPositivePending = 0;
        let dsPositiveFailed = 0;
        let gtPositiveImages = 0;
        let gtPositivePending = 0;
        let gtPositiveFailed = 0;
        let dsTotalImages: number | null = 0;
        let gtValidationImages: number | null = 0;
        const taskLayout = taskLayouts[resource.id] || null;
        const taskValidationFrames = toNumberArray(
            taskLayout?.validationFrames ?? taskLayout?.validation_frames ?? [],
        );
        const taskMode = taskLayout?.mode ?? null;

        for (const row of jobRows) {
            if (row.role === 'consensus') continue;
            jobsCount += 1;

            const summary = row.report?.summary;
            if (!summary) missingReports += 1;

            if (typeof row.jobId === 'number') {
                if (row.jobId in dsObjectCountByJobId) {
                    const value = dsObjectCountByJobId[row.jobId];
                    if (typeof value === 'number') dsObjectCount = (dsObjectCount ?? 0) + value;
                    else dsObjectCountFailed += 1;
                } else {
                    dsObjectCountPending += 1;
                }

                if (row.jobId in dsPositiveByJobId) {
                    const value = dsPositiveByJobId[row.jobId];
                    if (typeof value === 'number') dsPositiveImages += value;
                    else dsPositiveFailed += 1;
                } else {
                    dsPositivePending += 1;
                }

                const job = row.job;
                if (job && Number.isInteger(job.startFrame) && Number.isInteger(job.stopFrame)) {
                    const span = job.stopFrame - job.startFrame + 1;
                    if (Number.isFinite(span) && span > 0) {
                        if (taskValidationFrames.length) {
                            const validationInRange = filterFramesByRange(
                                taskValidationFrames,
                                job.startFrame,
                                job.stopFrame,
                            ).length;
                            dsTotalImages = (dsTotalImages ?? 0) + Math.max(0, span - validationInRange);
                        } else {
                            dsTotalImages = (dsTotalImages ?? 0) + span;
                        }
                    } else {
                        dsTotalImages = null;
                    }
                }
            }
        }

        if (dsObjectCountPending > 0 || dsObjectCountFailed > 0) {
            dsObjectCount = null;
        }

        for (const job of gtJobs) {
            const jid = job?.id;
            if (typeof jid !== 'number') continue;
            if (jid in gtObjectCountByJobId) {
                const value = gtObjectCountByJobId[jid];
                if (typeof value === 'number') gtObjectCount = (gtObjectCount ?? 0) + value;
                else gtObjectCountFailed += 1;
            } else {
                gtObjectCountPending += 1;
            }

            if (jid in gtPositiveByJobId) {
                const value = gtPositiveByJobId[jid];
                if (typeof value === 'number') gtPositiveImages += value;
                else gtPositiveFailed += 1;
            } else {
                gtPositivePending += 1;
            }

            if (Number.isInteger(job.startFrame) && Number.isInteger(job.stopFrame)) {
                if (taskValidationFrames.length) {
                    gtValidationImages = (gtValidationImages ?? 0) + filterFramesByRange(taskValidationFrames, job.startFrame, job.stopFrame).length;
                } else {
                    gtValidationImages = null;
                }
            }
        }

        if (gtObjectCountPending > 0 || gtObjectCountFailed > 0) {
            gtObjectCount = null;
        }

        const dsNegativeImages = (dsTotalImages !== null && dsPositivePending === 0 && dsPositiveFailed === 0) ?
            Math.max(0, dsTotalImages - dsPositiveImages) : null;
        const gtNegativeImages = (gtValidationImages !== null && gtPositivePending === 0 && gtPositiveFailed === 0) ?
            Math.max(0, gtValidationImages - gtPositiveImages) : null;

        return {
            dsObjectCount,
            gtObjectCount,
            dsObjectCountPending,
            dsObjectCountFailed,
            gtObjectCountPending,
            gtObjectCountFailed,
            missingReports,
            jobsCount,
            dsPositiveImages,
            dsPositivePending,
            dsPositiveFailed,
            gtPositiveImages,
            gtPositivePending,
            gtPositiveFailed,
            dsTotalImages,
            gtValidationImages,
            dsNegativeImages,
            gtNegativeImages,
        };
    }, [
        kind,
        jobRows,
        dsPositiveByJobId,
        dsObjectCountByJobId,
        gtJobs,
        gtPositiveByJobId,
        gtObjectCountByJobId,
        taskLayouts,
        jobLayouts,
        resource.id,
    ]);

    const jobMetaById = useMemo(() => {
        const map = new Map<number, { role: JobRow['role']; job: Job | null; parentJobId: number | null }>();
        for (const row of jobRows) {
            if (typeof row.jobId === 'number') {
                map.set(row.jobId, { role: row.role, job: row.job, parentJobId: row.parentJobId });
            }
        }
        return map;
    }, [jobRows]);

    const gtImageCountByJobId = useMemo(() => {
        const map = new Map<number, number | null>();
        if (kind !== 'task') return map;
        const taskId = resource.id;
        const taskLayout = taskLayouts[taskId] || null;
        if (!taskLayout) return map;
        const mode = taskLayout?.mode ?? null;
        const validationFrames = toNumberArray(
            taskLayout?.validationFrames ?? taskLayout?.validation_frames ?? [],
        );

        for (const [jobId, meta] of jobMetaById.entries()) {
            const job = meta?.job;
            if (!job || !Number.isInteger(job.startFrame) || !Number.isInteger(job.stopFrame)) {
                map.set(jobId, null);
                continue;
            }

            if (mode === 'gt_pool') {
                const jl = jobLayouts[jobId] || null;
                if (!jl) {
                    map.set(jobId, null);
                    continue;
                }
                const hpFrames = toNumberArray(jl?.honeypotFrames ?? jl?.honeypot_frames ?? []);
                const hpRealFrames = toNumberArray(jl?.honeypotRealFrames ?? jl?.honeypot_real_frames ?? []);
                const frames = hpRealFrames.length ? hpRealFrames : hpFrames;
                map.set(jobId, frames.length);
                continue;
            }

            if (!validationFrames.length) {
                map.set(jobId, 0);
                continue;
            }

            map.set(jobId, filterFramesByRange(validationFrames, job.startFrame, job.stopFrame).length);
        }

        return map;
    }, [kind, resource.id, taskLayouts, jobLayouts, jobMetaById]);

    const gtPositiveImageCountByJobId = useMemo(() => {
        const map = new Map<number, number | null>();
        if (kind !== 'task') return map;
        const taskId = resource.id;
        const taskLayout = taskLayouts[taskId] || null;
        if (!taskLayout) return map;
        const mode = taskLayout?.mode ?? null;
        const validationFrames = toNumberArray(
            taskLayout?.validationFrames ?? taskLayout?.validation_frames ?? [],
        );

        if (gtJobs.length) {
            const allReady = gtJobs.every((job) => typeof job?.id === 'number' && (job.id in gtPositiveFramesByJobId));
            if (!allReady) {
                for (const [jobId] of jobMetaById.entries()) {
                    map.set(jobId, null);
                }
                return map;
            }
        }

        const gtPositiveFrameSet = new Set<number>();
        for (const job of gtJobs) {
            const jid = job?.id;
            if (typeof jid !== 'number') continue;
            const frames = gtPositiveFramesByJobId[jid];
            if (Array.isArray(frames)) {
                for (const f of frames) gtPositiveFrameSet.add(f);
            }
        }

        for (const [jobId, meta] of jobMetaById.entries()) {
            const job = meta?.job;
            if (!job || !Number.isInteger(job.startFrame) || !Number.isInteger(job.stopFrame)) {
                map.set(jobId, null);
                continue;
            }

            let gtFrames: number[] = [];
            if (mode === 'gt_pool') {
                const jl = jobLayouts[jobId] || null;
                if (!jl) {
                    map.set(jobId, null);
                    continue;
                }
                const hpFrames = toNumberArray(jl?.honeypotFrames ?? jl?.honeypot_frames ?? []);
                const hpRealFrames = toNumberArray(jl?.honeypotRealFrames ?? jl?.honeypot_real_frames ?? []);
                gtFrames = hpRealFrames.length ? hpRealFrames : hpFrames;
            } else {
                if (!validationFrames.length) {
                    map.set(jobId, 0);
                    continue;
                }
                gtFrames = filterFramesByRange(validationFrames, job.startFrame, job.stopFrame);
            }

            if (!gtFrames.length) {
                map.set(jobId, 0);
                continue;
            }

            let count = 0;
            for (const f of gtFrames) {
                if (gtPositiveFrameSet.has(f)) count += 1;
            }
            map.set(jobId, count);
        }

        return map;
    }, [kind, resource.id, taskLayouts, jobLayouts, jobMetaById, gtJobs, gtPositiveFramesByJobId]);

    const filteredJobRows = useMemo(() => {
        if (jobRoleFilter === 'all') return jobRows;
        return jobRows.filter((r) => r.role === jobRoleFilter);
    }, [jobRows, jobRoleFilter]);

    const jobRowsStats = useMemo(() => {
        const consensusCount = jobRows.filter((r) => r.role === 'consensus').length;
        const parentCount = jobRows.length - consensusCount;
        return { parentCount, consensusCount };
    }, [jobRows]);

    const hasJobRows = kind === 'task' ? filteredJobRows.length > 0 : displayedJobReports.length > 0;

    const conflictJobReports = useMemo(() => {
        if (kind !== 'task') return displayedJobReports;
        if (conflictRoleFilter === 'all') return displayedJobReports;
        return displayedJobReports.filter((r: any) => {
            const jid = getJobId(r);
            if (typeof jid !== 'number') return false;
            const meta = jobMetaById.get(jid);
            return meta?.role === conflictRoleFilter;
        });
    }, [displayedJobReports, kind, conflictRoleFilter, jobMetaById]);

    const requiredDsPositiveJobs = useMemo(() => {
        if (kind !== 'task') return [];
        return jobRows.filter((row) => row.role !== 'consensus' && row.job);
    }, [kind, jobRows]);

    const ensureValidationContext = async (dsJobId: number, preferredTaskId: number | null): Promise<number | null> => {
        setValidationByJobError((prev) => ({ ...prev, [dsJobId]: null }));
        setValidationByJobLoading((prev) => ({ ...prev, [dsJobId]: true }));

        try {
            let taskId: number | null = preferredTaskId;

            if (!taskId) {
                // Try cache
                taskId = taskIdByJob[dsJobId] ?? null;
            }

            if (!taskId) {
                // Fetch job to get taskId
                const [job] = await core.jobs.get({ jobID: dsJobId });
                taskId = job?.taskId ?? job?.taskID ?? job?.task_id ?? null;
                setTaskIdByJob((prev) => ({ ...prev, [dsJobId]: taskId ?? null }));
            }

            if (!taskId) {
                setValidationByJobError((prev) => ({ ...prev, [dsJobId]: `无法解析 taskId（dsJobId=${dsJobId}）` }));
                return null;
            }

            // Task validation layout
            if (!(taskId in taskLayouts)) {
                // tasks.get expects `id` (not taskID/taskId)
                const [task] = await core.tasks.get({ id: taskId });
                const layout = await (task as any)?.validationLayout?.();
                setTaskLayouts((prev) => ({ ...prev, [taskId as number]: layout ?? null }));
            }

            // DS job validation layout (needed for gt_pool mapping)
            if (!(dsJobId in jobLayouts)) {
                const [job] = await core.jobs.get({ jobID: dsJobId });
                const layout = await (job as any)?.validationLayout?.();
                setJobLayouts((prev) => ({ ...prev, [dsJobId]: layout ?? null }));
            }

            // GT job id for the task
            if (!(taskId in gtJobByTask)) {
                const jobs = await core.jobs.get({ taskID: taskId }, true);
                const gtJob = (jobs || []).find((j: any) => String(j?.type || '').toLowerCase() === 'ground_truth') || null;
                const gtJobId: number | null = gtJob ? gtJob.id : null;
                setGtJobByTask((prev) => ({ ...prev, [taskId as number]: gtJobId }));
            }

            return taskId;
        } catch (err: unknown) {
            setValidationByJobError((prev) => ({ ...prev, [dsJobId]: err instanceof Error ? err.message : '无法加载 validation_layout / GT job 信息' }));
            return null;
        } finally {
            setValidationByJobLoading((prev) => ({ ...prev, [dsJobId]: false }));
        }
    };

    const loadConflictsForReport = async (reportId: number): Promise<void> => {
        setConflictsErrorByReportId((prev) => ({ ...prev, [reportId]: null }));
        setConflictsLoadingByReportId((prev) => ({ ...prev, [reportId]: true }));
        try {
            const list = await core.analytics.quality.conflicts({ reportID: reportId });
            setConflictsByReportId((prev) => ({ ...prev, [reportId]: Array.from(list as any[]) }));
        } catch (err: unknown) {
            setConflictsByReportId((prev) => ({ ...prev, [reportId]: null }));
            setConflictsErrorByReportId((prev) => ({ ...prev, [reportId]: err instanceof Error ? err.message : '无法加载 conflicts' }));
        } finally {
            setConflictsLoadingByReportId((prev) => ({ ...prev, [reportId]: false }));
        }
    };

    const ensureTaskLayout = async (taskId: number): Promise<any | null> => {
        if (taskId in taskLayouts) return taskLayouts[taskId] ?? null;
        try {
            const [task] = await core.tasks.get({ id: taskId });
            const layout = await (task as any)?.validationLayout?.();
            setTaskLayouts((prev) => ({ ...prev, [taskId]: layout ?? null }));
            return layout ?? null;
        } catch {
            setTaskLayouts((prev) => ({ ...prev, [taskId]: prev[taskId] ?? null }));
            return taskLayouts[taskId] ?? null;
        }
    };

    const ensureJobLayout = async (jobId: number, job?: Job | null): Promise<any | null> => {
        if (jobId in jobLayouts) return jobLayouts[jobId] ?? null;
        try {
            let target = job || null;
            if (!target) {
                const [fetched] = await core.jobs.get({ jobID: jobId });
                target = fetched || null;
            }
            const layout = await (target as any)?.validationLayout?.();
            setJobLayouts((prev) => ({ ...prev, [jobId]: layout ?? null }));
            return layout ?? null;
        } catch {
            setJobLayouts((prev) => ({ ...prev, [jobId]: prev[jobId] ?? null }));
            return jobLayouts[jobId] ?? null;
        }
    };

    const openFrameGallery = async (mode: GalleryMode): Promise<void> => {
        if (kind !== 'task') return;
        const taskId = resource.id;
        const titleMap: Record<GalleryMode, string> = {
            tp: 'TP 图片（正确）',
            fp: 'FP 图片（多标）',
            fn: 'FN 图片（漏标）',
            ds_pos: 'DS 正样本图片 (非验证帧 DS>0)',
            ds_neg: 'DS 负样本图片 (非验证帧 DS=0)',
            ds_all: 'DS 全部样本图片 (非验证帧)',
            gt_pos: 'GT 正样本图片 (GT>0)',
            gt_neg: 'GT 负样本图片 (GT=0)',
            gt_all: 'GT 全部样本图片',
        };
        const title = titleMap[mode];
        setFrameGallery({ title, items: [], loading: true, error: null });

        const orgSlug = core?.config?.organization?.organizationSlug ?? null;
        const items: GalleryItem[] = [];
        let errorMsg: string | null = null;

        try {
            if (mode === 'tp') {
                const parentRows = jobRows.filter((r) => r.role !== 'consensus' && r.report && typeof r.jobId === 'number');
                const gtJobId = gtJobs.length ? gtJobs[0].id : null;
                const taskLayout = await ensureTaskLayout(taskId);
                const taskMode = taskLayout?.mode ?? null;

                for (const row of parentRows) {
                    const reportId = row.report?.id;
                    if (typeof reportId !== 'number') continue;
                    try {
                        const response = await core.server.request(`/api/quality/reports/${reportId}/data`, {
                            params: { format: 'json', ...(orgSlug ? { org: orgSlug } : {}) },
                        });
                        let data = response?.data ?? response;
                        if (typeof data === 'string') data = JSON.parse(data);
                        const frameResults = data?.frame_results ?? data?.frameResults;
                        if (!frameResults || typeof frameResults !== 'object') continue;

                        for (const [frameKey, fr] of Object.entries(frameResults)) {
                            const frame = Number(frameKey);
                            if (!Number.isFinite(frame)) continue;
                            const ann: any = (fr as any)?.annotations ?? {};
                            const valid = numOrZero(ann.valid_count ?? ann.validCount);
                            if (valid <= 0) continue;

                            let gtFrame: number | null = null;
                            if (taskMode === 'gt') {
                                gtFrame = frame;
                            } else if (taskMode === 'gt_pool') {
                                const jl = await ensureJobLayout(row.jobId, row.job);
                                const hpFrames = toNumberArray(jl?.honeypotFrames ?? jl?.honeypot_frames ?? []);
                                const hpRealFrames = toNumberArray(jl?.honeypotRealFrames ?? jl?.honeypot_real_frames ?? []);
                                const hpMap = new Map<number, number>();
                                if (hpFrames.length && hpRealFrames.length) {
                                    for (let i = 0; i < hpFrames.length; i++) {
                                        hpMap.set(hpFrames[i], hpRealFrames[i]);
                                    }
                                }
                                gtFrame = hpMap.get(frame) ?? null;
                            }

                            const gtLink = (gtJobId && gtFrame !== null) ?
                                `/tasks/${taskId}/jobs/${gtJobId}?frame=${gtFrame}` : null;
                            items.push({
                                key: `tp-${row.jobId}-${frame}`,
                                jobId: row.jobId,
                                frame,
                                tags: ['TP'],
                                severity: null,
                                preview: buildFrameImageUrl(row.jobId, frame, orgSlug),
                                dsLink: `/tasks/${taskId}/jobs/${row.jobId}?frame=${frame}`,
                                gtLink,
                                role: 'ds',
                                overlayMode: 'all',
                                dsJobId: row.jobId,
                                gtJobId,
                                dsFrame: frame,
                                gtFrame,
                                dsAnnotationIds: [],
                                gtAnnotationIds: [],
                            });
                        }
                    } catch {
                        errorMsg = errorMsg || `无法加载 report ${reportId} 的 TP 帧`;
                    }
                }
            } else if (mode === 'fp' || mode === 'fn') {
                const conflictType = mode === 'fp' ? 'extra_annotation' : 'missing_annotation';
                const parentRows = jobRows.filter((r) => r.role !== 'consensus' && r.report && typeof r.jobId === 'number');
                for (const row of parentRows) {
                    const reportId = row.report?.id;
                    if (typeof reportId !== 'number') continue;
                    let list = conflictsByReportId[reportId] ?? null;
                    if (!Array.isArray(list)) {
                        try {
                            const fetched = await core.analytics.quality.conflicts({ reportID: reportId });
                            list = Array.from(fetched as any[]);
                            setConflictsByReportId((prev) => ({ ...prev, [reportId]: list }));
                        } catch {
                            errorMsg = errorMsg || `无法加载 report ${reportId} 的 conflicts`;
                            continue;
                        }
                    }

                    const rows = getConflictFrameRowsFromConflicts(list);
                    let gtJobIdFromAnnotations: number | null = null;
                    const filtered = rows.filter((r: any) => (r.types || []).includes(conflictType));
                    for (const r of filtered) {
                        const frame = r.frame;
                        const annotationIds = Array.isArray(r.annotationIds) ? (r.annotationIds as ConflictAnnotationId[]) : [];
                        const dsAnnoIds = annotationIds
                            .filter((a) => a.jobId === row.jobId)
                            .map((a) => a.objId);
                        if (gtJobIdFromAnnotations === null) {
                            const other = annotationIds.find((a) => a.jobId !== row.jobId);
                            gtJobIdFromAnnotations = other?.jobId ?? null;
                        }
                        const gtAnnoIds = gtJobIdFromAnnotations ?
                            annotationIds.filter((a) => a.jobId === gtJobIdFromAnnotations).map((a) => a.objId) : [];
                        const severity = (r.severities || []).includes('error') ? 'error' :
                            ((r.severities || []).includes('warning') ? 'warning' : null);
                        const tags = Array.from(new Set(
                            ([] as string[]).concat(
                                [mode.toUpperCase()],
                                r.severities || [],
                                r.types || [],
                            ),
                        ));
                        const taskLayout = await ensureTaskLayout(taskId);
                        const taskMode = taskLayout?.mode ?? null;
                        let gtFrame: number | null = null;
                        if (taskMode === 'gt') {
                            gtFrame = frame;
                        } else if (taskMode === 'gt_pool') {
                            const jl = await ensureJobLayout(row.jobId, row.job);
                            const hpFrames = toNumberArray(jl?.honeypotFrames ?? jl?.honeypot_frames ?? []);
                            const hpRealFrames = toNumberArray(jl?.honeypotRealFrames ?? jl?.honeypot_real_frames ?? []);
                            const hpMap = new Map<number, number>();
                            if (hpFrames.length && hpRealFrames.length) {
                                for (let i = 0; i < hpFrames.length; i++) {
                                    hpMap.set(hpFrames[i], hpRealFrames[i]);
                                }
                            }
                            gtFrame = hpMap.get(frame) ?? null;
                        }
                        const gtLink = (gtJobIdFromAnnotations && gtFrame !== null) ?
                            `/tasks/${taskId}/jobs/${gtJobIdFromAnnotations}?frame=${gtFrame}` : null;
                        items.push({
                            key: `conflict-${row.jobId}-${frame}-${conflictType}`,
                            jobId: row.jobId,
                            frame,
                            tags,
                            severity,
                            errorCount: row.errorCount,
                            warningCount: row.warningCount,
                            preview: buildFrameImageUrl(row.jobId, frame, orgSlug),
                            dsLink: `/tasks/${taskId}/jobs/${row.jobId}?frame=${frame}`,
                            gtLink,
                            role: 'ds',
                            overlayMode: 'conflict',
                            dsJobId: row.jobId,
                            gtJobId: gtJobIdFromAnnotations,
                            dsFrame: frame,
                            gtFrame,
                            dsAnnotationIds: dsAnnoIds,
                            gtAnnotationIds: gtAnnoIds,
                        });
                    }
                }
            } else {
                const isDs = mode.startsWith('ds_');
                const positive = mode.endsWith('_pos');
                const negative = mode.endsWith('_neg');
                const isAll = mode.endsWith('_all');
                const taskLayout = await ensureTaskLayout(taskId);
                const taskValidationFrames = toNumberArray(
                    taskLayout?.validationFrames ?? taskLayout?.validation_frames ?? [],
                );
                const taskMode = taskLayout?.mode ?? null;

                const needsValidationFrames = !(isDs && (positive || negative || isAll));
                if (needsValidationFrames && !taskValidationFrames.length && taskMode !== 'gt_pool') {
                    throw new Error('未找到 validation frames，无法生成正负样本图片列表');
                }

                const jobList: { jobId: number; job: Job }[] = [];
                if (isDs) {
                    for (const row of jobRows) {
                        if (row.role === 'consensus' || !row.job || typeof row.jobId !== 'number') continue;
                        jobList.push({ jobId: row.jobId, job: row.job });
                    }
                } else {
                    for (const job of gtJobs) {
                        if (typeof job?.id === 'number') {
                            jobList.push({ jobId: job.id, job });
                        }
                    }
                }

                for (const entry of jobList) {
                    const job = entry.job;
                    let validationFrames = taskValidationFrames;
                    const useValidationFrames = !(isDs && (positive || negative || isAll));
                    if (isDs && taskMode === 'gt_pool') {
                        const jl = await ensureJobLayout(entry.jobId, job);
                        const hpFrames = toNumberArray(jl?.honeypotFrames ?? jl?.honeypot_frames ?? []);
                        if (hpFrames.length) validationFrames = hpFrames;
                    }

                    if (useValidationFrames && !validationFrames.length) continue;
                    let framesInRange: number[] = [];
                    if (useValidationFrames) {
                        framesInRange = filterFramesByRange(validationFrames, job.startFrame, job.stopFrame);
                    } else if (validationFrames.length) {
                        const validationSet = new Set(validationFrames);
                        framesInRange = rangeFrames(job.startFrame, job.stopFrame)
                            .filter((f) => !validationSet.has(f));
                    } else {
                        framesInRange = rangeFrames(job.startFrame, job.stopFrame);
                    }
                    if (!framesInRange.length) continue;

                    let positiveFrames: number[] = [];
                    if (!isAll) {
                        const validationSet = new Set(framesInRange);
                        const result = await listPositiveFramesForJob(job, validationSet);
                        if (result === null) {
                            errorMsg = errorMsg || `无法读取 job ${entry.jobId} 的标注`;
                            continue;
                        }
                        positiveFrames = result;
                    }

                    const positiveSet = new Set(positiveFrames);
                    const targetFrames = isAll ? framesInRange :
                        (positive ? positiveFrames : (negative ? framesInRange.filter((f) => !positiveSet.has(f)) : framesInRange));

                    const tag = isDs ? (isAll ? 'DS' : (positive ? 'DS+' : 'DS-')) :
                        (isAll ? 'GT' : (positive ? 'GT+' : 'GT-'));
                    for (const frame of targetFrames) {
                        items.push({
                            key: `${tag}-${entry.jobId}-${frame}`,
                            jobId: entry.jobId,
                            frame,
                            tags: [tag],
                            severity: null,
                            preview: buildFrameImageUrl(entry.jobId, frame, orgSlug),
                            dsLink: isDs ? `/tasks/${taskId}/jobs/${entry.jobId}?frame=${frame}` : null,
                            gtLink: !isDs ? `/tasks/${taskId}/jobs/${entry.jobId}?frame=${frame}` : null,
                            role: isDs ? 'ds' : 'gt',
                            overlayMode: 'all',
                            dsJobId: isDs ? entry.jobId : null,
                            gtJobId: !isDs ? entry.jobId : null,
                            dsFrame: isDs ? frame : null,
                            gtFrame: !isDs ? frame : null,
                            dsAnnotationIds: [],
                            gtAnnotationIds: [],
                        });
                    }
                }
            }

            items.sort((a, b) => (a.frame - b.frame) || (a.jobId - b.jobId));
            setFrameGallery({ title, items, loading: false, error: errorMsg });
        } catch (err: unknown) {
            setFrameGallery({
                title,
                items: [],
                loading: false,
                error: err instanceof Error ? err.message : '无法生成图片列表',
            });
        }
    };

    const loadReports = async (): Promise<any[]> => {
        setQualityError(null);
        setQualityLoading(true);
        setQualityDebug(null);
            setReports([]);
            setExpandedJobId(null);
        setCreateRqStatus(null);
        setJobAssignees({});
        setConflictsByReportId({});
        setConflictsLoadingByReportId({});
        setConflictsErrorByReportId({});
        setDsPositiveByJobId({});
        setDsPositiveLoading(false);
        setGtPositiveByJobId({});
        setGtPositiveLoading(false);

        try {
            const filter: any = {};
            // analytics.quality.reports filter (cvat-core-wrapper) expects *ID fields
            // (taskID/projectID/jobID). Using taskId/projectId will throw:
            // "Unsupported filter property has been received: \"taskId\""
            if (kind === 'project') filter.projectID = resource.id;
            if (kind === 'task') filter.taskID = resource.id;
            if (kind === 'job') {
                filter.taskID = (resource as Job).taskId;
                filter.target = 'job';
            }

            const list = await core.analytics.quality.reports(filter, true);
            const raw: any = (list as any);
            const asArray = Array.isArray(raw) ? raw :
                (Array.isArray(raw?.results) ? raw.results : Array.from(raw as any[]));
            asArray.sort((a, b) => {
                const diff = getCreatedMs(b) - getCreatedMs(a);
                if (diff) return diff;
                return (b.id || 0) - (a.id || 0);
            });
            setReports(asArray);

            if (debugEnabled) {
                setQualityDebug({
                    backendAPI: core?.config?.backendAPI,
                    kind,
                    resourceId: resource.id,
                    jobTaskId: kind === 'job' ? (resource as Job).taskId : null,
                    filter,
                    receivedCount: asArray.length,
                    receivedExample: asArray[0] ? {
                        id: asArray[0].id,
                        target: asArray[0].target,
                        jobId: getJobId(asArray[0]),
                        createdDate: getCreatedDateStr(asArray[0]),
                        summary: asArray[0].summary,
                    } : null,
                });
            }
            return asArray;
        } catch (err: unknown) {
            if (isCvatError(err) && (err.code === 403 || err.code === 401)) setQualityError('没有权限访问 Quality reports');
            else setQualityError(err instanceof Error ? err.message : '无法加载 Quality reports');
            return [];
        } finally {
            setQualityLoading(false);
        }
    };

    const loadReportData = async (id: number): Promise<void> => {
        // kept for backward-compat, but we no longer render "Report Data"
        try {
            await fetchQualityReportData(id);
        } catch (err: unknown) {
            notification.error({ message: '无法加载 Quality report data', description: err instanceof Error ? err.message : '' });
        }
    };

    const loadConflicts = async (id: number): Promise<void> => {
        // kept for backward-compat, but we no longer render raw "Conflicts" block
        try {
            await core.analytics.quality.conflicts({ reportID: id });
        } catch (err: unknown) {
            notification.error({ message: '无法加载 Quality conflicts', description: err instanceof Error ? err.message : '' });
        }
    };

    const createQualityReport = async (): Promise<void> => {
        try {
            if (creatingReport) return;
            if (kind === 'job') {
                const jobUpdatedMs = getJobUpdatedMs(resource);
                const reportTargetUpdatedMs = latestJobReportForCurrentJob ?
                    (getTargetLastUpdatedMs(latestJobReportForCurrentJob) || getCreatedMs(latestJobReportForCurrentJob)) :
                    0;
                if (jobUpdatedMs && reportTargetUpdatedMs && jobUpdatedMs <= reportTargetUpdatedMs) {
                    notification.warning({
                        message: 'Job 没有更新，跳过重新计算',
                        description: '未检测到新的标注变更（job.updated_date 没有超过最近一次 report 的 target_last_updated）。',
                    });
                    return;
                }
            }

            setCreatingReport(true);
            setQualityError(null);
            setCreateRqId(null);
            setCreateRqStatus(null);

            const backendAPI: string = core?.config?.backendAPI;
            const url = `${backendAPI}/quality/reports`;
            const body: any = {};
            if (kind === 'project') body.project_id = resource.id;
            if (kind === 'task') body.task_id = resource.id;
            if (kind === 'job') body.task_id = (resource as Job).taskId;

            const response = await core.server.request(url, { method: 'POST', data: body });
            const responseData = (response && typeof response === 'object' && 'data' in response) ? (response as any).data : response;
            const rqId: string | null = responseData?.rq_id || null;
            const reportId = typeof responseData?.id === 'number' ? responseData.id : null;
            if (!rqId || typeof rqId !== 'string') {
                if (reportId) {
                    notification.success({ message: 'Quality Report 已生成，正在刷新列表…' });
                    await loadReports();
                    return;
                }
                notification.warning({ message: '已发送创建请求，但未获得 rq_id', description: '你可以稍后点“刷新列表”看看是否已生成 report。' });
                await loadReports();
                return;
            }

            setCreateRqId(rqId);
            notification.info({ message: '已开始生成 Quality Report', description: `rq_id: ${rqId}` });
            await core.requests.listen(rqId, {
                callback: (req: Request) => {
                    try { setCreateRqStatus(req.toJSON()); } catch { /* ignore */ }
                },
            });
            notification.success({ message: 'Quality Report 已生成，正在刷新列表…' });
            await loadReports();
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const dupInfo = parseDuplicateRequestMessage(errMsg);
            if (dupInfo) {
                setQualityError(null);
                setCreateRqId(null);
                setCreateRqStatus(null);
                setCreatingReport(true);
                try {
                    const baselineStamp = getLatestReportStamp(reports);
                    const findExistingRequest = async (): Promise<Request | null> => {
                        const list = await core.requests.list();
                        const asArray = Array.isArray(list) ? list : Array.from(list as any[]);
                        const byTarget = (req: Request): boolean => {
                            const op = req.operation || {};
                            if (op.type !== dupInfo.action) return false;
                            if (op.target !== dupInfo.target) return false;
                            if (dupInfo.target === 'task') return op.taskID === dupInfo.targetId;
                            if (dupInfo.target === 'project') return op.projectID === dupInfo.targetId;
                            if (dupInfo.target === 'job') return op.jobID === dupInfo.targetId;
                            return false;
                        };
                        return (asArray as Request[]).find(byTarget) || null;
                    };

                    let existing: Request | null = await findExistingRequest();
                    if (!existing) {
                        for (let i = 0; i < 8; i++) {
                            await sleep(1500);
                            existing = await findExistingRequest();
                            if (existing) break;
                        }
                    }

                    if (existing) {
                        setCreateRqId(existing.id);
                        notification.info({ message: '已有计算在进行中', description: `rq_id: ${existing.id}` });
                        await core.requests.listen(existing.id, {
                            initialRequest: existing,
                            callback: (req: Request) => {
                                try { setCreateRqStatus(req.toJSON()); } catch { /* ignore */ }
                            },
                        });
                        notification.success({ message: 'Quality Report 已生成，正在刷新列表…' });
                        await loadReports();
                    } else {
                        notification.warning({
                            message: '已有计算在进行中',
                            description: '未能获取请求 ID，正在等待结果刷新…',
                        });
                        for (let i = 0; i < 10; i++) {
                            const list = await loadReports();
                            if (isNewerStamp(getLatestReportStamp(list), baselineStamp)) break;
                            await sleep(3000);
                        }
                    }
                } catch (listenErr: unknown) {
                    setQualityError(listenErr instanceof Error ? listenErr.message : '创建 Quality Report 失败');
                } finally {
                    setCreatingReport(false);
                }
                return;
            }
            setQualityError(errMsg || '创建 Quality Report 失败');
        } finally {
            setCreatingReport(false);
        }
    };

    useEffect(() => {
        // Load assignees for displayed job reports (best-effort)
        let cancelled = false;
        const loadAssignees = async (): Promise<void> => {
            try {
                const jobIds = Array.from(new Set(
                    (displayedJobReports || [])
                        .map((r: any) => getJobId(r))
                        .filter((v: any) => typeof v === 'number' && Number.isFinite(v)),
                )) as number[];

                const missing = jobIds.filter((jid) => !(jid in jobAssignees));
                if (!missing.length) return;

                for (const jid of missing) {
                    try {
                        const [job] = await core.jobs.get({ jobID: jid });
                        const username = job?.assignee?.username ?? null;
                        if (cancelled) return;
                        setJobAssignees((prev) => ({ ...prev, [jid]: username }));
                    } catch {
                        if (cancelled) return;
                        setJobAssignees((prev) => ({ ...prev, [jid]: null }));
                    }
                }
            } catch {
                // ignore
            }
        };

        loadAssignees();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [core, displayedJobReports]);

    useEffect(() => {
        if (!tilePreview) {
            setTileOverlay({ loading: false, dsShapes: [], gtShapes: [], error: null });
            setTileImageSize(null);
            return;
        }

        const {
            dsJobId,
            gtJobId,
            dsFrame,
            gtFrame,
            dsAnnotationIds,
            gtAnnotationIds,
            overlayMode,
        } = tilePreview;

        setTileImageSize(null);

        const dsAnnoIdSet = new Set(
            (dsAnnotationIds || []).filter((v) => typeof v === 'number' && Number.isFinite(v)),
        );
        const gtAnnoIdSet = new Set(
            (gtAnnotationIds || []).filter((v) => typeof v === 'number' && Number.isFinite(v)),
        );
        const useAll = overlayMode === 'all';
        if (!useAll && !dsAnnoIdSet.size && !gtAnnoIdSet.size) {
            setTileOverlay({ loading: false, dsShapes: [], gtShapes: [], error: null });
            return;
        }

        let cancelled = false;
        const load = async (): Promise<void> => {
            setTileOverlay({ loading: true, dsShapes: [], gtShapes: [], error: null });
            try {
                let dsShapes: OverlayShape[] = [];
                let gtShapes: OverlayShape[] = [];

                if (typeof dsJobId === 'number' && typeof dsFrame === 'number' && (useAll || dsAnnoIdSet.size)) {
                    let job = jobMetaById.get(dsJobId)?.job || null;
                    if (!job) {
                        const [fetched] = await core.jobs.get({ jobID: dsJobId });
                        job = fetched || null;
                    }
                    if (job) {
                        const states = await job.annotations.get(dsFrame, false, []);
                        dsShapes = buildOverlayShapes(states, useAll ? null : dsAnnoIdSet);
                    }
                }

                if (typeof gtJobId === 'number' && typeof gtFrame === 'number' && (useAll || gtAnnoIdSet.size)) {
                    let job = jobMetaById.get(gtJobId)?.job || null;
                    if (!job) {
                        const [fetched] = await core.jobs.get({ jobID: gtJobId });
                        job = fetched || null;
                    }
                    if (job) {
                        const states = await job.annotations.get(gtFrame, false, []);
                        gtShapes = buildOverlayShapes(states, useAll ? null : gtAnnoIdSet);
                    }
                }

                if (!cancelled) setTileOverlay({ loading: false, dsShapes, gtShapes, error: null });
            } catch (err: unknown) {
                if (!cancelled) {
                    setTileOverlay({
                        loading: false,
                        dsShapes: [],
                        gtShapes: [],
                        error: err instanceof Error ? err.message : '无法加载标注',
                    });
                }
            }
        };

        load();
        return () => { cancelled = true; };
    }, [tilePreview, jobMetaById, core]);

    useEffect(() => {
        loadReports();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.id, kind]);

    useEffect(() => {
        if (kind !== 'task') return;
        let cancelled = false;
        const prefetchLayouts = async (): Promise<void> => {
            const taskId = resource.id;
            const layout = await ensureTaskLayout(taskId);
            if (cancelled) return;
            if (layout?.mode !== 'gt_pool') return;
            for (const row of jobRows) {
                if (row.role === 'consensus' || typeof row.jobId !== 'number') continue;
                await ensureJobLayout(row.jobId, row.job);
                if (cancelled) return;
            }
        };
        prefetchLayouts();
        return () => { cancelled = true; };
    }, [kind, resource.id, jobRows]);

    useEffect(() => {
        if (kind !== 'task') {
            setGtJobs([]);
            return;
        }

        if (gtJobsFromTask.length) {
            setGtJobs(gtJobsFromTask);
            return;
        }

        let cancelled = false;
        const loadGtJobs = async (): Promise<void> => {
            try {
                const list = await core.jobs.get({ taskID: resource.id }, true);
                const jobs = (Array.isArray(list) ? list : Array.from(list as any[])) as Job[];
                const gt = jobs.filter((job) => {
                    if (job?.type === JobType.GROUND_TRUTH) return true;
                    const t = String((job as any)?.type ?? '').toLowerCase();
                    return t === 'ground_truth';
                });
                if (!cancelled) setGtJobs(gt);
            } catch {
                if (!cancelled) setGtJobs([]);
            }
        };

        loadGtJobs();
        return () => { cancelled = true; };
    }, [kind, resource.id, gtJobsFromTask, core]);

    useEffect(() => {
        if (kind !== 'task') return;
        let cancelled = false;
        const missing = requiredDsPositiveJobs.filter((row) => !(row.jobId in dsPositiveByJobId));
        if (!missing.length) return;

        const load = async (): Promise<void> => {
            setDsPositiveLoading(true);
            try {
                const taskLayout = await ensureTaskLayout(resource.id);
                const validationFrames = toNumberArray(
                    taskLayout?.validationFrames ?? taskLayout?.validation_frames ?? [],
                );
                const validationSet = new Set(validationFrames);
                const results = await asyncPool(1, missing, async (row) => {
                    const job = row.job as Job;
                    const nonValidationSet = validationFrames.length ?
                        new Set(
                            rangeFrames(job.startFrame, job.stopFrame)
                                .filter((f) => !validationSet.has(f)),
                        ) :
                        undefined;
                    const frames = await listPositiveFramesForJob(job, nonValidationSet);
                    if (frames === null) {
                        return { jobId: row.jobId, count: null, objectCount: null };
                    }
                    const objectCount = await countObjectsForFrames(job, frames);
                    return { jobId: row.jobId, count: frames.length, objectCount };
                });

                if (cancelled) return;
                setDsPositiveByJobId((prev) => {
                    const next = { ...prev };
                    for (const r of results) {
                        next[r.jobId] = r.count;
                    }
                    return next;
                });
                setDsObjectCountByJobId((prev) => {
                    const next = { ...prev };
                    for (const r of results) {
                        next[r.jobId] = r.objectCount;
                    }
                    return next;
                });
            } finally {
                if (!cancelled) setDsPositiveLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [kind, requiredDsPositiveJobs, dsPositiveByJobId, resource.id]);

    useEffect(() => {
        if (kind !== 'task') return;
        let cancelled = false;
        const missing = gtJobs.filter((job) => typeof job?.id === 'number' && !(job.id in gtPositiveByJobId));
        if (!missing.length) return;

        const load = async (): Promise<void> => {
            setGtPositiveLoading(true);
            try {
                const taskId = resource.id;
                const taskLayout = await ensureTaskLayout(taskId);
                const taskValidationFrames = toNumberArray(
                    taskLayout?.validationFrames ?? taskLayout?.validation_frames ?? [],
                );
                const results = await asyncPool(1, missing, async (job) => {
                    if (!taskValidationFrames.length) {
                        return { jobId: job.id, count: null, objectCount: null, frames: null };
                    }
                    const framesInRange = filterFramesByRange(taskValidationFrames, job.startFrame, job.stopFrame);
                    const validationSet = new Set(framesInRange);
                    const frames = await listPositiveFramesForJob(job, validationSet);
                    if (frames === null) {
                        return { jobId: job.id, count: null, objectCount: null, frames: null };
                    }
                    const objectCount = await countObjectsForFrames(job, frames);
                    return { jobId: job.id, count: frames.length, objectCount, frames };
                });

                if (cancelled) return;
                setGtPositiveByJobId((prev) => {
                    const next = { ...prev };
                    for (const r of results) {
                        next[r.jobId] = r.count;
                    }
                    return next;
                });
                setGtPositiveFramesByJobId((prev) => {
                    const next = { ...prev };
                    for (const r of results) {
                        next[r.jobId] = Array.isArray(r.frames) ? r.frames : null;
                    }
                    return next;
                });
                setGtObjectCountByJobId((prev) => {
                    const next = { ...prev };
                    for (const r of results) {
                        next[r.jobId] = r.objectCount;
                    }
                    return next;
                });
            } finally {
                if (!cancelled) setGtPositiveLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [kind, gtJobs, gtPositiveByJobId]);

    useEffect(() => {
        if (kind !== 'task') return;
        if (!conflictJobReports.length) return;
        const reportIds = conflictJobReports
            .map((r: any) => r?.id)
            .filter((id: any) => typeof id === 'number' && Number.isFinite(id)) as number[];
        if (!reportIds.length) return;
        reportIds.forEach((id) => {
            loadConflictsForReport(id);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, conflictJobReports]);

    const taskSummaryExtra = (kind === 'task' && jobTotals) ? (
        <TaskSummaryExtra
            jobTotals={jobTotals}
            gtJobsCount={gtJobs.length}
            dsPositiveLoading={dsPositiveLoading}
            gtPositiveLoading={gtPositiveLoading}
            onOpenGallery={openFrameGallery}
        />
    ) : null;

    return (
        <Space direction='vertical' size='middle' style={{ width: '100%' }}>
            {kind === 'task' && (
                <TaskQualitySummary
                    task={resource as Task}
                    extraSummary={taskSummaryExtra}
                    onMetricClick={(metric) => {
                        if (metric === 'tp') openFrameGallery('tp');
                        if (metric === 'fp') openFrameGallery('fp');
                        if (metric === 'fn') openFrameGallery('fn');
                    }}
                    summaryOverride={parentJobSummary ?? undefined}
                    frameCountsOverride={parentFrameCounts}
                    frameCountsLoadingOverride={parentFrameCountsLoading}
                />
            )}
            {debugEnabled && (
                <Card
                    size='small'
                    title='Analytics Lite Debug (Quality)'
                    extra={(
                        <Space>
                            <Button size='small' onClick={loadReports} disabled={qualityLoading}>Reload (core)</Button>
                        </Space>
                    )}
                >
                    <pre style={{ ...jsonStyle, maxHeight: 240 }}>
                        {JSON.stringify({
                            kind,
                            resourceId: resource.id,
                            jobTaskId: kind === 'job' ? (resource as Job).taskId : null,
                            reportsLength: reports.length,
                            selectedReportId: null,
                            qualityError,
                            qualityDebug,
                        }, null, 2)}
                    </pre>
                </Card>
            )}

            {qualityError && <Alert type='error' message={qualityError} showIcon />}
            {qualityLoading && <Spin tip='Loading reports...' />}

            {!qualityLoading && reports.length === 0 && (
                <Card size='small' title='还没有 Quality Reports'>
                    <Space direction='vertical' style={{ width: '100%' }} size='middle'>
                        <Alert
                            type='warning'
                            showIcon
                            message='当前任务/作业还没有生成质量报表'
                        />
                        <Space>
                            <Button type='primary' loading={creatingReport} onClick={createQualityReport}>生成 Quality Report</Button>
                        </Space>
                        {createRqId && (
                            <Alert
                                type='info'
                                showIcon
                                message={`rq_id: ${createRqId}`}
                                description={createRqStatus ? (
                                    <pre style={{ ...jsonStyle, maxHeight: 180 }}>{JSON.stringify(createRqStatus, null, 2)}</pre>
                                ) : '等待任务状态…'}
                            />
                        )}
                    </Space>
                </Card>
            )}

            <JobReportsCard
                kind={kind}
                reports={reports}
                displayedJobReports={displayedJobReports}
                jobRows={jobRows}
                filteredJobRows={filteredJobRows}
                jobRowsStats={jobRowsStats}
                jobRoleFilter={jobRoleFilter}
                onJobRoleFilterChange={setJobRoleFilter}
                hasJobRows={hasJobRows}
                creatingReport={creatingReport}
                qualityLoading={qualityLoading}
                createQualityReport={createQualityReport}
                expandedJobId={expandedJobId}
                onExpandedJobChange={setExpandedJobId}
                getJobHistoryForJobId={getJobHistoryForJobId}
                jobAssignees={jobAssignees}
            />

            <ConflictsCard
                kind={kind}
                resource={resource}
                conflictRoleFilter={conflictRoleFilter}
                onConflictRoleFilterChange={setConflictRoleFilter}
                conflictJobReports={conflictJobReports}
                conflictsByReportId={conflictsByReportId}
                conflictsLoadingByReportId={conflictsLoadingByReportId}
                conflictsErrorByReportId={conflictsErrorByReportId}
                validationByJobError={validationByJobError}
                taskLayouts={taskLayouts}
                jobLayouts={jobLayouts}
                gtJobByTask={gtJobByTask}
                taskIdByJob={taskIdByJob}
                jobMetaById={jobMetaById}
                jobAssignees={jobAssignees}
                gtImageCountByJobId={gtImageCountByJobId}
                gtPositiveImageCountByJobId={gtPositiveImageCountByJobId}
                orgSlug={core?.config?.organization?.organizationSlug ?? null}
                ensureValidationContext={ensureValidationContext}
                loadConflictsForReport={loadConflictsForReport}
                onTilePreview={setTilePreview}
            />

            <FrameGalleryModal
                frameGallery={frameGallery}
                onClose={() => setFrameGallery(null)}
                onSelect={(m) => setTilePreview({
                    src: m.preview,
                    title: `Frame ${m.frame}`,
                    tags: m.tags || [],
                    severity: m.severity,
                    dsLink: m.dsLink,
                    gtLink: m.gtLink,
                    dsJobId: m.dsJobId,
                    gtJobId: m.gtJobId,
                    dsFrame: m.dsFrame,
                    gtFrame: m.gtFrame,
                    dsAnnotationIds: m.dsAnnotationIds || [],
                    gtAnnotationIds: m.gtAnnotationIds || [],
                    overlayMode: m.overlayMode,
                })}
            />

            <FramePreviewModal
                tilePreview={tilePreview}
                tileOverlay={tileOverlay}
                tileImageSize={tileImageSize}
                onClose={() => setTilePreview(null)}
                onImageSize={setTileImageSize}
            />
        </Space>
    );
}
