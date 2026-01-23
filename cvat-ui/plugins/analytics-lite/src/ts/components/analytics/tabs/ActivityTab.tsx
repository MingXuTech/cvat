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
import Row from 'antd/lib/row';
import Col from 'antd/lib/col';
import notification from 'antd/lib/notification';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Tooltip,
    Legend,
} from 'chart.js';

import { getCore, Project, Task, Job } from 'cvat-core-wrapper';
import { AnalyticsLiteProps, ResourceKind } from '../types';
import { fmtDurationSeconds, parseCSV, parseTsMs } from '../utils';
import { jsonStyle } from '../styles';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const SCOPE_LABELS: Record<string, string> = {
    'change:frame': '切换帧',
    'update:task': '更新任务',
    'update:job': '更新作业',
    'user:activity': '用户活动',
    'send:working_time': '上报工作时长',
    'click:element': '点击界面元素',
    'load:job': '加载作业',
    'save:job': '保存作业',
    'load:workspace': '加载工作区',
    'draw:object': '绘制标注对象',
    'paste:object': '粘贴标注对象',
    'copy:object': '复制标注对象',
    'delete:object': '删除标注对象',
    'merge:objects': '合并标注对象',
    'split:objects': '拆分标注对象',
    'group:objects': '分组标注对象',
    'resize:object': '调整标注对象大小',
    'drag:object': '拖拽标注对象',
    'action:undo': '撤销操作',
    'action:redo': '重做操作',
    'zoom:image': '缩放图像',
    'fit:image': '适应图像',
    'rotate:image': '旋转图像',
};

const ACTION_LABELS: Record<string, string> = {
    create: '创建',
    update: '更新',
    delete: '删除',
    change: '变更',
    load: '加载',
    save: '保存',
    send: '发送',
    draw: '绘制',
    paste: '粘贴',
    copy: '复制',
    merge: '合并',
    split: '拆分',
    group: '分组',
    resize: '调整大小',
    drag: '拖拽',
    zoom: '缩放',
    fit: '适配',
    rotate: '旋转',
    action: '操作',
};

const RESOURCE_LABELS: Record<string, string> = {
    frame: '帧',
    task: '任务',
    job: '作业',
    project: '项目',
    annotations: '标注',
    label: '标签',
    issue: '问题',
    comment: '评论',
    object: '标注对象',
    objects: '标注对象',
    image: '图像',
    element: '界面元素',
    workspace: '工作区',
};

function formatScopeLabel(scope: string): string {
    if (!scope || scope === '(no scope)') return '无范围';
    if (scope in SCOPE_LABELS) return SCOPE_LABELS[scope];
    if (scope.includes(':')) {
        const [action, resource] = scope.split(':', 2);
        const actionLabel = ACTION_LABELS[action] || action;
        const resourceLabel = RESOURCE_LABELS[resource] || resource;
        return `${actionLabel}${resourceLabel}`;
    }
    return scope;
}

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
    const [expandedUserKeys, setExpandedUserKeys] = useState<React.Key[]>([]);
    const [selectedUserKey, setSelectedUserKey] = useState<string | null>(null);

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
            setExpandedUserKeys([]);
            setSelectedUserKey(null);

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
                scopeHistory: Array<{ ts: number; scope: string }>;
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
                        scopeHistory: [],
                    });
                }
                const u = byUser.get(userKey)!;
                u.events += 1;
                if (ts) u.timestamps.push(ts);
                u.scopes.set(scope, (u.scopes.get(scope) || 0) + 1);
                if (ts) u.scopeHistory.push({ ts, scope });

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
                    .map(([s, c]) => `${formatScopeLabel(s)}(${c})`)
                    .join(', ');
                return { ...u, activeSec, topScopes, _tsSorted: tsSorted };
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

    const buildDailyActive = (tsSorted: number[]): Array<{ date: string; activeSec: number }> => {
        if (!tsSorted.length) return [];
        const idleThresholdSec = Math.max(1, idleThresholdMinutes) * 60;
        const byDate = new Map<string, number>();
        for (let i = 1; i < tsSorted.length; i++) {
            const prev = tsSorted[i - 1];
            const curr = tsSorted[i];
            const deltaSec = Math.max(0, Math.min((curr - prev) / 1000, idleThresholdSec));
            const dateKey = new Date(prev).toISOString().slice(0, 10);
            byDate.set(dateKey, (byDate.get(dateKey) || 0) + deltaSec);
        }
        return Array.from(byDate.entries())
            .map(([date, activeSec]) => ({ date, activeSec }))
            .sort((a, b) => (a.date < b.date ? -1 : 1));
    };

    const barOptions = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'top' as const },
            tooltip: {
                callbacks: {
                    label: (ctx: any) => {
                        const sec = ctx?.parsed?.y ?? 0;
                        return `${ctx.dataset.label}: ${fmtDurationSeconds(sec)}`;
                    },
                },
            },
        },
        scales: {
            y: {
                ticks: {
                    callback: (value: any) => fmtDurationSeconds(Number(value) || 0),
                },
            },
        },
    }), [idleThresholdMinutes]);

    const selectedUser = useMemo(() => {
        if (!activityStats || !selectedUserKey) return null;
        return activityStats.tables.users.find((u: any) => (u.key || u.userId) === selectedUserKey) || null;
    }, [activityStats, selectedUserKey]);

    const selectedUserScopes = useMemo(() => {
        if (!selectedUser) return [];
        return Array.from((selectedUser.scopes || new Map()).entries())
            .map(([scope, count]: [string, number]) => ({
                scope,
                count,
                label: formatScopeLabel(scope),
            }))
            .sort((a, b) => b.count - a.count);
    }, [selectedUser]);

    const highlightScopes = new Set([
        'draw:object',
        'delete:object',
        'merge:objects',
        'split:objects',
        'resize:object',
        'drag:object',
    ]);
    const highlightScopeOrder = [
        'draw:object',
        'delete:object',
        'merge:objects',
        'split:objects',
        'resize:object',
        'drag:object',
    ];

    const topScopesList = useMemo(() => selectedUserScopes.slice(0, 5), [selectedUserScopes]);

    const highlightScopesList = useMemo(() => {
        const map = new Map(selectedUserScopes.map((s) => [s.scope, s]));
        return highlightScopeOrder.map((scope) => {
            const hit = map.get(scope);
            return {
                scope,
                count: hit ? hit.count : 0,
                label: hit ? hit.label : formatScopeLabel(scope),
            };
        });
    }, [selectedUserScopes]);

    const selectedUserHistory = useMemo(() => {
        if (!selectedUser) return [];
        const history = Array.isArray(selectedUser.scopeHistory) ? selectedUser.scopeHistory : [];
        return history
            .slice()
            .sort((a, b) => b.ts - a.ts);
    }, [selectedUser]);

    return (
        <Space direction='vertical' size='middle' style={{ width: '100%' }}>

            <Card size='small'>
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16,
                }}
                >
                    <Space>
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
                    <Space>
                        <span>Idle Threshold (minutes):</span>
                        <InputNumber
                            min={1}
                            max={120}
                            value={idleThresholdMinutes}
                            onChange={(v) => setIdleThresholdMinutes(Number(v) || 5)}
                        />
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
                        onRow={(record: any) => ({
                            onClick: () => {
                                setSelectedUserKey(record.key || record.userId || null);
                            },
                        })}
                        expandable={{
                            expandedRowKeys: expandedUserKeys,
                            expandRowByClick: true,
                            onExpand: (expanded: boolean, record: any) => {
                                const key = record.key || record.userId;
                                setExpandedUserKeys((prev) => (
                                    expanded ? Array.from(new Set([...prev, key])) : prev.filter((k) => k !== key)
                                ));
                            },
                            expandedRowRender: (record: any) => {
                                const daily = buildDailyActive(record._tsSorted || []);
                                if (!daily.length) {
                                    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='该用户暂无可用活跃数据' />;
                                }
                                return (
                                    <div style={{ height: 240 }}>
                                        <Bar
                                            data={{
                                                labels: daily.map((d) => d.date),
                                                datasets: [{
                                                    label: `Active Duration (idle<=${idleThresholdMinutes}m)`,
                                                    data: daily.map((d) => d.activeSec),
                                                    backgroundColor: '#5470c6',
                                                }],
                                            }}
                                            options={barOptions}
                                        />
                                    </div>
                                );
                            },
                        }}
                        columns={[
                            { title: 'User ID', dataIndex: 'userId', key: 'userId' },
                            { title: 'Username', dataIndex: 'username', key: 'username' },
                            { title: 'Events', dataIndex: 'events', key: 'events' },
                            {
                                title: `Estimated Active (idle<=${idleThresholdMinutes}m)`,
                                key: 'active',
                                render: (_: any, r: any) => fmtDurationSeconds(r.activeSec),
                            },
                        ]}
                    />
                </Card>
            )}

            {activityStats && (
                <Card size='small' title={selectedUser ? `当前用户 Scope（${selectedUser.username} / ${selectedUser.userId}）` : '当前用户 Scope'}>
                    {selectedUser ? (
                        selectedUserScopes.length ? (
                            <Row gutter={16} style={{ display: 'flex', alignItems: 'stretch' }}>
                                <Col span={10} style={{ display: 'flex', flexDirection: 'column' }}>
                                    <Card type='inner' size='small' title='Top Scope' style={{ marginBottom: 16 }}>
                                        <Table
                                            size='small'
                                            pagination={false}
                                            rowKey={(r: any) => r.scope}
                                            dataSource={topScopesList}
                                            columns={[
                                                { title: '行为', dataIndex: 'label', key: 'label', ellipsis: true },
                                                { title: '次数', dataIndex: 'count', key: 'count', width: 80 },
                                            ]}
                                        />
                                    </Card>
                                    <Card type='inner' size='small' title='标注关键行为频率' style={{ flex: 1 }}>
                                        <Table
                                            size='small'
                                            pagination={false}
                                            rowKey={(r: any) => r.scope}
                                            dataSource={highlightScopesList}
                                            columns={[
                                                {
                                                    title: '行为',
                                                    key: 'label',
                                                    ellipsis: true,
                                                    render: (_: any, r: any) => (
                                                        <span style={{ color: '#d46b08', fontWeight: 600 }}>
                                                            {r.label}
                                                        </span>
                                                    ),
                                                },
                                                { title: '次数', dataIndex: 'count', key: 'count', width: 80 },
                                            ]}
                                        />
                                    </Card>
                                </Col>
                                <Col span={14} style={{ position: 'relative' }}>
                                    <div style={{
                                        position: 'absolute', top: 0, bottom: 0, left: 8, right: 8,
                                    }}
                                    >
                                        <Card
                                            type='inner'
                                            size='small'
                                            title='操作历史（全部）'
                                            bodyStyle={{
                                                padding: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                                            }}
                                            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                                        >
                                            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
                                                {selectedUserHistory.length ? (
                                                    <ul style={{ padding: 0, margin: 0, listStyle: 'none' }}>
                                                        {selectedUserHistory.map((h: any, idx: number) => {
                                                            const tsLabel = (() => {
                                                                try { return new Date(h.ts).toLocaleString(); } catch { return String(h.ts); }
                                                            })();
                                                            return (
                                                                <li key={`${h.ts}-${idx}`} style={{
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    padding: '6px 0',
                                                                    borderBottom: '1px solid #f0f0f0',
                                                                    fontSize: '12px',
                                                                }}
                                                                >
                                                                    <span style={{ fontWeight: 500 }}>{formatScopeLabel(h.scope)}</span>
                                                                    <span style={{ color: '#8c8c8c' }}>{tsLabel}</span>
                                                                </li>
                                                            );
                                                        })}
                                                    </ul>
                                                ) : (
                                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无历史记录' />
                                                )}
                                            </div>
                                        </Card>
                                    </div>
                                </Col>
                            </Row>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='该用户暂无 scope 数据' />
                        )
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='请点击上面的用户行查看该用户的 scope' />
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
