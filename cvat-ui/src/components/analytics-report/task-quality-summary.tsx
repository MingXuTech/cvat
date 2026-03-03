// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Card, Spin, Statistic, Typography, Tooltip } from 'antd';
import { Link } from 'react-router-dom';
import { QuestionCircleOutlined } from '@ant-design/icons';

import {
    getCore, Task, JobType, JobState, JobStage, QualityReport,
} from 'cvat-core-wrapper';

const core = getCore();

interface Props {
    task: Task;
    extraSummary?: ReactNode;
    onMetricClick?: (metric: 'tp' | 'fp' | 'fn') => void;
    summaryOverride?: any;
    frameCountsOverride?: { tp: number; fp: number; fn: number; tn: number } | null;
    frameCountsLoadingOverride?: boolean;
}

function TaskQualitySummary({
    task,
    extraSummary,
    onMetricClick,
    summaryOverride,
    frameCountsOverride,
    frameCountsLoadingOverride,
}: Props): JSX.Element {
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState<QualityReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [frameCounts, setFrameCounts] = useState<{ tp: number; fp: number; fn: number; tn: number } | null>(null);
    const [frameCountsLoading, setFrameCountsLoading] = useState(false);
    const summary = summaryOverride ?? report?.summary ?? null;

    const derivedCounts = useMemo(() => {
        if (!summary) return null;
        const toNum = (value: number | null | undefined): number => (
            typeof value === 'number' && Number.isFinite(value) ? value : 0
        );
        const tp = toNum(summary.validCount ?? summary.valid_count);
        const dsCount = toNum(summary.dsCount ?? summary.ds_count);
        const gtCount = toNum(summary.gtCount ?? summary.gt_count);
        const totalCount = toNum(summary.totalCount ?? summary.total_count);
        const fp = Math.max(0, dsCount - tp);
        const fn = Math.max(0, gtCount - tp);
        const hasTotal = Number.isFinite(summary.totalCount ?? summary.total_count);
        const tn = hasTotal ? Math.max(0, totalCount - dsCount - gtCount + tp) : null;
        return {
            tp,
            fp,
            fn,
            tn,
        };
    }, [summary]);

    const { consensusEnabled, consensusIncomplete, gtReady } = useMemo(() => {
        const jobs = task.jobs || [];
        const consensusReplicaJobs = jobs.filter((job) => job.type === JobType.CONSENSUS_REPLICA);
        const consensusParents = jobs.filter((job) => (
            job.type === JobType.ANNOTATION && job.consensusReplicas > 0
        ));
        const consensusReplicaIncomplete = consensusReplicaJobs
            .some((job) => job.state !== JobState.COMPLETED);
        const consensusParentIncomplete = consensusParents
            .some((job) => job.state !== JobState.COMPLETED);
        const consensusIncomplete = task.consensusEnabled &&
            (consensusReplicaIncomplete || consensusParentIncomplete);
        const gtJob = jobs.find((job) => job.type === JobType.GROUND_TRUTH) || null;
        const gtReady = !!gtJob && gtJob.stage === JobStage.ACCEPTANCE && gtJob.state === JobState.COMPLETED;
        return {
            consensusEnabled: task.consensusEnabled,
            consensusIncomplete,
            gtReady,
        };
    }, [task]);

    const fetchLatestReport = useCallback(async (): Promise<QualityReport | null> => {
        const [latest] = await core.analytics.quality.reports({ taskID: task.id, target: 'task' });
        return latest || null;
    }, [task.id]);

    const createReport = useCallback(async (): Promise<QualityReport | null> => {
        const org = core.config.organization.organizationSlug;
        const response = await core.server.request('/api/quality/reports', {
            method: 'post',
            data: { task_id: task.id },
            params: org ? { org } : {},
        });

        if (response?.status === 201 && response?.data) {
            return new QualityReport(response.data);
        }

        if (response?.status === 202 && response?.data?.rq_id) {
            await core.requests.listen(response.data.rq_id, { callback: () => {} });
            return fetchLatestReport();
        }

        return null;
    }, [task.id, fetchLatestReport]);

    useEffect(() => {
        let active = true;
        const run = async (): Promise<void> => {
            setError(null);

            if (consensusEnabled && consensusIncomplete) {
                setReport(null);
                return;
            }

            if (!gtReady) {
                setReport(null);
                return;
            }

            try {
                setLoading(true);
                const latest = await fetchLatestReport();
                if (!active) return;

                if (latest) {
                    setReport(latest);
                    return;
                }

                const created = await createReport();
                if (!active) return;

                setReport(created);
            } catch (err: unknown) {
                if (!active) return;
                setError(err instanceof Error ? err.message : 'Unknown error');
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        run();

        return () => {
            active = false;
        };
    }, [consensusEnabled, consensusIncomplete, gtReady, fetchLatestReport, createReport]);

    useEffect(() => {
        let active = true;
        const loadFrameCounts = async (): Promise<void> => {
            if (frameCountsOverride !== undefined) {
                if (active) {
                    setFrameCounts(null);
                    setFrameCountsLoading(false);
                }
                return;
            }
            if (!report?.id) {
                setFrameCounts(null);
                return;
            }

            setFrameCountsLoading(true);
            try {
                const org = core.config.organization.organizationSlug;
                const response = await core.server.request(`/api/quality/reports/${report.id}/data`, {
                    params: {
                        format: 'json',
                        ...(org ? { org } : {}),
                    },
                });
                let data = response?.data ?? response;
                if (typeof data === 'string') {
                    data = JSON.parse(data);
                }
                const frameResults = data?.frame_results ?? data?.frameResults;
                if (!frameResults || typeof frameResults !== 'object') {
                    if (active) setFrameCounts(null);
                    return;
                }

                let tp = 0;
                let fp = 0;
                let fn = 0;
                let tn = 0;
                for (const fr of Object.values(frameResults)) {
                    const ann = (fr as any)?.annotations ?? {};
                    const valid = ann.valid_count ?? ann.validCount ?? 0;
                    const extra = ann.extra_count ?? ann.extraCount ?? 0;
                    const missing = ann.missing_count ?? ann.missingCount ?? 0;
                    const ds = ann.ds_count ?? ann.dsCount ?? 0;
                    const gt = ann.gt_count ?? ann.gtCount ?? 0;

                    if (valid > 0) tp += 1;
                    if (extra > 0) fp += 1;
                    if (missing > 0) fn += 1;
                    if (ds === 0 && gt === 0) tn += 1;
                }

                if (active) setFrameCounts({ tp, fp, fn, tn });
            } catch {
                if (active) setFrameCounts(null);
            } finally {
                if (active) setFrameCountsLoading(false);
            }
        };

        loadFrameCounts();
        return () => {
            active = false;
        };
    }, [report?.id, frameCountsOverride]);

    const moduleTitle = (title: React.ReactNode): JSX.Element => (
        <div className='cvat-quality-module-title'>{title}</div>
    );

    const effectiveFrameCounts = frameCountsOverride !== undefined ? frameCountsOverride : frameCounts;
    const effectiveFrameCountsLoading = frameCountsOverride !== undefined ?
        !!frameCountsLoadingOverride : frameCountsLoading;

    const formatObjImg = (obj: number | null | undefined, key: 'tp' | 'fp' | 'fn' | 'tn'): string => {
        const objVal = typeof obj === 'number' && Number.isFinite(obj) ? obj : 0;
        const imgVal = effectiveFrameCounts?.[key];
        const imgText = (typeof imgVal === 'number' && Number.isFinite(imgVal)) ?
            String(imgVal) :
            (effectiveFrameCountsLoading ? '...' : '-');
        return `${objVal} / ${imgText}`;
    };

    const renderObjImg = (obj: number | null | undefined, key: 'tp' | 'fp' | 'fn' | 'tn'): React.ReactNode => {
        const objVal = typeof obj === 'number' && Number.isFinite(obj) ? obj : 0;
        const imgVal = effectiveFrameCounts?.[key];
        const imgText = (typeof imgVal === 'number' && Number.isFinite(imgVal)) ?
            String(imgVal) :
            (effectiveFrameCountsLoading ? '...' : '-');
        return (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                <span>{objVal}</span>
                <span style={{ opacity: 0.6 }}>/</span>
                <span>{imgText}</span>
            </span>
        );
    };

    const statCell = (
        label: React.ReactNode,
        value: number | string,
        options?: {
            clickable?: boolean;
            onClick?: () => void;
            suffix?: React.ReactNode;
            precision?: number;
            valueRender?: (node: React.ReactNode) => React.ReactNode;
            extraSummary?: React.ReactNode;
        },
    ): JSX.Element => {
        const clickable = options?.clickable && options?.onClick;
        const titleNode = options?.extraSummary ? (
            <span>
                {label}
                <Tooltip title={options.extraSummary}>
                    <QuestionCircleOutlined className='cvat-task-quality-help' />
                </Tooltip>
            </span>
        ) : label;
        return (
            <div
                className={clickable ? 'cvat-quality-stat cvat-quality-stat--clickable' : 'cvat-quality-stat'}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? options?.onClick : undefined}
                onKeyDown={clickable ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') options?.onClick?.();
                } : undefined}
            >
                <Statistic
                    title={titleNode}
                    value={value}
                    precision={options?.precision}
                    suffix={options?.suffix}
                    valueRender={options?.valueRender}
                />
            </div>
        );
    };

    if (consensusEnabled && consensusIncomplete) {
        return (
            <Card title='Task annotation quality' className='cvat-task-quality-card'>
                <Alert
                    type='warning'
                    showIcon
                    message='Consensus is not finished'
                    description={(
                        <span>
                            Please complete all consensus jobs and run merge before viewing quality metrics.{' '}
                            <Link to={`/tasks/${task.id}/consensus`}>Open consensus management</Link>
                        </span>
                    )}
                />
                {extraSummary ? (
                    <div className='cvat-quality-module cvat-quality-module--dataset'>
                        {moduleTitle('数据集详情')}
                        {extraSummary}
                    </div>
                ) : null}
            </Card>
        );
    }

    if (!gtReady) {
        return (
            <Card title='Task annotation quality' className='cvat-task-quality-card'>
                <Alert
                    type='info'
                    showIcon
                    message='Ground truth job is not ready'
                    description='Quality metrics require a GT job in Acceptance stage with Completed state.'
                />
                {extraSummary ? (
                    <div className='cvat-quality-module cvat-quality-module--dataset'>
                        {moduleTitle('数据集详情')}
                        {extraSummary}
                    </div>
                ) : null}
            </Card>
        );
    }

    return (
        <Card
            title={(
                <span>
                    Task annotation quality{' '}
                    <Tooltip
                        title={(
                            <div className='cvat-task-quality-tooltip'>
                                <div>Metrics are computed against the GT job on validation frames.</div>
                                <div>Valid = matched annotations (TP)</div>
                                <div>Precision = Valid / DS (TP + FP)</div>
                                <div>Recall = Valid / GT (TP + FN)</div>
                                <div>Accuracy = Valid / Total (TP + FP + FN)</div>
                            </div>
                        )}
                    >
                        <QuestionCircleOutlined className='cvat-task-quality-help' />
                    </Tooltip>
                </span>
            )}
            className='cvat-task-quality-card'
        >
            {loading && (
                <div className='cvat-task-quality-loading'>
                    <Spin />
                </div>
            )}
            {!loading && error && (
                <Alert
                    type='error'
                    showIcon
                    message='Failed to load quality metrics'
                    description={error}
                />
            )}
            {!loading && !error && summary && (
                <div className='cvat-task-quality-metrics'>
                    <div className='cvat-quality-module cvat-quality-module--core'>
                        {moduleTitle('核心指标')}
                        <div className='cvat-quality-grid cvat-quality-grid--core'>
                            {statCell('Accuracy', (summary?.accuracy ?? 0) * 100, {
                                precision: 2,
                                suffix: '%',
                                extraSummary: 'TP / (TP + FP + FN)',
                            })}
                            {statCell('Precision', (summary?.precision ?? 0) * 100, {
                                precision: 2,
                                suffix: '%',
                                extraSummary: 'TP / (TP + FP)',
                            })}
                            {statCell('Recall', (summary?.recall ?? 0) * 100, {
                                precision: 2,
                                suffix: '%',
                                extraSummary: 'TP / (TP + FN)',
                            })}
                        </div>
                    </div>

                    <div className='cvat-quality-module cvat-quality-module--confusion'>
                        {moduleTitle(
                            <span>
                                混淆矩阵
                                <Tooltip title='对象数 / 图片数（基于 report 的逐帧统计）'>
                                    <QuestionCircleOutlined className='cvat-task-quality-help' style={{ marginLeft: 6 }} />
                                </Tooltip>
                            </span>,
                        )}
                        {/*
                          For each cell, we show a tooltip clarifying that:
                          left = object count, right = image count (non-exclusive).
                        */}
                        <div className='cvat-quality-grid cvat-quality-grid--confusion'>
                            {statCell('TP', formatObjImg(derivedCounts?.tp ?? 0, 'tp'), {
                                clickable: !!onMetricClick,
                                onClick: onMetricClick ? () => onMetricClick('tp') : undefined,
                                suffix: onMetricClick ? <span className='cvat-quality-stat-arrow'>&gt;</span> : undefined,
                                valueRender: () => renderObjImg(derivedCounts?.tp ?? 0, 'tp'),
                                extraSummary: '左侧为对象数，右侧为图片数。图片数按“是否包含该类结果”统计，同一图片可同时计入多个类别，因此图片数总和可能大于总图片数。',
                            })}
                            {statCell('FP', formatObjImg(derivedCounts?.fp ?? 0, 'fp'), {
                                clickable: !!onMetricClick,
                                onClick: onMetricClick ? () => onMetricClick('fp') : undefined,
                                suffix: onMetricClick ? <span className='cvat-quality-stat-arrow'>&gt;</span> : undefined,
                                valueRender: () => renderObjImg(derivedCounts?.fp ?? 0, 'fp'),
                                extraSummary: '左侧为对象数，右侧为图片数。图片数按“是否包含该类结果”统计，同一图片可同时计入多个类别，因此图片数总和可能大于总图片数。',
                            })}
                            {statCell('FN', formatObjImg(derivedCounts?.fn ?? 0, 'fn'), {
                                clickable: !!onMetricClick,
                                onClick: onMetricClick ? () => onMetricClick('fn') : undefined,
                                suffix: onMetricClick ? <span className='cvat-quality-stat-arrow'>&gt;</span> : undefined,
                                valueRender: () => renderObjImg(derivedCounts?.fn ?? 0, 'fn'),
                                extraSummary: '左侧为对象数，右侧为图片数。图片数按“是否包含该类结果”统计，同一图片可同时计入多个类别，因此图片数总和可能大于总图片数。',
                            })}
                            {statCell('TN', formatObjImg(derivedCounts?.tn ?? 0, 'tn'), {
                                valueRender: () => renderObjImg(derivedCounts?.tn ?? 0, 'tn'),
                                extraSummary: '左侧为对象数，右侧为图片数。图片数按“是否包含该类结果”统计，同一图片可同时计入多个类别，因此图片数总和可能大于总图片数。',
                            })}
                        </div>
                    </div>
                </div>
            )}
            {!loading && !error && !summary && (
                <Alert
                    type='warning'
                    showIcon
                    message='Quality report is not available yet'
                    description='Try again after the report has been generated.'
                />
            )}
            {extraSummary ? (
                <div className='cvat-quality-module cvat-quality-module--dataset'>
                    {moduleTitle('数据集详情')}
                    {extraSummary}
                </div>
            ) : null}
            {!loading && !error && report ? (
                <Typography.Text type='secondary' style={{ display: 'block', marginTop: 8 }}>
                    Report created: {new Date(report.createdDate).toLocaleString()}
                </Typography.Text>
            ) : null}
        </Card>
    );
}

export default React.memo(TaskQualitySummary);
