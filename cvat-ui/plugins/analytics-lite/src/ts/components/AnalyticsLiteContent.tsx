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
import notification from 'antd/lib/notification';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';

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
        <Descriptions size='small' column={1} bordered>
            <Descriptions.Item label='资源类型'>{kind}</Descriptions.Item>
            <Descriptions.Item label='ID'>{resource.id}</Descriptions.Item>
            {'name' in resource ? (
                <Descriptions.Item label='Name'>{(resource as any).name}</Descriptions.Item>
            ) : null}
            <Descriptions.Item label='Time period'>
                {timePeriod ? `${timePeriod.startDate} ~ ${timePeriod.endDate}` : '未选择'}
            </Descriptions.Item>
        </Descriptions>
    );

    const items = [
        {
            key: 'quality',
            label: 'Quality',
            children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={loadReports}
                            disabled={qualityLoading}
                        >
                            刷新报表列表
                        </Button>
                        <Text type='secondary'>
                            优先复用后端 `/api/quality/*`；首期只做读取与展示
                        </Text>
                    </div>

                    {qualityError ? <Alert type='error' message={qualityError} /> : null}

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <Text>Report:</Text>
                        <Select<number>
                            style={{ minWidth: 320 }}
                            loading={qualityLoading}
                            value={selectedReportId ?? undefined}
                            placeholder='选择一个 report'
                            onChange={(val: number) => setSelectedReportId(val)}
                            options={reports.map((r: any) => ({
                                value: r.id,
                                label: `#${r.id} (${r.target || 'unknown'})`,
                            }))}
                        />
                        <Button
                            icon={<ReloadOutlined />}
                            disabled={!selectedReportId}
                            loading={reportDataLoading}
                            onClick={() => selectedReportId && loadReportData(selectedReportId)}
                        >
                            刷新 report data
                        </Button>
                        <Button
                            icon={<ReloadOutlined />}
                            disabled={!selectedReportId}
                            loading={conflictsLoading}
                            onClick={() => selectedReportId && loadConflicts(selectedReportId)}
                        >
                            刷新 conflicts
                        </Button>
                    </div>

                    {qualityLoading ? <Spin /> : null}

                    {reportDataLoading ? <Spin /> : null}

                    {reportData ? (
                        <pre style={{
                            maxHeight: 520,
                            overflow: 'auto',
                            background: '#111827',
                            color: '#e5e7eb',
                            padding: 12,
                            borderRadius: 6,
                            fontSize: 12,
                        }}
                        >
                            {JSON.stringify(reportData, null, 2)}
                        </pre>
                    ) : null}

                    {conflictsLoading ? <Spin /> : null}
                    {conflicts ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <Text strong>{`Conflicts: ${conflicts.length}`}</Text>
                            <pre style={{
                                maxHeight: 320,
                                overflow: 'auto',
                                background: '#111827',
                                color: '#e5e7eb',
                                padding: 12,
                                borderRadius: 6,
                                fontSize: 12,
                            }}
                            >
                                {JSON.stringify(conflicts.slice(0, 200), null, 2)}
                            </pre>
                            {conflicts.length > 200 ? (
                                <Text type='secondary'>仅展示前 200 条（避免页面卡顿）</Text>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ),
        },
        {
            key: 'events',
            label: 'Activity (Events)',
            children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Alert
                        type='info'
                        message='首期仅提供导出 Events'
                        description='后端目前主要提供 CSV 导出（/api/events 或 /api/events/export），没有稳定的 JSON 聚合接口；首期先用导出满足排查/核对需求，统计面板作为二期。'
                    />
                    <Descriptions size='small' column={1} bordered>
                        <Descriptions.Item label='Filter'>
                            {kind === 'project' ? `project_id=${resource.id}` : null}
                            {kind === 'task' ? `task_id=${resource.id}` : null}
                            {kind === 'job' ? `job_id=${resource.id}` : null}
                        </Descriptions.Item>
                        <Descriptions.Item label='Time period'>
                            {timePeriod ? `${timePeriod.startDate} ~ ${timePeriod.endDate}` : '未选择'}
                        </Descriptions.Item>
                    </Descriptions>
                    <Button
                        type='primary'
                        icon={<DownloadOutlined />}
                        loading={exportingEvents}
                        onClick={exportEvents}
                    >
                        导出 Events CSV
                    </Button>
                </div>
            ),
        },
        {
            key: 'consensus',
            label: 'Consensus',
            children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Alert
                        type='info'
                        message='Consensus 用于 replicas 一致性与合并（quorum/merge）'
                        description='Settings 是 task 级；merge 可在 task/job 级触发（会返回 rq_id）。'
                    />

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={loadConsensusSettings}
                            disabled={consensusLoading || kind !== 'task'}
                        >
                            刷新 settings（task）
                        </Button>
                        <Button
                            type='primary'
                            loading={merging}
                            onClick={mergeConsensus}
                            disabled={kind === 'project'}
                        >
                            发起 merge
                        </Button>
                        {kind !== 'task' ? (
                            <Text type='secondary'>settings 仅 task 级可读</Text>
                        ) : null}
                    </div>

                    {consensusError ? <Alert type='error' message={consensusError} /> : null}
                    {consensusLoading ? <Spin /> : null}
                    {consensusSettings ? (
                        <pre style={{
                            maxHeight: 520,
                            overflow: 'auto',
                            background: '#111827',
                            color: '#e5e7eb',
                            padding: 12,
                            borderRadius: 6,
                            fontSize: 12,
                        }}
                        >
                            {JSON.stringify(consensusSettings, null, 2)}
                        </pre>
                    ) : null}
                </div>
            ),
        },
        {
            key: 'honeypots',
            label: 'Honeypots',
            children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={loadValidationLayout}
                            disabled={validationLoading}
                        >
                            刷新 validation_layout
                        </Button>
                        <Text type='secondary'>
                            来自 `/api/tasks|jobs/{'{id}'}/validation_layout`
                        </Text>
                    </div>
                    {validationError ? <Alert type='error' message={validationError} /> : null}
                    {validationLoading ? <Spin /> : null}
                    {validationLayout ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {validationLayout && typeof validationLayout === 'object' &&
                            ('honeypotFrames' in validationLayout) && ('honeypotRealFrames' in validationLayout) ? (
                                <Alert
                                    type='info'
                                    message='honeypot_frames 映射'
                                    description={`count=${(validationLayout.honeypotFrames || []).length}`}
                                />
                            ) : null}
                            {validationLayout && typeof validationLayout === 'object' &&
                            ('honeypotFrames' in validationLayout) && ('honeypotRealFrames' in validationLayout) ? (
                                <pre style={{
                                    maxHeight: 220,
                                    overflow: 'auto',
                                    background: '#111827',
                                    color: '#e5e7eb',
                                    padding: 12,
                                    borderRadius: 6,
                                    fontSize: 12,
                                }}
                                >
                                    {JSON.stringify(
                                        (validationLayout.honeypotFrames as number[]).map((frame: number, idx: number) => ({
                                            honeypot_frame: frame,
                                            real_frame: (validationLayout.honeypotRealFrames as number[])[idx],
                                        })),
                                        null,
                                        2,
                                    )}
                                </pre>
                            ) : null}
                        <pre style={{
                            maxHeight: 520,
                            overflow: 'auto',
                            background: '#111827',
                            color: '#e5e7eb',
                            padding: 12,
                            borderRadius: 6,
                            fontSize: 12,
                        }}
                        >
                            {JSON.stringify(validationLayout, null, 2)}
                        </pre>
                        </div>
                    ) : (
                        <Text type='secondary'>该资源没有 validation_layout（或未启用验证/无数据）</Text>
                    )}
                </div>
            ),
        },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {header}
            <Tabs items={items} />
        </div>
    );
}

export default React.memo(AnalyticsLiteContent);


