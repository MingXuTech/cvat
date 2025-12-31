// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Descriptions from 'antd/lib/descriptions';
import Empty from 'antd/lib/empty';
import Progress from 'antd/lib/progress';
import Select from 'antd/lib/select';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Table from 'antd/lib/table';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';
import { ReloadOutlined } from '@ant-design/icons';
import { Request, getCore, Job } from 'cvat-core-wrapper';

import { AnalyticsLiteProps, ResourceKind } from '../types';
import { fetchQualityReportData, isCvatError } from '../../../api';
import { fmtNum, fmtRatio } from '../utils';
import { jsonStyle } from '../styles';

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

function getErrorCount(s: any): number | null {
    return s?.errorCount ?? s?.error_count ?? null;
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
    const [reportDataLoading, setReportDataLoading] = useState(false);
    const [reportData, setReportData] = useState<any | null>(null);
    const [conflictsLoading, setConflictsLoading] = useState(false);
    const [conflicts, setConflicts] = useState<any[] | null>(null);

    const selectedReport = useMemo(() => (
        reports.find((r: any) => r?.id === selectedReportId) || null
    ), [reports, selectedReportId]);
    const summary = useMemo(() => (selectedReport?.summary || null), [selectedReport]);

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

    const loadReports = async (): Promise<void> => {
        setQualityError(null);
        setQualityLoading(true);
        setQualityDebug(null);
        setReports([]);
        setSelectedReportId(null);
        setReportData(null);
        setCreateRqStatus(null);

        try {
            const filter: any = {};
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
        } catch (err: unknown) {
            if (isCvatError(err) && (err.code === 403 || err.code === 401)) setQualityError('没有权限访问 Quality reports');
            else setQualityError(err instanceof Error ? err.message : '无法加载 Quality reports');
        } finally {
            setQualityLoading(false);
        }
    };

    const loadReportData = async (id: number): Promise<void> => {
        setReportDataLoading(true);
        setReportData(null);
        try {
            const data = await fetchQualityReportData(id);
            setReportData(data);
        } catch (err: unknown) {
            notification.error({ message: '无法加载 Quality report data', description: err instanceof Error ? err.message : '' });
        } finally {
            setReportDataLoading(false);
        }
    };

    const loadConflicts = async (id: number): Promise<void> => {
        setConflictsLoading(true);
        setConflicts(null);
        try {
            const list = await core.analytics.quality.conflicts({ reportID: id });
            setConflicts(Array.from(list as any[]));
        } catch (err: unknown) {
            notification.error({ message: '无法加载 Quality conflicts', description: err instanceof Error ? err.message : '' });
        } finally {
            setConflictsLoading(false);
        }
    };

    const createQualityReport = async (): Promise<void> => {
        try {
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
            const rqId: string | null = response?.rq_id || response?.id || null;
            if (!rqId || typeof rqId !== 'string') {
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
            setQualityError(err instanceof Error ? err.message : '创建 Quality Report 失败');
        } finally {
            setCreatingReport(false);
        }
    };

    useEffect(() => {
        loadReports();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.id, kind]);

    useEffect(() => {
        if (selectedReportId) {
            loadReportData(selectedReportId);
            loadConflicts(selectedReportId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedReportId]);

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
                    <Button icon={<ReloadOutlined />} onClick={loadReports} disabled={qualityLoading}>刷新列表</Button>
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
                            <Button icon={<ReloadOutlined />} loading={reportDataLoading} onClick={() => loadReportData(selectedReportId)}>刷新 Data</Button>
                            <Button icon={<ReloadOutlined />} loading={conflictsLoading} onClick={() => loadConflicts(selectedReportId)}>刷新 Conflicts</Button>
                        </>
                    )}
                </Space>
                <div style={{ marginTop: 8 }}>
                    <Text type='secondary' style={{ fontSize: 12 }}>* 优先复用后端 `/api/quality/*`</Text>
                </div>
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
                            description={(
                                <>
                                    <div>你打开的 quality-control 页面是 premium 占位，但后端 API 仍可创建报表。</div>
                                    <div>点击下面按钮会调用 `POST /api/quality/reports` 并自动轮询 `GET /api/requests/&lt;rq_id&gt;`。</div>
                                </>
                            )}
                        />
                        <Space>
                            <Button type='primary' loading={creatingReport} onClick={createQualityReport}>生成 Quality Report</Button>
                            <Button disabled={creatingReport} onClick={loadReports}>只刷新列表</Button>
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
                        onRow={(r: any) => ({ onClick: () => setSelectedReportId(r.id), style: { cursor: 'pointer' } })}
                        columns={[
                            { title: 'Report', dataIndex: 'id', key: 'id' },
                            { title: 'Target', dataIndex: 'target', key: 'target' },
                            { title: 'Job', key: 'job', render: (_: any, r: any) => getJobId(r) ?? '-' },
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

            {!!displayedOtherReports.length && (
                <Card size='small' title={`其他 Reports（target!=job，共 ${displayedOtherReports.length}）`}>
                    <Table
                        size='small'
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        rowKey={(r: any) => r.id}
                        dataSource={displayedOtherReports}
                        onRow={(r: any) => ({ onClick: () => setSelectedReportId(r.id), style: { cursor: 'pointer' } })}
                        columns={[
                            { title: 'Report', dataIndex: 'id', key: 'id' },
                            { title: 'Target', dataIndex: 'target', key: 'target' },
                            {
                                title: 'Created',
                                key: 'created',
                                render: (_: any, r: any) => {
                                    const dt = getCreatedDateStr(r);
                                    try { return dt ? new Date(dt).toLocaleString() : '-'; } catch { return dt || '-'; }
                                },
                            },
                            { title: 'Errors', key: 'errors', render: (_: any, r: any) => fmtNum(getErrorCount(r?.summary)) },
                        ]}
                    />
                </Card>
            )}

            {selectedReportId ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Card size='small' title='Summary'>
                        {summary ? (
                            <Space direction='vertical' style={{ width: '100%' }} size='small'>
                                <Descriptions size='small' bordered column={2}>
                                    <Descriptions.Item label='Accuracy'>{fmtRatio(summary?.accuracy)}</Descriptions.Item>
                                    <Descriptions.Item label='Precision'>{fmtRatio(summary?.precision)}</Descriptions.Item>
                                    <Descriptions.Item label='Recall'>{fmtRatio(summary?.recall)}</Descriptions.Item>
                                    <Descriptions.Item label='Errors'>{fmtNum(getErrorCount(summary))}</Descriptions.Item>
                                </Descriptions>
                                <Space><Text style={{ width: 80 }}>Accuracy</Text><Progress percent={typeof summary?.accuracy === 'number' ? summary.accuracy * 100 : 0} /></Space>
                                <Space><Text style={{ width: 80 }}>Precision</Text><Progress percent={typeof summary?.precision === 'number' ? summary.precision * 100 : 0} /></Space>
                                <Space><Text style={{ width: 80 }}>Recall</Text><Progress percent={typeof summary?.recall === 'number' ? summary.recall * 100 : 0} /></Space>
                            </Space>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='该 report 没有 summary 字段' />
                        )}
                    </Card>
                    <Card size='small' title='Report Data' extra={reportDataLoading && <Spin size='small' />}>
                        {reportData ? (
                            <pre style={jsonStyle}>{JSON.stringify(reportData, null, 2)}</pre>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无 Report Data' />
                        )}
                    </Card>
                    <Card size='small' title={`Conflicts (${conflicts?.length ?? 0})`} extra={conflictsLoading && <Spin size='small' />}>
                        {conflicts && conflicts.length > 0 ? (
                            <>
                                <pre style={jsonStyle}>{JSON.stringify(conflicts.slice(0, 200), null, 2)}</pre>
                                {conflicts.length > 200 && <Text type='secondary'>仅展示前 200 条（避免页面卡顿）</Text>}
                            </>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无 Conflicts' />
                        )}
                    </Card>
                </div>
            ) : (
                !qualityLoading && <Empty description='请选择一个 Report 查看详情' />
            )}
        </Space>
    );
}


