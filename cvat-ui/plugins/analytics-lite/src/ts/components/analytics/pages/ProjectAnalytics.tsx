// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Descriptions from 'antd/lib/descriptions';
import Empty from 'antd/lib/empty';
import Progress from 'antd/lib/progress';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Table from 'antd/lib/table';

import { getCore, Project, Task } from 'cvat-core-wrapper';
import { AnalyticsLiteProps } from '../types';
import AnalyticsHeader from '../AnalyticsHeader';
import { asyncPool } from '../utils';
import { ReloadOutlined } from '@ant-design/icons';

type LabelMeta = { id: number; name: string };

function extractAnnotationsStats(
    data: any,
    labelById: Record<number, LabelMeta>,
): { validFrames: Set<number>; labelCounts: Map<string, { id: number; name: string; count: number }> } {
    const validFrames = new Set<number>();
    const labelCounts = new Map<string, { id: number; name: string; count: number }>();

    const incLabel = (labelId: any): void => {
        const idNum = typeof labelId === 'number' ? labelId : Number(labelId);
        const meta = Number.isFinite(idNum) ? labelById[idNum] : null;
        const name = meta?.name || String(labelId ?? 'unknown');
        const key = meta ? `${meta.name} (${meta.id})` : `${name} (${String(labelId ?? '-')})`;
        const current = labelCounts.get(key);
        if (current) current.count += 1;
        else labelCounts.set(key, { id: Number.isFinite(idNum) ? idNum : -1, name, count: 1 });
    };

    const addFrame = (frame: any): void => {
        const f = typeof frame === 'number' ? frame : Number(frame);
        if (Number.isInteger(f) && f >= 0) validFrames.add(f);
    };

    const shapes = Array.isArray(data?.shapes) ? data.shapes : [];
    const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
    const tags = Array.isArray(data?.tags) ? data.tags : [];

    for (const s of shapes) {
        addFrame(s?.frame);
        incLabel(s?.label_id ?? s?.labelId);
    }

    for (const t of tracks) {
        // count track as one labeled object
        incLabel(t?.label_id ?? t?.labelId);
        const tshapes = Array.isArray(t?.shapes) ? t.shapes : [];
        for (const ts of tshapes) addFrame(ts?.frame);
    }

    for (const tag of tags) {
        addFrame(tag?.frame);
        incLabel(tag?.label_id ?? tag?.labelId);
    }

    return { validFrames, labelCounts };
}

export default function ProjectAnalytics(props: AnalyticsLiteProps): JSX.Element {
    const { resource, timePeriod } = props;
    const core = useMemo(() => getCore(), []);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
    const [taskRows, setTaskRows] = useState<any[] | null>(null);
    const [totals, setTotals] = useState<any | null>(null);
    const [labelTotals, setLabelTotals] = useState<any[] | null>(null);

    const load = async (): Promise<void> => {
        try {
            setLoading(true);
            setError(null);
            setTaskRows(null);
            setTotals(null);
            setLabelTotals(null);
            setProgress({ done: 0, total: 0 });

            const project = resource as Project;
            const tasksList = await core.tasks.get({ projectId: project.id }, true);
            const tasks: Task[] = Array.from(tasksList as any[]);
            tasks.sort((a: any, b: any) => (a.id || 0) - (b.id || 0));
            setProgress({ done: 0, total: tasks.length });

            const backendAPI: string = core?.config?.backendAPI;
            const labelTotalsAcc = new Map<string, { id: number; name: string; count: number }>();

            const rows = await asyncPool(3, tasks, async (task: any) => {
                const labelById: Record<number, LabelMeta> = {};
                try {
                    const labelsUrl = `${backendAPI}/labels?task_id=${task.id}&page_size=10000`;
                    const labelsResp = await core.server.request(labelsUrl, { method: 'GET' } as any);
                    const labelsData = (labelsResp && typeof labelsResp === 'object' && 'data' in labelsResp) ?
                        (labelsResp as any).data : labelsResp;
                    const labelsArr = Array.isArray(labelsData?.results) ? labelsData.results : (Array.isArray(labelsData) ? labelsData : []);
                    for (const lbl of labelsArr) {
                        if (typeof lbl?.id === 'number') labelById[lbl.id] = { id: lbl.id, name: lbl.name || String(lbl.id) };
                    }
                } catch {
                    // ignore, fallback to unknown
                }

                const url = `${backendAPI}/tasks/${task.id}/annotations`;
                const resp = await core.server.request(url, { method: 'GET' } as any);
                const data = (resp && typeof resp === 'object' && 'data' in resp) ? (resp as any).data : resp;

                const { validFrames, labelCounts } = extractAnnotationsStats(data, labelById);
                for (const [key, meta] of labelCounts.entries()) {
                    const prev = labelTotalsAcc.get(key);
                    if (prev) prev.count += meta.count;
                    else labelTotalsAcc.set(key, { ...meta });
                }

                setProgress((p) => ({ ...p, done: Math.min(p.done + 1, p.total) }));

                const labelsArr = Array.from(labelCounts.entries())
                    .map(([key, meta]) => ({ label_key: key, label_id: meta.id, label_name: meta.name, count: meta.count }))
                    .sort((a, b) => b.count - a.count);

                const totalImages = Number(task?.size ?? task?.frameCount ?? task?.data?.size ?? 0) || 0;
                const validImages = validFrames.size;
                return {
                    task_id: task.id,
                    task_name: task.name || `Task ${task.id}`,
                    images_total: totalImages,
                    images_valid: validImages,
                    labels: labelsArr,
                    labels_top: labelsArr.slice(0, 3).map((x) => `${x.label_name}(${x.label_id}):${x.count}`).join(', '),
                    link_task: `/tasks/${task.id}`,
                    link_task_analytics: `/tasks/${task.id}/analytics`,
                };
            });

            const totalImages = rows.reduce((acc, r) => acc + (r.images_total || 0), 0);
            const totalValidImages = rows.reduce((acc, r) => acc + (r.images_valid || 0), 0);
            const totalAnn = rows.reduce((acc, r) => acc + (Array.isArray(r.labels) ? r.labels.reduce((a: any, x: any) => a + x.count, 0) : 0), 0);

            const labelTotalsArr = Array.from(labelTotalsAcc.entries())
                .map(([key, meta]) => ({ label_key: key, label_id: meta.id, label_name: meta.name, count: meta.count }))
                .sort((a, b) => b.count - a.count);

            setTaskRows(rows);
            setTotals({
                tasks: rows.length,
                images_total: totalImages,
                images_valid: totalValidImages,
                annotations_total: totalAnn,
            });
            setLabelTotals(labelTotalsArr);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : '无法加载 Project analytics');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.id]);

    const progressPct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    return (
        <div style={{
            padding: '0 12px 24px',
            boxSizing: 'border-box',
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
        }}
        >
            <AnalyticsHeader kind='project' resource={resource} timePeriod={timePeriod} />
            <Space direction='vertical' size='middle' style={{ width: '100%' }}>
                <Alert
                    type='info'
                    showIcon
                    message='Project Analytics（按 Task 聚合）'
                    description='逐个拉取项目下每个 Task 的 /annotations 来计算：图片数、有效图片数（至少一个目标的帧数）、按 label 的标注数量。Task 多/标注大时会比较慢。'
                />

                <Card size='small' title='Controls' extra={loading && <Spin size='small' />}>
                    <Space wrap>
                        <Button icon={<ReloadOutlined />} onClick={load} disabled={loading}>
                            刷新统计
                        </Button>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ color: 'rgba(255,255,255,0.65)' }}>{`进度：${progress.done}/${progress.total}`}</span>
                        </span>
                    </Space>
                    <div style={{ marginTop: 12 }}>
                        <Progress percent={progressPct} />
                    </div>
                    {error && <Alert style={{ marginTop: 12 }} type='error' showIcon message={error} />}
                </Card>

                <Card size='small' title='Project Summary'>
                    {totals ? (
                        <Descriptions size='small' bordered column={2}>
                            <Descriptions.Item label='Tasks'>{totals.tasks}</Descriptions.Item>
                            <Descriptions.Item label='Images (total)'>{totals.images_total}</Descriptions.Item>
                            <Descriptions.Item label='Images (valid)'>{totals.images_valid}</Descriptions.Item>
                            <Descriptions.Item label='Valid ratio'>
                                {totals.images_total ? `${((totals.images_valid / totals.images_total) * 100).toFixed(2)}%` : '-'}
                            </Descriptions.Item>
                            <Descriptions.Item label='Annotations (total)'>{totals.annotations_total}</Descriptions.Item>
                        </Descriptions>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='加载后显示项目汇总' />
                    )}
                </Card>

                <Card size='small' title={`Per Task (${taskRows?.length || 0})`}>
                    {taskRows ? (
                        <Table
                            size='small'
                            pagination={{ pageSize: 10, showSizeChanger: true }}
                            rowKey={(r: any) => r.task_id}
                            dataSource={taskRows}
                            expandable={{
                                expandedRowRender: (r: any) => (
                                    <div style={{ padding: 8 }}>
                                        <Table
                                            size='small'
                                            pagination={false}
                                            rowKey={(x: any) => x.label_key}
                                            dataSource={r.labels || []}
                                            columns={[
                                                { title: 'Label Name', dataIndex: 'label_name', key: 'label_name' },
                                                { title: 'Label ID', dataIndex: 'label_id', key: 'label_id' },
                                                { title: 'Count', dataIndex: 'count', key: 'count' },
                                            ]}
                                        />
                                    </div>
                                ),
                                rowExpandable: (r: any) => Array.isArray(r.labels) && r.labels.length > 0,
                            }}
                            columns={[
                                { title: 'Task ID', dataIndex: 'task_id', key: 'task_id' },
                                {
                                    title: 'Name',
                                    key: 'name',
                                    render: (_: any, r: any) => (
                                        <Space>
                                            <Button type='link' href={r.link_task} target='_blank'>{r.task_name}</Button>
                                            <Button type='link' href={r.link_task_analytics} target='_blank'>Analytics</Button>
                                        </Space>
                                    ),
                                },
                                { title: 'Images', dataIndex: 'images_total', key: 'images_total' },
                                { title: 'Valid Images', dataIndex: 'images_valid', key: 'images_valid' },
                                {
                                    title: 'Valid %',
                                    key: 'valid_ratio',
                                    render: (_: any, r: any) => (
                                        r.images_total ? `${((r.images_valid / r.images_total) * 100).toFixed(2)}%` : '-'
                                    ),
                                },
                                { title: 'Top Labels', dataIndex: 'labels_top', key: 'labels_top' },
                            ]}
                        />
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='正在加载…' />
                    )}
                </Card>

                <Card size='small' title={`Project Label Totals (${labelTotals?.length || 0})`}>
                    {labelTotals ? (
                        <Table
                            size='small'
                            pagination={{ pageSize: 20, showSizeChanger: true }}
                            rowKey={(r: any) => r.label_key}
                            dataSource={labelTotals}
                            columns={[
                                { title: 'Label Name', dataIndex: 'label_name', key: 'label_name' },
                                { title: 'Label ID', dataIndex: 'label_id', key: 'label_id' },
                                { title: 'Count', dataIndex: 'count', key: 'count' },
                            ]}
                        />
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='加载后显示 label 汇总' />
                    )}
                </Card>
            </Space>
        </div>
    );
}


