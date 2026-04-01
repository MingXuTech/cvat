// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import Select from 'antd/lib/select';
import { JobStage, JobState } from 'cvat-core-wrapper';
import { handleDropdownKeyDown } from 'utils/dropdown-utils';

export function getJobStateClassName(value: JobState | null): string {
    switch (value) {
        case JobState.NEW:
            return 'cvat-job-state-new';
        case JobState.IN_PROGRESS:
            return 'cvat-job-state-in-progress';
        case JobState.REJECTED:
            return 'cvat-job-state-rejected';
        case JobState.COMPLETED:
            return 'cvat-job-state-completed';
        default:
            return '';
    }
}

interface JobStateSelectorProps {
    value: JobState | null;
    disabled?: boolean;
    onSelect: (newValue: JobState) => void;
}

export function JobStateSelector({ value, onSelect, disabled }: Readonly<JobStateSelectorProps>): JSX.Element {
    const jobStateClassName = getJobStateClassName(value);

    return (
        <Select
            className={`cvat-job-item-state ${jobStateClassName}`.trim()}
            popupClassName='cvat-job-item-state-dropdown'
            value={value}
            disabled={disabled}
            onChange={onSelect}
            onKeyDown={handleDropdownKeyDown}
            placeholder='Select a state'
        >
            <Select.Option className={getJobStateClassName(JobState.NEW)} value={JobState.NEW}>
                {JobState.NEW}
            </Select.Option>
            <Select.Option className={getJobStateClassName(JobState.IN_PROGRESS)} value={JobState.IN_PROGRESS}>
                {JobState.IN_PROGRESS}
            </Select.Option>
            <Select.Option className={getJobStateClassName(JobState.REJECTED)} value={JobState.REJECTED}>
                {JobState.REJECTED}
            </Select.Option>
            <Select.Option className={getJobStateClassName(JobState.COMPLETED)} value={JobState.COMPLETED}>
                {JobState.COMPLETED}
            </Select.Option>
        </Select>
    );
}

interface JobStageSelectorProps {
    value: JobStage | null;
    disabled?: boolean;
    onSelect: (newValue: JobStage) => void;
}

export function JobStageSelector({ value, onSelect, disabled }: Readonly<JobStageSelectorProps>): JSX.Element {
    return (
        <Select
            className='cvat-job-item-stage'
            popupClassName='cvat-job-item-stage-dropdown'
            value={value}
            disabled={disabled}
            onChange={onSelect}
            onKeyDown={handleDropdownKeyDown}
            placeholder='Select a stage'
        >
            <Select.Option value={JobStage.ANNOTATION}>
                {JobStage.ANNOTATION}
            </Select.Option>
            <Select.Option value={JobStage.VALIDATION}>
                {JobStage.VALIDATION}
            </Select.Option>
            <Select.Option value={JobStage.ACCEPTANCE}>
                {JobStage.ACCEPTANCE}
            </Select.Option>
        </Select>
    );
}
