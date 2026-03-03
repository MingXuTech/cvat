import React from 'react';
import Button from 'antd/lib/button';
import Card from 'antd/lib/card';
import Empty from 'antd/lib/empty';
import Space from 'antd/lib/space';
import Table from 'antd/lib/table';
import Text from 'antd/lib/typography/Text';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip as ChartTooltip,
    Legend,
} from 'chart.js';

import { ResourceKind } from '../types';
import { fmtNum, fmtRatio } from '../utils';
import { renderRoleTag } from './quality-tab.render';
import { JobRow } from './quality-tab.types';
import {
    getCounts,
    getCreatedDateStr,
    getErrorCount,
} from './quality-tab.utils';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ChartTooltip, Legend);

export type JobReportsCardProps = {
    kind: ResourceKind;
    reports: any[];
    displayedJobReports: any[];
    jobRows: JobRow[];
    filteredJobRows: JobRow[];
    jobRowsStats: { parentCount: number; consensusCount: number };
    jobRoleFilter: 'all' | 'parent' | 'consensus';
    onJobRoleFilterChange: (value: 'all' | 'parent' | 'consensus') => void;
    hasJobRows: boolean;
    creatingReport: boolean;
    qualityLoading: boolean;
    createQualityReport: () => void;
    expandedJobId: number | null;
    onExpandedJobChange: React.Dispatch<React.SetStateAction<number | null>>;
    getJobHistoryForJobId: (jobId: number) => any[];
    jobAssignees: Record<number, string | null>;
};

export default function JobReportsCard(props: JobReportsCardProps): JSX.Element {
    const {
        kind,
        reports,
        displayedJobReports,
        jobRows,
        filteredJobRows,
        jobRowsStats,
        jobRoleFilter,
        onJobRoleFilterChange,
        hasJobRows,
        creatingReport,
        qualityLoading,
        createQualityReport,
        expandedJobId,
        onExpandedJobChange,
        getJobHistoryForJobId,
        jobAssignees,
    } = props;

    return (
        <Card
            size='small'
            title={kind === 'job' ?
                `Job Reports (当前 job 最新: ${displayedJobReports.length})` :
                (kind === 'task' ?
                    `Job Reports (父: ${jobRowsStats.parentCount}, 子: ${jobRowsStats.consensusCount})` :
                    `Job Reports (每个 job 最新: ${displayedJobReports.length} / 原始 ${reports.filter((r: any) => r?.target === 'job').length})`)}
            extra={(
                <Space>
                    <Button
                        type='primary'
                        loading={creatingReport}
                        disabled={qualityLoading}
                        onClick={createQualityReport}
                    >
                        {kind === 'job' ? '重新计算 (当前 Task)' : '生成 / 重新计算'}
                    </Button>
                </Space>
            )}
        >
            {kind === 'task' && (
                <Space style={{ marginBottom: 8 }} wrap>
                    <Text type='secondary'>过滤:</Text>
                    <Button
                        size='small'
                        type={jobRoleFilter === 'all' ? 'primary' : 'default'}
                        onClick={() => onJobRoleFilterChange('all')}
                    >
                        全部
                    </Button>
                    <Button
                        size='small'
                        type={jobRoleFilter === 'parent' ? 'primary' : 'default'}
                        onClick={() => onJobRoleFilterChange('parent')}
                    >
                        Parent
                    </Button>
                    <Button
                        size='small'
                        type={jobRoleFilter === 'consensus' ? 'primary' : 'default'}
                        onClick={() => onJobRoleFilterChange('consensus')}
                    >
                        Consensus
                    </Button>
                </Space>
            )}
            {hasJobRows ? (
                <Table
                    size='small'
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: true,
                        showTotal: () => (
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                {kind === 'task' ? '当前展示每个 Job 最新的 Quality Report' : '当前展示最新的 Quality Report'}
                            </Text>
                        ),
                    }}
                    rowKey={(r: JobRow) => r.jobId}
                    dataSource={kind === 'task' ? filteredJobRows : jobRows}
                    onRow={(r: JobRow) => ({
                        onClick: () => {
                            if (r.report?.id) {
                                onExpandedJobChange((prev) => (prev === r.jobId ? null : r.jobId));
                            }
                        },
                        style: { cursor: r.report ? 'pointer' : 'default' },
                    })}
                    expandable={{
                        expandedRowKeys: expandedJobId ? [expandedJobId] : [],
                        onExpand: (expanded: boolean, r: JobRow) => {
                            if (!expanded) {
                                onExpandedJobChange(null);
                                return;
                            }
                            if (r.report?.id) {
                                onExpandedJobChange(r.jobId);
                            }
                        },
                        expandedRowRender: (r: JobRow) => {
                            const jid = r.jobId;
                            if (typeof jid !== 'number') {
                                return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='无法解析 job id' />;
                            }
                            const history = getJobHistoryForJobId(jid);
                            if (history.length < 2) {
                                return (
                                    <Empty
                                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        description={history.length === 1 ? '只有 1 次计算结果，趋势图需要至少 2 次' : '暂无趋势数据'}
                                    />
                                );
                            }
                            return (
                                <div style={{ padding: 8 }}>
                                    <div style={{ height: 260 }}>
                                        <Line
                                            data={{
                                                labels: history.map((p: any) => p.label),
                                                datasets: [
                                                    {
                                                        label: 'Accuracy (%)',
                                                        data: history.map((p: any) => (typeof p.accuracy === 'number' ? p.accuracy * 100 : null)),
                                                        borderColor: '#1677ff',
                                                        backgroundColor: 'rgba(22, 119, 255, 0.15)',
                                                        tension: 0.25,
                                                        spanGaps: true,
                                                    },
                                                    {
                                                        label: 'Precision (%)',
                                                        data: history.map((p: any) => (typeof p.precision === 'number' ? p.precision * 100 : null)),
                                                        borderColor: '#52c41a',
                                                        backgroundColor: 'rgba(82, 196, 26, 0.15)',
                                                        tension: 0.25,
                                                        spanGaps: true,
                                                    },
                                                    {
                                                        label: 'Recall (%)',
                                                        data: history.map((p: any) => (typeof p.recall === 'number' ? p.recall * 100 : null)),
                                                        borderColor: '#faad14',
                                                        backgroundColor: 'rgba(250, 173, 20, 0.15)',
                                                        tension: 0.25,
                                                        spanGaps: true,
                                                    },
                                                ],
                                            }}
                                            options={{
                                                responsive: true,
                                                maintainAspectRatio: false,
                                                plugins: {
                                                    legend: { position: 'top' as const },
                                                    tooltip: { mode: 'index' as const, intersect: false },
                                                },
                                                interaction: { mode: 'index' as const, intersect: false },
                                                scales: {
                                                    y: {
                                                        min: 0,
                                                        max: 100,
                                                        ticks: { callback: (v: any) => `${v}%` },
                                                    },
                                                },
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        },
                        rowExpandable: (r: JobRow) => !!r.report,
                    }}
                    columns={[
                        {
                            title: 'Job',
                            key: 'job',
                            render: (_: any, r: JobRow) => (
                                <span>
                                    {r.depth ? <span style={{ marginRight: 6, opacity: 0.65 }}>↳</span> : null}
                                    #{r.jobId}
                                </span>
                            ),
                        },
                        {
                            title: 'Role',
                            key: 'role',
                            render: (_: any, r: JobRow) => renderRoleTag(r.role),
                        },
                        {
                            title: 'Parent Job',
                            key: 'parent',
                            render: (_: any, r: JobRow) => (typeof r.parentJobId === 'number' ? `#${r.parentJobId}` : '-'),
                        },
                        {
                            title: 'Assignee',
                            key: 'assignee',
                            render: (_: any, r: JobRow) => {
                                const assignee = r.job?.assignee?.username ?? null;
                                if (assignee) return assignee;
                                if (typeof r.jobId !== 'number') return '-';
                                return jobAssignees[r.jobId] || '-';
                            },
                        },
                        {
                            title: 'Accuracy',
                            key: 'accuracy',
                            render: (_: any, r: JobRow) => (r.report ? fmtRatio(r.report?.summary?.accuracy) : '-'),
                        },
                        {
                            title: 'Precision',
                            key: 'precision',
                            render: (_: any, r: JobRow) => (r.report ? fmtRatio(r.report?.summary?.precision) : '-'),
                        },
                        {
                            title: 'Recall',
                            key: 'recall',
                            render: (_: any, r: JobRow) => (r.report ? fmtRatio(r.report?.summary?.recall) : '-'),
                        },
                        { title: 'TP', key: 'tp', render: (_: any, r: JobRow) => (r.report ? getCounts(r.report?.summary).tp : '-') },
                        { title: 'FP', key: 'fp', render: (_: any, r: JobRow) => (r.report ? getCounts(r.report?.summary).fp : '-') },
                        { title: 'FN', key: 'fn', render: (_: any, r: JobRow) => (r.report ? getCounts(r.report?.summary).fn : '-') },
                        { title: 'TN', key: 'tn', render: (_: any, r: JobRow) => (r.report ? getCounts(r.report?.summary).tn : '-') },
                        { title: 'Errors', key: 'errors', render: (_: any, r: JobRow) => (r.report ? fmtNum(getErrorCount(r.report?.summary)) : '-') },
                        {
                            title: 'Created',
                            key: 'created',
                            render: (_: any, r: JobRow) => {
                                const dt = r.report ? getCreatedDateStr(r.report) : null;
                                try { return dt ? new Date(dt).toLocaleString() : '-'; } catch { return dt || '-'; }
                            },
                        },
                    ]}
                />
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='暂无 Reports' />
            )}
        </Card>
    );
}
