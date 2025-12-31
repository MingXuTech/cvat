// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT
// @ts-nocheck

import React, { useMemo } from 'react';
import { getCore, Project, Task, Job } from 'cvat-core-wrapper';

import { AnalyticsLiteProps, getResourceKind } from './analytics/types';
import ProjectAnalytics from './analytics/pages/ProjectAnalytics';
import TaskJobAnalytics from './analytics/pages/TaskJobAnalytics';

function AnalyticsLiteContent(props: AnalyticsLiteProps): JSX.Element {
    const { resource, timePeriod } = props;
    useMemo(() => getCore(), []); // keep parity with previous implementation

    const kind = useMemo(() => getResourceKind(resource), [resource]);
    const debugEnabled = useMemo(() => {
        try {
            return typeof window !== 'undefined' &&
                new URLSearchParams(window.location.search).get('analyticsLiteDebug') === '1';
        } catch {
            return false;
        }
    }, []);

    if (resource instanceof Project) {
        return <ProjectAnalytics resource={resource} timePeriod={timePeriod} />;
    }

    // Task / Job use the tabbed experience
    if (resource instanceof Task || resource instanceof Job) {
        return (
            <TaskJobAnalytics
                resource={resource}
                timePeriod={timePeriod}
                kind={kind}
                debugEnabled={debugEnabled}
            />
        );
    }

    // Fallback (should not happen)
    return <TaskJobAnalytics resource={resource} timePeriod={timePeriod} kind={kind} debugEnabled={debugEnabled} />;
}

export default React.memo(AnalyticsLiteContent);


