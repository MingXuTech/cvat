// @ts-nocheck
import React, { useMemo, useState } from 'react';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Descriptions from 'antd/lib/descriptions';
import Empty from 'antd/lib/empty';
import InputNumber from 'antd/lib/input-number';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Table from 'antd/lib/table';
import Text from 'antd/lib/typography/Text';
import notification from 'antd/lib/notification';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';

import { getCore, Project, Task, Job } from 'cvat-core-wrapper';
import { AnalyticsLiteProps, ResourceKind } from '../types';
import { fmtDurationSeconds, parseCSV, parseTsMs } from '../utils';
import { jsonStyle } from '../styles';

export default function ActivityTab(
    props: AnalyticsLiteProps & { kind: ResourceKind; debugEnabled: boolean },
): JSX.Element {
    const { resource, timePeriod, kind, debugEnabled } = props;
    const core = useMemo(() => getCore(), []);

    const [exportingEvents, setExportingEvents] = useState(false);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityError, setActivityError] = useState<string | null>(null);
    const [activityRowsCount, setActivityRowsCount] = useState<number>(0);
    const [activityStats, setActivityStats] = useState<any | null>(null);
    const [activityRawPreview, setActivityRawPreview] = useState<string | null>(null);
    const [idleThresholdMinutes, setIdleThresholdMinutes] = useState<number>(5);

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

    const loadActivityStats = async (): Promise<void> => {
        try {
            setActivityLoading(true);
            setActivityError(null);
            setActivityStats(null);
            setActivityRowsCount(0);
            setActivityRawPreview(null);

            const params: any = {};
            if (timePeriod) {
                params.from = timePeriod.startDate;
                params.to = timePeriod.endDate;
            }
            if (kind === 'project') params.projectId = resource.id;
            if (kind === 'task') params.taskId = resource.id;
            if (kind === 'job') params.jobId = resource.id;

            const url = await core.analytics.events.export(params);
            const resp = await core.server.request(url, { method: 'GET', responseType: 'text' } as any);
            const csvText = (resp && typeof resp === 'object' && 'data' in resp) ? (resp as any).data : resp;
            const csv = typeof csvText === 'string' ? csvText : String(csvText ?? '');

            const preview = csv.split('\n').slice(0, 30).join('\n');
            setActivityRawPreview(preview);

            const { headers, rows } = parseCSV(csv);
            setActivityRowsCount(rows.length);

            const tsKey = headers.includes('timestamp') ? 'timestamp' :
                (headers.find((h) => h.toLowerCase().includes('timestamp')) || 'timestamp');
            const userIdKey = headers.includes('user_id') ? 'user_id' :
                (headers.find((h) => h.toLowerCase() === 'user_id') || headers.find((h) => h.toLowerCase().includes('user_id')) || 'user_id');
            const userNameKey = headers.includes('user_name') ? 'user_name' :
                (headers.find((h) => h.toLowerCase() === 'user_name') ||
                    headers.find((h) => h.toLowerCase() === 'username') ||
                    headers.find((h) => h.toLowerCase().includes('user_name')) ||
                    headers.find((h) => h.toLowerCase().includes('username')) ||
                    '');
            const jobKey = headers.includes('job_id') ? 'job_id' :
                (headers.find((h) => h.toLowerCase().includes('job')) || 'job_id');
            const scopeKey = headers.includes('scope') ? 'scope' :
                (headers.find((h) => h.toLowerCase().includes('scope')) || 'scope');
            const sourceKey = headers.includes('source') ? 'source' :
                (headers.find((h) => h.toLowerCase().includes('source')) || 'source');

            const byScope = new Map<string, number>();
            const bySource = new Map<string, number>();
            const byUser = new Map<string, {
                key: string;
                userId: string;
                username: string;
                events: number;
                timestamps: number[];
                scopes: Map<string, number>;
            }>();
            const byJob = new Map<string, { jobId: string; events: number }>();

            let minTs = Number.POSITIVE_INFINITY;
            let maxTs = 0;

            for (const r of rows) {
                const ts = parseTsMs(r[tsKey]);
                if (ts) {
                    if (ts < minTs) minTs = ts;
                    if (ts > maxTs) maxTs = ts;
                }

                const scope = String(r[scopeKey] ?? '').trim() || '(no scope)';
                const source = String(r[sourceKey] ?? '').trim() || '(unknown)';
                const userId = String(r[userIdKey] ?? '').trim() || '';
                const username = userNameKey ? (String(r[userNameKey] ?? '').trim() || '') : '';
                const userKey = userId || username || '(unknown)';
                const jobId = String(r[jobKey] ?? '').trim() || '-';

                byScope.set(scope, (byScope.get(scope) || 0) + 1);
                bySource.set(source, (bySource.get(source) || 0) + 1);

                if (!byUser.has(userKey)) {
                    byUser.set(userKey, {
                        key: userKey,
                        userId: userId || '-',
                        username: username || '-',
                        events: 0,
                        timestamps: [],
                        scopes: new Map(),
                    });
                }
                const u = byUser.get(userKey)!;
                u.events += 1;
                if (ts) u.timestamps.push(ts);
                u.scopes.set(scope, (u.scopes.get(scope) || 0) + 1);

                if (jobId && jobId !== '-') {
                    if (!byJob.has(jobId)) byJob.set(jobId, { jobId, events: 0 });
                    byJob.get(jobId)!.events += 1;
                }
            }

            const idleThresholdSec = Math.max(1, idleThresholdMinutes) * 60;
            const usersTable = Array.from(byUser.values()).map((u) => {
                const tsSorted = u.timestamps.slice().sort((a, b) => a - b);
                let activeSec = 0;
                for (let i = 1; i < tsSorted.length; i++) {
                    const deltaSec = (tsSorted[i] - tsSorted[i - 1]) / 1000;
                    if (deltaSec > 0) activeSec += Math.min(deltaSec, idleThresholdSec);
                }
                const topScopes = Array.from(u.scopes.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([s, c]) => `${s}(${c})`)
                    .join(', ');
                return { ...u, activeSec, topScopes };
            }).sort((a, b) => b.events - a.events);

            const scopesTable = Array.from(byScope.entries()).map(([scope, events]) => ({ scope, events }))
                .sort((a, b) => b.events - a.events);
            const jobsTable = Array.from(byJob.values()).sort((a, b) => b.events - a.events);
            const sourcesTable = Array.from(bySource.entries()).map(([source, events]) => ({ source, events }))
                .sort((a, b) => b.events - a.events);

            const totalActiveSec = usersTable.reduce((acc, u) => acc + (u.activeSec || 0), 0);

            setActivityStats({
                headers,
                inferredKeys: { tsKey, userIdKey, userNameKey, jobKey, scopeKey, sourceKey },
                totalEvents: rows.length,
                uniqueUsers: byUser.size,
                uniqueJobs: byJob.size,
                timeRange: {
                    from: Number.isFinite(minTs) ? new Date(minTs).toISOString() : null,
                    to: maxTs ? new Date(maxTs).toISOString() : null,
                },
                estimatedActive: {
                    idleThresholdMinutes,
                    totalActiveSec,
                },
                tables: {
                    users: usersTable,
                    scopes: scopesTable,
                    jobs: jobsTable,
                    sources: sourcesTable,
                },
            });
        } catch (err: unknown) {
            setActivityError(err instanceof Error ? err.message : '无法加载 Activity 统计');
        } finally {
            setActivityLoading(false);
        }
    };

    return (
        <Space direction='vertical' size='middle' style={{ width: '100%' }}>
            <Alert
                type='info'
                showIcon
                message='Activity 统计（基于 Events CSV）'
                description='面板通过后端导出的 Events CSV 做前端聚合统计。工作时长为“估算活跃时长”：按用户事件时间差累加，并对长空闲按阈值截断。'
            />

            <Card size='small' title='Activity Controls'>
                <Descriptions size='small' column={1} bordered>
                    <Descriptions.Item label='Filter Scope'>
                        {kind === 'project' ? `project_id=${resource.id}` : null}
                        {kind === 'task' ? `task_id=${resource.id}` : null}
                        {kind === 'job' ? `job_id=${resource.id}` : null}
                    </Descriptions.Item>
                    <Descriptions.Item label='Time period'>
                        {timePeriod ? `${timePeriod.startDate} ~ ${timePeriod.endDate}` : 'All Time'}
                    </Descriptions.Item>
                    <Descriptions.Item label='Idle Threshold (minutes)'>
                        <InputNumber
                            min={1}
                            max={120}
                            value={idleThresholdMinutes}
                            onChange={(v) => setIdleThresholdMinutes(Number(v) || 5)}
                        />
                    </Descriptions.Item>
                </Descriptions>
                <div style={{ marginTop: 16 }}>
                    <Space wrap>
                        <Button
                            type='primary'
                            icon={<ReloadOutlined />}
                            loading={activityLoading}
                            onClick={loadActivityStats}
                        >
                            刷新统计
                        </Button>
                        <Button
                            icon={<DownloadOutlined />}
                            loading={exportingEvents}
                            onClick={exportEvents}
                        >
                            下载原始 CSV
                        </Button>
                    </Space>
                </div>
            </Card>

            {activityError && <Alert type='error' showIcon message={activityError} />}

            <Card size='small' title='Summary' extra={activityLoading && <Spin size='small' />}>
                {activityStats ? (
                    <Descriptions size='small' bordered column={2}>
                        <Descriptions.Item label='Total Events'>{activityStats.totalEvents}</Descriptions.Item>
                        <Descriptions.Item label='Unique Users'>{activityStats.uniqueUsers}</Descriptions.Item>
                        <Descriptions.Item label='Unique Jobs'>{activityStats.uniqueJobs}</Descriptions.Item>
                        <Descriptions.Item label='Estimated Active (total)'>
                            {fmtDurationSeconds(activityStats.estimatedActive.totalActiveSec)}
                        </Descriptions.Item>
                        <Descriptions.Item label='Time Range From'>{activityStats.timeRange.from || '-'}</Descriptions.Item>
                        <Descriptions.Item label='Time Range To'>{activityStats.timeRange.to || '-'}</Descriptions.Item>
                    </Descriptions>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='请点击“刷新统计”加载数据' />
                )}
            </Card>

            {activityStats && (
                <Card size='small' title={`By User (${activityStats.tables.users.length})`}>
                    <Table
                        size='small'
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        rowKey={(r: any) => r.key || r.userId}
                        dataSource={activityStats.tables.users}
                        columns={[
                            { title: 'User ID', dataIndex: 'userId', key: 'userId' },
                            { title: 'Username', dataIndex: 'username', key: 'username' },
                            { title: 'Events', dataIndex: 'events', key: 'events' },
                            {
                                title: `Estimated Active (idle<=${idleThresholdMinutes}m)`,
                                key: 'active',
                                render: (_: any, r: any) => fmtDurationSeconds(r.activeSec),
                            },
                            { title: 'Top Scopes', dataIndex: 'topScopes', key: 'topScopes' },
                        ]}
                    />
                </Card>
            )}

            {activityStats && (
                <Card size='small' title={`By Scope (${activityStats.tables.scopes.length})`}>
                    <Table
                        size='small'
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        rowKey={(r: any) => r.scope}
                        dataSource={activityStats.tables.scopes.slice(0, 200)}
                        columns={[
                            { title: 'Scope', dataIndex: 'scope', key: 'scope' },
                            { title: 'Events', dataIndex: 'events', key: 'events' },
                        ]}
                    />
                    {activityStats.tables.scopes.length > 200 && (
                        <Text type='secondary'>仅展示前 200 条 scope（避免卡顿）</Text>
                    )}
                </Card>
            )}

            {activityStats && (
                <Card size='small' title={`By Job (${activityStats.tables.jobs.length})`}>
                    <Table
                        size='small'
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        rowKey={(r: any) => r.jobId}
                        dataSource={activityStats.tables.jobs.slice(0, 200)}
                        columns={[
                            { title: 'Job ID', dataIndex: 'jobId', key: 'jobId' },
                            { title: 'Events', dataIndex: 'events', key: 'events' },
                        ]}
                    />
                    {activityStats.tables.jobs.length > 200 && (
                        <Text type='secondary'>仅展示前 200 条 job（避免卡顿）</Text>
                    )}
                </Card>
            )}

            {debugEnabled && (
                <Card size='small' title={`Debug (Activity) rows=${activityRowsCount}`} style={{ background: '#fffbe6', borderColor: '#ffe58f' }}>
                    <Descriptions size='small' bordered column={1}>
                        <Descriptions.Item label='Inferred Keys'>
                            <pre style={{ ...jsonStyle, maxHeight: 140 }}>
                                {JSON.stringify(activityStats?.inferredKeys || null, null, 2)}
                            </pre>
                        </Descriptions.Item>
                        <Descriptions.Item label='CSV Preview (first 30 lines)'>
                            <pre style={{ ...jsonStyle, maxHeight: 220 }}>
                                {activityRawPreview || '(empty)'}
                            </pre>
                        </Descriptions.Item>
                    </Descriptions>
                </Card>
            )}
        </Space>
    );
}


