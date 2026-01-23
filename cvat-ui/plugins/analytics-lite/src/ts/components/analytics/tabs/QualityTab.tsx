// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Empty from 'antd/lib/empty';
import Tag from 'antd/lib/tag';
import Select from 'antd/lib/select';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Table from 'antd/lib/table';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';
import { Request, getCore, Job } from 'cvat-core-wrapper';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
} from 'chart.js';

import { AnalyticsLiteProps, ResourceKind } from '../types';
import { fetchQualityReportData, isCvatError } from '../../../api';
import { fmtNum, fmtRatio } from '../utils';
import { jsonStyle } from '../styles';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

function getJobId(r: any): number | null {
    return r?.jobID ?? r?.jobId ?? r?.job_id ?? r?.operation?.job_id ?? null;
}

function getCreatedDateStr(r: any): string | null {
    return r?.createdDate ?? r?.created_date ?? null;
}

function getCreatedMs(r: any): number {
    const s = getCreatedDateStr(r);
    if (!s) return 0;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? 0 : ms;
}

function getTargetLastUpdatedStr(r: any): string | null {
    return r?.targetLastUpdated ?? r?.target_last_updated ?? null;
}

function getTargetLastUpdatedMs(r: any): number {
    const s = getTargetLastUpdatedStr(r);
    if (!s) return 0;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? 0 : ms;
}

function getJobUpdatedStr(job: any): string | null {
    return job?.updatedDate ?? job?.updated_date ?? null;
}

function getJobUpdatedMs(job: any): number {
    const s = getJobUpdatedStr(job);
    if (!s) return 0;
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? 0 : ms;
}

function getLatestReportStamp(list: any[]): { createdMs: number; id: number } {
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

function isNewerStamp(a: { createdMs: number; id: number }, b: { createdMs: number; id: number }): boolean {
    if (a.createdMs > b.createdMs) return true;
    if (a.createdMs < b.createdMs) return false;
    return a.id > b.id;
}

function getErrorCount(s: any): number | null {
    return s?.errorCount ?? s?.error_count ?? null;
}

function getTaskId(r: any): number | null {
    return r?.taskID ?? r?.taskId ?? r?.task_id ?? r?.operation?.task_id ?? null;
}

function getFrameIdFromAny(r: any): number | null {
    const v = r?.frame_id ?? r?.frameId ?? r?.frame ?? null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return null;
}

function uniqNums(xs: number[]): number[] {
    return Array.from(new Set(xs.filter((x) => typeof x === 'number' && Number.isFinite(x)))).sort((a, b) => a - b);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

function parseDuplicateRequestMessage(message: string): {
    action: string;
    target: string;
    targetId: number;
    subresource?: string;
} | null {
    const match = message.match(/action=([^&]+)&target=([^&]+)&target_id=(\d+)(?:&subresource=([^&]+))?/);
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
    const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
    const [expandedJobReportId, setExpandedJobReportId] = useState<number | null>(null);
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

    const selectedReport = useMemo(() => (
        reports.find((r: any) => r?.id === selectedReportId) || null
    ), [reports, selectedReportId]);

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

    const displayedOtherReports = useMemo(() => (
        reports
            .filter((r: any) => r?.target !== 'job')
            .sort((a: any, b: any) => {
                const diff = getCreatedMs(b) - getCreatedMs(a);
                if (diff) return diff;
                return (b.id || 0) - (a.id || 0);
            })
    ), [reports]);

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

    const getConflictFrameRowsFromConflicts = (list: any[] | null): any[] => {
        if (!Array.isArray(list) || !list.length) return [];
        const byFrame = new Map<number, { frame: number; types: Set<string>; severities: Set<string>; count: number }>();

        for (const c of list) {
            const frame = getFrameIdFromAny(c);
            if (frame === null) continue;
            const row = byFrame.get(frame) || {
                frame,
                types: new Set<string>(),
                severities: new Set<string>(),
                count: 0,
            };
            if (typeof c?.type === 'string' && c.type) row.types.add(c.type);
            if (typeof c?.severity === 'string' && c.severity) row.severities.add(c.severity);
            row.count += 1;
            byFrame.set(frame, row);
        }

        const rows = Array.from(byFrame.values()).map((r) => ({
            frame: r.frame,
            count: r.count,
            types: Array.from(r.types).sort(),
            severities: Array.from(r.severities).sort(),
        }));
        rows.sort((a, b) => {
            const aErr = a.severities.includes('error') ? 1 : 0;
            const bErr = b.severities.includes('error') ? 1 : 0;
            if (aErr !== bErr) return bErr - aErr;
            return a.frame - b.frame;
        });
        return rows;
    };

    const loadReports = async (): Promise<any[]> => {
        setQualityError(null);
        setQualityLoading(true);
        setQualityDebug(null);
        setReports([]);
            setSelectedReportId(null);
            setExpandedJobReportId(null);
        setCreateRqStatus(null);
        setJobAssignees({});
        setConflictsByReportId({});
        setConflictsLoadingByReportId({});
        setConflictsErrorByReportId({});

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
            if (asArray.length) {
                let preferred: any | null = null;
                if (kind === 'job') {
                    preferred = asArray.find((r: any) => r?.target === 'job' && getJobId(r) === resource.id) || null;
                }
                if (!preferred) {
                    preferred = asArray.find((r: any) => r?.target === 'job') || null;
                }
                setSelectedReportId((preferred || asArray[0]).id);
            }

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
        loadReports();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.id, kind]);

    useEffect(() => {
        if (kind !== 'task') return;
        if (!displayedJobReports.length) return;
        const reportIds = displayedJobReports
            .map((r: any) => r?.id)
            .filter((id: any) => typeof id === 'number' && Number.isFinite(id)) as number[];
        if (!reportIds.length) return;
        reportIds.forEach((id) => {
            loadConflictsForReport(id);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, displayedJobReports]);

    return (
        <Space direction='vertical' size='middle' style={{ width: '100%' }}>
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
                            selectedReportId,
                            qualityError,
                            qualityDebug,
                        }, null, 2)}
                    </pre>
                </Card>
            )}

            <Card size='small'>
                <Space wrap>
                    <Button
                        type='primary'
                        loading={creatingReport}
                        disabled={qualityLoading}
                        onClick={createQualityReport}
                    >
                        {kind === 'job' ? '重新计算 (当前 Task)' : '生成 / 重新计算'}
                    </Button>
                    <Text>Report:</Text>
                    <Select<number>
                        style={{ minWidth: 250 }}
                        loading={qualityLoading}
                        value={selectedReportId ?? undefined}
                        placeholder='Select a report'
                        onChange={(val: number) => setSelectedReportId(val)}
                        options={reports.map((r: any) => ({
                            value: r.id,
                            label: `#${r.id} (${r.target || 'unknown'}) - acc=${fmtRatio(r?.summary?.accuracy)} prec=${fmtRatio(r?.summary?.precision)} rec=${fmtRatio(r?.summary?.recall)} err=${fmtNum(getErrorCount(r?.summary))}`,
                        }))}
                    />
                    {selectedReportId && (
                        <>
                            {/* kept slot for future */}
                        </>
                    )}
                </Space>
            </Card>

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

            <Card
                size='small'
                title={kind === 'job' ?
                    `Job Reports (当前 job 最新: ${displayedJobReports.length})` :
                    `Job Reports (每个 job 最新: ${displayedJobReports.length} / 原始 ${reports.filter((r: any) => r?.target === 'job').length})`}
            >
                {displayedJobReports.length ? (
                <Table
                        size='small'
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        rowKey={(r: any) => r.id}
                        dataSource={displayedJobReports}
                        onRow={(r: any) => ({
                            onClick: () => {
                                setSelectedReportId(r.id);
                                setExpandedJobReportId((prev) => (prev === r.id ? null : r.id));
                            },
                            style: { cursor: 'pointer' },
                        })}
                        expandable={{
                            expandedRowKeys: expandedJobReportId ? [expandedJobReportId] : [],
                            onExpand: (expanded: boolean, r: any) => {
                                if (!expanded) {
                                    setExpandedJobReportId(null);
                                    return;
                                }
                                setExpandedJobReportId(r.id);
                            },
                            expandedRowRender: (r: any) => {
                                const jid = getJobId(r);
                                if (typeof jid !== 'number') {
                                    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='无法解析 job id' />;
                                }
                                const history = getJobHistoryForJobId(jid);
                                if (history.length < 2) {
                                    return (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={history.length === 1 ? '只有 1 次计算结果，趋势图需要至少 2 次' : '暂无趋势数据'}
                                        />
                                    );
                                }
                                return (
                                    <div style={{ padding: 8 }}>
                                        <div style={{ height: 260 }}>
                                            <Line
                                                data={{
                                                    labels: history.map((p: any) => p.label),
                                                    datasets: [
                                                        {
                                                            label: 'Accuracy (%)',
                                                            data: history.map((p: any) => (typeof p.accuracy === 'number' ? p.accuracy * 100 : null)),
                                                            borderColor: '#1677ff',
                                                            backgroundColor: 'rgba(22, 119, 255, 0.15)',
                                                            tension: 0.25,
                                                            spanGaps: true,
                                                        },
                                                        {
                                                            label: 'Precision (%)',
                                                            data: history.map((p: any) => (typeof p.precision === 'number' ? p.precision * 100 : null)),
                                                            borderColor: '#52c41a',
                                                            backgroundColor: 'rgba(82, 196, 26, 0.15)',
                                                            tension: 0.25,
                                                            spanGaps: true,
                                                        },
                                                        {
                                                            label: 'Recall (%)',
                                                            data: history.map((p: any) => (typeof p.recall === 'number' ? p.recall * 100 : null)),
                                                            borderColor: '#faad14',
                                                            backgroundColor: 'rgba(250, 173, 20, 0.15)',
                                                            tension: 0.25,
                                                            spanGaps: true,
                                                        },
                                                    ],
                                                }}
                                                options={{
                                                    responsive: true,
                                                    maintainAspectRatio: false,
                                                    plugins: {
                                                        legend: { position: 'top' as const },
                                                        tooltip: { mode: 'index' as const, intersect: false },
                                                    },
                                                    interaction: { mode: 'index' as const, intersect: false },
                                                    scales: {
                                                        y: {
                                                            min: 0,
                                                            max: 100,
                                                            ticks: { callback: (v: any) => `${v}%` },
                                                        },
                                                    },
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            },
                            rowExpandable: (r: any) => r?.target === 'job',
                        }}
                        columns={[
                            { title: 'Report', dataIndex: 'id', key: 'id' },
                            { title: 'Target', dataIndex: 'target', key: 'target' },
                            { title: 'Job', key: 'job', render: (_: any, r: any) => getJobId(r) ?? '-' },
                            {
                                title: 'Assignee',
                                key: 'assignee',
                                render: (_: any, r: any) => {
                                    const jid = getJobId(r);
                                    if (typeof jid !== 'number') return '-';
                                    return jobAssignees[jid] || '-';
                                },
                            },
                            { title: 'Accuracy', key: 'accuracy', render: (_: any, r: any) => fmtRatio(r?.summary?.accuracy) },
                            { title: 'Precision', key: 'precision', render: (_: any, r: any) => fmtRatio(r?.summary?.precision) },
                            { title: 'Recall', key: 'recall', render: (_: any, r: any) => fmtRatio(r?.summary?.recall) },
                            { title: 'Errors', key: 'errors', render: (_: any, r: any) => fmtNum(getErrorCount(r?.summary)) },
                            {
                                title: 'Created',
                                key: 'created',
                                render: (_: any, r: any) => {
                                    const dt = getCreatedDateStr(r);
                                    try { return dt ? new Date(dt).toLocaleString() : '-'; } catch { return dt || '-'; }
                                },
                            },
                        ]}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无 Reports' />
                )}
            </Card>

            <Card size='small' title={`错误帧定位（按 Job，DS ↔ GT，可跳转）`}>
                {displayedJobReports.length ? (
                    <Table
                        size='small'
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        rowKey={(r: any) => r.id}
                        dataSource={displayedJobReports}
                        expandable={{
                            expandRowByClick: true,
                            expandedRowRender: (r: any) => {
                                const reportId = r?.id;
                                const dsJobId = getJobId(r);
                                const taskIdHint = (() => {
                                    const fromReport = getTaskId(r);
                                    if (kind === 'task') return resource.id;
                                    if (kind === 'job') return (resource as Job).taskId;
                                    return fromReport;
                                })();

                                const list = typeof reportId === 'number' ? (conflictsByReportId[reportId] ?? null) : null;
                                const rows = getConflictFrameRowsFromConflicts(list);

                                const taskIdResolved = (typeof dsJobId === 'number' ? (taskIdByJob[dsJobId] ?? taskIdHint ?? null) : taskIdHint ?? null);
                                const mode = (typeof taskIdResolved === 'number' ? (taskLayouts[taskIdResolved]?.mode ?? null) : null);
                                const gtJobId = (typeof taskIdResolved === 'number' ? (gtJobByTask[taskIdResolved] ?? null) : null);

                                const validationFrames = (typeof taskIdResolved === 'number') ?
                                    (taskLayouts[taskIdResolved]?.validationFrames ?? taskLayouts[taskIdResolved]?.validation_frames ?? []) : [];
                                const validationSet = new Set(
                                    (Array.isArray(validationFrames) ? validationFrames : [])
                                        .map((v: any) => (typeof v === 'string' ? Number(v) : v))
                                        .filter((v: any) => typeof v === 'number' && Number.isFinite(v)),
                                );

                                const jl = (typeof dsJobId === 'number') ? (jobLayouts[dsJobId] || null) : null;
                                const honeypotFrames = jl?.honeypotFrames ?? jl?.honeypot_frames ?? [];
                                const honeypotRealFrames = jl?.honeypotRealFrames ?? jl?.honeypot_real_frames ?? [];
                                const hpMap = new Map<number, number>();
                                if (Array.isArray(honeypotFrames) && Array.isArray(honeypotRealFrames)) {
                                    for (let i = 0; i < honeypotFrames.length; i++) {
                                        const k = (typeof honeypotFrames[i] === 'string') ? Number(honeypotFrames[i]) : honeypotFrames[i];
                                        const v = (typeof honeypotRealFrames[i] === 'string') ? Number(honeypotRealFrames[i]) : honeypotRealFrames[i];
                                        if (typeof k === 'number' && Number.isFinite(k) && typeof v === 'number' && Number.isFinite(v)) {
                                            hpMap.set(k, v);
                                        }
                                    }
                                }

                                const mappedRows = rows.map((f: any) => {
                                    const dsFrame = f.frame;
                                    const gtFrame = mode === 'gt' ? dsFrame :
                                        (mode === 'gt_pool' ? (hpMap.get(dsFrame) ?? null) : null);
                                    const inValidation = gtFrame !== null ? validationSet.has(gtFrame) : validationSet.has(dsFrame);
                                    const dsLink = (taskIdResolved && dsJobId) ? `/tasks/${taskIdResolved}/jobs/${dsJobId}?frame=${dsFrame}` : null;
                                    const gtLink = (taskIdResolved && gtJobId && gtFrame !== null) ? `/tasks/${taskIdResolved}/jobs/${gtJobId}?frame=${gtFrame}` : null;
                                    return {
                                        ds_frame: dsFrame,
                                        gt_frame: gtFrame,
                                        in_validation: inValidation,
                                        types: f.types || [],
                                        severities: f.severities || [],
                                        count: f.count || 0,
                                        ds_link: dsLink,
                                        gt_link: gtLink,
                                    };
                                });

                                const loading = typeof reportId === 'number' ? !!conflictsLoadingByReportId[reportId] : false;
                                const errMsg = typeof reportId === 'number' ? (conflictsErrorByReportId[reportId] || null) : null;
                                const vErr = typeof dsJobId === 'number' ? (validationByJobError[dsJobId] || null) : null;

                                return (
                                    <div style={{ padding: 8 }}>
                                        <Space style={{ marginBottom: 8 }} wrap>
                                            <Text type='secondary'>mode: {String(mode ?? '-')}</Text>
                                            <Text type='secondary'>GT job: {String(gtJobId ?? '-')}</Text>
                                            {errMsg ? <Text type='danger'>{errMsg}</Text> : null}
                                            {vErr ? <Text type='danger'>{vErr}</Text> : null}
                                            {loading ? <Spin size='small' /> : null}
                                        </Space>

                                        {loading ? (
                                            <div style={{ textAlign: 'center', padding: 12 }}><Spin /></div>
                                        ) : (mappedRows.length ? (
                                            <Table
                                                size='small'
                                                pagination={{ pageSize: 20, showSizeChanger: true }}
                                                rowKey={(m: any) => String(m.ds_frame)}
                                                dataSource={mappedRows}
                                                columns={[
                                                    { title: 'DS Frame', dataIndex: 'ds_frame', key: 'ds_frame' },
                                                    {
                                                        title: 'GT Frame',
                                                        dataIndex: 'gt_frame',
                                                        key: 'gt_frame',
                                                        render: (v: any) => (typeof v === 'number' ? v : <Text type='secondary'>-</Text>),
                                                    },
                                                    {
                                                        title: 'Severity',
                                                        key: 'severity',
                                                        render: (_: any, m: any) => (
                                                            <Space wrap>
                                                                {(m.severities || []).map((s: string) => (
                                                                    <Tag key={s} color={s === 'error' ? 'red' : 'orange'}>{s}</Tag>
                                                                ))}
                                                            </Space>
                                                        ),
                                                    },
                                                    {
                                                        title: 'Type',
                                                        key: 'type',
                                                        render: (_: any, m: any) => (
                                                            <Space wrap>
                                                                {(m.types || []).map((t: string) => (
                                                                    <Tag key={t}>{t}</Tag>
                                                                ))}
                                                            </Space>
                                                        ),
                                                    },
                                                    { title: 'Count', dataIndex: 'count', key: 'count' },
                                                    {
                                                        title: '在 Validation Set',
                                                        key: 'in_validation',
                                                        render: (_: any, m: any) => (
                                                            typeof m.in_validation === 'boolean' ? (
                                                                m.in_validation ? <Tag color='green'>是</Tag> : <Tag>否</Tag>
                                                            ) : <Text type='secondary'>-</Text>
                                                        ),
                                                    },
                                                    {
                                                        title: '跳转',
                                                        key: 'open',
                                                        render: (_: any, m: any) => (
                                                            <Space>
                                                                {m.ds_link ? <Button type='link' href={m.ds_link} target='_blank'>打开 DS</Button> : <Text type='secondary'>无 task/job</Text>}
                                                                {m.gt_link ? <Button type='link' href={m.gt_link} target='_blank'>打开 GT</Button> : <Text type='secondary'>无映射/无 GT</Text>}
                                                            </Space>
                                                        ),
                                                    },
                                                ]}
                                            />
                                        ) : (
                                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='该 job report 暂无 conflicts（可能 errors 来自统计但无明细，或接口无权限）' />
                                        ))}
                                    </div>
                                );
                            },
                            onExpand: async (expanded: boolean, r: any) => {
                                if (!expanded) return;
                                const reportId = r?.id;
                                const dsJobId = getJobId(r);
                                const taskIdHint = (() => {
                                    const fromReport = getTaskId(r);
                                    if (kind === 'task') return resource.id;
                                    if (kind === 'job') return (resource as Job).taskId;
                                    return fromReport;
                                })();

                                if (typeof dsJobId === 'number') {
                                    ensureValidationContext(dsJobId, taskIdHint ?? null);
                                }
                                if (typeof reportId === 'number' && !(reportId in conflictsByReportId)) {
                                    loadConflictsForReport(reportId);
                                }
                            },
                            rowExpandable: (r: any) => r?.target === 'job',
                        }}
                        columns={[
                            { title: 'Report', dataIndex: 'id', key: 'id' },
                            { title: 'DS Job', key: 'job', render: (_: any, r: any) => getJobId(r) ?? '-' },
                            { title: 'Errors', key: 'errors', render: (_: any, r: any) => fmtNum(getErrorCount(r?.summary)) },
                            {
                                title: '冲突帧数',
                                key: 'frames',
                                render: (_: any, r: any) => {
                                    const list = typeof r?.id === 'number' ? (conflictsByReportId[r.id] ?? null) : null;
                                    const rows = getConflictFrameRowsFromConflicts(list);
                                    return rows.length ? rows.length : <Text type='secondary'>-</Text>;
                                },
                            },
                        ]}
                    />
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无 job reports' />
                )}
                <div style={{ marginTop: 8 }}>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        * 映射逻辑：mode=gt 时 DS frame=GT frame；mode=gt_pool 时用 `job.validation_layout` 的 honeypotFrames→honeypotRealFrames 映射（非 honeypot 帧可能没有对应 GT）。
                    </Text>
                </div>
            </Card>


            {selectedReportId ? null : (
                !qualityLoading && <Empty description='请选择一个 Report 查看详情' />
            )}
        </Space>
    );
}
