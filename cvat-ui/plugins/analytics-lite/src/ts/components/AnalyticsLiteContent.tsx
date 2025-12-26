// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT
// @ts-nocheck

import React, { useEffect, useMemo, useState } from 'react';
import Tabs from 'antd/lib/tabs';
import Spin from 'antd/lib/spin';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Select from 'antd/lib/select';
import Descriptions from 'antd/lib/descriptions';
import Text from 'antd/lib/typography/Text';
import Card from 'antd/lib/card';
import Space from 'antd/lib/space';
import Empty from 'antd/lib/empty';
import notification from 'antd/lib/notification';
import {
    DownloadOutlined,
    ReloadOutlined,
    BarChartOutlined,
    ClockCircleOutlined,
    TeamOutlined,
    ExperimentOutlined,
} from '@ant-design/icons';

import { getCore, Project, Task, Job } from 'cvat-core-wrapper';
import { TimePeriod } from 'components/analytics-report';
import { fetchQualityReportData, isCvatError } from '../api';

interface Props {
    resource: Project | Task | Job;
    timePeriod: TimePeriod | null;
}

type ResourceKind = 'project' | 'task' | 'job';

function getResourceKind(resource: Project | Task | Job): ResourceKind {
    if (resource instanceof Project) return 'project';
    if (resource instanceof Task) return 'task';
    return 'job';
}

const jsonStyle: React.CSSProperties = {
    maxHeight: 520,
    overflow: 'auto',
    background: '#111827',
    color: '#e5e7eb',
    padding: 16,
    borderRadius: 8,
    fontSize: 12,
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
    border: '1px solid #374151',
    marginTop: 8,
};

function AnalyticsLiteContent(props: Props): JSX.Element {
    const { resource, timePeriod } = props;
    const core = useMemo(() => getCore(), []);
    const kind = useMemo(() => getResourceKind(resource), [resource]);

    // QUALITY
    const [qualityLoading, setQualityLoading] = useState(false);
    const [qualityError, setQualityError] = useState<string | null>(null);
    const [reports, setReports] = useState<any[]>([]);
    const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
    const [reportDataLoading, setReportDataLoading] = useState(false);
    const [reportData, setReportData] = useState<any | null>(null);
    const [conflictsLoading, setConflictsLoading] = useState(false);
    const [conflicts, setConflicts] = useState<any[] | null>(null);

    const loadReports = async (): Promise<void> => {
        setQualityError(null);
        setQualityLoading(true);
        setReports([]);
        setSelectedReportId(null);
        setReportData(null);

        try {
            const filter: any = {};
            if (kind === 'project') filter.projectID = resource.id;
            if (kind === 'task') filter.taskID = resource.id;
            if (kind === 'job') filter.jobID = resource.id;

            const list = await core.analytics.quality.reports(filter, true);
            const asArray = Array.from(list as any[]);
            // newest first (id is monotonic)
            asArray.sort((a, b) => (b.id || 0) - (a.id || 0));
            setReports(asArray);
            if (asArray.length) {
                setSelectedReportId(asArray[0].id);
            }
        } catch (err: unknown) {
            if (isCvatError(err) && (err.code === 403 || err.code === 401)) {
                setQualityError('没有权限访问 Quality reports');
            } else {
                setQualityError(err instanceof Error ? err.message : '无法加载 Quality reports');
            }
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
            notification.error({
                message: '无法加载 Quality report data',
                description: err instanceof Error ? err.message : '',
            });
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
            notification.error({
                message: '无法加载 Quality conflicts',
                description: err instanceof Error ? err.message : '',
            });
        } finally {
            setConflictsLoading(false);
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

    // EVENTS (export only for MVP)
    const [exportingEvents, setExportingEvents] = useState(false);
    const exportEvents = async (): Promise<void> => {
        try {
            setExportingEvents(true);
            const params: any = {};
            if (timePeriod) {
                params.from = timePeriod.startDate;
                params.to = timePeriod.endDate;
            }
            if (kind === 'project') params.projectId = resource.id;
            if (kind === 'task') params.taskId = resource.id;
            if (kind === 'job') params.jobId = resource.id;
            params.filename = `export-events-${kind}-${resource.id}.csv`;

            const url = await core.analytics.events.export(params);
            const a = document.createElement('a');
            try {
                a.setAttribute('href', url);
                a.setAttribute('download', params.filename);
                a.click();
            } finally {
                a.remove();
            }
        } catch (err: unknown) {
            notification.error({
                message: '无法导出 Events',
                description: err instanceof Error ? err.message : '',
            });
        } finally {
            setExportingEvents(false);
        }
    };

    // HONEYPOTS (validation layout)
    const [validationLoading, setValidationLoading] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [validationLayout, setValidationLayout] = useState<any | null>(null);
    const loadValidationLayout = async (): Promise<void> => {
        setValidationLoading(true);
        setValidationError(null);
        setValidationLayout(null);
        try {
            if (typeof (resource as any).validationLayout !== 'function') {
                setValidationLayout(null);
                return;
            }
            const layout = await (resource as any).validationLayout();
            setValidationLayout(layout);
        } catch (err: unknown) {
            if (isCvatError(err) && (err.code === 403 || err.code === 401)) {
                setValidationError('没有权限访问 validation_layout');
            } else {
                setValidationError(err instanceof Error ? err.message : '无法加载 validation_layout');
            }
        } finally {
            setValidationLoading(false);
        }
    };

    useEffect(() => {
        loadValidationLayout();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.id, kind]);

    // CONSENSUS
    const [consensusLoading, setConsensusLoading] = useState(false);
    const [consensusError, setConsensusError] = useState<string | null>(null);
    const [consensusSettings, setConsensusSettings] = useState<any | null>(null);
    const [merging, setMerging] = useState(false);

    const loadConsensusSettings = async (): Promise<void> => {
        setConsensusLoading(true);
        setConsensusError(null);
        setConsensusSettings(null);
        try {
            if (kind !== 'task') {
                // consensus settings are task-level
                setConsensusSettings(null);
                return;
            }
            const settings = await core.consensus.settings.get({ taskID: resource.id });
            setConsensusSettings(settings);
        } catch (err: unknown) {
            if (isCvatError(err) && (err.code === 403 || err.code === 401)) {
                setConsensusError('没有权限访问 consensus settings');
            } else {
                setConsensusError(err instanceof Error ? err.message : '无法加载 consensus settings');
            }
        } finally {
            setConsensusLoading(false);
        }
    };

    const mergeConsensus = async (): Promise<void> => {
        setMerging(true);
        try {
            if (typeof (resource as any).mergeConsensusJobs !== 'function') {
                notification.warning({
                    message: '当前资源不支持 mergeConsensusJobs',
                });
                return;
            }
            const rqID: string = await (resource as any).mergeConsensusJobs();
            notification.success({
                message: '已发起 consensus merge',
                description: `rq_id: ${rqID}`,
            });
        } catch (err: unknown) {
            notification.error({
                message: '无法发起 consensus merge',
                description: err instanceof Error ? err.message : '',
            });
        } finally {
            setMerging(false);
        }
    };

    useEffect(() => {
        loadConsensusSettings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.id, kind]);

    const header = (
        <Card size='small' bordered={false} style={{ background: '#f5f5f5' }}>
            <Descriptions size='small' column={2} bordered>
                <Descriptions.Item label='Resource Type'>{kind.toUpperCase()}</Descriptions.Item>
                <Descriptions.Item label='ID'>{resource.id}</Descriptions.Item>
                {'name' in resource ? (
                    <Descriptions.Item label='Name'>{(resource as any).name}</Descriptions.Item>
                ) : null}
                <Descriptions.Item label='Time period'>
                    {timePeriod ? `${timePeriod.startDate} ~ ${timePeriod.endDate}` : 'All Time'}
                </Descriptions.Item>
            </Descriptions>
        </Card>
    );

    const items = [
        {
            key: 'quality',
            label: (
                <Space>
                    <BarChartOutlined />
                    Quality
                </Space>
            ),
            children: (
                <Space direction='vertical' size='middle' style={{ width: '100%' }}>
                    <Card size='small'>
                        <Space wrap>
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={loadReports}
                                disabled={qualityLoading}
                            >
                                刷新列表
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
                                    label: `#${r.id} (${r.target || 'unknown'}) - ${new Date(r.createdDate).toLocaleString()}`,
                                }))}
                            />
                            {selectedReportId && (
                                <>
                                    <Button
                                        icon={<ReloadOutlined />}
                                        loading={reportDataLoading}
                                        onClick={() => loadReportData(selectedReportId)}
                                    >
                                        刷新 Data
                                    </Button>
                                    <Button
                                        icon={<ReloadOutlined />}
                                        loading={conflictsLoading}
                                        onClick={() => loadConflicts(selectedReportId)}
                                    >
                                        刷新 Conflicts
                                    </Button>
                                </>
                            )}
                        </Space>
                        <div style={{ marginTop: 8 }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                * 优先复用后端 `/api/quality/*`
                            </Text>
                        </div>
                    </Card>

                    {qualityError && <Alert type='error' message={qualityError} showIcon />}
                    {qualityLoading && <Spin tip='Loading reports...' />}

                    {selectedReportId ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <Card
                                size='small'
                                title='Report Data'
                                extra={reportDataLoading && <Spin size='small' />}
                            >
                                {reportData ? (
                                    <pre style={jsonStyle}>
                                        {JSON.stringify(reportData, null, 2)}
                                    </pre>
                                ) : (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无 Report Data' />
                                )}
                            </Card>

                            <Card
                                size='small'
                                title={`Conflicts (${conflicts?.length ?? 0})`}
                                extra={conflictsLoading && <Spin size='small' />}
                            >
                                {conflicts && conflicts.length > 0 ? (
                                    <>
                                        <pre style={jsonStyle}>
                                            {JSON.stringify(conflicts.slice(0, 200), null, 2)}
                                        </pre>
                                        {conflicts.length > 200 && (
                                            <Text type='secondary'>仅展示前 200 条（避免页面卡顿）</Text>
                                        )}
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
            ),
        },
        {
            key: 'events',
            label: (
                <Space>
                    <ClockCircleOutlined />
                    Activity
                </Space>
            ),
            children: (
                <Space direction='vertical' size='middle' style={{ width: '100%' }}>
                    <Alert
                        type='info'
                        showIcon
                        message='首期仅提供导出 Events'
                        description='后端目前主要提供 CSV 导出（/api/events 或 /api/events/export），没有稳定的 JSON 聚合接口；首期先用导出满足排查/核对需求，统计面板作为二期。'
                    />
                    <Card size='small' title='Export Events'>
                        <Descriptions size='small' column={1} bordered>
                            <Descriptions.Item label='Filter Scope'>
                                {kind === 'project' ? `project_id=${resource.id}` : null}
                                {kind === 'task' ? `task_id=${resource.id}` : null}
                                {kind === 'job' ? `job_id=${resource.id}` : null}
                            </Descriptions.Item>
                            <Descriptions.Item label='Time period'>
                                {timePeriod ? `${timePeriod.startDate} ~ ${timePeriod.endDate}` : 'All Time'}
                            </Descriptions.Item>
                        </Descriptions>
                        <div style={{ marginTop: 16 }}>
                            <Button
                                type='primary'
                                icon={<DownloadOutlined />}
                                loading={exportingEvents}
                                onClick={exportEvents}
                            >
                                导出 Events CSV
                            </Button>
                        </div>
                    </Card>
                </Space>
            ),
        },
        {
            key: 'consensus',
            label: (
                <Space>
                    <TeamOutlined />
                    Consensus
                </Space>
            ),
            children: (
                <Space direction='vertical' size='middle' style={{ width: '100%' }}>
                    <Alert
                        type='info'
                        showIcon
                        message='Consensus Info'
                        description='Consensus 用于 replicas 一致性与合并（quorum/merge）。Settings 是 task 级；merge 可在 task/job 级触发（会返回 rq_id）。'
                    />

                    <Card size='small' title='Operations'>
                        <Space>
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={loadConsensusSettings}
                                disabled={consensusLoading || kind !== 'task'}
                            >
                                刷新 Settings (Task Only)
                            </Button>
                            <Button
                                type='primary'
                                loading={merging}
                                onClick={mergeConsensus}
                                disabled={kind === 'project'}
                            >
                                发起 Merge
                            </Button>
                        </Space>
                        {kind !== 'task' && (
                            <div style={{ marginTop: 8 }}>
                                <Text type='secondary'>* Settings 仅 Task 级可读</Text>
                            </div>
                        )}
                    </Card>

                    {consensusError && <Alert type='error' message={consensusError} showIcon />}

                    <Card
                        size='small'
                        title='Consensus Settings'
                        extra={consensusLoading && <Spin size='small' />}
                    >
                        {consensusSettings ? (
                            <pre style={jsonStyle}>
                                {JSON.stringify(consensusSettings, null, 2)}
                            </pre>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No Settings Loaded' />
                        )}
                    </Card>
                </Space>
            ),
        },
        {
            key: 'honeypots',
            label: (
                <Space>
                    <ExperimentOutlined />
                    Honeypots
                </Space>
            ),
            children: (
                <Space direction='vertical' size='middle' style={{ width: '100%' }}>
                    <Card size='small' title='Validation Layout'>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <Space>
                                <Button
                                    icon={<ReloadOutlined />}
                                    onClick={loadValidationLayout}
                                    disabled={validationLoading}
                                >
                                    刷新 Layout
                                </Button>
                                <Text type='secondary'>
                                    Source: `/api/tasks|jobs/{'{id}'}/validation_layout`
                                </Text>
                            </Space>
                        </div>

                        {validationError && <Alert type='error' message={validationError} showIcon style={{ marginBottom: 12 }} />}
                        {validationLoading && <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>}

                        {!validationLoading && validationLayout ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {validationLayout && typeof validationLayout === 'object' &&
                                ('honeypotFrames' in validationLayout) && ('honeypotRealFrames' in validationLayout) && (
                                    <Alert
                                        type='success'
                                        message={`Honeypot Frames Count: ${(validationLayout.honeypotFrames || []).length}`}
                                        showIcon
                                    />
                                )}

                                <Card size='small' type='inner' title='Honeypot Frames Mapping'>
                                    {validationLayout && typeof validationLayout === 'object' &&
                                    ('honeypotFrames' in validationLayout) && ('honeypotRealFrames' in validationLayout) ? (
                                        <pre style={{ ...jsonStyle, maxHeight: 200 }}>
                                            {JSON.stringify(
                                                (validationLayout.honeypotFrames as number[]).map((frame: number, idx: number) => ({
                                                    honeypot_frame: frame,
                                                    real_frame: (validationLayout.honeypotRealFrames as number[])[idx],
                                                })),
                                                null,
                                                2,
                                            )}
                                        </pre>
                                    ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                                </Card>

                                <Card size='small' type='inner' title='Full Layout Data'>
                                    <pre style={jsonStyle}>
                                        {JSON.stringify(validationLayout, null, 2)}
                                    </pre>
                                </Card>
                            </div>
                        ) : (
                            !validationLoading && <Empty description='该资源没有 validation_layout（或未启用验证/无数据）' />
                        )}
                    </Card>
                </Space>
            ),
        },
    ];

    return (
        <div style={{ padding: '0 12px 24px' }}>
            {header}
            <Tabs items={items} type="card" />
        </div>
    );
}

export default React.memo(AnalyticsLiteContent);
