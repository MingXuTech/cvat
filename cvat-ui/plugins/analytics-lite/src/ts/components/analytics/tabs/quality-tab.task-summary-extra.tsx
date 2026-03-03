import React from 'react';
import Statistic from 'antd/lib/statistic';
import Tooltip from 'antd/lib/tooltip';
import Text from 'antd/lib/typography/Text';
import { EyeOutlined, QuestionCircleOutlined } from '@ant-design/icons';

import { GalleryMode, JobTotals } from './quality-tab.types';

export type TaskSummaryExtraProps = {
    jobTotals: JobTotals;
    gtJobsCount: number;
    dsPositiveLoading: boolean;
    gtPositiveLoading: boolean;
    onOpenGallery: (mode: GalleryMode) => void;
};

const clickableStat = (
    label: React.ReactNode,
    value: number | string | null,
    onClick?: () => void,
): JSX.Element => (
    <div
        className={onClick ? 'cvat-quality-stat cvat-quality-stat--clickable' : 'cvat-quality-stat'}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={onClick ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') onClick();
        } : undefined}
    >
        <Statistic
            title={label}
            value={value === null ? '-' : value}
            suffix={onClick ? <EyeOutlined className='cvat-quality-stat-icon' /> : undefined}
        />
    </div>
);

const labelWithTip = (label: string, tip: string): React.ReactNode => (
    <span>
        {label}
        <Tooltip title={tip}>
            <QuestionCircleOutlined className='cvat-task-quality-help' style={{ marginLeft: 6 }} />
        </Tooltip>
    </span>
);

export default function TaskSummaryExtra(props: TaskSummaryExtraProps): JSX.Element {
    const {
        jobTotals,
        gtJobsCount,
        dsPositiveLoading,
        gtPositiveLoading,
        onOpenGallery,
    } = props;

    return (
        <div>
            <div className='cvat-quality-grid cvat-quality-grid--dataset'>
                {clickableStat(
                    labelWithTip('DS目标数', 'TP + FP'),
                    jobTotals.dsObjectCount,
                    () => onOpenGallery('ds_all'),
                )}
                {clickableStat(
                    labelWithTip('GT目标数', 'TP + FN'),
                    jobTotals.gtObjectCount,
                    gtJobsCount ? () => onOpenGallery('gt_all') : undefined,
                )}
                {clickableStat(
                    labelWithTip('DS正样本图片数', '非验证帧 DS > 0（剔除 GT/validation）'),
                    jobTotals.dsPositiveImages,
                    () => onOpenGallery('ds_pos'),
                )}
                {clickableStat(
                    labelWithTip('GT正样本图片数', 'GT > 0'),
                    gtJobsCount ? jobTotals.gtPositiveImages : '-',
                    gtJobsCount ? () => onOpenGallery('gt_pos') : undefined,
                )}
                {clickableStat(
                    labelWithTip('DS负样本图片数', '非验证帧 DS = 0（剔除 GT/validation）'),
                    jobTotals.dsNegativeImages ?? '-',
                    () => onOpenGallery('ds_neg'),
                )}
                {clickableStat(
                    labelWithTip('GT负样本图片数', 'GT = 0'),
                    gtJobsCount ? (jobTotals.gtNegativeImages ?? '-') : '-',
                    gtJobsCount ? () => onOpenGallery('gt_neg') : undefined,
                )}
            </div>
            <div style={{ marginTop: 6 }}>
                <Text type='secondary' style={{ fontSize: 12 }}>
                    {jobTotals.missingReports ? `缺少 ${jobTotals.missingReports} 个 job report` : ''}
                    {(jobTotals.missingReports && (dsPositiveLoading || jobTotals.dsPositivePending ||
                        jobTotals.dsPositiveFailed || gtPositiveLoading || jobTotals.gtPositivePending ||
                        jobTotals.gtPositiveFailed)) ? ' · ' : ''}
                    {dsPositiveLoading || jobTotals.dsPositivePending ? `DS正样本计算中 ${jobTotals.dsPositivePending}` : ''}
                    {(dsPositiveLoading || jobTotals.dsPositivePending) && (jobTotals.dsPositiveFailed || gtPositiveLoading ||
                        jobTotals.gtPositivePending || jobTotals.gtPositiveFailed) ? ' · ' : ''}
                    {jobTotals.dsPositiveFailed ? `DS正样本获取失败 ${jobTotals.dsPositiveFailed}` : ''}
                    {(jobTotals.dsPositiveFailed && (gtPositiveLoading || jobTotals.gtPositivePending ||
                        jobTotals.gtPositiveFailed)) ? ' · ' : ''}
                    {gtPositiveLoading || jobTotals.gtPositivePending ? `GT正样本计算中 ${jobTotals.gtPositivePending}` : ''}
                    {(gtPositiveLoading || jobTotals.gtPositivePending) && jobTotals.gtPositiveFailed ? ' · ' : ''}
                    {jobTotals.gtPositiveFailed ? `GT正样本获取失败 ${jobTotals.gtPositiveFailed}` : ''}
                </Text>
                {(jobTotals.dsObjectCountPending || jobTotals.dsObjectCountFailed ||
                    jobTotals.gtObjectCountPending || jobTotals.gtObjectCountFailed) ? (
                        <div style={{ marginTop: 4 }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                {jobTotals.dsObjectCountPending ? `DS目标数计算中 ${jobTotals.dsObjectCountPending}` : ''}
                                {(jobTotals.dsObjectCountPending && jobTotals.dsObjectCountFailed) ? ' · ' : ''}
                                {jobTotals.dsObjectCountFailed ? `DS目标数获取失败 ${jobTotals.dsObjectCountFailed}` : ''}
                                {(jobTotals.dsObjectCountPending || jobTotals.dsObjectCountFailed) &&
                                    (jobTotals.gtObjectCountPending || jobTotals.gtObjectCountFailed) ? ' · ' : ''}
                                {jobTotals.gtObjectCountPending ? `GT目标数计算中 ${jobTotals.gtObjectCountPending}` : ''}
                                {(jobTotals.gtObjectCountPending && jobTotals.gtObjectCountFailed) ? ' · ' : ''}
                                {jobTotals.gtObjectCountFailed ? `GT目标数获取失败 ${jobTotals.gtObjectCountFailed}` : ''}
                            </Text>
                        </div>
                    ) : null}
            </div>
        </div>
    );
}
