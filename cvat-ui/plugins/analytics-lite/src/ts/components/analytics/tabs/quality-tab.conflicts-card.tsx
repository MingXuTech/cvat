import React from 'react';
import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Empty from 'antd/lib/empty';
import Space from 'antd/lib/space';
import Spin from 'antd/lib/spin';
import Table from 'antd/lib/table';
import Text from 'antd/lib/typography/Text';
import Tooltip from 'antd/lib/tooltip';
import { QuestionCircleOutlined } from '@ant-design/icons';

import { Job } from 'cvat-core-wrapper';
import { ResourceKind } from '../types';
import { fmtNum } from '../utils';
import { renderRoleTag } from './quality-tab.render';
import { ConflictFrameRow, getConflictFrameRowsFromConflicts } from './quality-tab.conflicts';
import { TilePreview } from './quality-tab.types';
import {
    buildFrameImageUrl,
    getErrorCount,
    getJobId,
    getTaskId,
} from './quality-tab.utils';

export type ConflictsCardProps = {
    kind: ResourceKind;
    resource: any;
    conflictRoleFilter: 'all' | 'parent' | 'consensus';
    onConflictRoleFilterChange: (value: 'all' | 'parent' | 'consensus') => void;
    conflictJobReports: any[];
    conflictsByReportId: Record<number, any[] | null>;
    conflictsLoadingByReportId: Record<number, boolean>;
    conflictsErrorByReportId: Record<number, string | null>;
    validationByJobError: Record<number, string | null>;
    taskLayouts: Record<number, any>;
    jobLayouts: Record<number, any>;
    gtJobByTask: Record<number, number | null>;
    taskIdByJob: Record<number, number | null>;
    jobMetaById: Map<number, { role: 'parent' | 'consensus' | 'single'; job: Job | null; parentJobId: number | null }>;
    jobAssignees: Record<number, string | null>;
    gtImageCountByJobId: Map<number, number | null>;
    gtPositiveImageCountByJobId: Map<number, number | null>;
    orgSlug: string | null;
    ensureValidationContext: (dsJobId: number, preferredTaskId: number | null) => void;
    loadConflictsForReport: (reportId: number) => void;
    onTilePreview: (preview: Omit<TilePreview, 'nonce'>) => void;
};

export default function ConflictsCard(props: ConflictsCardProps): JSX.Element {
    const {
        kind,
        resource,
        conflictRoleFilter,
        onConflictRoleFilterChange,
        conflictJobReports,
        conflictsByReportId,
        conflictsLoadingByReportId,
        conflictsErrorByReportId,
        validationByJobError,
        taskLayouts,
        jobLayouts,
        gtJobByTask,
        taskIdByJob,
        jobMetaById,
        jobAssignees,
        gtImageCountByJobId,
        gtPositiveImageCountByJobId,
        orgSlug,
        ensureValidationContext,
        loadConflictsForReport,
        onTilePreview,
    } = props;

    return (
        <Card
            size='small'
            title='错误帧定位（按 Job，DS ↔ GT，可跳转）'
        >
            {kind === 'task' && (
                <Space style={{ marginBottom: 8 }} wrap>
                    <Text type='secondary'>过滤:</Text>
                    <Button
                        size='small'
                        type={conflictRoleFilter === 'all' ? 'primary' : 'default'}
                        onClick={() => onConflictRoleFilterChange('all')}
                    >
                        全部
                    </Button>
                    <Button
                        size='small'
                        type={conflictRoleFilter === 'parent' ? 'primary' : 'default'}
                        onClick={() => onConflictRoleFilterChange('parent')}
                    >
                        Parent
                    </Button>
                    <Button
                        size='small'
                        type={conflictRoleFilter === 'consensus' ? 'primary' : 'default'}
                        onClick={() => onConflictRoleFilterChange('consensus')}
                    >
                        Consensus
                    </Button>
                </Space>
            )}
            {conflictJobReports.length ? (
                <Table
                    size='small'
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                    rowKey={(r: any) => r.id}
                    dataSource={conflictJobReports}
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

                            const mappedRows = rows.map((f: ConflictFrameRow) => {
                                const dsFrame = f.frame;
                                const gtFrame = mode === 'gt' ? dsFrame :
                                    (mode === 'gt_pool' ? (hpMap.get(dsFrame) ?? null) : null);
                                const inValidation = gtFrame !== null ? validationSet.has(gtFrame) : validationSet.has(dsFrame);
                                const dsLink = (taskIdResolved && dsJobId) ? `/tasks/${taskIdResolved}/jobs/${dsJobId}?frame=${dsFrame}` : null;
                                const gtLink = (taskIdResolved && gtJobId && gtFrame !== null) ? `/tasks/${taskIdResolved}/jobs/${gtJobId}?frame=${gtFrame}` : null;
                                const framePreview = (typeof dsJobId === 'number') ?
                                    buildFrameImageUrl(dsJobId, dsFrame, orgSlug) : null;
                                const dsAnnoIds = Array.isArray(f.annotationIds) ? Array.from(new Set(
                                    f.annotationIds
                                        .filter((a: any) => typeof a?.jobId === 'number' && a.jobId === dsJobId)
                                        .map((a: any) => a?.objId)
                                        .filter((v: any) => typeof v === 'number' && Number.isFinite(v)),
                                )) : [];
                                const gtAnnoIds = Array.isArray(f.annotationIds) ? Array.from(new Set(
                                    f.annotationIds
                                        .filter((a: any) => typeof a?.jobId === 'number' && a.jobId === gtJobId)
                                        .map((a: any) => a?.objId)
                                        .filter((v: any) => typeof v === 'number' && Number.isFinite(v)),
                                )) : [];
                                return {
                                    ds_frame: dsFrame,
                                    gt_frame: gtFrame,
                                    in_validation: inValidation,
                                    types: f.types || [],
                                    severities: f.severities || [],
                                    count: f.count || 0,
                                    errorCount: typeof f.errorCount === 'number' ? f.errorCount : 0,
                                    warningCount: typeof f.warningCount === 'number' ? f.warningCount : 0,
                                    ds_link: dsLink,
                                    gt_link: gtLink,
                                    preview: framePreview,
                                    ds_annotation_ids: dsAnnoIds,
                                    gt_annotation_ids: gtAnnoIds,
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
                                        <div
                                            style={{
                                                display: 'grid',
                                                gap: 12,
                                                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                                            }}
                                        >
                                            {mappedRows.map((m: any) => {
                                                const severity = (m.severities || []).includes('error') ? 'error' :
                                                    ((m.severities || []).includes('warning') ? 'warning' : null);
                                                const tags = Array.from(new Set(
                                                    ([] as string[]).concat(m.severities || [], m.types || []),
                                                ));
                                                return (
                                                    <div
                                                        key={String(m.ds_frame)}
                                                        style={{
                                                            border: severity === 'error' ? '2px solid #ff4d4f' :
                                                                (severity === 'warning' ? '2px solid #faad14' : '1px solid #d9d9d9'),
                                                            borderRadius: 8,
                                                            overflow: 'hidden',
                                                            background: '#111',
                                                            position: 'relative',
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={() => onTilePreview({
                                                            src: m.preview || null,
                                                            title: `Frame ${m.ds_frame}`,
                                                            tags,
                                                            severity,
                                                            dsLink: m.ds_link || null,
                                                            gtLink: m.gt_link || null,
                                                            dsJobId: typeof dsJobId === 'number' ? dsJobId : null,
                                                            gtJobId: typeof gtJobId === 'number' ? gtJobId : null,
                                                            dsFrame: m.ds_frame,
                                                            gtFrame: m.gt_frame,
                                                            dsAnnotationIds: m.ds_annotation_ids || [],
                                                            gtAnnotationIds: m.gt_annotation_ids || [],
                                                            overlayMode: 'conflict',
                                                        })}
                                                    >
                                                        <div style={{ aspectRatio: '16/9', background: '#000' }}>
                                                            {m.preview ? (
                                                                <img
                                                                    src={m.preview}
                                                                    alt={`frame ${m.ds_frame}`}
                                                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                                />
                                                            ) : (
                                                                <div style={{
                                                                    width: '100%',
                                                                    height: '100%',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    color: '#999',
                                                                    fontSize: 12,
                                                                }}
                                                                >
                                                                    No preview
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div style={{
                                                            position: 'absolute',
                                                            left: 8,
                                                            top: 8,
                                                            background: 'rgba(0,0,0,0.65)',
                                                            color: '#fff',
                                                            padding: '2px 6px',
                                                            borderRadius: 4,
                                                            fontSize: 12,
                                                        }}
                                                        >
                                                            #{m.ds_frame}
                                                        </div>
                                                        {(typeof m.errorCount === 'number' || typeof m.warningCount === 'number') ? (
                                                            <div style={{
                                                                position: 'absolute',
                                                                right: 8,
                                                                top: 8,
                                                                display: 'flex',
                                                                gap: 4,
                                                            }}
                                                            >
                                                                <span
                                                                    style={{
                                                                        background: '#ff4d4f',
                                                                        color: '#fff',
                                                                        padding: '2px 6px',
                                                                        borderRadius: 4,
                                                                        fontSize: 11,
                                                                    }}
                                                                >
                                                                    E {m.errorCount ?? 0}
                                                                </span>
                                                                <span
                                                                    style={{
                                                                        background: '#faad14',
                                                                        color: '#111',
                                                                        padding: '2px 6px',
                                                                        borderRadius: 4,
                                                                        fontSize: 11,
                                                                    }}
                                                                >
                                                                    W {m.warningCount ?? 0}
                                                                </span>
                                                            </div>
                                                        ) : null}
                                                        <div style={{
                                                            position: 'absolute',
                                                            left: 8,
                                                            bottom: 8,
                                                            display: 'flex',
                                                            flexWrap: 'wrap',
                                                            gap: 4,
                                                        }}
                                                        >
                                                            {tags.slice(0, 3).map((t: string) => (
                                                                <span
                                                                    key={t}
                                                                    style={{
                                                                        background: t === 'error' ? '#ff4d4f' :
                                                                            (t === 'warning' ? '#faad14' : 'rgba(0,0,0,0.65)'),
                                                                        color: '#fff',
                                                                        padding: '2px 6px',
                                                                        borderRadius: 4,
                                                                        fontSize: 11,
                                                                    }}
                                                                >
                                                                    {t}
                                                                </span>
                                                            ))}
                                                            {tags.length > 3 ? (
                                                                <span
                                                                    style={{
                                                                        background: 'rgba(0,0,0,0.65)',
                                                                        color: '#fff',
                                                                        padding: '2px 6px',
                                                                        borderRadius: 4,
                                                                        fontSize: 11,
                                                                    }}
                                                                >
                                                                    +{tags.length - 3}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
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
                        { title: 'DS Job', key: 'job', render: (_: any, r: any) => getJobId(r) ?? '-' },
                        {
                            title: 'Role',
                            key: 'role',
                            render: (_: any, r: any) => {
                                const jid = getJobId(r);
                                if (typeof jid !== 'number') return <Text type='secondary'>-</Text>;
                                const meta = jobMetaById.get(jid);
                                return renderRoleTag(meta?.role ?? 'single');
                            },
                        },
                        {
                            title: 'Assignee',
                            key: 'assignee',
                            render: (_: any, r: any) => {
                                const jid = getJobId(r);
                                if (typeof jid !== 'number') return <Text type='secondary'>-</Text>;
                                const meta = jobMetaById.get(jid);
                                const assignee = meta?.job?.assignee?.username ?? null;
                                if (assignee) return assignee;
                                return jobAssignees[jid] || '-';
                            },
                        },
                        {
                            title: 'GT图片数',
                            key: 'gt_total',
                            render: (_: any, r: any) => {
                                const jid = getJobId(r);
                                if (typeof jid !== 'number') return <Text type='secondary'>-</Text>;
                                const value = gtImageCountByJobId.get(jid);
                                return typeof value === 'number' ? value : <Text type='secondary'>-</Text>;
                            },
                        },
                        {
                            title: (
                                <span>
                                    GT正样本图片数
                                    <Tooltip title='仅统计该 Job 对应的 GT 图片中，GT>0 的帧数。'>
                                        <QuestionCircleOutlined className='cvat-task-quality-help' style={{ marginLeft: 6 }} />
                                    </Tooltip>
                                </span>
                            ),
                            key: 'gt_positive',
                            render: (_: any, r: any) => {
                                const jid = getJobId(r);
                                if (typeof jid !== 'number') return <Text type='secondary'>-</Text>;
                                const value = gtPositiveImageCountByJobId.get(jid);
                                return typeof value === 'number' ? value : <Text type='secondary'>-</Text>;
                            },
                        },
                        {
                            title: (
                                <span>
                                    Errors
                                    <Tooltip title='Task annotation quality 使用的 error_count（来自 report summary），表示错误标注数量，不等同于冲突图片数量。'>
                                        <QuestionCircleOutlined className='cvat-task-quality-help' style={{ marginLeft: 6 }} />
                                    </Tooltip>
                                </span>
                            ),
                            key: 'errors',
                            render: (_: any, r: any) => fmtNum(getErrorCount(r?.summary)),
                        },
                        {
                            title: '冲突图片数量',
                            key: 'frames',
                            render: (_: any, r: any) => {
                                const reportId = r?.id;
                                const list = typeof reportId === 'number' ? (conflictsByReportId[reportId] ?? null) : null;
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
    );
}
