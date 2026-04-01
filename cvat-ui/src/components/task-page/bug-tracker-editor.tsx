// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import Button from 'antd/lib/button';
import Modal from 'antd/lib/modal';
import Text from 'antd/lib/typography/Text';
import { Row, Col } from 'antd/lib/grid';

import patterns from 'utils/validation-patterns';

interface Props {
    instance: any;
    disabled?: boolean;
    onChange: (bugTracker: string) => void;
}

export default function BugTrackerEditorComponent(props: Props): JSX.Element {
    const { instance, onChange, disabled } = props;

    const [bugTracker, setBugTracker] = useState(instance.bugTracker);
    const [bugTrackerEditing, setBugTrackerEditing] = useState(false);

    const instanceType = Array.isArray(instance.tasks) ? 'project' : 'task';
    let shown = false;

    const onStart = (): void => setBugTrackerEditing(true);
    const onChangeValue = (value: string): void => {
        if (value && !patterns.validateURL.pattern.test(value)) {
            if (!shown) {
                Modal.error({
                    title: `Could not update the ${instanceType} ${instance.id}`,
                    content: 'Issue tracker is expected to be URL',
                    onOk: () => {
                        shown = false;
                    },
                    className: 'cvat-modal-issue-tracker-update-task-fail',
                });
                shown = true;
            }
        } else {
            setBugTracker(value);
            setBugTrackerEditing(false);
            onChange(value);
        }
    };

    if (bugTracker) {
        return (
            <Row className='cvat-issue-tracker'>
                <Col>
                    <Text strong className='cvat-text-color'>
                        Issue Tracker
                    </Text>
                    <Text editable={disabled ? false : { onChange: onChangeValue }} className='cvat-issue-tracker-value'>
                        {bugTracker}
                    </Text>
                    <br />
                    <Button
                        onClick={(): void => {
                            window.open(bugTracker, '_blank');
                        }}
                        className='cvat-open-bug-tracker-button'
                    >
                        Open the issue
                    </Button>
                </Col>
            </Row>
        );
    }

    return (
        <Row className='cvat-issue-tracker'>
            <Col>
                <Text strong className='cvat-text-color'>
                    Issue Tracker
                </Text>
                <Text
                    className='cvat-issue-tracker-value'
                    editable={disabled ? false : {
                        editing: bugTrackerEditing,
                        onStart,
                        onChange: onChangeValue,
                    }}
                >
                    {disabled ? 'Not set' : ''}
                </Text>
            </Col>
        </Row>
    );
}
