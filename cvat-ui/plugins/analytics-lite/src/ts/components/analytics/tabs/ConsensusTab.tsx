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
import notification from 'antd/lib/notification';
import { ReloadOutlined } from '@ant-design/icons';

import { getCore, Task } from 'cvat-core-wrapper';
import { AnalyticsLiteProps, ResourceKind } from '../types';
import { isCvatError } from '../../../api';
import { jsonStyle } from '../styles';

export default function ConsensusTab(
    props: AnalyticsLiteProps & { kind: ResourceKind; debugEnabled: boolean },
): JSX.Element {
    const { resource, kind } = props;
    const core = useMemo(() => getCore(), []);

    const [consensusLoading, setConsensusLoading] = useState(false);
    const [consensusError, setConsensusError] = useState<string | null>(null);
    const [consensusSettings, setConsensusSettings] = useState<any | null>(null);
    const [merging, setMerging] = useState(false);
    const [consensusJobsLoading, setConsensusJobsLoading] = useState(false);
    const [consensusJobsError, setConsensusJobsError] = useState<string | null>(null);
    const [consensusJobs, setConsensusJobs] = useState<any[] | null>(null);

    const loadConsensusSettings = async (): Promise<void> => {
        setConsensusLoading(true);
        setConsensusError(null);
        setConsensusSettings(null);
        try {
            if (kind !== 'task') {
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

    const loadConsensusJobs = async (): Promise<void> => {
        if (kind !== 'task') {
            setConsensusJobs(null);
            return;
        }

        setConsensusJobsLoading(true);
        setConsensusJobsError(null);
        setConsensusJobs(null);
        try {
            const list = await core.jobs.get({ taskID: resource.id }, true);
            const jobsArr = Array.from(list as any[]);
            jobsArr.sort((a, b) => (a.id || 0) - (b.id || 0));
            setConsensusJobs(jobsArr);
        } catch (err: unknown) {
            if (isCvatError(err) && (err.code === 403 || err.code === 401)) {
                setConsensusJobsError('没有权限获取 task jobs');
            } else {
                setConsensusJobsError(err instanceof Error ? err.message : '无法加载 task jobs');
            }
        } finally {
            setConsensusJobsLoading(false);
        }
    };

    const mergeConsensus = async (): Promise<void> => {
        setMerging(true);
        try {
            if (typeof (resource as any).mergeConsensusJobs !== 'function') {
                notification.warning({ message: '当前资源不支持 mergeConsensusJobs' });
                return;
            }
            const rqID: string = await (resource as any).mergeConsensusJobs();
            notification.success({ message: '已发起 consensus merge', description: `rq_id: ${rqID}` });
        } catch (err: unknown) {
            notification.error({ message: '无法发起 consensus merge', description: err instanceof Error ? err.message : '' });
        } finally {
            setMerging(false);
        }
    };

    useEffect(() => {
        loadConsensusSettings();
        loadConsensusJobs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resource.id, kind]);

    const consensusMetrics = useMemo(() => {
        if (kind !== 'task') return null;
        const task = resource as Task;
        const jobs = consensusJobs || (Array.isArray((task as any).jobs) ? (task as any).jobs : []);
        const replicas = jobs.map((j: any) => ({
            job_id: j.id,
            type: j.type || '-',
            stage: j.stage || '-',
            state: j.state || '-',
            parent_job_id: j.parentJobId ?? j.parent_job_id ?? null,
            replicas: j.consensusReplicas ?? j.consensus_replicas ?? 0,
        }));
        const histogram = replicas.reduce((acc: Record<string, number>, r: any) => {
            const k = String(r.replicas ?? 0);
            acc[k] = (acc[k] || 0) + 1;
            return acc;
        }, {});
        const maxReplicas = replicas.reduce((m: number, r: any) => Math.max(m, Number(r.replicas || 0)), 0);
        const enabled = (task as any).consensusEnabled ?? false;
        const quorum = consensusSettings?.quorum ?? consensusSettings?.toJSON?.()?.quorum ?? null;
        const iou = consensusSettings?.iouThreshold ?? consensusSettings?.toJSON?.()?.iou_threshold ?? null;
        return {
            enabled,
            quorum,
            iou,
            jobsTotal: replicas.length,
            maxReplicas,
            histogram,
            rows: replicas,
        };
    }, [kind, resource, consensusJobs, consensusSettings]);

    return (
        <Space direction='vertical' size='middle' style={{ width: '100%' }}>
            <Alert
                type='info'
                showIcon
                message='Consensus Info'
                description='Consensus 用于 replicas 一致性与合并（quorum/merge）。Settings 是 task 级；merge 可在 task/job 级触发（会返回 rq_id）。'
            />

            <Card
                size='small'
                title='Consensus 指标（Task Only）'
                extra={(consensusLoading || consensusJobsLoading) && <Spin size='small' />}
            >
                {kind !== 'task' ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='仅 Task 级展示指标' />
                ) : (
                    <>
                        {(consensusError || consensusJobsError) && (
                            <Alert type='error' showIcon style={{ marginBottom: 12 }} message={consensusError || consensusJobsError} />
                        )}
                        <Descriptions size='small' bordered column={2}>
                            <Descriptions.Item label='Enabled'>{consensusMetrics?.enabled ? 'Yes' : 'No'}</Descriptions.Item>
                            <Descriptions.Item label='Quorum'>{consensusMetrics?.quorum ?? '-'}</Descriptions.Item>
                            <Descriptions.Item label='IoU Threshold'>
                                {typeof consensusMetrics?.iou === 'number' ? consensusMetrics.iou : (consensusMetrics?.iou ?? '-')}
                            </Descriptions.Item>
                            <Descriptions.Item label='Jobs Total'>{consensusMetrics?.jobsTotal ?? 0}</Descriptions.Item>
                            <Descriptions.Item label='Max Replicas'>{consensusMetrics?.maxReplicas ?? 0}</Descriptions.Item>
                            <Descriptions.Item label='Replicas Histogram'>
                                <pre style={{ ...jsonStyle, maxHeight: 120 }}>
                                    {JSON.stringify(consensusMetrics?.histogram || {}, null, 2)}
                                </pre>
                            </Descriptions.Item>
                        </Descriptions>
                    </>
                )}
            </Card>

            <Card size='small' title='Jobs（replicas 分布）' extra={consensusJobsLoading && <Spin size='small' />}>
                <Table
                    size='small'
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                    rowKey={(r: any) => r.job_id}
                    dataSource={(consensusMetrics?.rows || []).map((r: any) => ({
                        ...r,
                        link: kind === 'task' ? `/tasks/${resource.id}/jobs/${r.job_id}` : '#',
                    }))}
                    columns={[
                        { title: 'Job ID', dataIndex: 'job_id', key: 'job_id' },
                        { title: 'Type', dataIndex: 'type', key: 'type' },
                        { title: 'Stage', dataIndex: 'stage', key: 'stage' },
                        { title: 'State', dataIndex: 'state', key: 'state' },
                        { title: 'Replicas', dataIndex: 'replicas', key: 'replicas' },
                        { title: 'Parent', dataIndex: 'parent_job_id', key: 'parent_job_id', render: (v: any) => v ?? '-' },
                        {
                            title: '打开',
                            key: 'open',
                            render: (_: any, r: any) => (r.link && r.link !== '#') ? (
                                <Button type='link' href={r.link} target='_blank'>打开 Job</Button>
                            ) : (
                                <Text type='secondary'>-</Text>
                            ),
                        },
                    ]}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无 Jobs' /> }}
                />
            </Card>

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
                        icon={<ReloadOutlined />}
                        onClick={loadConsensusJobs}
                        disabled={consensusJobsLoading || kind !== 'task'}
                    >
                        刷新 Jobs
                    </Button>
                    <Button type='primary' loading={merging} onClick={mergeConsensus} disabled={kind === 'project'}>
                        发起 Merge
                    </Button>
                </Space>
                {kind !== 'task' && (
                    <div style={{ marginTop: 8 }}>
                        <Text type='secondary'>* Settings 仅 Task 级可读</Text>
                    </div>
                )}
            </Card>

            <Card size='small' title='Consensus Settings' extra={consensusLoading && <Spin size='small' />}>
                {consensusSettings ? (
                    <pre style={jsonStyle}>{JSON.stringify(consensusSettings, null, 2)}</pre>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No Settings Loaded' />
                )}
            </Card>
        </Space>
    );
}


