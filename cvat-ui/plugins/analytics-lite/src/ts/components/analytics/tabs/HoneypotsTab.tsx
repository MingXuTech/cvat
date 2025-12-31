// @ts-nocheck
import React, { useEffect, useMemo, useState } from 'react';
import Alert from 'antd/lib/alert';
import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Descriptions from 'antd/lib/descriptions';
import Empty from 'antd/lib/empty';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Table from 'antd/lib/table';
import Text from 'antd/lib/typography/Text';
import { ReloadOutlined } from '@ant-design/icons';

import { getCore, Task, Job } from 'cvat-core-wrapper';
import { AnalyticsLiteProps, ResourceKind } from '../types';
import { isCvatError } from '../../../api';
import { jsonStyle } from '../styles';

export default function HoneypotsTab(
    props: AnalyticsLiteProps & { kind: ResourceKind; debugEnabled: boolean },
): JSX.Element {
    const { resource, kind } = props;
    const core = useMemo(() => getCore(), []);

    const [validationLoading, setValidationLoading] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [validationLayout, setValidationLayout] = useState<any | null>(null);

    const [honeypotsByJobLoading, setHoneypotsByJobLoading] = useState(false);
    const [honeypotsByJobError, setHoneypotsByJobError] = useState<string | null>(null);
    const [honeypotsByJob, setHoneypotsByJob] = useState<any[] | null>(null);

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

    const loadHoneypotsByJob = async (): Promise<void> => {
        if (kind !== 'task') {
            setHoneypotsByJob(null);
            return;
        }

        setHoneypotsByJobLoading(true);
        setHoneypotsByJobError(null);
        setHoneypotsByJob(null);
        try {
            const task = resource as Task;
            const jobsFromTask = Array.isArray((task as any).jobs) ? (task as any).jobs as Job[] : [];
            const jobs = jobsFromTask.length ? jobsFromTask : await core.jobs.get({ taskID: task.id }, true);

            const gtJob = jobs.find((j: any) => String(j?.type || '').toLowerCase() === 'ground_truth') || null;
            const gtJobId: number | null = gtJob ? gtJob.id : null;

            const rows: any[] = [];
            for (const job of jobs) {
                try {
                    const layout = await (job as any).validationLayout?.();
                    const honeypotFrames: number[] = layout?.honeypotFrames || [];
                    const honeypotRealFrames: number[] = layout?.honeypotRealFrames || [];
                    const mappings = honeypotFrames.map((dsFrame: number, idx: number) => ({
                        ds_frame: dsFrame,
                        gt_frame: honeypotRealFrames[idx] ?? null,
                    }));

                    const jobType = String((job as any).type || '');
                    const isGT = jobType.toLowerCase() === 'ground_truth';
                    rows.push({
                        job_id: job.id,
                        job_type: jobType || '-',
                        is_gt: isGT,
                        gt_job_id: gtJobId,
                        task_id: task.id,
                        honeypot_count: honeypotFrames.length,
                        mappings,
                    });
                } catch (e: unknown) {
                    rows.push({
                        job_id: job.id,
                        job_type: String((job as any).type || '-'),
                        is_gt: String((job as any).type || '').toLowerCase() === 'ground_truth',
                        gt_job_id: gtJobId,
                        task_id: task.id,
                        honeypot_count: 0,
                        mappings: [],
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            }

            rows.sort((a, b) => (a.is_gt === b.is_gt ? a.job_id - b.job_id : (a.is_gt ? 1 : -1)));
            setHoneypotsByJob(rows);
        } catch (err: unknown) {
            if (isCvatError(err) && (err.code === 403 || err.code === 401)) {
                setHoneypotsByJobError('没有权限按 job 读取 validation_layout');
            } else {
                setHoneypotsByJobError(err instanceof Error ? err.message : '无法按 job 加载 Honeypots 映射');
            }
        } finally {
            setHoneypotsByJobLoading(false);
        }
    };

    useEffect(() => {
        loadValidationLayout();
        loadHoneypotsByJob();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.id, kind]);

    return (
        <Space direction='vertical' size='middle' style={{ width: '100%' }}>
            <Card size='small' title='Validation Layout'>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Space>
                        <Button icon={<ReloadOutlined />} onClick={loadValidationLayout} disabled={validationLoading}>
                            刷新 Layout
                        </Button>
                        {kind === 'task' && (
                            <Button icon={<ReloadOutlined />} onClick={loadHoneypotsByJob} disabled={honeypotsByJobLoading}>
                                刷新（按 Job）
                            </Button>
                        )}
                        <Text type='secondary'>Source: `/api/tasks|jobs/{'{id}'}/validation_layout`</Text>
                    </Space>
                </div>

                {validationError && <Alert type='error' message={validationError} showIcon style={{ marginBottom: 12 }} />}
                {validationLoading && <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>}

                {!validationLoading && validationLayout ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {kind === 'task' && (
                            <Card
                                size='small'
                                type='inner'
                                title='Honeypots 指标（Task Only）'
                                extra={honeypotsByJobLoading && <Spin size='small' />}
                            >
                                <Descriptions size='small' bordered column={2}>
                                    <Descriptions.Item label='Mode'>{validationLayout?.mode ?? '-'}</Descriptions.Item>
                                    <Descriptions.Item label='Validation Frames'>{(validationLayout?.validationFrames || []).length}</Descriptions.Item>
                                    <Descriptions.Item label='Disabled Frames'>{(validationLayout?.disabledFrames || []).length}</Descriptions.Item>
                                    <Descriptions.Item label='Honeypots (Task)'>{(validationLayout?.honeypotFrames || []).length}</Descriptions.Item>
                                </Descriptions>
                                <div style={{ marginTop: 12 }}>
                                    {honeypotsByJobError && <Alert type='error' showIcon message={honeypotsByJobError} />}
                                </div>
                                <div style={{ marginTop: 12 }}>
                                    <Table
                                        size='small'
                                        pagination={{ pageSize: 10, showSizeChanger: true }}
                                        rowKey={(r: any) => r.job_id}
                                        dataSource={(honeypotsByJob ? honeypotsByJob.filter((r: any) => !r.is_gt) : [])}
                                        columns={[
                                            { title: 'Job ID (DS)', dataIndex: 'job_id', key: 'job_id' },
                                            { title: 'Honeypots', dataIndex: 'honeypot_count', key: 'honeypot_count' },
                                            { title: 'GT Job', dataIndex: 'gt_job_id', key: 'gt_job_id', render: (v: any) => v ?? '-' },
                                            {
                                                title: '打开 Job',
                                                key: 'open',
                                                render: (_: any, r: any) => (
                                                    <Button type='link' href={`/tasks/${r.task_id}/jobs/${r.job_id}`} target='_blank'>
                                                        打开 DS Job
                                                    </Button>
                                                ),
                                            },
                                        ]}
                                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无 Honeypots 数据' /> }}
                                    />
                                </div>
                            </Card>
                        )}

                        {kind === 'task' ? (
                            <Card
                                size='small'
                                type='inner'
                                title='Honeypot Frames Mapping（按 Job：GT/DS，可跳转）'
                                extra={honeypotsByJobLoading && <Spin size='small' />}
                            >
                                {honeypotsByJobError && (
                                    <Alert type='error' showIcon message={honeypotsByJobError} style={{ marginBottom: 12 }} />
                                )}
                                {honeypotsByJob ? (
                                    <Table
                                        size='small'
                                        pagination={{ pageSize: 10, showSizeChanger: true }}
                                        rowKey={(r: any) => r.job_id}
                                        dataSource={honeypotsByJob.filter((r: any) => !r.is_gt)}
                                        expandable={{
                                            expandedRowRender: (r: any) => {
                                                const mappings = Array.isArray(r.mappings) ? r.mappings : [];
                                                const shown = mappings.slice(0, 200);
                                                return (
                                                    <div style={{ padding: 8 }}>
                                                        <Table
                                                            size='small'
                                                            pagination={false}
                                                            rowKey={(m: any) => `${r.job_id}-${m.ds_frame}-${m.gt_frame}`}
                                                            dataSource={shown}
                                                            columns={[
                                                                { title: 'DS Frame（job 内看到的 honeypot）', dataIndex: 'ds_frame', key: 'ds_frame' },
                                                                { title: 'GT Frame（真实帧）', dataIndex: 'gt_frame', key: 'gt_frame' },
                                                                {
                                                                    title: '跳转',
                                                                    key: 'actions',
                                                                    render: (_: any, m: any) => {
                                                                        const taskId = r.task_id;
                                                                        const dsLink = `/tasks/${taskId}/jobs/${r.job_id}?frame=${m.ds_frame}`;
                                                                        const gtLink = r.gt_job_id ? `/tasks/${taskId}/jobs/${r.gt_job_id}?frame=${m.gt_frame}` : null;
                                                                        return (
                                                                            <Space>
                                                                                <Button type='link' href={dsLink} target='_blank'>打开 DS</Button>
                                                                                {gtLink ? (
                                                                                    <Button type='link' href={gtLink} target='_blank'>打开 GT</Button>
                                                                                ) : (
                                                                                    <Text type='secondary'>无 GT Job</Text>
                                                                                )}
                                                                            </Space>
                                                                        );
                                                                    },
                                                                },
                                                            ]}
                                                        />
                                                        {mappings.length > 200 && (
                                                            <Text type='secondary'>仅展开展示前 200 条映射（避免卡顿）</Text>
                                                        )}
                                                    </div>
                                                );
                                            },
                                            rowExpandable: (r: any) => (r.honeypot_count || 0) > 0,
                                        }}
                                        columns={[
                                            { title: 'Job ID (DS)', dataIndex: 'job_id', key: 'job_id' },
                                            { title: 'Job Type', dataIndex: 'job_type', key: 'job_type' },
                                            { title: 'Honeypots', dataIndex: 'honeypot_count', key: 'honeypot_count' },
                                            { title: 'GT Job', key: 'gt_job', render: (_: any, r: any) => r.gt_job_id ?? '-' },
                                            {
                                                title: '打开 Job',
                                                key: 'open',
                                                render: (_: any, r: any) => (
                                                    <Button type='link' href={`/tasks/${r.task_id}/jobs/${r.job_id}`} target='_blank'>打开</Button>
                                                ),
                                            },
                                            {
                                                title: '备注',
                                                key: 'note',
                                                render: (_: any, r: any) => r.error ? (
                                                    <Text type='danger'>{r.error}</Text>
                                                ) : (
                                                    <Text type='secondary'>展开可看 DS↔GT 映射</Text>
                                                ),
                                            },
                                        ]}
                                    />
                                ) : (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无按 Job 的 Honeypots 数据（点“刷新（按 Job）”）' />
                                )}
                            </Card>
                        ) : (
                            <Card size='small' type='inner' title='Honeypot Frames Mapping'>
                                {validationLayout && typeof validationLayout === 'object' &&
                                ('honeypotFrames' in validationLayout) && ('honeypotRealFrames' in validationLayout) ? (
                                    <Table
                                        size='small'
                                        pagination={{ pageSize: 10, showSizeChanger: true }}
                                        rowKey={(r: any) => `${r.honeypot_frame}-${r.real_frame}`}
                                        dataSource={(validationLayout.honeypotFrames as number[]).map((frame: number, idx: number) => ({
                                            honeypot_frame: frame,
                                            real_frame: (validationLayout.honeypotRealFrames as number[])[idx],
                                        }))}
                                        columns={[
                                            { title: 'DS Frame（job 内看到的 honeypot）', dataIndex: 'honeypot_frame', key: 'honeypot_frame' },
                                            { title: 'GT Frame（真实帧）', dataIndex: 'real_frame', key: 'real_frame' },
                                            {
                                                title: '跳转',
                                                key: 'open',
                                                render: (_: any, r: any) => {
                                                    const taskId = (resource as Job).taskId;
                                                    const link = `/tasks/${taskId}/jobs/${resource.id}?frame=${r.honeypot_frame}`;
                                                    return <Button type='link' href={link} target='_blank'>打开该帧</Button>;
                                                },
                                            },
                                        ]}
                                    />
                                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                            </Card>
                        )}

                        <Card size='small' type='inner' title='Full Layout Data'>
                            <pre style={jsonStyle}>{JSON.stringify(validationLayout, null, 2)}</pre>
                        </Card>
                    </div>
                ) : (
                    !validationLoading && <Empty description='该资源没有 validation_layout（或未启用验证/无数据）' />
                )}
            </Card>
        </Space>
    );
}


